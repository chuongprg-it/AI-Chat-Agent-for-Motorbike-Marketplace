from typing import List, Dict, Any

ERROR_ANALYSIS_CASES: List[Dict[str, Any]] = [
    {
        "case_id": "ERR_01_C1_PRICE_LOCKOUT",
        "conversation_id": "c1",
        "symptom": "Bế tắc đàm phán giá (Price Deadlock) & Nguy cơ bỏ rơi hội thoại (Lead Drop-off)",
        "failure_category": "Wrong next_best_action & Missing tool invocation",
        "description": "Người bán đòi 32tr cho Air Blade 2021, người mua kịch trần 25-26tr (chênh 6tr). Agent truyền thống chỉ trả lời câu an ủi chung chung ('Để mình hỏi thêm...'), không đưa ra con số neo (anchor price), không phân tích giá trị xe và không gọi tool tìm xe thay thế.",
        "why_it_failed": "Agent xem cuộc trò chuyện là 1-1 đơn thuần, thiếu nhận thức về inventory có sẵn trên sàn và thiếu khả năng điều hướng thương lượng theo hướng win-win.",
        "missing_signal": "Không tính toán khoảng cách giá Delta = Price_seller (32tr) - Budget_max (26tr) = 6tr (>20% ngân sách). Khi Delta > 15%, thương lượng chay hầu như luôn thất bại.",
        "how_to_fix": "Quy tắc định tuyến: Khi phát hiện Price Gap > 15%, Agent lập tức gọi `search_listings(budget_max=26tr)` để gợi ý xe tương đương (ví dụ Honda Lead 2021 giá 26tr hoặc Janus 2022 giá 24.5tr) làm phương án dự phòng, đồng thời đề xuất mức giá trung gian 28.5tr kèm gói bảo hành Vucar Care để thuyết phục cả 2 bên."
    },
    {
        "case_id": "ERR_02_C2_LEGAL_RISK_UNDERESTIMATION",
        "conversation_id": "c2",
        "symptom": "Rủi ro pháp lý giấy tờ nghiêm trọng nhưng phản ứng thụ động, không kích hoạt Escalation",
        "failure_category": "Missing escalation & Incomplete state risk tracking",
        "description": "Người bán tiết lộ 'đang chờ rút hồ sơ gốc, chưa sang tên được ngay'. Người mua bày tỏ lo lắng ('vậy có rủi ro gì không?'). Agent chỉ hứa 'sẽ kiểm tra lại quy trình' mà không gắn nhãn rủi ro CRITICAL, không báo cáo cho đội ngũ pháp chế/ops và không cảnh báo người mua nguy cơ mất tiền cọc.",
        "why_it_failed": "Agent xử lý văn bản như một câu hỏi thông tin thông thường (FAQ lookup) thay vì một sự kiện rủi ro giao dịch (Compliance & Fraud Risk).",
        "missing_signal": "Từ khóa rủi ro cao: 'chờ rút hồ sơ gốc', 'chưa sang tên được ngay' kết hợp với cảm xúc người mua 'hơi ngại vụ giấy tờ'. Thiếu slot `paperwork_risk_level = CRITICAL`.",
        "how_to_fix": "1. Tự động chuyển state `risks` sang `CRITICAL` và kích hoạt event `ESCALATION` cho bộ phận Pháp lý Vucar. 2. Đưa ra giải pháp Escrow: Hướng dẫn người mua chỉ đặt cọc qua tài khoản trung gian Vucar, chỉ giải ngân cho người bán khi có giấy hẹn công an và hỗ trợ kiểm tra nguồn gốc xe chống xe trộm cắp/xe tranh chấp."
    },
    {
        "case_id": "ERR_03_C3_DISINTERMEDIATION_BYPASS",
        "conversation_id": "c3",
        "symptom": "Nguy cơ thoát sàn / luồn sàn (Disintermediation / Platform Bypass)",
        "failure_category": "Weak value proposition & Failure to protect marketplace channel",
        "description": "Người bán từ chối trung gian môi giới ('chỉ bán trực tiếp... không muốn qua trung gian', 'chỉ cần số điện thoại người mua là được'). Agent phản hồi máy móc về 'kết nối an toàn', không thuyết phục được người bán về giá trị thực sự của Vucar.",
        "why_it_failed": "Agent không phân biệt được tâm lý người bán: Người bán sợ bị 'cò lái ép giá, cắt phế hoa hồng'. Agent không khẳng định được chính sách Vucar KHÔNG thu phí bên bán.",
        "missing_signal": "Intent 'BYPASS_ATTEMPT' (đòi số điện thoại riêng, bài xích bên thứ ba). Thiếu công cụ tạo kênh bảo mật che số điện thoại (phone masking bridge).",
        "how_to_fix": "1. Gọi `create_chat_bridge` với tính năng che số điện thoại ảo và bảo mật danh tính. 2. Nhấn mạnh 3 cam kết của Vucar: 'Miễn phí hoàn toàn cho người bán, miễn phí kiểm định kỹ thuật 120 điểm tận nơi, lọc sẵn người mua thiện chí có cọc để tránh bị người mua ảo làm phiền'."
    },
    {
        "case_id": "ERR_04_SLOT_OVERWRITE_AMBIGUITY",
        "conversation_id": "synthetic_04",
        "symptom": "Ghi đè thông tin ngân sách sai lệch khi người mua thay đổi quyết định",
        "failure_category": "Wrong state transition & Memory corruption",
        "description": "Ban đầu người mua nói 'tầm 25tr', sau đó người bán chào xe 30tr thì người mua nói 'ráng thêm cùng lắm 27tr thôi'. State bị ghi đè thành ngân sách cố định 27tr thay vì lưu khoảng [25tr - 27tr] có độ co giãn.",
        "why_it_failed": "Hệ thống state trích xuất theo kiểu Point-in-time value thay vì lưu giữ Min/Max/Stretch budget.",
        "missing_signal": "Ngữ cảnh 'cùng lắm' biểu thị ngân sách giãn tối đa (stretch budget), không phải ngân sách mong muốn ban đầu (target budget).",
        "how_to_fix": "Cấu trúc trường `constraints.budget` thành: `budget_target: 25tr, budget_stretch_max: 27tr`. Giúp thuật toán matching ưu tiên xe 25tr trước khi đề xuất xe 27tr."
    },
    {
        "case_id": "ERR_05_PREMATURE_BOOKING",
        "conversation_id": "synthetic_05",
        "symptom": "Thúc ép đặt lịch xem xe khi chưa giải quyết xong khúc mắc về giấy tờ và giá",
        "failure_category": "Wrong lead_stage transition & Policy violation",
        "description": "Agent vội vàng gọi tool `book_appointment` khi người mua còn chưa đồng ý về tình trạng giấy tờ xe đang cầm cố.",
        "why_it_failed": "Hệ thống tối ưu hoá thiển cận (Over-optimizing) cho metric số lịch hẹn (Appointment Rate) mà bỏ qua điều kiện tiên quyết (Pre-conditions).",
        "missing_signal": "Điều kiện chuyển stage: `lead_stage` chỉ được chuyển sang `APPOINTMENT` khi `open_questions.length == 0` và không có `risks.level == CRITICAL`.",
        "how_to_fix": "Bổ sung Guardrail: Chặn gọi `book_appointment` nếu còn bất kỳ rủi ro CRITICAL nào chưa được giải quyết (resolved == False)."
    }
]
