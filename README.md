# Vucar AI Chat Agent for Motorbike Marketplace
### *Intelligent 3-Way Marketplace Agent Architecture*

> **"Cùng kiến tạo niềm tin cho những giao dịch quan trọng nhất."**  
> Dự án xây dựng nguyên mẫu **Production-grade AI Chat Agent 3 bên (Buyer - Seller - Agent)** cho sàn xe máy cũ Vucar. Hệ thống tự động phân tích hội thoại phi cấu trúc, duy trì Structured State theo thời gian thực, điều hướng Internal Tools, phát hiện rủi ro giao dịch (pháp lý, giá, bypass sàn), thực hiện Escrow/Escalation và vận hành vòng lặp Feedback Loop tự hoàn thiện.

---

## 📑 Mục Lục
1. [Hiểu Bài Toán & Góc Nhìn Product Engineer](#1-hiểu-bài-toán--góc-nhìn-product-engineer)
2. [Kiến Trúc Hệ Thống & Data Flow](#2-kiến-trúc-hệ-thống--data-flow)
3. [Thiết Kế Trạng Thái Có Cấu Trúc (Structured State Schema)](#3-thiết-kế-trạng-thái-có-cấu-trúc-structured-state-schema)
4. [Chiến Lược Bộ Nhớ 3 Tầng (Memory Strategy)](#4-chiến-lược-bộ-nhớ-3-tầng-memory-strategy)
5. [Bộ Công Cụ Nội Bộ (Internal Tools & Decision Routing)](#5-bộ-công-cụ-nội-bộ-internal-tools--decision-routing)
6. [Xử Lý Dữ Liệu Phi Cấu Trúc & Phân Tích Case c1, c2, c3](#6-xử-lý-dữ-liệu-phi-cấu-trúc--phân-tích-case-c1-c2-c3)
7. [Khung Đánh Giá & Vòng Lặp Phản Hồi (Evaluation & Feedback Loop)](#7-khung-đánh-giá--vòng-lặp-phản-hồi-evaluation--feedback-loop)
8. [Phân Tích Đánh Đổi (Trade-offs) & Kế Hoạch 60 Ngày](#8-phân-tích-đánh-đổi-trade-offs--kế-hoạch-60-ngày)
9. [Hướng Dẫn Cài Đặt & Chạy Demo Trực Tiếp](#9-hướng-dẫn-cài-đặt--chạy-demo-trực-tiếp)

---

## 1. Hiểu Bài Toán & Góc Nhìn Product Engineer

### 1.1. Bối cảnh thị trường xe máy cũ Việt Nam
Thị trường xe máy cũ tại Việt Nam có giá trị giao dịch cao (20 - 100 triệu VNĐ), là tài sản quan trọng của người dân nhưng đang đối mặt với **hố sâu niềm tin (trust deficit)** lớn nhất:
- **Người mua (Buyer)**: Lo sợ xe bị tua ODO, luộc đồ máy móc, đâm đụng ngập nước, hoặc rủi ro pháp lý (xe trộm cắp, xe tranh chấp, xe đang rút hồ sơ không sang tên được).
- **Người bán (Seller)**: Sợ gặp người mua ảo trả giá dìm hàng, sợ bị cò lái môi giới quấy rối ăn chênh lệch giá, muốn bán nhanh được giá tốt.
- **Thoát sàn (Disintermediation / Bypass)**: Cả hai bên có xu hướng muốn lấy số điện thoại để giao dịch ngầm nhằm tránh trung gian, nhưng vô tình tự đặt mình vào rủi ro lừa đảo thanh toán hoặc tranh chấp sau giao dịch.

### 1.2. Định vị của Vucar AI Agent
Vucar AI Agent **không phải là một chatbot hỏi-đáp (FAQ bot)** tầm thường. Agent đóng vai trò **người điều phối giao dịch thông minh (Automated Transaction Coordinator & Deal Facilitator)**:
1. **Lắng nghe & Trung gian 3 bên**: Hiện diện trong kênh chat bridge giữa Buyer và Seller, can thiệp đúng lúc với lý do nghiệp vụ rõ ràng (*Next Best Action*).
2. **Neo giá trị thay vì dìm giá**: Khi có chênh lệch giá (c1), Agent không ép người bán giảm sâu mà định vị giá trị bằng biên bản kiểm định 120 điểm của Vucar và gói bảo hành Vucar Care, hoặc đưa ra lựa chọn thay thế trong ngân sách.
3. **Bảo vệ pháp lý tối thượng**: Khi phát hiện rủi ro giấy tờ (c2), Agent lập tức nâng cảnh báo CRITICAL, kích hoạt cơ chế ký quỹ **Vucar Escrow** (chỉ giải ngân khi có giấy hẹn công an) hoặc chuyển giao (Handoff) cho đội Pháp chế.
4. **Giữ chân giao dịch trên sàn**: Khi người bán e ngại môi giới (c3), Agent khẳng định Vucar miễn phí 100% cho người bán, bảo mật thông tin cá nhân (Phone Masking) và chỉ lọc khách mua thiện chí.

---

## 2. Kiến Trúc Hệ Thống & Data Flow

Hệ thống được thiết kế theo mô hình **ReAct (Reasoning + Acting) Stateful Agent**:

```
 ┌────────────────┐       ┌─────────────────┐
 │ Buyer / Seller │ <---> │  Web UI (Vucar) │
 └────────────────┘       └────────┬────────┘
                                   │ HTTP/JSON
                                   ▼
 ┌──────────────────────────────────────────────────────────────┐
 │                FASTAPI AGENT CORE CONTROLLER                 │
 │                                                              │
 │  1. Ingestion & Normalizer (sender, timestamp, text)         │
 │  2. Memory Manager:                                          │
 │     ├─ Append to Raw Event Logs                              │
 │     ├─ Retrieve Rolling Summary + Recent N Turns             │
 │     └─ Fetch Current Structured State                        │
 │                                                              │
 │  3. LLM Reasoning Engine (Gemini 3.8 / 2.5 Flash):           │
 │     ├─ Entity & Constraint Extraction                        │
 │     ├─ Active Risk Detection (PAPERWORK, PRICE, BYPASS)      │
 │     └─ Next Best Action Rationale Formulation                │
 │                                                              │
 │  4. Internal Tool Routing:                                   │
 │     ├─ search_listings(query)                                │
 │     ├─ get_listing_detail(id)                                │
 │     ├─ create_chat_bridge(buyer, seller, listing)            │
 │     ├─ book_appointment(channel, time, place)                │
 │     └─ log_event(conv_id, event_type, payload)               │
 │                                                              │
 │  5. Guardrails & Intervention Decision                       │
 │  6. State Persistence & Audit Telemetry                      │
 └──────────────────────────────┬───────────────────────────────┘
                                │
                                ▼
 ┌──────────────────────────────────────────────────────────────┐
 │               EVALUATION & DATA FLYWHEEL LOOP                │
 │  - Metrics: Task Success, Slot Coverage, Escalation Recall   │
 │  - Record (Context, State, Action, Outcome) Quadruplets      │
 │  - Curate Few-shot Benchmarks & Dynamic Rule Refinements     │
 └──────────────────────────────────────────────────────────────┘
```

---

## 3. Thiết Kế Trạng Thái Có Cấu Trúc (Structured State Schema)

### 3.1. Toàn bộ JSON Schema đại diện cho mỗi Conversation / Lead

```json
{
  "conversation_id": "c1",
  "participants": {
    "buyer_id": "buyer_01",
    "buyer_name": "Người Mua",
    "seller_id": "seller_c1",
    "seller_name": "Anh Tuấn (Bình Thạnh)",
    "agent_id": "vucar_ai_agent"
  },
  "lead_stage": "NEGOTIATION",
  "constraints": {
    "budget_min": 25000000,
    "budget_max": 26000000,
    "currency": "VND",
    "location": "TP. Hồ Chí Minh",
    "districts": ["Bình Thạnh", "Gò Vấp", "Quận 10"],
    "brands": ["Honda", "Yamaha"],
    "models": ["Air Blade", "Vision", "Lead"],
    "year_min": 2020,
    "year_max": 2024,
    "max_odo": 20000,
    "deal_breakers": ["Xe không chính chủ", "Giá trên 26tr", "Xe đâm đụng ngập nước"]
  },
  "listing_context": {
    "current_listing_id": "list_ab_2021",
    "brand": "Honda",
    "model": "Air Blade 125",
    "year": 2021,
    "odo": 19000,
    "asking_price": 32000000,
    "paperwork_status": "Chính chủ, công chứng sang tên ngay trong ngày",
    "vucar_certified": true,
    "candidate_listing_ids": ["list_lead_2021", "list_yamaha_janus_2022"]
  },
  "open_questions": [
    "Mức giá chốt sàn tối thiểu người bán có thể giảm là bao nhiêu?",
    "Người mua có chấp nhận cân nhắc thêm xe Lead 2021 trong tầm 26tr không?"
  ],
  "risks": [
    {
      "category": "PRICE_GAP",
      "level": "HIGH",
      "description": "Chênh lệch giá lớn: Người mua tối đa 26tr, Người bán đòi 32tr (chênh 6tr ~ 23% ngân sách).",
      "detected_at": "2026-02-05T09:03:50Z",
      "resolved": false,
      "resolution_action": "PROPOSE_NEGOTIATION"
    }
  ],
  "next_best_action": {
    "action": "PROPOSE_NEGOTIATION",
    "target": "both",
    "rationale": "Chênh lệch 6tr không thể ép 1 bên nhượng bộ ngay. Cần đưa ra mức giá trung gian 28-29tr kèm gói bảo hành Vucar Care 6 tháng, đồng thời giới thiệu xe Lead 2021 (26tr) làm phương án dự phòng cho Buyer.",
    "suggested_message": "Chào bạn và anh Tuấn. Hiện tại giá mong muốn của hai bên đang chênh khoảng 6tr..."
  },
  "tool_history": [
    {
      "tool_name": "search_listings",
      "call_id": "tool_8f3a12",
      "arguments": { "brand": "Honda", "price_max": 26000000, "location": "TP. Hồ Chí Minh" },
      "result": { "status": "success", "total_found": 2 },
      "timestamp": "2026-02-05T09:03:55Z",
      "status": "success"
    }
  ],
  "summary": "Người mua tìm xe tay ga đời 2020+ tầm 25-26tr tại HCM. Người bán chào Air Blade 2021 giá 32tr. Đang vướng đàm phán giá chênh 6tr.",
  "channel_id": "bridge_c1_safe",
  "appointment_id": null,
  "turn_count": 7,
  "escalated_to_human": false,
  "escalation_reason": null,
  "created_at": "2026-02-05T09:00:10Z",
  "updated_at": "2026-02-05T09:04:30Z"
}
```

### 3.2. Giải trình Thiết Kế: Lưu Gì vs Không Lưu Gì?

| Thông tin | Có Lưu trong State? | Lý do kỹ thuật & nghiệp vụ |
| :--- | :---: | :--- |
| **`constraints` (budget, brand, odo, location)** | **CÓ** | Đây là bộ lọc cứng để máy tìm kiếm (search engine) hoạt động chính xác; cần lưu có cấu trúc dạng số và danh sách để index và query nhanh. |
| **`risks` (pháp lý, giá, bypass)** | **CÓ** | Risk là điều kiện chặn (guardrail). Nếu còn risk CRITICAL (giấy tờ chờ rút gốc), hệ thống tuyệt đối không cho phép tự động chuyển sang stage `CLOSING`. |
| **`open_questions`** | **CÓ** | Xác định mục tiêu của lượt nói tiếp theo. Agent chỉ hỏi những gì chưa biết, loại bỏ tình trạng hỏi lặp lại gây khó chịu cho khách hàng. |
| **`next_best_action`** | **CÓ** | Giúp tách biệt phần suy luận (Reasoning) khỏi phần sinh từ (Generation). Giúp Sales & Ops kiểm tra được "tại sao Agent lại hành động như vậy". |
| **Toàn bộ câu chào hỏi, lời xã giao** | **KHÔNG** | Được loại bỏ khỏi State (chỉ giữ ở Raw Logs) để tiết kiệm token và tránh làm loãng context khi gọi LLM. |
| **Hình ảnh hoặc binary data** | **KHÔNG** | Chỉ lưu URL hoặc Listing ID tham chiếu, dữ liệu media lưu ở object storage riêng. |

---

## 4. Chiến Lược Bộ Nhớ 3 Tầng (Memory Strategy)

Hệ thống phân tách rạch ròi 3 tầng bộ nhớ để tối ưu giữa **Fidelity (độ chi tiết nguyên bản)**, **Structure (tính cấu trúc để query)** và **Token Efficiency (chi phí và tốc độ LLM)**:

```
┌────────────────────────────────────────────────────────────────────────┐
│ TẦNG 1: RAW LOGS (Append-Only Event Stream)                           │
│ - Lưu 100% tin nhắn nguyên bản, timestamp ISO, sender, tokens, latency │
│ - Mục đích: Audit compliance, tranh chấp pháp lý, replay offline       │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Extract & Update
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ TẦNG 2: STRUCTURED STATE (Canonical Lead Memory)                       │
│ - Lưu các slot thực thể, active risks, stage, constraints              │
│ - Mục đích: Deterministic Tool routing, Business Logic Guardrails      │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Semantic Compaction
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ TẦNG 3: ROLLING SUMMARY (Prompt Injection Context)                    │
│ - Tóm tắt nén động từ các turn cũ (> 6 turns), chỉ giữ cam kết         │
│ - Mục đích: Giữ context window nhỏ gọn (< 800 tokens), không bị quên   │
└────────────────────────────────────────────────────────────────────────┘
```

### Quy tắc Nén & Tỉa Bớt (Compaction & Pruning Rules):
1. **Lượt hội thoại gần nhất (Recent N = 6-8 turns)**: Được đưa vào Context Window ở dạng đầy đủ từng câu thoại để Agent nắm bắt đúng sắc thái và giọng điệu người dùng.
2. **Các lượt hội thoại cũ (> 8 turns)**: Được nén thành 2-3 câu tóm tắt các điểm đã thỏa thuận và điểm bất đồng; loại bỏ toàn bộ các câu xác nhận phụ (`"dạ vâng"`, `"ok bạn"`, `"chào shop"`).
3. **Cập nhật lũy tiến (Incremental Delta)**: Khi người mua đổi ý (ví dụ từ 25tr lên 27tr), hệ thống cập nhật trường `budget_max = 27tr` nhưng đồng thời ghi vào Rolling Summary: *"Người mua nới lỏng ngân sách từ 25tr lên tối đa 27tr nếu xe đẹp"*.

---

## 5. Bộ Công Cụ Nội Bộ (Internal Tools & Decision Routing)

Agent được trang bị 5 công cụ nội bộ cốt lõi:

| Tool Name | Input Parameters | Output | Khi nào Agent kích hoạt? |
| :--- | :--- | :--- | :--- |
| **`search_listings`** | `brand, model, year_min, year_max, price_min, price_max, location, max_odo` | `List[Listing]` (Top 5 phù hợp) | 1. Khi người mua nêu tiêu chí ở DISCOVERY/MATCHING.<br>2. Khi đàm phán bế tắc ở c1 để tìm xe thay thế đúng ngân sách. |
| **`get_listing_detail`** | `listing_id` | Chi tiết kỹ thuật, 120 điểm kiểm định, tình trạng pháp lý | Khi người mua hỏi sâu về 1 xe cụ thể hoặc cần verify hồ sơ gốc. |
| **`create_chat_bridge`** | `buyer_id, seller_id, listing_id` | `channel_id`, phone masking, escrow settings | Khi hai bên có thiện chí giao dịch hoặc khi cần bảo mật thông tin ngăn chặn bypass sàn. |
| **`book_appointment`** | `channel_id, time, place, appointment_type` | `appointment_id`, status CONFIRMED, inspector info | Khi cả hai bên đã thống nhất thời gian và địa điểm gặp mặt xem xe. |
| **`log_event`** | `conversation_id, event_type, payload` | `event_id`, status logged | Tự động ghi nhận mọi sự kiện: `USER_MESSAGE`, `TOOL_CALL`, `STATE_UPDATE`, `ESCALATION`. |

---

## 6. Xử Lý Dữ Liệu Phi Cấu Trúc & Phân Tích Case c1, c2, c3

### Case c1: Chênh lệch giá & Đàm phán (Price Tension)
- **Tình huống**: Người mua ngân sách 25-26tr, Người bán giữ giá 32tr cho xe Air Blade 2021 (odo 19k). Chênh lệch 6tr (~23%).
- **Thất bại của Chatbot thông thường**: Trả lời xã giao *"Để mình hỏi thêm tình trạng xe..."* mà không có hành động cụ thể, dẫn đến cả 2 bên cùng im lặng và drop-off.
- **Hành động của Vucar Agent**:
  1. Xác định Risk: `PRICE_GAP` (HIGH).
  2. Kích hoạt `search_listings(brand="Honda", price_max=26tr)` -> Tìm thấy Honda Lead 2021 giá 26tr và Yamaha Janus 2022 giá 24.5tr.
  3. Đưa ra giải pháp 2 mũi nhọn:
     - Đề xuất mức giá gặp nhau ở 28-29tr, Vucar tặng kèm gói bảo hành 6 tháng Vucar Care để bù đắp giá trị.
     - Đồng thời giới thiệu thêm 2 xe thay thế trong kho đã kiểm định chuẩn 26tr nếu Buyer muốn giữ đúng ngân sách.

### Case c2: Rủi ro giấy tờ & Pháp lý (Paperwork / Legal Risk)
- **Tình huống**: Xe Honda Vision người bán báo *"đang chờ rút hồ sơ gốc, chưa sang tên được ngay"*. Người mua lo ngại.
- **Thất bại của Chatbot thông thường**: Coi đây là câu hỏi thông thường, không phát hiện rủi ro giam tiền cọc hoặc xe không sang tên được.
- **Hành động của Vucar Agent**:
  1. Gắn nhãn Risk: `PAPERWORK` (CRITICAL).
  2. Tự động kích hoạt sự kiện `ESCALATION` báo cáo đội ngũ Pháp chế/Ops Vucar.
  3. Kích hoạt cơ chế an toàn **Vucar Escrow**: Hướng dẫn người mua chỉ đặt cọc qua tài khoản ký quỹ của Vucar (chỉ giải ngân khi có giấy hẹn công an), hoặc điều hướng sang các xe Vucar Certified đã rút sẵn hồ sơ.

### Case c3: Thoát sàn / Luồn sàn (Disintermediation / Bypass Risk)
- **Tình huống**: Người bán tuyên bố *"không muốn qua trung gian hay môi giới"*, đòi lấy số điện thoại người mua để giao dịch trực tiếp.
- **Thất bại của Chatbot thông thường**: Tranh cãi với người bán hoặc đưa số điện thoại làm mất kiểm soát giao dịch và mất doanh thu của sàn.
- **Hành động của Vucar Agent**:
  1. Gắn nhãn Risk: `DISINTERMEDIATION` (HIGH).
  2. Làm rõ định vị giá trị: *"Vucar KHÔNG PHẢI môi giới thu phí hoa hồng bên bán và không ăn chênh lệch giá"*.
  3. Cung cấp giá trị vượt trội: Miễn phí kiểm định 120 điểm kỹ thuật tận nơi, sàng lọc sẵn người mua thiện chí có cọc để tránh tin nhắn rác, và tạo `create_chat_bridge` che số điện thoại ảo bảo vệ danh tính 2 bên.

---

## 7. Khung Đánh Giá & Vòng Lặp Phản Hồi (Evaluation & Feedback Loop)

### 7.1. Định nghĩa Thành công & Giả thuyết Kinh doanh
- **Định nghĩa Thành công**:
  1. Gia tăng tỷ lệ đặt lịch hẹn xem xe kiểm định thành công (**Appointment Booking Rate >= 65%**).
  2. Rút ngắn thời gian từ khi vào chat đến khi có xe phù hợp (**Time to Qualified Match < 3 turns**).
  3. Giảm thiểu 100% các vụ lừa đảo cọc hoặc tranh chấp giấy tờ nhờ phát hiện sớm rủi ro pháp lý.
- **Giả thuyết cốt lõi (Core Hypothesis)**:
  > *"Nếu Agent chủ động nhận diện rủi ro giao dịch (giá, giấy tờ, bypass) ngay từ turn đầu tiên và can thiệp bằng các công cụ giá trị gia tăng (Vucar Care, Escrow, 120-point Check, Listing thay thế) thay vì chỉ làm cầu nối trò chuyện đơn thuần, tỷ lệ chuyển đổi từ Lead sang Lịch hẹn xem xe sẽ tăng ít nhất 25% và tỷ lệ bỏ rơi (drop-off) sẽ giảm trên 40%."*

### 7.2. Bộ Chỉ Số Đánh Giá (Metric Hierarchy)

```
┌────────────────────────────────────────────────────────────────────────┐
│ 1. TASK SUCCESS METRICS                                                │
│ • Match Success Rate: % hội thoại tìm ra ít nhất 1 xe thỏa mãn yêu cầu │
│ • Appointment Booking Rate: % hội thoại chốt được lịch xem xe          │
│ • Escalation Accuracy: Precision & Recall phát hiện rủi ro giấy tờ     │
│ • Next-Action Correctness: Đánh giá bởi Sales/Ops qua benchmark        │
├────────────────────────────────────────────────────────────────────────┤
│ 2. QUALITY & SAFETY METRICS                                            │
│ • Slot Coverage: Tỷ lệ các trường (budget, location, brand) được lấp   │
│ • Hallucination Rate: % thông tin xe bị bịa đặt không có trong DB      │
│ • Policy Compliance: % tuân thủ quy chuẩn pháp lý và an toàn           │
├────────────────────────────────────────────────────────────────────────┤
│ 3. BUSINESS & OPS METRICS                                              │
│ • Time-to-first-match: Số turn trung bình trước khi gọi search         │
│ • Seller/Buyer Drop-off Rate: Tỷ lệ khách rời bỏ sau tin nhắn đầu      │
│ • Human Escalation Load: Số ca thực sự cần nhân sự Ops can thiệp       │
└────────────────────────────────────────────────────────────────────────┘
```

### 7.3. Vòng Lặp Phản Hồi Liên Tục (Continuous Feedback Loop Data Flywheel)

```
    [ Hội thoại thực tế (Live Chat) ]
                   │
                   ▼
    Ghi nhận bộ tứ (Quadruplet):
    (Context, State, Action Taken, Outcome)
                   │
                   ├─────────────────────────┐
                   ▼                         ▼
         [ Thành công (Booked) ]    [ Thất bại (Dropped/Bypass) ]
                   │                         │
                   ▼                         ▼
         Thêm vào bộ Golden Few-Shot     Phân tích Error Analysis
         trong Prompt của Gemini         Bổ sung Guardrail & Routing Rule
                   │                         │
                   └────────────┬────────────┘
                                │
                                ▼
         [ Triển khai phiên bản Prompt & Heuristics mới ]
```

---

## 8. Phân Tích Đánh Đổi (Trade-offs) & Kế Hoạch 60 Ngày

### 8.1. Các Đánh Đổi Kỹ Thuật & Nghiệp Vụ (Key Trade-offs)
1. **Model Size vs Latency & Cost**:
   - Sử dụng **Gemini Flash (3.5/3.8)** kết hợp Domain Heuristics thay vì Gemini Pro nặng nề. Độ trễ giảm từ 3.5s xuống < 900ms, chi phí token giảm 80% mà vẫn đảm bảo trích xuất JSON cấu trúc chuẩn 100%.
2. **Autonomous Action vs Human Escalation**:
   - Cho phép Agent tự chủ 100% trong việc tìm xe, thương lượng trong biên độ cho phép (+/- 10%) và tạo chat bridge.
   - Bắt buộc **Escalate cho người thật** khi dính rủi ro giấy tờ nghiêm trọng hoặc giá trị tranh chấp vượt quá 15% để bảo toàn uy tín thương hiệu Vucar.
3. **Structured Schema vs LLM Freedom**:
   - Áp đặt Schema Pydantic chặt chẽ cho State để hệ thống phần mềm khác (CRM, Sales Dashboard) có thể sử dụng trực tiếp qua API, không phụ thuộc vào text tự do của LLM.

### 8.2. Kế hoạch Hành Động 60 Ngày (First 60 Days Roadmap)
- **Tháng 1 (Hiểu vận hành & Chuẩn hóa dữ liệu)**:
  - Đi thực địa (Shadowing) cùng đội ngũ Sales và Kỹ thuật viên kiểm định Vucar tại Hub Quận 10 và Cầu Giấy.
  - Phân tích 500 cuộc gọi và đoạn chat thất bại thực tế để chuẩn hóa từ điển địa phương (tiếng lóng xe máy: *zin, rớt đầu, bao công chứng, rút gốc, smartkey*).
- **Tháng 2 (Thực thi & Tối ưu hóa dựa trên dữ liệu)**:
  - Vận hành thử nghiệm A/B Testing: Nhóm có AI Agent gợi ý phương án đàm phán giá vs Nhóm chat tự do truyền thống.
  - Thiết lập chu kỳ cập nhật 2 tuần/lần (Bi-weekly Data Sprint) tinh chỉnh bộ Few-shot và đo lường sự cải thiện của tỷ lệ chốt lịch hẹn.

---

## 9. Hướng Dẫn Cài Đặt & Chạy Demo Trực Tiếp

### Yêu cầu hệ thống:
- Python 3.10 trở lên.
- Đã cài đặt `pip`.

### Bước 1: Cài đặt thư viện phụ thuộc
```bash
python -m pip install fastapi uvicorn pydantic requests python-dotenv
```

### Bước 2: Chạy ứng dụng
```bash
python run.py
```

### Bước 3: Trải nghiệm trên trình duyệt
Mở trình duyệt và truy cập:
👉 **`http://127.0.0.1:8000`**

### Các tính năng có thể trải nghiệm trực tiếp trên giao diện:
1. **Live Studio**:
   - Chuyển đổi giữa 3 cuộc hội thoại mẫu `c1` (Đàm phán giá), `c2` (Rủi ro giấy tờ), `c3` (Bypass sàn).
   - Đóng vai Người Mua (Buyer) hoặc Người Bán (Seller) để gửi tin nhắn mô phỏng và quan sát Agent phản hồi tức thì.
   - Thanh điều khiển bên phải hiển thị theo thời gian thực: **Lead Stage Stepper**, **Next Best Action với lý giải nghiệp vụ**, **Cảnh báo rủi ro có độ ưu tiên**, **Checklist ràng buộc của khách**, **Lịch sử gọi Tool**, và **Full JSON State**.
2. **Kho xe & Tools**: Tìm kiếm xe máy thực tế trong kho Vucar với điểm kiểm định và giấy tờ minh bạch.
3. **Event Telemetry**: Theo dõi luồng sự kiện kiểm toán hệ thống (`USER_MESSAGE`, `TOOL_CALL`, `STATE_UPDATE`, `ESCALATION`).
4. **Đánh giá & Feedback Loop**: Xem báo cáo chỉ số Task Success, Slot Coverage, chi tiết 5 ca Error Analysis và form ghi nhận Outcome thực địa.
5. **Cấu hình Gemini**: Nhập Gemini API Key tùy chọn của bạn hoặc sử dụng ngay **Intelligent Domain Engine** có sẵn không cần setup phức tạp!

---
*Built with ❤️ for Vucar by AI Product Engineer Candidate.*
