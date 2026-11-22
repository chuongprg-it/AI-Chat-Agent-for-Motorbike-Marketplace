import uuid
from typing import Dict, Any, List, Optional
from datetime import datetime
from backend.app.models.schema import (
    Message, ConversationState, LeadStage, SenderType, EventType,
    RiskSignal, RiskLevel, NextBestAction, BuyerConstraints, ListingContext,
    ToolExecutionRecord
)
from backend.app.agent.memory import memory_manager
from backend.app.agent.gemini_client import gemini_client
from backend.app.agent.prompts import SYSTEM_PROMPT, EXTRACTION_AND_STATE_PROMPT
from backend.app.agent.tools import (
    search_listings, get_listing_detail, create_chat_bridge, book_appointment, log_event
)

class AgentEngine:
    """
    Core Agent Loop for Vucar Marketplace:
    Performs Reason + Act (ReAct) cycle:
    1. Observe new message
    2. Retrieve Tiered Context (Memory + State)
    3. Update Structured State (Constraints, Risks, Stage)
    4. Reason on Next Best Action
    5. Execute internal tools if warranted
    6. Generate mediated response and log event telemetry
    """

    def process_message(
        self,
        conversation_id: str,
        sender: SenderType,
        text: str,
        timestamp: Optional[str] = None
    ) -> Dict[str, Any]:
        ts = timestamp or datetime.utcnow().isoformat()
        msg = Message(
            id=f"msg_{uuid.uuid4().hex[:8]}",
            conversation_id=conversation_id,
            timestamp=ts,
            sender=sender,
            text=text
        )

        # 1. Append to raw message log
        memory_manager.append_message(conversation_id, msg)

        # 2. Get existing or initialize state
        current_state = memory_manager.get_state(conversation_id)
        if not current_state:
            current_state = ConversationState(
                conversation_id=conversation_id,
                created_at=ts,
                updated_at=ts
            )

        # 3. Retrieve context
        context = memory_manager.build_context_for_prompt(conversation_id)

        # 4. Prompt Gemini for State Analysis & Decision
        prompt = EXTRACTION_AND_STATE_PROMPT.format(
            chat_history=context["recent_chat_history"],
            current_state=current_state.model_dump_json(indent=2)
        )

        llm_resp = gemini_client.generate(
            prompt=prompt,
            system_instruction=SYSTEM_PROMPT,
            temperature=0.2
        )

        parsed_data = llm_resp.get("data", {})
        if not isinstance(parsed_data, dict):
            parsed_data = {}

        # 5. Update state from LLM analysis
        updated_state = self._apply_state_update(current_state, parsed_data)

        # 6. Tool Routing Decision
        tool_results = self._decide_and_execute_tools(updated_state, text, sender)

        # 7. Generate or format Agent reply
        agent_reply_text = None
        if updated_state.next_best_action and updated_state.next_best_action.suggested_message:
            agent_reply_text = updated_state.next_best_action.suggested_message

        # If agent replied, append agent message
        if agent_reply_text and sender != SenderType.AGENT:
            agent_msg = Message(
                id=f"msg_{uuid.uuid4().hex[:8]}",
                conversation_id=conversation_id,
                timestamp=datetime.utcnow().isoformat(),
                sender=SenderType.AGENT,
                text=agent_reply_text
            )
            memory_manager.append_message(conversation_id, agent_msg)

            # Telemetry for agent action
            log_event(
                conversation_id=conversation_id,
                event_type=EventType.AGENT_ACTION,
                payload={
                    "action": updated_state.next_best_action.action,
                    "target": updated_state.next_best_action.target,
                    "reply": agent_reply_text
                },
                actor="agent"
            )

        # Save updated state
        memory_manager.save_state(updated_state)

        return {
            "conversation_id": conversation_id,
            "processed_message": msg.model_dump(),
            "agent_reply": agent_reply_text,
            "state": updated_state.model_dump(),
            "tools_called": tool_results,
            "model_used": llm_resp.get("model_used", "gemini-2.5-flash")
        }

    def _apply_state_update(self, state: ConversationState, data: Dict[str, Any]) -> ConversationState:
        # Lead Stage
        if "lead_stage" in data:
            try:
                state.lead_stage = LeadStage(data["lead_stage"])
            except Exception:
                pass

        # Constraints
        if "constraints" in data and isinstance(data["constraints"], dict):
            c = data["constraints"]
            state.constraints.budget_min = c.get("budget_min", state.constraints.budget_min)
            state.constraints.budget_max = c.get("budget_max", state.constraints.budget_max)
            state.constraints.location = c.get("location", state.constraints.location)
            if c.get("brands"):
                state.constraints.brands = list(set(state.constraints.brands + c.get("brands", [])))
            if c.get("models"):
                state.constraints.models = list(set(state.constraints.models + c.get("models", [])))
            if c.get("year_min"):
                state.constraints.year_min = c.get("year_min")
            if c.get("max_odo"):
                state.constraints.max_odo = c.get("max_odo")
            if c.get("deal_breakers"):
                state.constraints.deal_breakers = list(set(state.constraints.deal_breakers + c.get("deal_breakers", [])))

        # Listing Context
        if "listing_context" in data and isinstance(data["listing_context"], dict):
            lc = data["listing_context"]
            for k, v in lc.items():
                if v is not None and hasattr(state.listing_context, k):
                    setattr(state.listing_context, k, v)

        # Open Questions
        if "open_questions" in data and isinstance(data["open_questions"], list):
            state.open_questions = data["open_questions"]

        # Risks
        if "risks" in data and isinstance(data["risks"], list):
            state.risks = []
            for r in data["risks"]:
                if isinstance(r, dict):
                    level = RiskLevel.MEDIUM
                    try:
                        level = RiskLevel(r.get("level", "MEDIUM"))
                    except Exception:
                        pass
                    state.risks.append(RiskSignal(
                        category=r.get("category", "GENERAL"),
                        level=level,
                        description=r.get("description", "")
                    ))

        # Next Best Action
        if "next_best_action" in data and isinstance(data["next_best_action"], dict):
            nba = data["next_best_action"]
            state.next_best_action = NextBestAction(
                action=nba.get("action", "CLARIFY_PREFERENCE"),
                target=nba.get("target", "buyer"),
                rationale=nba.get("rationale", ""),
                suggested_message=nba.get("suggested_message", "")
            )

        # Summary
        if "summary" in data and data["summary"]:
            state.summary = data["summary"]

        return state

    def _decide_and_execute_tools(self, state: ConversationState, text: str, sender: SenderType) -> List[Dict[str, Any]]:
        tool_results = []
        action = state.next_best_action.action if state.next_best_action else ""

        # Condition 1: Search Listings when buyer needs options or when negotiating price gap
        if action in ["SEARCH_LISTINGS", "PROPOSE_NEGOTIATION"] or (sender == SenderType.BUYER and state.lead_stage in [LeadStage.DISCOVERY, LeadStage.MATCHING]):
            if state.constraints.budget_max or state.constraints.brands:
                call_id = f"tool_{uuid.uuid4().hex[:8]}"
                tool_args = {
                    "brand": state.constraints.brands[0] if state.constraints.brands else None,
                    "price_max": state.constraints.budget_max or 30000000,
                    "location": state.constraints.location or "TP. Hồ Chí Minh",
                    "year_min": state.constraints.year_min or 2020
                }

                res = search_listings(**tool_args)

                rec = ToolExecutionRecord(
                    tool_name="search_listings",
                    call_id=call_id,
                    arguments=tool_args,
                    result=res
                )
                state.tool_history.append(rec)
                tool_results.append(rec.model_dump())

                # Populate candidate listings in state
                if res.get("listings"):
                    state.listing_context.candidate_listing_ids = [item["id"] for item in res["listings"]]

                # Telemetry
                log_event(
                    conversation_id=state.conversation_id,
                    event_type=EventType.TOOL_CALL,
                    payload={"tool": "search_listings", "args": tool_args, "results_count": res.get("total_found", 0)},
                    actor="agent_engine"
                )

        # Condition 2: Create Chat Bridge when buyer and seller engage
        if not state.channel_id and (state.lead_stage in [LeadStage.MATCHING, LeadStage.NEGOTIATION] or action == "ADDRESS_BYPASS"):
            call_id = f"tool_{uuid.uuid4().hex[:8]}"
            buyer_id = state.participants.buyer_id
            seller_id = state.participants.seller_id or f"seller_{state.conversation_id}"
            listing_id = state.listing_context.current_listing_id or "list_default"

            bridge_res = create_chat_bridge(buyer_id, seller_id, listing_id)
            state.channel_id = bridge_res["channel_id"]

            rec = ToolExecutionRecord(
                tool_name="create_chat_bridge",
                call_id=call_id,
                arguments={"buyer_id": buyer_id, "seller_id": seller_id, "listing_id": listing_id},
                result=bridge_res
            )
            state.tool_history.append(rec)
            tool_results.append(rec.model_dump())

            log_event(
                conversation_id=state.conversation_id,
                event_type=EventType.TOOL_CALL,
                payload={"tool": "create_chat_bridge", "channel_id": state.channel_id},
                actor="agent_engine"
            )

        # Condition 3: Escalation log if critical paperwork or bypass risk is present
        has_critical_risk = any(r.level in [RiskLevel.HIGH, RiskLevel.CRITICAL] for r in state.risks)
        if has_critical_risk and not state.escalated_to_human:
            state.escalated_to_human = True
            high_risks = [f"[{r.category}] {r.description}" for r in state.risks if r.level in [RiskLevel.HIGH, RiskLevel.CRITICAL]]
            state.escalation_reason = " | ".join(high_risks)

            log_event(
                conversation_id=state.conversation_id,
                event_type=EventType.ESCALATION,
                payload={
                    "stage": state.lead_stage.value,
                    "reason": state.escalation_reason,
                    "action_taken": action
                },
                actor="agent_engine"
            )

        # Condition 4: Book appointment if appointment agreed
        if "hẹn" in text.lower() and ("giờ" in text.lower() or "ngày" in text.lower() or "thứ" in text.lower()) and state.channel_id:
            call_id = f"tool_{uuid.uuid4().hex[:8]}"
            apt_res = book_appointment(
                channel_id=state.channel_id,
                time="15:00 Ngày mai",
                place="Vucar Hub Quận 10 (Hỗ trợ kiểm định 120 điểm)"
            )
            state.appointment_id = apt_res.get("appointment_id")
            state.lead_stage = LeadStage.APPOINTMENT

            rec = ToolExecutionRecord(
                tool_name="book_appointment",
                call_id=call_id,
                arguments={"channel_id": state.channel_id},
                result=apt_res
            )
            state.tool_history.append(rec)
            tool_results.append(rec.model_dump())

        return tool_results

agent_engine = AgentEngine()
