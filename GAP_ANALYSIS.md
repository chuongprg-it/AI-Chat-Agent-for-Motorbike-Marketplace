# Đánh Giá Thiếu Sót & Đề Xuất Cải Thiện

> Tài liệu tự đánh giá trung thực về những gì phiên bản hiện tại chưa làm được, chưa làm tốt, và phương án khắc phục cụ thể trong tương lai.

---

## 1. Những Gì Đã Làm Được Tốt

Trước khi đi vào thiếu sót, cần ghi nhận những phần đã vận hành đúng để định vị tương đối:

| Thành phần | Trạng thái | Ghi chú |
|-----------|-----------|---------|
| ReAct Agent Loop (engine.py) | ✅ Hoạt động | 9 bước xử lý rõ ràng, có thể trace từng bước |
| Structured State (schema.py) | ✅ Hoạt động | Pydantic schema đầy đủ, type-safe |
| 3-tier Memory Strategy | ✅ Triển khai | raw_logs → structured_state → rolling_summary |
| 5 Internal Tools | ✅ Triển khai | search, detail, bridge, appointment, log |
| Gemini + Heuristic Fallback | ✅ Hoạt động | Chạy offline không cần API key |
| Risk Detection (3 loại) | ✅ Hoạt động | PRICE_GAP, PAPERWORK, DISINTERMEDIATION |
| Sales Handoff | ✅ Hoạt động | Tự động khi agent undecided hoặc escalate |
| Web UI (3-way chat) | ✅ Hoạt động | Real-time state panel, event telemetry, eval dashboard |
| Event Telemetry | ✅ Hoạt động | Log đầy đủ TOOL_CALL, ESCALATION, STATE_UPDATE |
| Evaluation System | ✅ Có cơ bản | Metrics + Error Analysis + Feedback Loop |

---

## 2. Thiếu Sót Kỹ Thuật (Technical Gaps)

### GAP-T1: Không có Persistence — State mất khi restart

**Mô tả:** Toàn bộ conversation state và raw logs lưu trong Python dict trong RAM. Khi server restart, **mọi thứ mất hoàn toàn**.

**Mức độ ảnh hưởng:** 🔴 Critical cho production

**Hiện tại:**
```python
# memory.py — Hiện tại
self.raw_logs: Dict[str, List[Message]] = {}  # In-memory only
self.structured_states: Dict[str, ConversationState] = {}  # In-memory only
```

**Phương án khắc phục:**
```
Tier-1 (Nhanh): Serialize state sang JSON file mỗi turn
Tier-2 (Chuẩn): Redis cho state (TTL 24h) + PostgreSQL cho raw_logs
Tier-3 (Scale): Event Sourcing pattern — PostgreSQL lưu full event stream, 
                state rebuild từ events khi cần
```

**Effort:** Medium (3–5 ngày engineering)

---

### GAP-T2: Không có Authentication & Rate Limiting

**Mô tả:** API endpoints hoàn toàn không có auth. Bất kỳ ai biết URL đều có thể gọi, inject message bất kỳ, hoặc spam.

**Mức độ ảnh hưởng:** 🔴 Critical cho production

**Phương án:**
- Thêm Bearer token / API Key header cho mỗi request
- Rate limiting: giới hạn 60 requests/minute/IP
- Conversation isolation: mỗi user chỉ được access conversation của chính mình

---

### GAP-T3: Race Condition khi nhiều request đồng thời

**Mô tả:** Nếu Buyer và Seller gửi tin cùng lúc, cả 2 cùng read state cũ, cùng process, và 1 trong 2 overwrite state của nhau.

**Mức độ ảnh hưởng:** 🟠 High

**Phương án:**
```python
# Fix: Per-conversation async lock
from asyncio import Lock

class MemoryManager:
    def __init__(self):
        self._locks: Dict[str, Lock] = {}
    
    async def get_lock(self, conv_id: str) -> Lock:
        if conv_id not in self._locks:
            self._locks[conv_id] = Lock()
        return self._locks[conv_id]
```

---

### GAP-T4: Tool Routing còn cứng nhắc — Keyword-based thay vì Intent-based

**Mô tả:** `_decide_and_execute_tools()` dùng `if "giấy tờ" in text_lower` để quyết định gọi `get_listing_detail`. Người dùng nói "xe này legal không?" sẽ không được detect.

