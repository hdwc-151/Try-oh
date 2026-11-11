# Database và dữ liệu ảnh

## Local

SQLite và file ảnh nằm trong data/; không commit thư mục này. Các repository tự tạo schema SQLite. Khi dùng compose.yaml, named volume prototype-data giữ dữ liệu qua lần tạo lại container.

## Production

Supabase quản lý PostgreSQL và Auth. Backend kết nối bằng DATABASE_URL; mobile chỉ nhận publishable key. Ảnh nằm trong bucket R2 private. Client đọc qua route đã xác thực và URL ký ngắn hạn; không đưa service-role key hay R2 secret vào bundle.

| Thành phần | Vai trò |
| --- | --- |
| auth.users / profiles | Tài khoản, role và thông tin hồ sơ |
| garments / person image / results / outfits | Dữ liệu riêng theo user |
| credit ledger / plans / billing | Lượt AI, lịch sử thay đổi và thanh toán |
| Các bảng social | Quan hệ, chia sẻ, bình chọn, report, moderation |
| storage_cleanup_queue | Xoá object có retry |
| generation_requests | Biên nhận chống tạo ảnh trùng, giữ 7 ngày |
| tryoh_schema_migrations | Tên migration, SHA-256 và thời điểm áp dụng |

Tên bảng chi tiết và các index/RLS là nguồn chuẩn trong supabase/migrations; không dựng lại schema thủ công từ bảng mô tả này.

## Migration

Yêu cầu database Supabase đã có schema auth, vai trò anon/authenticated và quyền DDL phù hợp cho backend migration.

~~~bash
npm ci
npm run build
npm run db:status
npm run db:migrate
npm run db:status
~~~

Runner đọc toàn bộ migration theo tên, dùng một transaction và advisory lock theo transaction. Nếu một file lỗi, rollback cả lượt triển khai. Nếu file đã áp dụng bị sửa hoặc bị bỏ khỏi release, runner từ chối chạy. Thêm file mới để đổi schema; không sửa lịch sử.

Production phải chạy migration trước khi khởi động code mới. Server kiểm tra bảng biên nhận và dừng với thông báo rõ nếu schema còn cũ. CI kiểm tra migration mới, chạy lại không làm thay đổi schema và rollback khi lỗi.

Repo được thiết kế cho Supabase, không phải PostgreSQL trống. Test dùng stub auth tối thiểu của PGlite; không thay thế kiểm tra trên dự án Supabase staging thật.

Database cũ từng chạy SQL Editor cần backup và thử runner trên bản sao trước. Không giả vờ đánh dấu migration đã chạy nếu chưa đối chiếu schema thực. Mười migration gốc giữ nguyên nội dung.

## Biên nhận AI

Khoá duy nhất là cặp user_id và request_key. Fingerprint gắn với request; cùng khoá khác body trả 409. Kết quả được lưu trước khi phản hồi. Request đang xử lý trả generation_in_progress, kèm Retry-After. Không tự chạy lại sau crash vì provider có thể đã tính phí.

Đây là cơ chế chống trùng, không phải hàng đợi job có khả năng tiếp tục xử lý sau restart. Pending lâu cần kiểm tra output và credit ledger trước khi operator hoàn lượt. Không xoá claim để ép chạy lại một yêu cầu chưa rõ trạng thái.

Các biên nhận được dọn theo retention 7 ngày; xoá tài khoản xoá biên nhận theo cascade ở PostgreSQL hoặc thao tác rõ ràng ở SQLite. Biên nhận có URL kết quả, không lưu ảnh base64, prompt hoặc credential.

## Backup và phục hồi

1. Backup database bằng công cụ của Supabase hoặc pg_dump; bản backup luôn là dữ liệu riêng.
2. Backup object/versioning của R2 riêng; DB backup không chứa byte ảnh.
3. Thử restore sang staging, kiểm tra quyền đọc ảnh giữa hai user và đối chiếu tổng credit ledger.
4. Với thay đổi lớn, ưu tiên migration cộng thêm trường/bảng, deploy code tương thích rồi mới dọn schema cũ ở release sau.

Không tự rollback dữ liệu bằng cách xoá bảng hoặc chạy lại migration lịch sử. Khôi phục từ backup chỉ sau khi đối chiếu các giao dịch phát sinh sau thời điểm backup.
