# Hướng Dẫn Chạy Source — Vucar AI Agent

> Thời gian setup: **~2 phút**. Không cần Docker, không cần database ngoài.

---

## Yêu cầu tối thiểu

| Thành phần | Phiên bản tối thiểu |
|------------|---------------------|
| Python     | 3.10+               |
| pip        | 23+                 |
| RAM        | 512 MB trống        |
| OS         | Windows / macOS / Linux |

> Kiểm tra Python: `python --version` hoặc `python3 --version`

---

## Cấu trúc thư mục

```
TestVucar/
├── run.py                          ← Entry point khởi động server
├── requirements.txt                ← Danh sách thư viện
├── README.md                       ← Tài liệu kiến trúc chi tiết
├── QUICKSTART.md                   ← File này
└── backend/
    └── app/
        ├── main.py                 ← FastAPI app + API routes
        ├── config.py               ← Cấu hình (port, model, paths)
        ├── agent/
        │   ├── engine.py           ← ReAct Agent Loop chính
        │   ├── gemini_client.py    ← Gemini API + Heuristic fallback
        │   ├── tools.py            ← 5 internal tools (search, book, bridge...)
        │   ├── memory.py           ← Quản lý state & lịch sử hội thoại
        │   └── prompts.py          ← System prompt & extraction prompt
        ├── models/
        │   └── schema.py           ← Pydantic schema (State, Message, Tools...)
        ├── eval/
        │   ├── evaluator.py        ← Hệ thống đánh giá & metrics
        │   └── error_cases.py      ← 5 ca error analysis mẫu
        ├── data/
        │   ├── chat_history.jsonl  ← Dữ liệu hội thoại mẫu (c1, c2, c3)
        │   ├── mock_listings.json  ← Kho xe (~10 tin đăng có hình ảnh thực)
        │   └── feedback_loop_data.json ← Dữ liệu feedback loop mẫu
        └── static/
            ├── index.html          ← Giao diện Web UI
            ├── app.js              ← Frontend logic
            └── style.css           ← Tailwind CSS custom
```

---

## Bước 1 — Cài thư viện

```bash
# Di chuyển vào thư mục gốc
cd TestVucar

# Cài đặt tất cả dependencies
pip install -r requirements.txt
```

Nếu `requirements.txt` chưa có hoặc cần cài thủ công:

```bash
pip install fastapi uvicorn pydantic requests python-dotenv
```

---

## Bước 2 — Chạy server

```bash
python run.py
```

Hoặc chạy trực tiếp bằng uvicorn (hỗ trợ auto-reload khi sửa code):

```bash
python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000 --reload
```

Khi thành công, terminal hiển thị:

```
INFO:     Uvicorn running on http://127.0.0.1:8000 (Press CTRL+C to quit)
INFO:     Application startup complete.
```

---

## Bước 3 — Mở giao diện

Truy cập trên trình duyệt:

```
http://127.0.0.1:8000
```

---

## Bước 4 — Khám phá tính năng

### Tab 1: Live Studio (Chat mô phỏng)

| Thao tác | Cách làm |
|----------|----------|
| Chọn kịch bản | Nhấn `c1` / `c2` / `c3` ở thanh conversation |
| Đổi vai người dùng | Chọn **Buyer** hoặc **Seller** trên ô nhập tin |
| Gửi tin nhắn | Nhập nội dung → nhấn **Gửi** hoặc `Enter` |
| Xem state real-time | Thanh phải: Lead Stage, Next Best Action, Risks, Tool History |
| Xem JSON State đầy đủ | Nhấn tab **JSON State** trên panel phải |
| Tạo hội thoại mới | Nhấn **＋ Chat mới** (ô trắng hoàn toàn) |

**Gợi ý kịch bản để test:**

> **c1 — Đàm phán giá:** Gửi với vai Buyer: *"Mình tìm xe Air Blade 2021 tầm 25-26tr"* → thử tiếp: *"Có hình xe không?"*

> **c2 — Rủi ro giấy tờ:** Gửi với vai Buyer: *"Giấy tờ xe này thế nào, có rủi ro không?"* → Agent sẽ gọi `get_listing_detail`

> **c3 — Bypass sàn:** Gửi với vai Seller: *"Tôi không muốn qua trung gian"* → Agent xử lý objection