**Mức độ ảnh hưởng:** 🟠 High — Miss rate cao với ngôn ngữ tự nhiên đa dạng

**Phương án:**
```
Option A: Mở rộng keyword list (nhanh nhưng maintenance cao)
Option B: Dùng Gemini native function calling — LLM tự quyết định tool nào cần gọi
Option C: Fine-tune intent classifier nhỏ (DistilBERT) cho domain Vucar
```

**Khuyến nghị:** Option B (Gemini Function Calling) khi đã có API key stable.

---

### GAP-T5: `budget_max` overwrite — Mất thông tin "ngân sách co giãn"

**Mô tả:** Khi người mua nói "cùng lắm 27tr thôi" sau khi đã nói "tầm 25tr", hệ thống ghi đè `budget_max = 27tr` thay vì hiểu đây là `stretch_max`.

**Mức độ ảnh hưởng:** 🟠 High — search_listings có thể bỏ qua xe 25tr phù hợp để push xe 27tr

**Phương án:**
```python
# Schema fix
class BuyerConstraints(BaseModel):
    budget_target: Optional[float] = None      # Ngân sách mong muốn thực sự
    budget_max: Optional[float] = None          # Tối đa tuyệt đối
    budget_stretch_max: Optional[float] = None  # Kịch trần có điều kiện ("cùng lắm...")

# Search priority: budget_target first, only show stretch_max options if no match
```

---

### GAP-T6: Appointment Guardrail thiếu — Cho phép book khi còn risk CRITICAL

**Mô tả:** Hiện tại `book_appointment` có thể được gọi ngay cả khi `state.risks` còn chứa risk `CRITICAL` chưa resolved (ví dụ: giấy tờ chưa rút gốc).

**Mức độ ảnh hưởng:** 🟠 High — Vi phạm chính sách Vucar, ảnh hưởng uy tín

**Phương án:**
```python
# engine.py — Thêm vào Condition 5 trước khi book
unresolved_critical = [r for r in state.risks 
                       if r.level in [RiskLevel.CRITICAL] and not r.resolved]
if unresolved_critical:
    # Không book, trả về cảnh báo
    return  # skip booking
```

---

### GAP-T7: `_compose_agent_reply` không xử lý multi-tool trong cùng turn

**Mô tả:** Khi 1 turn gọi nhiều tools (ví dụ: `search_listings` + `get_listing_detail`), hàm chỉ trả về reply của tool đầu tiên khớp điều kiện.

**Mức độ ảnh hưởng:** 🟡 Medium

**Phương án:**
```python
# Collect all tool outputs và compose unified reply
def _compose_from_multiple_tools(self, tool_results):
    sections = []
    for tr in tool_results:
        if tr["tool_name"] == "get_listing_detail":
            sections.append(self._format_detail_reply(tr))
        if tr["tool_name"] == "search_listings":
            sections.append(self._format_search_reply(tr))
        if tr["tool_name"] == "book_appointment":
            sections.append(self._format_booking_reply(tr))
    return "\n\n".join(sections)
```

---

## 3. Thiếu Sót Chất Lượng AI (AI Quality Gaps)

### GAP-AI1: Heuristics không hiểu tiếng lóng xe máy Việt Nam

**Mô tả:** Các từ chuyên ngành phổ biến trong giao dịch xe máy thực tế hoàn toàn không được nhận diện:

| Từ lóng | Nghĩa thực | Heuristics xử lý? |
|---------|-----------|-------------------|
| "zin 100%" | Xe chưa qua sửa chữa, nguyên bản | ❌ Không |
| "rớt đầu" | Xe bị tai nạn phần đầu | ❌ Không |
| "bao công chứng" | Cam kết hỗ trợ sang tên công chứng | ❌ Không |
| "smartkey" | Chìa khóa thông minh Honda | ❌ Không |
| "cầm cố" | Xe đang thế chấp ngân hàng | ❌ Không |
| "phiên bản phuộc bình" | Dòng xe với phuộc lò xo bình thường | ❌ Không |
| "xe bị phù phép ODO" | Xe bị can thiệp đồng hồ km | ❌ Không |

