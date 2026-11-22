from enum import Enum
from typing import List, Optional, Dict, Any
from pydantic import BaseModel, Field
from datetime import datetime

class LeadStage(str, Enum):
    DISCOVERY = "DISCOVERY"
    MATCHING = "MATCHING"
    NEGOTIATION = "NEGOTIATION"
    APPOINTMENT = "APPOINTMENT"
    CLOSING = "CLOSING"
    DROPPED = "DROPPED"

class SenderType(str, Enum):
    BUYER = "buyer"
    SELLER = "seller"
    AGENT = "agent"
    SYSTEM = "system"

class EventType(str, Enum):
    USER_MESSAGE = "USER_MESSAGE"
    AGENT_ACTION = "AGENT_ACTION"
    TOOL_CALL = "TOOL_CALL"
    TOOL_RESULT = "TOOL_RESULT"
    STATE_UPDATE = "STATE_UPDATE"
    ESCALATION = "ESCALATION"
    HANDOFF = "HANDOFF"
    FEEDBACK = "FEEDBACK"

class RiskLevel(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"

class RiskSignal(BaseModel):
    category: str = Field(..., description="Category: PAPERWORK, PRICE_GAP, DISINTERMEDIATION, ODO, FRAUD, CONDITION")
    level: RiskLevel = RiskLevel.MEDIUM
    description: str = Field(..., description="Risk explanation in Vietnamese")
    detected_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())
    resolved: bool = False
    resolution_action: Optional[str] = None

class BuyerConstraints(BaseModel):
    budget_min: Optional[float] = None
    budget_max: Optional[float] = None
    currency: str = "VND"
    location: Optional[str] = None
    districts: List[str] = Field(default_factory=list)
    brands: List[str] = Field(default_factory=list)
    models: List[str] = Field(default_factory=list)
    year_min: Optional[int] = None
    year_max: Optional[int] = None
    max_odo: Optional[int] = None
    deal_breakers: List[str] = Field(default_factory=list)

class ListingContext(BaseModel):
    current_listing_id: Optional[str] = None
    brand: Optional[str] = None
    model: Optional[str] = None
    year: Optional[int] = None
    odo: Optional[int] = None
    asking_price: Optional[float] = None
    paperwork_status: Optional[str] = None
    vucar_certified: Optional[bool] = None
    candidate_listing_ids: List[str] = Field(default_factory=list)

class NextBestAction(BaseModel):
    action: str = Field(..., description="E.g. CLARIFY_PREFERENCE, SEARCH_LISTINGS, BRIDGE_BUYER_SELLER, PROPOSE_NEGOTIATION, ESCALATE_PAPERWORK_RISK, ADDRESS_BYPASS, BOOK_APPOINTMENT, CLOSE_DEAL")
    target: str = Field(..., description="Target party: buyer | seller | both | ops_human")
    rationale: str = Field(..., description="Operational reason why this action was chosen based on state")
    suggested_message: Optional[str] = Field(None, description="Pre-composed or agent message in Vietnamese")

class ToolExecutionRecord(BaseModel):
    tool_name: str
    call_id: str
    arguments: Dict[str, Any]
    result: Dict[str, Any]
    timestamp: str = Field(default_factory=lambda: datetime.utcnow().isoformat())
    status: str = "success"

class Message(BaseModel):
    id: Optional[str] = None
    conversation_id: str
    timestamp: str = Field(default_factory=lambda: datetime.utcnow().isoformat())
    sender: SenderType
    text: str
    metadata: Dict[str, Any] = Field(default_factory=dict)

class ConversationParticipants(BaseModel):
    buyer_id: str = "buyer_01"
    buyer_name: Optional[str] = "Người Mua"
    seller_id: Optional[str] = None
    seller_name: Optional[str] = None
    agent_id: str = "vucar_ai_agent"

class ConversationState(BaseModel):
    conversation_id: str
    participants: ConversationParticipants = Field(default_factory=ConversationParticipants)
    lead_stage: LeadStage = LeadStage.DISCOVERY
    constraints: BuyerConstraints = Field(default_factory=BuyerConstraints)
    listing_context: ListingContext = Field(default_factory=ListingContext)
    open_questions: List[str] = Field(default_factory=list)
    risks: List[RiskSignal] = Field(default_factory=list)
    next_best_action: Optional[NextBestAction] = None
    tool_history: List[ToolExecutionRecord] = Field(default_factory=list)
    summary: str = Field("", description="Compact rolling summary of conversation and commitments")
    channel_id: Optional[str] = None
    appointment_id: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())
    turn_count: int = 0
    escalated_to_human: bool = False
    escalation_reason: Optional[str] = None

class EventLog(BaseModel):
    event_id: str
    conversation_id: str
    timestamp: str = Field(default_factory=lambda: datetime.utcnow().isoformat())
    event_type: EventType
    payload: Dict[str, Any]
    actor: str = "agent"

class FeedbackRecord(BaseModel):
    feedback_id: str
    conversation_id: str
    timestamp: str = Field(default_factory=lambda: datetime.utcnow().isoformat())
    context_snapshot: Dict[str, Any]
    state_snapshot: Dict[str, Any]
    action_taken: str
    outcome: str = Field(..., description="e.g., APPOINTMENT_BOOKED, DEAL_CLOSED, NEGOTIATION_STALLED, BUYER_DROPPED, SELLER_BYPASSED")
    user_satisfaction_score: Optional[int] = None
    notes: Optional[str] = None
