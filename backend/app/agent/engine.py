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

def _extract_appointment_time(text: str) -> str:
    """Extract time/date info from user message for appointment booking."""
    import re
    text_lower = text.lower()
    # Try to find explicit time patterns like "15h", "3 giờ chiều", "9:00 sáng", "thứ 7 ngày 10/2"
    time_match = re.search(r'(\d{1,2}[h:]\d{0,2})\s*(sáng|chiều|tối)?', text_lower)
    date_match = re.search(r'(thứ\s*\d|chủ nhật|ngày mai|chiều mai|sáng mai|hôm nay|cuối tuần|ngày\s*\d{1,2}[/\-]\d{1,2})', text_lower)
    time_str = time_match.group(0).strip() if time_match else ""
    date_str = date_match.group(0).strip() if date_match else ""
    if time_str and date_str:
        return f"{time_str} {date_str}".strip()
    elif time_str:
        return f"{time_str} (theo lịch đã thỏa thuận)"
    elif date_str:
        return f"Buổi {date_str}"
    return "Thời gian theo thỏa thuận"


# ── Trigger keywords for sales hand-off ──────────────────────────────────────
_SALES_TRIGGERS = [
    "không biết",
    "chưa chắc",
    "không rõ",
    "mình cần tư vấn thêm",
    "tư vấn giúp",
    "hỗ trợ thêm",
    "giải thích",
    "phức tạp quá",
    "em hỏi thêm",
    "anh ơi",
    "chị ơi",
]

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
    7. If agent undecided → Sales hand-off
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

        # If this is a sales message, just log it and return (no AI processing needed)
        if sender == SenderType.SALES:
            log_event(
                conversation_id=conversation_id,
                event_type=EventType.HANDOFF,
                payload={"actor": "sales", "message": text},
                actor="sales"
            )
            current_state = memory_manager.get_state(conversation_id)
            return {
                "conversation_id": conversation_id,
                "processed_message": msg.model_dump(),
                "agent_reply": None,
                "sales_reply": text,
                "state": current_state.model_dump() if current_state else {},
                "tools_called": [],
                "model_used": "n/a"
            }

        # 2. Get existing or initialize state
        current_state = memory_manager.get_state(conversation_id)
        if not current_state:
            current_state = ConversationState(
                conversation_id=conversation_id,
                created_at=ts,
                updated_at=ts
            )

        # 3. Retrieve context (recent chat + structured state)
        context = memory_manager.build_context_for_prompt(conversation_id)

        # 4. Prompt Gemini for State Analysis & Decision
        prompt = EXTRACTION_AND_STATE_PROMPT.format(
            chat_history=context["recent_chat_history"],
            current_state=current_state.model_dump_json(indent=2)
        )

        llm_resp = gemini_client.generate(
            prompt=prompt,
            system_instruction=SYSTEM_PROMPT,
            temperature=0.2,
            conversation_id=conversation_id
        )

        parsed_data = llm_resp.get("data", {})
        if not isinstance(parsed_data, dict):
            parsed_data = {}

        # 5. Update state from LLM analysis
        updated_state = self._apply_state_update(current_state, parsed_data)

        # 6. Tool Routing Decision
        tool_results = self._decide_and_execute_tools(updated_state, text, sender)

        # 7. Determine agent reply (incorporating tool results if search_listings was called)
        agent_reply_text = None
        sales_reply_text = None

        # Build a context-aware reply that reflects sender role, state, and retrieved listings
        agent_reply_text = self._compose_agent_reply(updated_state, text, sender, tool_results=tool_results)

        # 8. Check if Sales hand-off is needed
        needs_sales = self._needs_sales_handoff(updated_state, text, sender)
        if needs_sales and not updated_state.sales_handoff:
            updated_state, sales_reply_text = self._do_sales_handoff(
                updated_state, conversation_id
            )

        # 9. Append agent message if applicable
        if agent_reply_text and sender != SenderType.AGENT:
            agent_msg = Message(
                id=f"msg_{uuid.uuid4().hex[:8]}",
                conversation_id=conversation_id,
                timestamp=datetime.utcnow().isoformat(),
                sender=SenderType.AGENT,
                text=agent_reply_text
            )
            memory_manager.append_message(conversation_id, agent_msg)

            log_event(
                conversation_id=conversation_id,
                event_type=EventType.AGENT_ACTION,
                payload={
                    "action": updated_state.next_best_action.action if updated_state.next_best_action else "REPLY",
                    "target": updated_state.next_best_action.target if updated_state.next_best_action else sender.value,
                    "reply": agent_reply_text,
                    "sender_role": sender.value
                },
                actor="agent"
            )

        # 10. Append sales message if hand-off occurred
        if sales_reply_text:
            sales_msg = Message(
                id=f"msg_{uuid.uuid4().hex[:8]}",
                conversation_id=conversation_id,
                timestamp=datetime.utcnow().isoformat(),
                sender=SenderType.SALES,
                text=sales_reply_text
            )
            memory_manager.append_message(conversation_id, sales_msg)

        # Save updated state
        updated_state.updated_at = datetime.utcnow().isoformat()
        updated_state.turn_count += 1
        memory_manager.save_state(updated_state)

        return {
            "conversation_id": conversation_id,
            "processed_message": msg.model_dump(),
            "agent_reply": agent_reply_text,
            "sales_reply": sales_reply_text,
            "state": updated_state.model_dump(),
            "tools_called": tool_results,
            "model_used": llm_resp.get("model_used", "vucar-heuristics")
        }

    def _compose_agent_reply(
        self,
        state: ConversationState,
        text: str,
        sender: SenderType,
        tool_results: Optional[List[Dict[str, Any]]] = None
    ) -> Optional[str]:
        """
        Build a contextual reply that:
        - If listings were found from search_listings tool, presents them directly to the buyer!
        - Uses the LLM-suggested message if available
        - Falls back to role-aware templates when missing
        """
        # Determine intent: is user explicitly asking to view photos/listings?
        photo_terms = [
            "hình", "ảnh", "xem ảnh", "xem hình", "cho xem", "gửi hình",
            "gửi ảnh", "mẫu xe", "cho mình xem", "gửi xe"
        ]
        is_asking_photo = any(pt in text.lower() for pt in photo_terms)

        # 1. ONLY send photos/listing cards when the user explicitly asks for photos/listings,
        # or when this turn specifically executed search_listings and the user is asking "có xe chưa" / searching options
        asking_for_listings = is_asking_photo or any(kw in text.lower() for kw in ["có xe chưa", "có những xe nào", "gửi xe tham khảo", "cho xem xe"])

        if asking_for_listings:
            matched_listings = []
            if tool_results:
                for tr in tool_results:
                    if tr.get("tool_name") == "search_listings":
                        matched_listings = tr.get("result", {}).get("listings", [])
                        if matched_listings:
                            break

            if not matched_listings and state.listing_context.candidate_listing_ids:
                from backend.app.agent.tools import db
                for lid in state.listing_context.candidate_listing_ids[:3]:
                    item = db.find_by_id(lid)
                    if item:
                        matched_listings.append(item)

            if not matched_listings and state.listing_context.current_listing_id:
                from backend.app.agent.tools import db
                item = db.find_by_id(state.listing_context.current_listing_id)
                if item:
                    matched_listings.append(item)

            if matched_listings:
                listing_lines = []
                for idx, item in enumerate(matched_listings[:3], 1):
                    price_mil = item['price'] / 1_000_000
                    price_str = f"{price_mil:.1f}".rstrip('0').rstrip('.') + " triệu"
                    cert_badge = " [Vucar Certified 120 điểm]" if item.get("vucar_certified") else ""
                    img_url = item.get("image_url", "")
                    img_md = f"![{item.get('model')}]({img_url})\n" if (img_url and is_asking_photo) else ""
                    listing_lines.append(
                        f"{img_md}"
                        f"**{idx}. 🏍️ {item.get('brand')} {item.get('model')} ({item.get('year')})**{cert_badge}\n"
                        f"• Giá: **{price_str}** | ODO: {item.get('odo', 0):,} km | Khu vực: {item.get('district', item.get('location', ''))}\n"
                        f"• Tình trạng pháp lý: {item.get('paperwork_status', 'Chính chủ, công chứng sang tên ngay')}"
                    )
                
                listings_text = "\n\n".join(listing_lines)
                greeting = "Dạ Vucar gửi bạn hình ảnh thực tế và thông tin chi tiết xe trong kho kiểm định của sàn:" if is_asking_photo else "Dạ Vucar gửi bạn danh sách xe đang có sẵn trong kho kiểm định phù hợp:"
                return (
                    f"{greeting}\n\n"
                    f"{listings_text}\n\n"
                    f"👉 Bạn quan tâm chiếc nào nhất để Vucar kết nối người bán hoặc sắp xếp lịch hẹn kiểm định xe thực tế ạ?"
                )

        # 2. Normal conversational flow: prefer LLM/heuristic suggested message
        # --- Check tool results first for special overrides ---
        if tool_results:
            for tr in tool_results:
                tool_name = tr.get("tool_name")

                # Appointment booked → confirmation message
                if tool_name == "book_appointment":
                    res = tr.get("result", {})
                    apt_time = res.get("time", "thời gian đã thỏa thuận")
                    apt_place = res.get("place", "Vucar Hub")
                    return (
                        f"✅ Vucar đã xác nhận lịch hẹn thành công!\n\n"
                        f"📅 **Thời gian:** {apt_time}\n"
                        f"📍 **Địa điểm:** {apt_place}\n"
                        f"🔧 **Dịch vụ:** Kiểm định kỹ thuật 120 điểm + Hỗ trợ công chứng hợp đồng\n\n"
                        f"Kỹ thuật viên Vucar sẽ có mặt đúng giờ để hỗ trợ hai bên kiểm tra xe và ký kết an toàn ạ! "
                        f"Mã lịch hẹn: `{res.get('appointment_id', 'N/A')}`"
                    )

                # Listing detail fetched → present paperwork/inspection info
                if tool_name == "get_listing_detail" and tr.get("result", {}).get("status") == "success":
                    listing = tr["result"]["listing"]
                    brand = listing.get("brand", "")
                    model = listing.get("model", "")
                    year = listing.get("year", "")
                    paperwork = listing.get("paperwork_status", "Chưa có thông tin")
                    certified = listing.get("vucar_certified", False)
                    score = listing.get("inspection_score", "N/A")
                    cert_text = f"✅ Vucar Certified ({score}/100 điểm kiểm định)" if certified else "⚠️ Chưa kiểm định Vucar"
                    return (
                        f"Dạ Vucar đã kiểm tra thông tin pháp lý xe **{brand} {model} {year}**:\n\n"
                        f"📄 **Tình trạng giấy tờ:** {paperwork}\n"
                        f"🔍 **Kiểm định:** {cert_text}\n\n"
                        f"{'✅ Xe này đủ điều kiện sang tên ngay trong ngày, bạn an tâm đặt cọc ạ!' if 'chính chủ' in paperwork.lower() or 'sang tên ngay' in paperwork.lower() else '⚠️ Vucar khuyên bạn nên yêu cầu kiểm tra pháp lý kỹ trước khi đặt cọc để đảm bảo an toàn ạ!'}"
                    )

        if state.next_best_action and state.next_best_action.suggested_message:
            msg = state.next_best_action.suggested_message.strip()
            if msg:
                return msg

        # Role-aware fallback templates
        c = state.constraints
        lc = state.listing_context
        stage = state.lead_stage.value

        if sender == SenderType.SELLER:
            # Acknowledge seller's information and bridge to buyer needs
            if lc.asking_price:
                price_vnd = f"{int(lc.asking_price/1_000_000)}tr"
                return (
                    f"Dạ cảm ơn anh/chị đã cung cấp thông tin. "
                    f"Vucar đã ghi nhận xe {lc.brand or ''} {lc.model or ''} "
                    f"{'đời ' + str(lc.year) if lc.year else ''} giá {price_vnd}. "
                    f"Chúng em sẽ kết nối với những người mua thiện chí trong khu vực "
                    f"({c.location or 'TP. Hồ Chí Minh'}) phù hợp ngân sách ạ!"
                )
            return (
                "Dạ cảm ơn anh/chị đã chia sẻ thông tin về xe. "
                "Vucar hỗ trợ kết nối người mua thiện chí và kiểm định 120 điểm miễn phí. "
                "Anh/chị có thể cho thêm thông tin về giá bán và tình trạng giấy tờ không ạ?"
            )

        elif sender == SenderType.BUYER:
            brands_str = ", ".join(c.brands) if c.brands else "xe máy"
            budget_str = f"tầm {int(c.budget_max/1_000_000)}tr" if c.budget_max else ""
            loc_str = c.location or "TP. Hồ Chí Minh"

            if stage == "DISCOVERY":
                return (
                    f"Dạ chào bạn! Vucar có thể hỗ trợ bạn tìm {brands_str} {budget_str} "
                    f"tại {loc_str}. Bạn có thêm yêu cầu về đời xe, ODO hoặc tình trạng giấy tờ không ạ?"
                )
            elif stage == "MATCHING":
                return (
                    f"Dạ Vucar đang lọc các xe {brands_str} {budget_str} tại {loc_str} "
                    f"đạt chuẩn kiểm định 120 điểm. Hệ thống sẽ gửi các phương án tốt nhất ngay!"
                )
            elif stage == "NEGOTIATION":
                return (
                    "Dạ Vucar ghi nhận tình hình đàm phán giá. "
                    "Chúng em sẽ hỗ trợ phân tích giá trị thị trường và đề xuất phương án hợp lý cho cả hai bên ạ!"
                )

        return (
            "Dạ Vucar đã ghi nhận thông tin từ bạn và đang hỗ trợ điều phối giao dịch an toàn ạ!"
        )

    def _needs_sales_handoff(
        self,
        state: ConversationState,
        text: str,
        sender: SenderType
    ) -> bool:
        """
        Determine if the conversation needs a human sales agent.
        Triggers:
        1. Action is CLARIFY_PREFERENCE and agent has no specific listing info
        2. User text contains confusion/handoff keywords
        3. Multiple CLARIFY_PREFERENCE actions in a row (>= 2 turns undecided)
        4. Explicit escalation action
        """
        if state.sales_handoff:
            return False  # already handed off

        action = (state.next_best_action.action if state.next_best_action else "").upper()

        # Explicit escalation
        if action in ["ESCALATE", "ESCALATE_PAPERWORK_RISK", "ESCALATE_TO_HUMAN"]:
            return True

        text_lower = text.lower()
        # Confusion signals from user
        if any(kw in text_lower for kw in _SALES_TRIGGERS):
            return True

        # Agent undecided + no meaningful constraints after several turns
        if action == "CLARIFY_PREFERENCE" and state.turn_count >= 2:
            has_data = bool(
                state.constraints.budget_max
                or state.constraints.brands
                or state.constraints.models
                or state.listing_context.current_listing_id
            )
            if not has_data:
                return True

        return False

    def _do_sales_handoff(
        self,
        state: ConversationState,
        conversation_id: str
    ):
        """
        Create a sales participant, update state, log ESCALATION event,
        and return the sales greeting message.
        """
        import uuid as _uuid
        sales_id = f"sales_{_uuid.uuid4().hex[:8]}"
        state.participants.sales_id = sales_id
        state.participants.sales_name = "Sales Vucar"
        state.sales_handoff = True
        state.sales_handoff_reason = (
            f"Agent không đủ thông tin để đưa ra quyết định. "
            f"Sales được kết nối để hỗ trợ trực tiếp. "
            f"Stage hiện tại: {state.lead_stage.value}"
        )

        sales_message = (
            "Chào bạn! 👋 Mình là **Sales Vucar** – sẽ hỗ trợ bạn trực tiếp nhé. "
            "Bạn có thể chia sẻ thêm về nhu cầu cụ thể (loại xe, ngân sách, khu vực) "
            "để mình tìm phương án phù hợp nhất cho bạn không ạ?"
        )

        log_event(
            conversation_id=conversation_id,
            event_type=EventType.ESCALATION,
            payload={
                "reason": state.sales_handoff_reason,
                "sales_id": sales_id,
                "stage": state.lead_stage.value
            },
            actor="agent_engine"
        )

        log_event(
            conversation_id=conversation_id,
            event_type=EventType.HANDOFF,
            payload={"from": "agent", "to": "sales", "sales_id": sales_id},
            actor="agent_engine"
        )

        return state, sales_message

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

        # Next Best Action – handle both flat and nested formats
        if "action" in data and "next_best_action" not in data:
            data["next_best_action"] = {
                "action": data.get("action", "CLARIFY_PREFERENCE"),
                "target": data.get("target", "buyer"),
                "rationale": data.get("rationale", ""),
                "suggested_message": data.get("suggested_message", "")
            }

        if "next_best_action" in data and isinstance(data["next_best_action"], dict):
            nba = data["next_best_action"]
            state.next_best_action = NextBestAction(
                action=nba.get("action", "CLARIFY_PREFERENCE"),
                target=nba.get("target", "buyer"),
                rationale=nba.get("rationale", "Phân tích ngữ cảnh hội thoại"),
                suggested_message=nba.get("suggested_message") or None
            )
        elif not state.next_best_action:
            state.next_best_action = NextBestAction(
                action="CLARIFY_PREFERENCE",
                target="buyer",
                rationale="Hỗ trợ người mua và người bán",
                suggested_message=None
            )

        # Summary
        if "summary" in data and data["summary"]:
            state.summary = data["summary"]

        return state

    def _decide_and_execute_tools(self, state: ConversationState, text: str, sender: SenderType) -> List[Dict[str, Any]]:
        tool_results = []
        action = state.next_best_action.action if state.next_best_action else ""
        text_lower = text.lower()

        # Condition 1: Search Listings when buyer needs options, mentions vehicle criteria, or asks for photos/suggestions
        photo_request_terms = ["hình", "ảnh", "xem ảnh", "xem hình", "cho xem", "gửi hình", "gửi ảnh", "mẫu xe", "có xe chưa", "cho mình xem"]
        is_asking_photo = any(t in text_lower for t in photo_request_terms)

        if action in ["SEARCH_LISTINGS", "PROPOSE_NEGOTIATION"] or is_asking_photo or (sender == SenderType.BUYER and state.lead_stage in [LeadStage.DISCOVERY, LeadStage.MATCHING]):
            if state.constraints.budget_max or state.constraints.brands or state.constraints.models or is_asking_photo or state.listing_context.current_listing_id:
                call_id = f"tool_{uuid.uuid4().hex[:8]}"
                tool_args = {
                    "brand": state.constraints.brands[0] if state.constraints.brands else None,
                    "model": state.constraints.models[0] if state.constraints.models else None,
                    "price_max": state.constraints.budget_max,
                    "location": state.constraints.location or "TP. Hồ Chí Minh",
                    "year_min": state.constraints.year_min
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

                # Populate candidate listings in state; auto-set current_listing_id if not yet set
                if res.get("listings"):
                    state.listing_context.candidate_listing_ids = [item["id"] for item in res["listings"]]
                    if not state.listing_context.current_listing_id:
                        state.listing_context.current_listing_id = res["listings"][0]["id"]

                log_event(
                    conversation_id=state.conversation_id,
                    event_type=EventType.TOOL_CALL,
                    payload={"tool": "search_listings", "args": tool_args, "results_count": res.get("total_found", 0)},
                    actor="agent_engine"
                )

        # Condition 2: Get Listing Detail when user asks about paperwork, inspection score, or legal status
        paperwork_terms = ["giấy tờ", "pháp lý", "sang tên", "hồ sơ", "kiểm định", "điểm kiểm", "tình trạng xe", "chính chủ", "rủi ro"]
        is_asking_detail = any(t in text_lower for t in paperwork_terms) or action in ["ESCALATE_PAPERWORK_RISK", "VERIFY_PAPERWORK"]
        listing_id_for_detail = state.listing_context.current_listing_id or (
            state.listing_context.candidate_listing_ids[0] if state.listing_context.candidate_listing_ids else None
        )
        if is_asking_detail and listing_id_for_detail:
            call_id = f"tool_{uuid.uuid4().hex[:8]}"
            detail_res = get_listing_detail(listing_id_for_detail)
            rec = ToolExecutionRecord(
                tool_name="get_listing_detail",
                call_id=call_id,
                arguments={"listing_id": listing_id_for_detail},
                result=detail_res
            )
            state.tool_history.append(rec)
            tool_results.append(rec.model_dump())

            # Sync paperwork status into state from real listing data
            if detail_res.get("status") == "success":
                listing_data = detail_res["listing"]
                if listing_data.get("paperwork_status"):
                    state.listing_context.paperwork_status = listing_data["paperwork_status"]
                if listing_data.get("vucar_certified") is not None:
                    state.listing_context.vucar_certified = listing_data["vucar_certified"]

            log_event(
                conversation_id=state.conversation_id,
                event_type=EventType.TOOL_CALL,
                payload={"tool": "get_listing_detail", "listing_id": listing_id_for_detail, "status": detail_res.get("status")},
                actor="agent_engine"
            )

        # Condition 3: Create Chat Bridge when buyer and seller engage
        if not state.channel_id and (state.lead_stage in [LeadStage.MATCHING, LeadStage.NEGOTIATION] or action in ["ADDRESS_BYPASS", "BRIDGE_BUYER_SELLER"]):
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

        # Condition 4: Escalation log if critical paperwork or bypass risk is present
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

        # Condition 5: Book Appointment
        # Trigger when: action==BOOK_APPOINTMENT, OR user message contains appointment + time signals
        appointment_intent_signals = ["hẹn", "đặt lịch", "xem xe lúc", "lịch hẹn", "gặp nhau", "kiểm định trực tiếp"]
        appointment_time_signals = ["giờ", "ngày", "thứ", "sáng", "chiều", "tối", ":00", "am", "pm"]
        is_booking = (
            action == "BOOK_APPOINTMENT"
            or (
                any(t in text_lower for t in appointment_intent_signals)
                and any(t in text_lower for t in appointment_time_signals)
            )
        )

        if is_booking and not state.appointment_id:
            # Auto-create channel bridge if not yet created
            if not state.channel_id:
                buyer_id = state.participants.buyer_id
                seller_id = state.participants.seller_id or f"seller_{state.conversation_id}"
                listing_id = state.listing_context.current_listing_id or "list_default"
                bridge_res = create_chat_bridge(buyer_id, seller_id, listing_id)
                state.channel_id = bridge_res["channel_id"]
                log_event(
                    conversation_id=state.conversation_id,
                    event_type=EventType.TOOL_CALL,
                    payload={"tool": "create_chat_bridge", "channel_id": state.channel_id, "trigger": "auto_for_appointment"},
                    actor="agent_engine"
                )

            apt_time = _extract_appointment_time(text)
            apt_place = "Vucar Hub Quận 10 (Hỗ trợ kiểm định 120 điểm)"
            call_id = f"tool_{uuid.uuid4().hex[:8]}"
            apt_res = book_appointment(
                channel_id=state.channel_id,
                time=apt_time,
                place=apt_place
            )
            state.appointment_id = apt_res.get("appointment_id")
            state.lead_stage = LeadStage.APPOINTMENT  # ← Update Lead Stage

            rec = ToolExecutionRecord(
                tool_name="book_appointment",
                call_id=call_id,
                arguments={"channel_id": state.channel_id, "time": apt_time, "place": apt_place},
                result=apt_res
            )
            state.tool_history.append(rec)
            tool_results.append(rec.model_dump())

            log_event(
                conversation_id=state.conversation_id,
                event_type=EventType.TOOL_CALL,
                payload={
                    "tool": "book_appointment",
                    "appointment_id": state.appointment_id,
                    "time": apt_time,
                    "place": apt_place,
                    "new_stage": LeadStage.APPOINTMENT.value
                },
                actor="agent_engine"
            )

        return tool_results

agent_engine = AgentEngine()