**Phương án:**
```python
# Mở rộng domain_vocabulary.py
VIETNAM_MOTO_JARGON = {
    "zin": {"meaning": "original_condition", "risk_signal": False},
    "rớt đầu": {"meaning": "front_accident", "risk_signal": True, "risk_category": "CONDITION"},
    "cầm cố": {"meaning": "mortgaged", "risk_signal": True, "risk_category": "PAPERWORK"},
    "phù phép odo": {"meaning": "odo_tampered", "risk_signal": True, "risk_category": "ODO"},
    # ...
}
```

---

### GAP-AI2: Không có Sentiment/Urgency Detection

**Mô tả:** Agent không phân biệt được:
- "Mình đang cần xe gấp tuần này" (urgency cao → cần push appointment ngay)
- "Mình tìm từ từ chưa gấp" (urgency thấp → tránh push quá mức)
- Người mua đang tức giận vs đang vui vẻ

**Phương án:**
- Thêm `urgency_level: LOW|MEDIUM|HIGH` vào ConversationState
- Thêm `buyer_sentiment: POSITIVE|NEUTRAL|NEGATIVE` để điều chỉnh giọng điệu reply

---

### GAP-AI3: Rolling Summary quá đơn giản — Rule-based thay vì Semantic

**Mô tả:** `_compact_messages()` chỉ filter theo keyword cứng:
```python
if any(term in txt for term in ["tr", "triệu", "honda", "yamaha", "giấy tờ", ...]):
    key_points.append(...)
```
Các cam kết quan trọng không chứa keyword này sẽ bị mất.

**Phương án:**
- Dùng Gemini để tóm tắt khi conversation > 8 turns: `"Tóm tắt 3 điểm cam kết và 2 điểm bất đồng chính từ đoạn chat sau:"`
- Cache summary để không gọi lại mỗi request

---

### GAP-AI4: Không có Conflict Resolution khi Buyer thay đổi yêu cầu

**Mô tả:** Nếu turn 1 Buyer nói "Honda", turn 5 lại nói "Yamaha cũng được", hệ thống cộng dồn brands = ["Honda", "Yamaha"] thay vì hiểu đây là mở rộng preference.

**Phương án:**
- Phân biệt `preference_brands` (mong muốn ban đầu) vs `acceptable_brands` (chấp nhận được)
- Track lịch sử thay đổi preference với timestamp

---

## 4. Thiếu Sót Nghiệp Vụ (Business Logic Gaps)

### GAP-B1: Escrow chỉ là văn bản — Chưa có integration thực

**Mô tả:** Agent đề cập "Vucar Escrow" nhưng không có API thực kết nối với hệ thống thanh toán. Đây là core value proposition của Vucar mà hiện tại chỉ là lời nói.

**Phương án:**
```python
# Thêm tool mới
def initiate_escrow(buyer_id, seller_id, listing_id, amount):
    """Khởi tạo yêu cầu ký quỹ qua API Vucar Finance"""
    # POST /api/v1/escrow/initiate
    pass
```

---

### GAP-B2: Không phân biệt được Buyer vs Guest User

**Mô tả:** Hiện tại `buyer_id` luôn là "buyer_01" hardcoded. Không có user identity thực, không personalize được dựa trên lịch sử mua trước.

**Phương án:**
- Tích hợp JWT auth → lấy `user_id` thực
- Thêm user profile: "Mua lần 3, thường mua Honda, budget thường 20–30tr"
- Personalize `suggested_message` dựa trên lịch sử

---

### GAP-B3: Không xử lý nhiều xe cùng lúc (Multi-listing negotiation)

**Mô tả:** `listing_context` chỉ có 1 `current_listing_id`. Nếu buyer quan tâm đến 2 xe đồng thời và so sánh, agent không handle được.

**Phương án:**
- Thêm `active_comparison_listings: List[ListingContext]` vào state
- Compose reply so sánh 2 xe theo format table

---

### GAP-B4: Appointment chưa có thông tin 2 chiều (seller chưa xác nhận)

**Mô tả:** `book_appointment` tự động trả về status "CONFIRMED" mà không cần xác nhận từ Seller. Trong thực tế, seller phải confirm trước.

**Phương án:**
```
Status flow: PENDING_SELLER_CONFIRM → CONFIRMED → COMPLETED | CANCELLED
```
- Gửi notification cho Seller khi có appointment mới
- Seller confirm → status → CONFIRMED
- Nếu sau 2 giờ không confirm → auto-cancel và notify buyer

---

## 5. Thiếu Sót Hạ Tầng (Infrastructure Gaps)

