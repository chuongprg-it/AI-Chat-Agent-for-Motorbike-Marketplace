import os
import json
from typing import Dict, Any, List, Optional
from fastapi import FastAPI, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel

from backend.app.config import settings
from backend.app.models.schema import (
    SenderType, LeadStage, ConversationState, Message
)
from backend.app.agent.tools import db, get_event_logs, search_listings, TOOL_DEFINITIONS
from backend.app.agent.memory import memory_manager
from backend.app.agent.engine import agent_engine
from backend.app.agent.gemini_client import gemini_client
from backend.app.eval.evaluator import evaluation_system

app = FastAPI(
    title="Vucar Motorbike Marketplace AI Agent",
    description="Intelligent 3-way marketplace bridge between buyers and sellers with structured state, memory, tools, and evaluation.",
    version="1.0.0"
)

# Enable CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class PostMessageRequest(BaseModel):
    sender: str
    text: str

class ConfigUpdateRequest(BaseModel):
    gemini_api_key: Optional[str] = None
    gemini_model: Optional[str] = None

def load_initial_chat_history():
    """
    Parses chat_history.jsonl on startup to populate memory and compute states
    """
    if not os.path.exists(settings.CHAT_HISTORY_FILE):
        return

    with open(settings.CHAT_HISTORY_FILE, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                item = json.loads(line)
                conv_id = item["conversation_id"]
                sender = SenderType(item["sender"])
                text = item["text"]
                ts = item.get("timestamp")

                msg = Message(
                    id=f"msg_{len(memory_manager.get_raw_messages(conv_id))+1}",
                    conversation_id=conv_id,
                    timestamp=ts,
                    sender=sender,
                    text=text
                )
                memory_manager.append_message(conv_id, msg)
            except Exception as e:
                print(f"Error parsing line: {e}")

    # Process each conversation to build structured state
    for conv_id in ["c1", "c2", "c3"]:
        raw_msgs = memory_manager.get_raw_messages(conv_id)
        if raw_msgs:
            last_msg = raw_msgs[-1]
            # Initialize state with heuristic / Gemini engine
            agent_engine.process_message(
                conversation_id=conv_id,
                sender=last_msg.sender,
                text=last_msg.text,
                timestamp=last_msg.timestamp
            )

@app.on_event("startup")
def startup_event():
    load_initial_chat_history()

# API Endpoints
@app.get("/api/conversations")
def get_conversations():
    results = []
    for conv_id, state in memory_manager.structured_states.items():
        raw_msgs = memory_manager.get_raw_messages(conv_id)
        last_msg = raw_msgs[-1].text if raw_msgs else ""
        results.append({
            "conversation_id": conv_id,
            "lead_stage": state.lead_stage.value,
            "participants": state.participants.model_dump(),
            "risks_count": len(state.risks),
            "top_risk": state.risks[0].model_dump() if state.risks else None,
            "turn_count": len(raw_msgs),
            "last_message": last_msg,
            "escalated_to_human": state.escalated_to_human,
            "channel_id": state.channel_id,
            "updated_at": state.updated_at
        })
    return {"conversations": sorted(results, key=lambda x: x["conversation_id"])}

@app.get("/api/conversations/{conv_id}")
def get_conversation_detail(conv_id: str):
    raw_msgs = memory_manager.get_raw_messages(conv_id)
    state = memory_manager.get_state(conv_id)
    if not state and not raw_msgs:
        # Auto initialize an empty state so newly created conversations are valid
        from datetime import datetime
        now = datetime.utcnow().isoformat()
        state = ConversationState(
            conversation_id=conv_id,
            created_at=now,
            updated_at=now
        )
        memory_manager.save_state(state)

    events = get_event_logs(conv_id)
    return {
        "conversation_id": conv_id,
        "messages": [m.model_dump() for m in raw_msgs],
        "state": state.model_dump() if state else None,
        "events": events
    }

@app.post("/api/conversations/{conv_id}/messages")
def send_message(conv_id: str, payload: PostMessageRequest):
    try:
        sender = SenderType(payload.sender)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid sender. Must be buyer, seller, sales, agent")

    res = agent_engine.process_message(
        conversation_id=conv_id,
        sender=sender,
        text=payload.text
    )
    return res

@app.post("/api/conversations/reset")
def reset_conversations():
    memory_manager.raw_logs.clear()
    memory_manager.structured_states.clear()
    load_initial_chat_history()
    return {"status": "reset_complete"}

@app.get("/api/tools")
def get_tools_catalog():
    return {
        "status": "success",
        "total": len(TOOL_DEFINITIONS),
        "tools": TOOL_DEFINITIONS
    }

@app.get("/api/listings")
def get_listings(
    brand: Optional[str] = None,
    price_max: Optional[float] = None,
    location: Optional[str] = None,
    keywords: Optional[str] = None
):
    if brand or price_max or location or keywords:
        return search_listings(brand=brand, price_max=price_max, location=location, keywords=keywords)
    return {
        "status": "success",
        "total": len(db.get_all()),
        "listings": db.get_all()
    }

@app.get("/api/events")
def get_events(conversation_id: Optional[str] = None):
    return {"events": get_event_logs(conversation_id)}

@app.get("/api/eval")
def get_evaluation():
    all_states = list(memory_manager.structured_states.values())
    metrics = evaluation_system.get_metrics_summary(all_states)
    return metrics

@app.post("/api/feedback")
def submit_feedback(
    conversation_id: str = Body(...),
    action_taken: str = Body(...),
    outcome: str = Body(...),
    score: int = Body(5),
    notes: Optional[str] = Body(None)
):
    state = memory_manager.get_state(conversation_id)
    rec = evaluation_system.record_feedback(
        conversation_id=conversation_id,
        context_snapshot={"channel_id": state.channel_id if state else None},
        state_snapshot=state.model_dump() if state else {},
        action_taken=action_taken,
        outcome=outcome,
        satisfaction_score=score,
        notes=notes
    )
    return {"status": "success", "record": rec}

@app.get("/api/config")
def get_config():
    return {
        "gemini_api_key_set": bool(gemini_client.api_key),
        "model": gemini_client.model
    }

@app.post("/api/config")
def update_config(payload: ConfigUpdateRequest):
    if payload.gemini_api_key:
        gemini_client.api_key = payload.gemini_api_key
    if payload.gemini_model:
        gemini_client.model = payload.gemini_model
    return {
        "status": "updated",
        "gemini_api_key_set": bool(gemini_client.api_key),
        "model": gemini_client.model
    }

# Mount static files
static_dir = settings.STATIC_DIR
if os.path.exists(static_dir):
    app.mount("/static", StaticFiles(directory=static_dir), name="static")

@app.get("/")
def serve_root():
    index_path = os.path.join(settings.STATIC_DIR, "index.html")
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return {"message": "Vucar AI Agent API running. Static UI not found."}
