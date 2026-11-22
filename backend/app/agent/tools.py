import json
import os
import uuid
from typing import Dict, Any, List, Optional
from datetime import datetime
from backend.app.config import settings
from backend.app.models.schema import EventType

class MockListingDatabase:
    def __init__(self, filepath: str = settings.MOCK_LISTINGS_FILE):
        self.filepath = filepath
        self.listings: List[Dict[str, Any]] = []
        self._load()

    def _load(self):
        if os.path.exists(self.filepath):
            with open(self.filepath, "r", encoding="utf-8") as f:
                self.listings = json.load(f)
        else:
            self.listings = []

    def get_all(self) -> List[Dict[str, Any]]:
        return self.listings

    def find_by_id(self, listing_id: str) -> Optional[Dict[str, Any]]:
        for item in self.listings:
            if item.get("id") == listing_id:
                return item
        return None

db = MockListingDatabase()

# In-memory stores for runtime
EVENT_LOGS: List[Dict[str, Any]] = []
BRIDGES: Dict[str, Dict[str, Any]] = {}
APPOINTMENTS: Dict[str, Dict[str, Any]] = {}

def search_listings(
    brand: Optional[str] = None,
    model: Optional[str] = None,
    year_min: Optional[int] = None,
    year_max: Optional[int] = None,
    price_min: Optional[float] = None,
    price_max: Optional[float] = None,
    location: Optional[str] = None,
    keywords: Optional[str] = None,
    max_odo: Optional[int] = None
) -> Dict[str, Any]:
    """
    Input: brand, model, year_range, price_range, location, keywords
    Output: list of listings matching criteria
    """
    results = []
    all_items = db.get_all()

    for item in all_items:
        # Brand match
        if brand and brand.lower() not in item.get("brand", "").lower():
            continue

        # Model match
        if model and model.lower() not in item.get("model", "").lower():
            continue

        # Year match
        item_year = item.get("year", 0)
        if year_min and item_year < year_min:
            continue
        if year_max and item_year > year_max:
            continue

        # Price match (with 10% flexible negotiation window)
        item_price = item.get("price", 0)
        if price_max and item_price > (price_max * 1.15):
            continue
        if price_min and item_price < price_min:
            continue

        # Odo match
        item_odo = item.get("odo", 0)
        if max_odo and item_odo > max_odo:
            continue

        # Location match
        if location:
            loc_lower = location.lower()
            item_loc = (item.get("location", "") + " " + item.get("district", "")).lower()
            # Normalize HCM vs Ho Chi Minh
            if "hcm" in loc_lower or "hồ chí minh" in loc_lower:
                if not ("hồ chí minh" in item_loc or "hcm" in item_loc):
                    continue
            elif loc_lower not in item_loc:
                continue

        # Keywords search
        if keywords:
            kw = keywords.lower()
            combined = f"{item.get('brand','')} {item.get('model','')} {item.get('description','')} {item.get('color','')}".lower()
            if kw not in combined:
                continue

        results.append(item)

    return {
        "status": "success",
        "total_found": len(results),
        "listings": results[:5]  # Top 5 best matches
    }

def get_listing_detail(listing_id: str) -> Dict[str, Any]:
    """
    Output: detailed info about one listing including paperwork and inspection score
    """
    item = db.find_by_id(listing_id)
    if not item:
        return {
            "status": "not_found",
            "message": f"Listing {listing_id} not found in inventory."
        }
    return {
        "status": "success",
        "listing": item
    }

def create_chat_bridge(buyer_id: str, seller_id: str, listing_id: str) -> Dict[str, Any]:
    """
    Output: channel_id for mediated buyer-seller communication with safety safeguards
    """
    channel_id = f"bridge_{uuid.uuid4().hex[:8]}"
    bridge_record = {
        "channel_id": channel_id,
        "buyer_id": buyer_id,
        "seller_id": seller_id,
        "listing_id": listing_id,
        "created_at": datetime.utcnow().isoformat(),
        "status": "active",
        "safeguards": {
            "phone_masking": True,
            "escrow_enabled": True,
            "vucar_inspection_guarantee": True
        }
    }
    BRIDGES[channel_id] = bridge_record
    return {
        "status": "created",
        "channel_id": channel_id,
        "details": bridge_record
    }

def book_appointment(channel_id: str, time: str, place: str, appointment_type: str = "INSPECTION_AND_TEST_RIDE") -> Dict[str, Any]:
    """
    Output: booking status for viewing, vehicle inspection, or contract closing
    """
    appointment_id = f"apt_{uuid.uuid4().hex[:8]}"
    record = {
        "appointment_id": appointment_id,
        "channel_id": channel_id,
        "time": time,
        "place": place,
        "type": appointment_type,
        "status": "CONFIRMED",
        "inspector_assigned": "Kỹ thuật viên Vucar (Đã sẵn sàng)",
        "created_at": datetime.utcnow().isoformat()
    }
    APPOINTMENTS[appointment_id] = record
    return {
        "status": "CONFIRMED",
        "appointment_id": appointment_id,
        "time": time,
        "place": place,
        "message": f"Lịch hẹn đã được đặt thành công vào lúc {time} tại {place}. Kỹ thuật viên Vucar sẽ hỗ trợ kiểm tra xe 120 điểm và công chứng hợp đồng an toàn."
    }