### GAP-I1: Không có Test Suite tự động

**Mô tả:** Không có file test nào trong codebase. Mọi thay đổi đều cần test thủ công.

**Phương án:**
```
backend/tests/
├── test_engine.py          # Unit test AgentEngine
├── test_tools.py           # Unit test 5 tools
├── test_memory.py          # Unit test MemoryManager
├── test_heuristics.py      # Regression test heuristics với c1/c2/c3
└── test_e2e.py             # End-to-end: gửi message → check state → check tools called
```

---

### GAP-I2: Không có Logging chuẩn (Structured Logging)

**Mô tả:** Code dùng `print()` và basic `logging.info()`. Không có correlation ID theo request, không filter được theo conversation.

**Phương án:**
```python
import structlog

logger = structlog.get_logger()
logger.info("tool_called", 
    tool="book_appointment",
    conv_id=conversation_id,
    appointment_id=apt_id,
    latency_ms=elapsed)
```

---

### GAP-I3: Không có Health Check & Monitoring

**Mô tả:** Không có `/health` endpoint, không có metrics export (Prometheus), không có alerting.

**Phương án:**
```python
@app.get("/health")
def health():
    return {
        "status": "healthy",
        "version": settings.VERSION,
        "conversations_active": len(memory_manager.structured_states),
        "uptime_seconds": int(time.time() - START_TIME)
    }
```

---

## 6. Tổng Hợp Ưu Tiên Cải Thiện

| Priority | Gap | Effort | Impact |
|----------|-----|--------|--------|
| 🔴 P0 | GAP-T1: Persistent Storage | Medium (3–5 ngày) | Critical |
| 🔴 P0 | GAP-T2: Authentication | Medium (2–3 ngày) | Critical |
| 🔴 P0 | GAP-T6: Appointment Guardrail | Low (2 giờ) | High |
| 🟠 P1 | GAP-T3: Race Condition Lock | Low (1 ngày) | High |
| 🟠 P1 | GAP-T5: Budget Stretch Field | Low (1 ngày) | High |
| 🟠 P1 | GAP-AI1: Vietnamese Jargon Dict | Medium (1 tuần) | High |
| 🟠 P1 | GAP-B1: Escrow Integration | High (1–2 tháng) | Very High |
| 🟡 P2 | GAP-T4: Intent-based Tool Routing | High (1 tuần) | Medium |
| 🟡 P2 | GAP-AI2: Sentiment Detection | Medium (1 tuần) | Medium |
| 🟡 P2 | GAP-B4: Appointment 2-way Confirm | Medium (1 tuần) | Medium |
| 🟡 P2 | GAP-I1: Test Suite | Medium (1 tuần) | Medium |
| 🟢 P3 | GAP-AI3: Semantic Rolling Summary | Medium | Low-Medium |
| 🟢 P3 | GAP-B2: User Identity/Personalization | High | Medium |
| 🟢 P3 | GAP-I3: Monitoring/Health Check | Low (1 ngày) | Low |

---

## 7. Những Phần Chưa Làm (Out of Scope — Production Requirements)

Dưới đây là những tính năng quan trọng chưa được implement và lý do:

| Tính năng | Lý do chưa làm | Phương án nếu production |
|-----------|---------------|--------------------------|
| **WebSocket / Real-time push** | Demo dùng polling (fetch) | Chuyển sang FastAPI WebSocket, hoặc SSE |
| **Image Analysis (phát hiện xe bị va đụng qua ảnh)** | Cần Gemini Vision API, nằm ngoài scope core | Gemini Vision + custom scoring model |
| **Phone Masking thực** | Cần tích hợp với VOIP provider (Twillio/CPaaS VN) | Integration API riêng |
| **Vucar Escrow API** | Cần hệ thống tài chính riêng | Tích hợp với PayOS/VNPAY/Zalopay |
| **CRM Sync** | Chưa có CRM target | REST webhook đến HubSpot/Salesforce |
| **Multi-language (Hà Nội accent)** | Heuristics tune cho HCM | Thêm dialect normalization |
| **Automated regression tests** | Time constraint | pytest + GitHub Actions CI/CD |
| **Admin Dashboard** | Chỉ có Sales UI | Separate admin portal cho Ops/Management |

---

*Tài liệu này phản ánh đúng thực trạng phiên bản hiện tại và cam kết cải thiện có lộ trình rõ ràng.*