> **Đặt lịch:** Gửi: *"Hẹn xem xe lúc 15h chiều mai nhé"* → Agent gọi `book_appointment`, Lead Stage chuyển sang `APPOINTMENT`

---

### Tab 2: Kho xe & Tools

- Duyệt kho ~10 xe máy với hình ảnh thực, giá và điểm kiểm định.
- Hover vào từng tool card để xem mô tả chức năng.
- Nhấn **Inspect Schema** để xem JSON schema đầy đủ của từng tool.

### Tab 3: Event Telemetry

- Theo dõi toàn bộ event log theo thời gian thực.
- Filter theo `conversation_id` để xem riêng từng cuộc hội thoại.
- Các event type: `USER_MESSAGE`, `TOOL_CALL`, `AGENT_ACTION`, `ESCALATION`, `HANDOFF`.

### Tab 4: Đánh giá & Feedback

- Xem báo cáo chỉ số: **Task Success Rate**, **Slot Coverage**, **Escalation Recall**.
- Đọc 5 ca **Error Analysis** với nguyên nhân và đề xuất cải thiện.
- Nhấn **Submit Feedback** để ghi nhận outcome thực địa vào feedback loop.

---

## Cấu hình Gemini API (tùy chọn)

Hệ thống chạy hoàn toàn **không cần API key** nhờ **Intelligent Domain Heuristics** tích hợp sẵn.

Nếu muốn dùng Gemini thực:

1. Nhấn icon **⚙ Cấu hình** trên thanh header.
2. Nhập **Gemini API Key** (lấy tại [aistudio.google.com](https://aistudio.google.com)).
3. Chọn model từ dropdown (`Gemini 3.5 Flash Lite` / `Gemini 3.8 Flash`) hoặc nhập tên model tùy chỉnh.
4. Nhấn **Lưu cấu hình**.

---

## API Endpoints

Nếu muốn test trực tiếp bằng curl / Postman:

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| `GET` | `/` | Web UI |
| `POST` | `/api/conversations/{conv_id}/messages` | Gửi tin nhắn, nhận agent reply |
| `GET` | `/api/conversations` | Danh sách tất cả conversations |
| `GET` | `/api/conversations/{conv_id}` | Lấy state + lịch sử 1 conversation |
| `POST` | `/api/conversations/reset` | Reset toàn bộ memory |
| `GET` | `/api/listings` | Danh sách xe trong kho |
| `GET` | `/api/tools` | Danh sách tool definitions |
| `GET` | `/api/events` | Event telemetry log |
| `GET` | `/api/eval` | Kết quả đánh giá |
| `POST` | `/api/feedback` | Ghi nhận feedback outcome |
| `POST` | `/api/config` | Cập nhật Gemini API key & model |

**Ví dụ gửi tin nhắn:**
```bash
curl -X POST http://127.0.0.1:8000/api/conversations/c1/messages \
  -H "Content-Type: application/json" \
  -d '{"sender": "buyer", "text": "Tôi muốn tìm Air Blade đời 2021 tầm 25tr"}'
```

**Ví dụ response:**
```json
{
  "agent_reply": "Dạ Vucar đã tìm thấy 2 xe Honda Air Blade phù hợp...",
  "state": {
    "lead_stage": "MATCHING",
    "appointment_id": null,
    "risks": []
  },
  "tools_called": [
    { "tool_name": "search_listings", "result": { "total_found": 2 } }
  ],
  "model_used": "vucar-dynamic-heuristics"
}
```

---

## Xử lý lỗi thường gặp

| Lỗi | Nguyên nhân | Giải pháp |
|-----|-------------|-----------|
| `ModuleNotFoundError: fastapi` | Chưa cài thư viện | Chạy `pip install -r requirements.txt` |
| `Address already in use` / port 8000 bận | Có process khác chiếm port | Chạy `python run.py --port 8001` hoặc tắt process cũ |
| `python` không nhận lệnh | Windows dùng `python3` | Thay `python` bằng `python3` |
| Trang web trắng / 404 | Static files không được serve | Đảm bảo chạy từ thư mục gốc `TestVucar/` |
| Gemini API trả lỗi 404 | Model name không hợp lệ | Thử model `gemini-2.5-flash` hoặc để trống để dùng Heuristics |

---

## Dừng server

```bash
# Nhấn Ctrl + C trong terminal đang chạy server
```

---

*Mọi thắc mắc về kiến trúc, xem thêm [README.md](./README.md)*