def log_event(conversation_id: str, event_type: EventType, payload: Dict[str, Any], actor: str = "agent") -> Dict[str, Any]:
    """
    Event types: USER_MESSAGE, AGENT_ACTION, TOOL_CALL, TOOL_RESULT, STATE_UPDATE, ESCALATION, HANDOFF, FEEDBACK
    """
    event_id = f"evt_{uuid.uuid4().hex[:8]}"
    record = {
        "event_id": event_id,
        "conversation_id": conversation_id,
        "timestamp": datetime.utcnow().isoformat(),
        "event_type": event_type.value if hasattr(event_type, "value") else str(event_type),
        "payload": payload,
        "actor": actor
    }
    EVENT_LOGS.append(record)
    return {
        "status": "logged",
        "event_id": event_id
    }

def get_event_logs(conversation_id: Optional[str] = None) -> List[Dict[str, Any]]:
    if conversation_id:
        return [e for e in EVENT_LOGS if e.get("conversation_id") == conversation_id]
    return EVENT_LOGS

TOOL_DEFINITIONS = [
    {
        "name": "search_listings",
        "description": "Tìm kiếm các xe máy cũ trên sàn Vucar theo hãng, model, năm sản xuất, ngân sách, địa điểm và odo.",
        "parameters": {
            "type": "object",
            "properties": {
                "brand": {"type": "string", "description": "Hãng xe (Honda, Yamaha, Piaggio, v.v.)"},
                "model": {"type": "string", "description": "Dòng xe (Air Blade, Vision, Lead, SH, NVX, v.v.)"},
                "year_min": {"type": "integer", "description": "Năm sản xuất tối thiểu (VD: 2020)"},
                "year_max": {"type": "integer", "description": "Năm sản xuất tối đa"},
                "price_min": {"type": "number", "description": "Giá tối thiểu (VNĐ)"},
                "price_max": {"type": "number", "description": "Giá tối đa (VNĐ)"},
                "location": {"type": "string", "description": "Địa điểm / Thành phố (HCM, Hà Nội)"},
                "keywords": {"type": "string", "description": "Từ khóa tìm kiếm tự do"},
                "max_odo": {"type": "integer", "description": "Số km đã đi tối đa (odo)"}
            }
        }
    },
    {
        "name": "get_listing_detail",
        "description": "Lấy thông tin chi tiết một tin đăng xe máy cụ thể (tình trạng giấy tờ, điểm kiểm định Vucar, thông tin người bán).",
        "parameters": {
            "type": "object",
            "properties": {
                "listing_id": {"type": "string", "description": "ID tin đăng (VD: list_ab_2021)"}
            },
            "required": ["listing_id"]
        }
    },
    {
        "name": "create_chat_bridge",
        "description": "Tạo kênh kết nối an toàn 3 bên giữa Buyer và Seller có Agent giám sát và bảo vệ giao dịch.",
        "parameters": {
            "type": "object",
            "properties": {
                "buyer_id": {"type": "string", "description": "ID người mua"},
                "seller_id": {"type": "string", "description": "ID người bán"},
                "listing_id": {"type": "string", "description": "ID tin đăng liên quan"}
            },
            "required": ["buyer_id", "seller_id", "listing_id"]
        }
    },
    {
        "name": "book_appointment",
        "description": "Đặt lịch hẹn xem xe, lái thử và kiểm định kỹ thuật tại Vucar Hub hoặc địa chỉ người bán/người mua.",
        "parameters": {
            "type": "object",
            "properties": {
                "channel_id": {"type": "string", "description": "ID kênh kết nối"},
                "time": {"type": "string", "description": "Thời gian hẹn (VD: 15:00 Thứ 7 ngày 10/02/2026)"},
                "place": {"type": "string", "description": "Địa điểm xem xe (VD: Vucar Hub Q10, hoặc 123 Lê Quang Định)"},
                "appointment_type": {"type": "string", "description": "Loại lịch hẹn (INSPECTION_AND_TEST_RIDE)"}
            },
            "required": ["channel_id", "time", "place"]
        }
    },
    {
        "name": "log_event",
        "description": "Ghi nhận sự kiện quan trọng trong hội thoại và hành động của agent để theo dõi và đánh giá.",
        "parameters": {
            "type": "object",
            "properties": {
                "conversation_id": {"type": "string", "description": "ID cuộc trò chuyện"},
                "event_type": {"type": "string", "description": "Loại sự kiện"},
                "payload": {"type": "object", "description": "Dữ liệu sự kiện"}
            },
            "required": ["conversation_id", "event_type", "payload"]
        }
    }
]
