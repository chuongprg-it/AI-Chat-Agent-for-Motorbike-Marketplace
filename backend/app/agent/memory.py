from typing import List, Dict, Any, Optional
from datetime import datetime
from backend.app.models.schema import Message, ConversationState, EventType, EventLog
from backend.app.agent.tools import log_event

class MemoryManager:
    """
    Tiered Memory Strategy for Vucar AI Agent:
    1. Raw Logs: Immutable, append-only chronological log of every message and system event.
    2. Structured State: The single source of truth for entity attributes, constraints, lead stage, and active risks.
    3. Rolling Summary: High-density semantic narrative compacted over turns, preserving key commitments and deal-breakers.
    """

    def __init__(self):
        # In-memory store: conversation_id -> List[Message]
        self.raw_logs: Dict[str, List[Message]] = {}
        # conversation_id -> ConversationState
        self.structured_states: Dict[str, ConversationState] = {}
        # Max uncompacted turns before trigger rolling summary
        self.compaction_threshold: int = 6

    def append_message(self, conversation_id: str, message: Message):
        if conversation_id not in self.raw_logs:
            self.raw_logs[conversation_id] = []
        self.raw_logs[conversation_id].append(message)

        # Log event to telemetry
        log_event(
            conversation_id=conversation_id,
            event_type=EventType.USER_MESSAGE,
            payload={
                "sender": message.sender.value if hasattr(message.sender, "value") else str(message.sender),
                "text": message.text,
                "timestamp": message.timestamp
            },
            actor=message.sender.value if hasattr(message.sender, "value") else str(message.sender)
        )

    def get_raw_messages(self, conversation_id: str) -> List[Message]:
        return self.raw_logs.get(conversation_id, [])

    def get_state(self, conversation_id: str) -> Optional[ConversationState]:
        return self.structured_states.get(conversation_id)

    def save_state(self, state: ConversationState):
        state.updated_at = datetime.utcnow().isoformat()
        state.turn_count = len(self.raw_logs.get(state.conversation_id, []))
        self.structured_states[state.conversation_id] = state

        # Telemetry: State Update
        log_event(
            conversation_id=state.conversation_id,
            event_type=EventType.STATE_UPDATE,
            payload={
                "lead_stage": state.lead_stage.value,
                "risks_count": len(state.risks),
                "active_risks": [r.category for r in state.risks],
                "next_action": state.next_best_action.action if state.next_best_action else None,
                "turn_count": state.turn_count
            },
            actor="agent_engine"
        )

    def build_context_for_prompt(self, conversation_id: str, max_recent_messages: int = 8) -> Dict[str, Any]:
        """
        Retrieves context efficiently:
        - Compact rolling summary of older turns
        - Full fidelity of recent N turns
        - Current structured state
        """
        raw_msgs = self.raw_logs.get(conversation_id, [])
        state = self.get_state(conversation_id)

        if len(raw_msgs) <= max_recent_messages:
            recent_turns = raw_msgs
            summary_context = state.summary if state else "Bắt đầu cuộc trò chuyện mới."
        else:
            # We compact older messages, and keep last N messages in full
            older_msgs = raw_msgs[:-max_recent_messages]
            recent_turns = raw_msgs[-max_recent_messages:]
            # Combine state summary with compacted note
            summary_context = state.summary if (state and state.summary) else self._compact_messages(older_msgs)

        formatted_recent = []
        for m in recent_turns:
            formatted_recent.append(f"[{m.timestamp}] {m.sender.value.upper()}: {m.text}")

        return {
            "rolling_summary": summary_context,
            "recent_chat_history": "\n".join(formatted_recent),
            "state_snapshot": state.model_dump() if state else None
        }

    def _compact_messages(self, messages: List[Message]) -> str:
        """
        Rule-based and semantic compaction: Prunes low-information chatter (chào bạn, dạ vâng)
        and extracts key claims (budget numbers, vehicle brands, objections).
        """
        key_points = []
        for m in messages:
            txt = m.text.lower()
            if any(term in txt for term in ["tr", "triệu", "vnd", "odo", "202", "honda", "yamaha", "giấy tờ", "trung gian"]):
                key_points.append(f"{m.sender.value}: {m.text}")

        if not key_points:
            return "Các bên trao đổi thông tin ban đầu."
        return "Tóm tắt các điểm quan trọng trước đó:\n- " + "\n- ".join(key_points[:5])

memory_manager = MemoryManager()
