# Vận hành trang quản trị Fitsy

## Phạm vi hiện tại

Module admin được tách khỏi auth, social và giao diện người dùng:

- server/admin/: phân quyền, repository SQLite/PostgreSQL, API, audit log và xử lý báo cáo (moderation).
- src/components/admin/: giao diện quản trị.
- src/services/admin-api.ts: client duy nhất gọi /api/admin/*.
- supabase/migrations/002_admin_access.sql: role, trạng thái và audit log production.
- supabase/migrations/004_image_credits.sql: số lượt tạo ảnh trọn đời của từng tài khoản.
- supabase/migrations/005_subscription_plans.sql: gói Free/Plus/Pro/Max và audit khi đổi gói.
- supabase/migrations/006_billing.sql: đơn VietQR/payOS, MoMo và thời hạn gói.
- supabase/migrations/007_credit_ledger_and_performance.sql: sổ `credit_ledger` ghi mọi thay đổi credit.
- supabase/migrations/008_account_deletion_retention.sql: giữ đơn thanh toán ẩn danh khi tài khoản bị xoá.
- supabase/migrations/009_social_normalized.sql: bảng báo cáo `user_reports` có trạng thái và các loại audit moderation.

Trang quản trị có URL /admin.

## Kích hoạt admin đầu tiên

1. Production: chạy lần lượt 001 đến 009 trong Supabase SQL Editor.
2. Thêm biến môi trường backend: ADMIN_EMAILS=owner@example.com. Có thể nhập nhiều email, phân tách bằng dấu phẩy.
3. Gắn role trong `app_metadata` của tài khoản đó trên Supabase (chỉ phía Supabase sửa được, người dùng không tự đặt được):

   ```sql
   update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'
   where email = 'owner@example.com';
   ```

4. Redeploy backend, đăng xuất rồi đăng nhập lại để token mới có role. Backend chỉ cấp admin khi **cả hai** điều kiện đúng: email nằm trong ADMIN_EMAILS và `app_metadata.role = admin`. Chỉ khớp email thì không đủ, để một người đăng ký bằng email đó (khi chưa bật xác minh email) không chiếm được quyền.
5. Sau khi đã có admin hoạt động, các role khác được quản lý tại /admin. Bỏ email khỏi ADMIN_EMAILS không tự hạ role đã lưu trong `profiles`.

Không đưa ADMIN_EMAILS vào biến VITE_* hoặc frontend.

## Ma trận quyền

| Chức năng | User/KOC | Moderator | Admin |
| --- | --- | --- | --- |
| Mở /admin | Không | Có | Có |
| Xem tổng quan/người dùng | Không | Có | Có |
| Đổi role | Không | Không | Có |
| Khoá/mở khoá | Không | Không | Có |
| Đặt số lượt tạo ảnh còn lại | Không | Không | Có |
| Xem audit log | Không | Không | Có |
| Tải sổ giao dịch Excel | Không | Không | Có |
| Xem báo cáo người dùng | Không | Có | Có |
| Đánh dấu đã xử lý / bỏ qua báo cáo | Không | Có | Có |
| Ẩn toàn bộ bài đăng của người bị báo cáo | Không | Có | Có |
| Khoá tài khoản từ báo cáo | Không | Không | Có |

Backend kiểm tra lại quyền cho mọi endpoint. Ẩn nút trên frontend chỉ là hỗ trợ giao diện.

## Biện pháp an toàn

- Admin không thể tự đổi role hoặc tự khoá tài khoản.
- Hệ thống không cho vô hiệu hoá admin hoạt động cuối cùng.
- Tài khoản suspended bị chặn ngay trong bước xác thực, không chỉ ở /admin. Trên cùng instance có hiệu lực ngay; instance khác nhận thay đổi trong tối đa 30 giây (cache thông tin user đã xác thực).
- Mọi thay đổi role, trạng thái, credit, gói và mọi thao tác moderation (ẩn bài, xử lý/bỏ qua báo cáo) đều ghi actor, target, trước/sau và thời gian vào audit log.
- Admin đặt số credit còn lại; chênh lệch được ghi vào `credit_ledger` (loại `admin_adjustment`, kèm id admin), không ghi đè âm thầm.
- User, KOC và moderator có 10 lượt tạo ảnh trọn đời mặc định. Tạo ảnh và tách đồ bằng AI đều trừ lượt; request thất bại được hoàn. Admin không tiêu credit và không chịu fixed-window rate limit tạo ảnh.
- API không trả mật khẩu, token, khoá API hoặc ảnh riêng tư.
- Không chỉnh raw_user_meta_data để cấp quyền. Role ứng dụng nằm trong database backend.

## Thanh toán và đối soát

- Cấu hình `PAYOS_CLIENT_ID`, `PAYOS_API_KEY`, `PAYOS_CHECKSUM_KEY` và/hoặc bộ biến `MOMO_*` trên Render.
- Webhook payOS phải trỏ tới `https://<domain>/api/billing/webhooks/payos`. MoMo nhận `ipnUrl` trực tiếp khi backend tạo giao dịch.
- Backend chỉ kích hoạt gói sau khi xác minh chữ ký webhook và số tiền. Việc cập nhật gói, credit, hạn dùng và trạng thái đơn chạy trong cùng transaction; webhook gửi lặp không cộng quyền lợi lần hai.
- Admin tải báo cáo tại nút **Tải sổ giao dịch Excel** trong `/admin`, hoặc endpoint `GET /api/billing/ledger.xlsx`.
- Database là nguồn dữ liệu duy nhất; file Excel được dựng lại từ database mỗi lần tải, không ghi file lên filesystem tạm của Render.
- Kích hoạt gói cộng credit của gói vào số dư hiện có (không ghi đè) và ghi `subscription_granted` vào `credit_ledger`, mỗi đơn đúng một lần.
- Báo cáo lưu mã đơn, mã giao dịch, người mua, gói, số tiền, trạng thái và mốc thời gian. Không lưu API key, chữ ký webhook hoặc dữ liệu ví nhạy cảm.

## Moderation

- Người dùng báo cáo một tài khoản trong mục Bạn bè; báo cáo vào bảng `user_reports` với trạng thái `open`, không báo cho người bị báo cáo.
- Tab **Báo cáo** trong /admin liệt kê báo cáo đang mở. Các nút: **Đã xử lý**, **Ẩn bài đăng** (ẩn mọi bài của người bị báo cáo khỏi feed và khỏi đường dẫn ảnh), **Khoá tài khoản** (chỉ admin), **Bỏ qua**.
- API: `GET /api/admin/moderation/reports`, `POST /api/admin/moderation/reports/:id` với body `{status: 'resolved' | 'dismissed', note?, hidePosts?, suspend?}`.

## Mở rộng sau

Các module catalog (Shop) và payout cho KOC nên có repository/service/router riêng. Không thêm logic tiền hoặc quyền vào component React và không cho frontend cập nhật trực tiếp database.
