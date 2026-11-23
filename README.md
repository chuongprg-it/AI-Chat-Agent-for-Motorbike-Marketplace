# Vucar AI Agent — Marketplace Intelligence Platform

> **"Cùng kiến tạo niềm tin cho những giao dịch quan trọng nhất."**

Hệ thống AI Agent 3 bên (Buyer – Seller – Agent) thông minh cho sàn giao dịch xe máy cũ Vucar. Agent không đơn thuần là chatbot hỏi-đáp — mà là **Transaction Coordinator tự động**: phân tích hội thoại phi cấu trúc, duy trì Structured State, điều hướng Internal Tools, phát hiện rủi ro giao dịch, và đưa ra Next Best Action có lý giải nghiệp vụ rõ ràng.

---

## Mục Lục

1. [Phân tích bài toán](#1-phân-tích-bài-toán)
2. [Kiến trúc tổng thể & Data Flow](#2-kiến-trúc-tổng-thể--data-flow)
3. [Các quyết định thiết kế & Đánh đổi kỹ thuật](#3-các-quyết-định-thiết-kế--đánh-đổi-kỹ-thuật)
4. [State Schema & Tool Schema](#4-state-schema--tool-schema)
5. [Chiến lược quản lý bộ nhớ](#5-chiến-lược-quản-lý-bộ-nhớ)
6. [Failure Modes — Các trường hợp hệ thống thất bại](#6-failure-modes--các-trường-hợp-hệ-thống-thất-bại)
7. [Kế hoạch đánh giá hệ thống](#7-kế-hoạch-đánh-giá-hệ-thống)
8. [Kế hoạch cải tiến tương lai](#8-kế-hoạch-cải-tiến-tương-lai)
9. [Hướng dẫn chạy](#9-hướng-dẫn-chạy)

---

## 1. Phân Tích Bài Toán

### 1.1. Góc nhìn thị trường

Thị trường xe máy cũ Việt Nam có giá trị trung bình **20–100 triệu VNĐ/giao dịch** — đủ lớn để rủi ro gây đau thực sự, nhưng đủ nhỏ để khách hàng không muốn thuê luật sư. Ba điểm đau cốt lõi:

| Bên | Điểm đau chính |
|-----|---------------|
| **Người mua** | Sợ xe bị tua ODO, bị luộc máy, giấy tờ tranh chấp không sang tên được |
| **Người bán** | Sợ người mua ảo trả giá dìm hàng, sợ cò lái ăn chênh lệch, muốn bán nhanh |
| **Sàn (Vucar)** | Rủi ro thoát sàn (bypass): 2 bên lấy số điện thoại giao dịch ngầm, mất kiểm soát và mất doanh thu |

### 1.2. Vì sao cần AI Agent thay vì Chatbot thông thường

Chatbot FAQ truyền thống thất bại vì:
- Trả lời độc lập từng câu, không nhớ ngữ cảnh xuyên suốt hội thoại
- Không phát hiện được pattern rủi ro ẩn trong chuỗi tin nhắn
- Không biết khi nào nên can thiệp vs khi nào nên im lặng
- Không thể ra quyết định "Hành động tiếp theo là gì?" dựa trên trạng thái toàn cục

**Vucar AI Agent** giải quyết bằng mô hình **ReAct (Reasoning + Acting) Stateful**:
1. Duy trì **Structured State** xuyên suốt hội thoại
2. **Phát hiện rủi ro** chủ động từ chuỗi ngữ nghĩa
3. **Điều hướng Tool** đúng thời điểm (tìm xe thay thế, đặt lịch, tạo kênh bảo mật)
4. **Can thiệp có lý do** — mọi hành động đều có `rationale` giải thích nghiệp vụ

### 1.3. Phân tích 3 kịch bản mẫu

**c1 — Chênh lệch giá (Price Tension):**
- Người mua tối đa 25–26tr; Người bán giữ giá 32tr (chênh 23%)
- Chatbot thường: trả lời "để hỏi thêm..." → 2 bên im lặng → drop-off
- Agent Vucar: tính `ΔPrice = 6tr > 15%` → kích hoạt `search_listings` tìm xe thay thế trong tầm → đề xuất giá trung gian 28–29tr kèm Vucar Care 6 tháng

**c2 — Rủi ro giấy tờ (Legal Risk):**
- Người bán báo "đang chờ rút hồ sơ gốc" → Người mua lo lắng
- Chatbot thường: xử lý như câu hỏi FAQ, không thấy rủi ro
- Agent Vucar: gắn nhãn `PAPERWORK_CRITICAL`, kích hoạt `get_listing_detail` xác minh, đề xuất cơ chế Escrow

**c3 — Thoát sàn (Disintermediation):**
- Người bán đòi số điện thoại trực tiếp, từ chối "trung gian"
- Chatbot thường: tranh cãi hoặc từ bỏ
- Agent Vucar: nhận diện `BYPASS_ATTEMPT` → `create_chat_bridge` với phone masking → làm rõ Vucar không thu phí bên bán

---

## 2. Kiến Trúc Tổng Thể & Data Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│  Web UI (index.html + app.js)                                        │
│  - Live Chat Studio (3-way: Buyer/Seller/Agent)                      │
│  - Real-time State Panel (Stage, Risks, NBA, Tools, JSON)            │
│  - Inventory Browser, Event Telemetry, Eval Dashboard               │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ HTTP REST (JSON)
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│  FastAPI Application Layer  (main.py)                                │
│  POST /api/conversations/{id}/messages                               │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     AgentEngine  (engine.py)                         │
│                                                                      │
│  Step 1: Append message → MemoryManager.raw_logs                     │
│  Step 2: Get current ConversationState                               │
│  Step 3: Build tiered context (rolling summary + recent N turns)     │
│  Step 4: Call LLM/Heuristics → extract structured data              │
│          ┌─────────────────────────────────────────────┐            │
│          │  GeminiClient (gemini_client.py)             │            │
│          │  ├─ Primary: Gemini API (3.5/3.8 Flash)      │            │
│          │  └─ Fallback: Intelligent Domain Heuristics  │            │
│          └─────────────────────────────────────────────┘            │
│  Step 5: _apply_state_update() → update ConversationState            │
│  Step 6: _decide_and_execute_tools() → route to Internal Tools       │
│          ├─ search_listings      (Condition 1: DISCOVERY/MATCHING)   │
│          ├─ get_listing_detail   (Condition 2: paperwork query)       │
│          ├─ create_chat_bridge   (Condition 3: MATCHING/NEGOTIATION)  │
│          ├─ [escalation log]     (Condition 4: HIGH/CRITICAL risk)    │
│          └─ book_appointment     (Condition 5: appointment intent)    │
│  Step 7: _compose_agent_reply() → build contextual response          │
│  Step 8: Check sales handoff → _do_sales_handoff() if needed         │
│  Step 9: Persist state → MemoryManager.save_state()                  │
└─────────────────────────────────────────────────────────────────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        [Memory]      [Tools]      [Evaluation]
        memory.py     tools.py     evaluator.py
                                   error_cases.py
```

### Luồng xử lý một tin nhắn (Request-Response Cycle)

```
Buyer gửi: "Mình muốn hẹn xem xe lúc 15h chiều mai"
    │
    ├─ 1. Append to raw_logs
    ├─ 2. Build context: summary + 8 recent turns
    ├─ 3. LLM detects: has_appointment=True, action=BOOK_APPOINTMENT
    ├─ 4. _apply_state_update: lead_stage stays, risks checked
    ├─ 5. _decide_and_execute_tools:
    │      ├─ Condition 2: "15h" → no paperwork keyword → skip
    │      ├─ Condition 3: auto create_chat_bridge (if no channel_id)
    │      └─ Condition 5: book_appointment("15h chiều mai") → apt_id assigned
    │                        lead_stage → APPOINTMENT
    ├─ 6. _compose_agent_reply: "✅ Vucar đã xác nhận lịch hẹn..."
    └─ Response: { agent_reply, state, tools_called, model_used }
```

---

## 3. Các Quyết Định Thiết Kế & Đánh Đổi Kỹ Thuật

### 3.1. Separation of Concerns: Reasoning vs Generation

**Quyết định:** Tách biệt hoàn toàn hai bước:
1. **LLM Reasoning** (prompt → structured JSON state) — độc lập với response text
2. **Agent Generation** (compose reply từ state + tool results)

**Lý do:** Cho phép Sales/Ops kiểm tra logic quyết định (`next_best_action.rationale`) mà không cần đọc toàn bộ hội thoại. Dễ debug, dễ audit.

**Đánh đổi:** Cần 2 lượt xử lý thay vì 1 → tăng latency ~200–400ms. Chấp nhận được vì đổi lấy tính minh bạch cao.

---

### 3.2. Deterministic Heuristics làm Primary Engine (không phải Gemini)

**Quyết định:** Xây dựng `_heuristic_fallback()` đủ mạnh để chạy độc lập không cần API key.

**Lý do:**
- Demo và phát triển không phụ thuộc vào quota/billing
- Latency dự đoán được (~0ms so với ~800ms của Gemini)
- Xử lý các case c1/c2/c3 deterministic, không có hallucination

**Đánh đổi:** Heuristics không hiểu ngữ cảnh phức tạp, không xử lý sarcasm, từ lóng địa phương. Khi dùng Gemini thực, chất lượng tốt hơn nhiều.

---

### 3.3. In-Memory State thay vì Database

**Quyết định:** Toàn bộ state lưu trong Python dict trong RAM.

**Lý do:** Đơn giản hóa setup để demo. Không cần PostgreSQL/Redis cho prototype.

**Đánh đổi:**
- State mất khi restart server
- Không scale ngang (multi-process)
- **Production fix:** Thay bằng Redis (state) + PostgreSQL (audit logs)

---

### 3.4. Tool Routing dựa trên Rules thay vì LLM Function Calling

**Quyết định:** `_decide_and_execute_tools()` dùng `if/elif` conditions dựa trên keywords + action từ LLM, thay vì dùng native function calling của Gemini.

**Lý do:** Kiểm soát tốt hơn, dễ debug, không phụ thuộc vào LLM quyết định có gọi tool hay không (LLM có thể "quên" gọi tool khi context dài).

**Đánh đổi:** Cứng nhắc hơn, cần maintain danh sách keyword thủ công.

---

### 3.5. Fallback Cascade cho Model Selection

**Quyết định:** Thử model theo thứ tự: `[user_model → gemini-3.5-flash-lite → gemini-2.5-flash → gemini-1.5-flash → heuristics]`

**Lý do:** Đảm bảo luôn trả về kết quả ngay cả khi model cụ thể không khả dụng hoặc rate-limited.

---

## 4. State Schema & Tool Schema

### 4.1. ConversationState Schema

```json
{
  "conversation_id": "c1",
  "participants": {
    "buyer_id": "buyer_01",
    "seller_id": "seller_c1",
    "agent_id": "vucar_ai_agent",
    "sales_id": null
  },
  "lead_stage": "DISCOVERY | MATCHING | NEGOTIATION | APPOINTMENT | CLOSING | DROPPED",
  "constraints": {
    "budget_min": 25000000,
    "budget_max": 26000000,
    "currency": "VND",
    "location": "TP. Hồ Chí Minh",
    "districts": ["Bình Thạnh"],
    "brands": ["Honda", "Yamaha"],
    "models": ["Air Blade", "Vision"],
    "year_min": 2020,
    "year_max": null,
    "max_odo": 20000,
    "deal_breakers": ["Giá trên 26tr", "Xe không chính chủ"]
  },
  "listing_context": {
    "current_listing_id": "list_ab_2021",
    "brand": "Honda",
    "model": "Air Blade 125",
    "year": 2021,
    "odo": 19000,
    "asking_price": 32000000,
    "paperwork_status": "Chính chủ, công chứng sang tên ngay",
    "vucar_certified": true,
    "candidate_listing_ids": ["list_lead_2021", "list_janus_2022"]
  },
  "open_questions": [
    "Mức giá tối thiểu người bán có thể chấp nhận?"
  ],
  "risks": [
    {
      "category": "PRICE_GAP | PAPERWORK | DISINTERMEDIATION | ODO | FRAUD | CONDITION",
      "level": "LOW | MEDIUM | HIGH | CRITICAL",
      "description": "Mô tả cụ thể",
      "detected_at": "2026-02-05T09:03:50Z",
      "resolved": false,
      "resolution_action": "PROPOSE_NEGOTIATION"
    }
  ],
  "next_best_action": {
    "action": "PROPOSE_NEGOTIATION",
    "target": "both",
    "rationale": "Lý do nghiệp vụ dựa trên state",
    "suggested_message": "Nội dung phản hồi mẫu tiếng Việt"
  },
  "tool_history": [
    {
      "tool_name": "search_listings",
      "call_id": "tool_8f3a12",
      "arguments": {"brand": "Honda", "price_max": 26000000},
      "result": {"total_found": 2, "listings": [...]},
      "timestamp": "2026-02-05T09:03:55Z",
      "status": "success"
    }
  ],
  "summary": "Người mua tìm xe tay ga 2020+ tầm 25-26tr. Đang vướng giá chênh 6tr.",
  "channel_id": "bridge_a1b2c3",
  "appointment_id": "apt_d4e5f6",
  "turn_count": 7,
  "escalated_to_human": false,
  "sales_handoff": false,
  "created_at": "2026-02-05T09:00:00Z",
  "updated_at": "2026-02-05T09:04:30Z"
}
```

**Thiết kế State — Lưu gì vs Không lưu gì:**

| Thông tin | Lưu? | Lý do |
|-----------|------|-------|
| `constraints` (budget, brand, odo) | ✅ Có | Bộ lọc cứng cho search engine, cần lưu dạng số |
| `risks` (pháp lý, giá, bypass) | ✅ Có | Điều kiện chặn (guardrail) — không được bỏ qua |
| `open_questions` | ✅ Có | Xác định mục tiêu lượt nói tiếp theo, tránh hỏi lặp |
| `next_best_action` | ✅ Có | Tách reasoning khỏi generation, audit được |
| `tool_history` | ✅ Có | Tránh gọi tool trùng lặp; audit forensics |
| Câu chào hỏi, lời xã giao | ❌ Không | Chỉ ở raw_logs; tiết kiệm token khi inject vào prompt |
| Hình ảnh, binary data | ❌ Không | Chỉ lưu URL/listing_id; media ở object storage |

---

### 4.2. Tool Schema — 5 Internal Tools

#### `search_listings`
```json
{
  "name": "search_listings",
  "trigger": "Khi buyer có tiêu chí (brand/budget/location), hoặc hỏi xe, hoặc cần tìm thay thế khi price gap > 15%",
  "parameters": {
    "brand": "string — Honda | Yamaha | Piaggio | ...",
    "model": "string — Air Blade | Vision | NVX | ...",
    "year_min": "integer — năm sản xuất tối thiểu",
    "price_max": "number — giá tối đa (VNĐ)",
    "location": "string — TP. Hồ Chí Minh | Hà Nội | ...",
    "max_odo": "integer — số km tối đa"
  },
  "output": "{ listings: [...top 5], total_found: N }"
}
```

#### `get_listing_detail`
```json
{
  "name": "get_listing_detail",
  "trigger": "Khi user hỏi về giấy tờ, pháp lý, kiểm định, hoặc action là ESCALATE_PAPERWORK_RISK",
  "parameters": {
    "listing_id": "string — ID tin đăng (required)"
  },
  "output": "{ listing: { paperwork_status, vucar_certified, inspection_score, ... } }"
}
```

#### `create_chat_bridge`
```json
{
  "name": "create_chat_bridge",
  "trigger": "Khi stage MATCHING/NEGOTIATION, hoặc cần ngăn bypass sàn",
  "parameters": {
    "buyer_id": "string",
    "seller_id": "string",
    "listing_id": "string"
  },
  "output": "{ channel_id, safeguards: { phone_masking, escrow_enabled, inspection_guarantee } }"
}
```

#### `book_appointment`
```json
{
  "name": "book_appointment",
  "trigger": "Khi user bày tỏ ý định hẹn xem xe + tín hiệu thời gian (giờ/ngày/thứ...)",
  "parameters": {
    "channel_id": "string",
    "time": "string — trích xuất từ message người dùng",
    "place": "string",
    "appointment_type": "INSPECTION_AND_TEST_RIDE (default)"
  },
  "output": "{ appointment_id, status: CONFIRMED, inspector_assigned }",
  "side_effect": "lead_stage → APPOINTMENT"
}
```

#### `log_event`
```json
{
  "name": "log_event",
  "trigger": "Tự động sau mỗi hành động quan trọng",
  "parameters": {
    "conversation_id": "string",
    "event_type": "USER_MESSAGE | AGENT_ACTION | TOOL_CALL | STATE_UPDATE | ESCALATION | HANDOFF",
    "payload": "object"
  },
  "output": "{ event_id, status: logged }"
}
```

---

## 5. Chiến Lược Quản Lý Bộ Nhớ

### Kiến trúc 3 tầng (Tiered Memory)

```
TẦNG 1: RAW LOGS (Append-Only Event Stream)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Lưu: Toàn bộ tin nhắn gốc (100%), event log, timestamps
Mục đích: Audit compliance, replay forensics, tranh chấp pháp lý
Không bao giờ xóa. Append-only.

           ↓ Extract & Update (mỗi turn)

TẦNG 2: STRUCTURED STATE (Canonical Lead Memory)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Lưu: Entity slots (budget, brand, odo), active risks, lead_stage, 
     next_best_action, tool_history, open_questions
Mục đích: Deterministic tool routing, business logic guardrails,
          API output cho CRM/Sales Dashboard

           ↓ Semantic Compaction (khi > N turns)

TẦNG 3: ROLLING SUMMARY (Prompt Injection Context)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Lưu: Tóm tắt nén các cam kết, bất đồng, deal-breakers của các 
     turn cũ (> 8 turns gần nhất)
Mục đích: Giữ context window < 800 tokens; không để agent "quên"
```

### Quy tắc Context Window khi gọi LLM

```
Prompt = SYSTEM_PROMPT
       + ROLLING_SUMMARY (tầng 3: các turn cũ nén lại)
       + RECENT_N_TURNS (tầng 1: 8 turn gần nhất, full text)
       + CURRENT_STATE_JSON (tầng 2: state hiện tại)
       + TASK_INSTRUCTION (yêu cầu output JSON)
```

Ước tính token: ~1,200–1,800 tokens/request (nằm trong giới hạn Flash models).

### Compaction Rules

1. **Recent N = 8 turns:** Giữ nguyên 100% — Agent cần sắc thái câu chữ gần nhất
2. **Older turns (> 8):** Rule-based compaction — chỉ giữ lại tin có keyword quan trọng: số tiền, brand xe, ODO, "giấy tờ", "trung gian"
3. **Incremental delta:** Khi người mua thay đổi ngân sách (25tr → 27tr), ghi vào cả state (`budget_stretch_max`) và rolling summary ("Buyer nới ngân sách tối đa 27tr nếu xe đẹp")
4. **Dead chatter pruning:** Loại bỏ "dạ vâng", "ok bạn", "cảm ơn" khỏi summary

---

## 6. Failure Modes — Các Trường Hợp Hệ Thống Thất Bại

### FM-01: State Corruption khi message race condition
**Triệu chứng:** Nếu 2 tin nhắn gửi đồng thời (Buyer + Seller cùng lúc), state có thể bị overwrite.
**Hiện tại:** In-memory dict không có lock.
**Fix:** Sử dụng async lock (`asyncio.Lock`) per conversation_id, hoặc Redis với optimistic locking.

---

### FM-02: Hallucination khi Heuristics không nhận diện được ngữ cảnh
**Triệu chứng:** Khi user dùng từ lóng địa phương ("zin 100%", "bao công chứng", "rớt đầu") — Heuristics không hiểu, trả về CLARIFY_PREFERENCE chung chung.
**Hiện tại:** Fallback sang sales handoff sau 2 turns undecided.
**Fix:** Mở rộng từ điển domain; fine-tune Gemini với dữ liệu thực tế Vucar.

---

### FM-03: Premature Appointment Booking
**Triệu chứng:** Agent gọi `book_appointment` khi vẫn còn risk CRITICAL chưa được resolve (ví dụ: vẫn đang tranh chấp giấy tờ).
**Hiện tại:** Chưa có guardrail chặn.
**Fix:** Điều kiện tiên quyết: `book_appointment` chỉ được phép khi `risks.filter(r => !r.resolved && r.level == CRITICAL).length == 0`.

---

### FM-04: Budget Overwrite khi người mua thay đổi ý kiến
**Triệu chứng:** Người mua nói "cùng lắm 27tr" → state ghi `budget_max = 27tr` thay vì `budget_target = 25tr, budget_stretch_max = 27tr`.
**Hiện tại:** Chỉ có 1 field `budget_max`.
**Fix:** Tách thành `budget_target` (ưu tiên) và `budget_stretch_max` (kịch trần có điều kiện).

---

### FM-05: LLM Timeout / API Error ảnh hưởng đến trải nghiệm
**Triệu chứng:** Gemini API timeout (8s) → fallback Heuristics → response chất lượng thấp hơn, không nhận ra ngữ cảnh phức tạp.
**Hiện tại:** Fallback trong 8 giây.
**Fix:** Giảm timeout xuống 5s; thêm streaming response để UI hiển thị "đang xử lý..." thay vì hang.

---

### FM-06: Memory bị mất khi restart server
**Triệu chứng:** Toàn bộ state và conversation history mất khi process restart.
**Hiện tại:** Pure in-memory Python dict.
**Fix:** Serialize state sang Redis với TTL 24h; persist raw_logs sang PostgreSQL.

---

### FM-07: Tool gọi trùng lặp trong cùng một turn
**Triệu chứng:** Nếu message chứa cả keyword paperwork lẫn appointment, cả `get_listing_detail` lẫn `book_appointment` đều được gọi — nhưng reply chỉ hiển thị kết quả của tool cuối.
**Hiện tại:** `_compose_agent_reply` ưu tiên `book_appointment` nếu có.
**Fix:** Priority queue cho tool results; hoặc compose reply tổng hợp từ nhiều tool cùng lúc.

---

## 7. Kế Hoạch Đánh Giá Hệ Thống

### 7.1. Phân tầng Metric

#### Layer 1 — Task Success Metrics (Kết quả nghiệp vụ)
| Metric | Định nghĩa | Target |
|--------|-----------|--------|
| **Match Success Rate** | % hội thoại tìm ra ≥ 1 xe thỏa tiêu chí | ≥ 80% |
| **Appointment Booking Rate** | % hội thoại chốt được lịch xem xe | ≥ 65% |
| **Escalation Accuracy** | Precision & Recall phát hiện risk CRITICAL | ≥ 90% |
| **NBA Correctness** | % `next_best_action` được Sales/Ops xác nhận là đúng | ≥ 85% |

#### Layer 2 — Quality & Safety Metrics (Chất lượng)
| Metric | Định nghĩa | Target |
|--------|-----------|--------|
| **Slot Coverage Rate** | % các field quan trọng được lấp đầy trong state | ≥ 75% |
| **Hallucination Rate** | % thông tin xe bị bịa đặt không có trong database | ≤ 2% |
| **Safety Compliance** | % response tuân thủ chính sách Vucar | ≥ 99% |
| **Risk Detection Recall** | % các rủi ro thực sự được phát hiện | ≥ 85% |

#### Layer 3 — Business & Ops Metrics (Vận hành)
| Metric | Định nghĩa | Target |
|--------|-----------|--------|
| **Time-to-first-match** | Số turn trung bình đến lần đầu gọi `search_listings` | ≤ 2 turns |
| **Drop-off Rate** | % lead bị drop sau ≤ 2 tin nhắn | ≤ 25% |
| **Human Escalation Load** | % ca thực sự cần Sales can thiệp | ≤ 15% |
| **Avg Response Latency** | Thời gian phản hồi trung bình | ≤ 1,200ms |

---

### 7.2. Phương pháp Đánh giá

**A/B Testing:**
- Nhóm A: Vucar AI Agent (ReAct + Structured State)
- Nhóm B: Chatbot FAQ truyền thống
- Metric đo: Appointment Rate, Drop-off Rate, User Satisfaction

**Offline Benchmark (Golden Test Set):**
- 50 hội thoại có nhãn thủ công từ Sales Vucar
- Đánh giá NBA correctness, risk detection precision/recall
- Chạy tự động mỗi lần deploy (`pytest backend/tests/`)

**Human Evaluation:**
- Sales/Ops review 20% sample hàng tuần
- Đánh giá: "Hành động này có đúng nghiệp vụ không?" (1–5)
- Các ca sai → đưa vào Error Analysis → cải thiện heuristics/prompt

---

### 7.3. Feedback Loop Data Flywheel

```
Live Chat → Record Quadruplet (Context, State, Action, Outcome)
                │
     ┌──────────┴──────────┐
     ▼                     ▼
  Thành công           Thất bại
  (Booked/Closed)     (Dropped/Bypass)
     │                     │
     ▼                     ▼
 Golden Few-shot      Error Analysis
 vào Prompt           → Guardrail Rule
     │                     │
     └──────────┬──────────┘
                ▼
       Deploy cải tiến 2 tuần/lần
```

---

## 8. Kế Hoạch Cải Tiến Tương Lai & Đề Xuất Nâng Cao

Để biến AI Agent từ một hệ thống điều phối hội thoại đơn thuần thành **Trợ lý Toàn diện (Super Copilot) thúc đẩy doanh số mạnh mẽ cho đội ngũ Sales & Vận hành Vucar**, kế hoạch kiến trúc và cải tiến kỹ thuật được định hình chi tiết như sau:

---

### 8.1. Thiết Kế Pipeline RAG (Retrieval-Augmented Generation) Tra Cứu Quy Trình & Pháp Lý Vucar

Hiện tại các kiến thức chuyên sâu về chính sách Vucar (120 điểm kiểm định gồm những gì, điều khoản bảo hành Vucar Care 6 tháng, quy trình rút hồ sơ công an quận...) đang được nén tóm tắt trong Prompt. Điều này gây tốn Context Window và khó cập nhật khi quy chế công ty thay đổi.

**Kiến trúc RAG chuyên biệt cho Vucar:**
```
[Tài liệu nội bộ: SOP 120 điểm, Quy chế cọc/Escrow, Luật Giao thông/Sang tên]
                               │
                               ▼
            [Chunking & Metadata Tagging (Chủ đề, Model xe, Pháp lý)]
                               │
                               ▼
       [Embedding Model: text-embedding-004 / multilingual-e5-base]
                               │
                               ▼
        [Vector DB: Qdrant / Pgvector / Pinecone (Hỗ trợ Hybrid Search)]
                               │
                               ▼
 ┌────────────────────────────────────────────────────────────────────────┐
 │ HYBRID RETRIEVAL PIPELINE (Dense Vector + BM25 Lexical + Reranker)     │
 │                                                                        │
 │ 1. Intent Router: Xác định câu hỏi thuộc nhóm:                        │
 │    - "Chính sách kiểm định 120 điểm"                                   │
 │    - "Quy trình rút hồ sơ gốc / Sang tên đổi chủ cấp biển số mới"       │
 │    - "Gói bảo hành động cơ & hộp số Vucar Care"                        │
 │                                                                        │
 │ 2. Retrieve Top-K Contexts (K=3) có độ tin cậy > 0.82                  │
 │ 3. Reranker (Cohere / Cross-Encoder): Loại bỏ context nhiễu            │
 │ 4. Dynamic Prompt Injection: Cung cấp trích dẫn chính xác cho LLM     │
 └────────────────────────────────────────────────────────────────────────┘
```
* **Lợi ích thực tế:** Khi khách hàng hỏi *"Rút hồ sơ ở Bình Dương mất mấy ngày và tốn bao nhiêu phí?"* hoặc *"Gói Vucar Care có bảo hành nồi xe tay ga không?"*, AI trả lời chính xác 100% theo cẩm nang mới nhất của Vucar, kèm số hotline và dẫn chứng quy định rõ ràng, hoàn toàn triệt tiêu Hallucination.

---

### 8.2. Hệ Thống "Sales Copilot" — Biến AI Thành Trợ Thủ Đắc Lực Cho Đội Ngũ Bán Hàng

Thay vì chỉ tương tác với khách, AI Agent sẽ đóng vai trò **"Bộ não phân tích ngầm" (Background Intelligence)** hỗ trợ nhân viên Sales chốt deal nhanh gấp 2–3 lần:

1. **Chấm điểm tiềm năng Lead theo thời gian thực (Real-time Lead Scoring & Intent Matrix):**
   * Tự động tính điểm độ nóng của Lead (0 – 100) dựa trên: Tần suất phản hồi, sự rõ ràng về ngân sách, mức độ cần xe gấp (Urgency), và thiện chí xem xe.
   * Khi Lead đạt điểm > 80 (Hot Lead), hệ thống tự động đẩy thông báo ưu tiên (High Priority Alert) kèm tóm tắt hồ sơ khách hàng vào ứng dụng của Telesales/Sales Rep.

2. **Gợi ý kịch bản ứng biến thông minh (Live Battlecards & Objection Handling):**
   * Nếu khách hàng so sánh: *"Bên Chợ Tốt bán con Air Blade này có 27 triệu thôi"*:
   * AI Copilot lập tức gửi gợi ý cho Sales:
     > *"Anh/chị giải thích: Giá 27tr trên sàn tự do thường chưa gồm phí rút hồ sơ gốc (1.5–2tr) và không có bảo hành động cơ. Xe 31tr của Vucar đã kiểm định 120 điểm, bao sang tên và tặng kèm bảo hành Vucar Care 6 tháng, tiết kiệm chi phí sửa chữa về sau."*

3. **Cơ chế Handoff thông minh kèm "Briefing Report" (Không để Sales đọc lại từ đầu):**
   * Khi cần chuyển giao cho người thật (Escalation / Handoff), Sales nhận ngay 1 bản **One-Page Executive Briefing**:
     * *Khách hàng:* Anh Nam - Tìm xe tay ga 25-27tr đi làm.
     * *Điểm nghẽn (Blocker):* Rất thích xe Vision nhưng ngại biển số tỉnh chưa rút hồ sơ.
     * *Hành động đề xuất cho Sales:* Đề xuất đặt cọc giữ xe qua Escrow và hỗ trợ phí rút hồ sơ 500k.

4. **Tự động trích xuất Task & Lên lịch nhắc hẹn CRM (Auto CRM Sync):**
   * Tự động push dữ liệu sau cuộc chat vào CRM (HubSpot, Salesforce, LarkBase, Lark Meego): Tạo Contact, cập nhật Deal Stage, tạo Google Calendar nhắc Kỹ thuật viên đi kiểm định xe theo giờ hẹn đã chốt.

---

### 8.3. Động Cơ Định Giá Thị Trường & Đàm Phán Tự Động (AI Valuation & Dynamic Pricing Engine)

* **Market Pricing Intelligence:**
  * Kết nối trực tiếp với cơ sở dữ liệu giao dịch thực tế của Vucar để phân tích giá thị trường (Fair Market Value) theo: `Hãng + Dòng xe + Năm sản xuất + Số ODO + Tình trạng ngoại quan`.
* **Dynamic Negotiation Boundary:**
  * Thiết lập biên độ thương lượng tự động: Cho phép AI Agent tự động đề xuất giảm giá trong giới hạn cho phép của Seller (ví dụ được phép bớt tối đa 1.5 triệu nếu khách đồng ý chốt lịch hẹn trong 24 giờ tới).

---

### 8.4. Đa Kênh Tích Hợp (Omnichannel Integration) & Voice AI

* **Omnichannel Hub:** Tích hợp trực tiếp vào **Zalo OA (Official Account)**, **Facebook Messenger**, **TikTok Shop Chat**, và **Website Widget** để quản lý hội thoại tập trung trên 1 luồng State duy nhất.
* **AI Voice Caller (Khảo sát & Nhắc lịch tự động):**
  * Tích hợp Voice Agent (sử dụng Gemini Live API / ElevenLabs) tự động gọi điện xác nhận lịch hẹn trước 2 tiếng: *"Dạ em chào anh Nam, em là trợ lý Vucar gọi để xác nhận lịch xem xe Air Blade lúc 15h chiều nay tại Vucar Hub Quận 10..."*.

---

### 8.5. Lộ Trình Triển Khai Kỹ Thuật (Engineering Roadmap)

| Giai đoạn | Thời gian | Mục tiêu chính | Đầu ra kỹ thuật |
| :--- | :---: | :--- | :--- |
| **P0: Foundation** | 1–2 tháng | Ổn định hạ tầng & Dữ liệu bền vững | • Persistent Storage (PostgreSQL + Redis).<br>• Authentication & Per-conversation Locks.<br>• Appointment Guardrail chặn booking khi dính rủi ro. |
| **P1: Intelligence** | 3–4 tháng | Trợ lý thông minh & Am hiểu nghiệp vụ | • **Triển khai RAG Pipeline** tra cứu 120 điểm kiểm định & pháp lý.<br>• Native Function Calling trên Gemini 3.5/3.8 Flash.<br>• Từ điển tiếng lóng xe máy Việt Nam chuyên sâu. |
| **P2: Sales Copilot** | 5–6 tháng | Tối ưu hóa chuyển đổi & Giúp sức Sales | • Real-time Lead Scoring Dashboard cho Sales.<br>• Gợi ý Battlecard đàm phán tức thì.<br>• Tự động đồng bộ hóa CRM & Lịch kiểm định. |
| **P3: Ecosystem** | 7–12 tháng | Nền tảng toàn diện | • Omnichannel Zalo OA / Messenger.<br>• Dynamic Market Valuation Engine.<br>• AI Vision phát hiện vết nứt/trầy xước xe qua ảnh chụp. |

---

## 9. Hướng Dẫn Chạy

> Xem [QUICKSTART.md](./QUICKSTART.md) để có hướng dẫn chi tiết từng bước.

### Nhanh nhất

```bash
# 1. Cài thư viện
pip install -r requirements.txt

# 2. Chạy server
python run.py

# 3. Mở trình duyệt
# → http://127.0.0.1:8000
```

Hệ thống chạy hoàn toàn **không cần Gemini API key** nhờ Intelligent Domain Heuristics tích hợp sẵn.