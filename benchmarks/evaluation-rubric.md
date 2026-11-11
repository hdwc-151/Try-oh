# Đánh giá AI trước khi đổi model

Không có số đo GPU hay chất lượng AI thật được tạo trong lần nhập repo này.

Chuẩn bị ít nhất 30 cặp ảnh có quyền sử dụng: áo sáng/tối, hoạ tiết/logo nhỏ, áo rộng, quần/váy, tóc dài, tay che thân, nhiều màu da và dáng người. Chia development/holdout theo **người và trang phục**, tránh cùng một ảnh lọt cả hai phần. Giữ tập holdout cố định.

Mỗi cấu hình chạy cùng ảnh, seed, kích thước và phiên bản weights. Tách cold start, warmup và các lượt đã warm. Ghi p50/p95, lỗi/OOM, bộ nhớ allocated/reserved và chi phí trên **một kết quả thành công**. Không so thời gian của GPU khác nhau rồi kết luận model nhanh hơn.

Hai người chấm độc lập, ẩn tên model; thang 1–5 cho từng mục:

| Mục | Cần quan sát |
| --- | --- |
| Nhận dạng người | Mặt, tóc, màu da, đặc điểm cơ thể |
| Trang phục | Màu, logo, hoạ tiết, cổ áo, tay áo, đường viền |
| Hình học | Tay/chân, nếp gấp, che khuất, biên ghép |
| Tuân thủ yêu cầu | Đúng món, đúng góc, không tự thêm phụ kiện |
| Khả năng sử dụng | Không méo rõ rệt, độ phân giải phù hợp |

Ngưỡng nghiệm thu dự kiến: không OOM trên GPU mục tiêu, ≥95% request thành công trên bộ kiểm tra, chất lượng trung bình không giảm quá 0,2/5 so với baseline và chi phí hoặc p95 được cải thiện trên cùng phần cứng. Đây là **tiêu chí đề xuất**, chưa phải kết quả đã đạt.

Ảnh mô phỏng không chứng minh quần áo vừa kích cỡ thực tế. Không dùng điểm CLIP/FID đơn lẻ để cam kết độ vừa người hoặc chất lượng từng ảnh.

Không đưa ảnh người dùng, ảnh benchmark riêng, weights hay API key vào Git. Thư mục private/results đã được ignore.
