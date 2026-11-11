# Bạn bè & bình chọn (P0)

## Cách dùng

1. Mỗi người đăng ký/đăng nhập tài khoản riêng.
2. Vào **Bạn bè → Riêng tư & mã mời**, đặt username và sao chép link/QR cá nhân.
3. Người nhận mở link sau khi đăng nhập, gửi lời mời. Người kia chấp nhận trong **Lời mời**.
4. Tạo nhóm trong **Nhóm**, hoặc dùng bạn bè trực tiếp.
5. Tạo outfit ở **Phòng thử**, kết quả được lưu theo luồng có sẵn. **Bộ sưu tập → Xin ý kiến bạn bè** chọn 1–3 outfit (một ảnh trước cũng được).
6. Chọn người nhận/nhóm/tất cả, thời hạn 1h/24h/72h; xác nhận danh sách ai được xem rồi gửi.
7. **Bảng tin** ưu tiên yêu cầu chưa trả lời. Vuốt ngang xem outfit và hai mặt, bấm ảnh phóng to. Đổi lựa chọn trước khi kết thúc.
8. Chủ bài xem kết quả, đóng sớm, xoá, chọn outfit nhiều phiếu nhất làm **outfit chính thức**. Nếu hoà, được chọn một trong các outfit đồng hạng. Nhãn xuất hiện trong bộ sưu tập.
9. Ngoài outfit đã lưu, có thể tạo bình chọn trực tiếp từ 2–3 ảnh tải lên, và đăng **bài** (tối đa 3 ảnh) với quyền xem Riêng tư / Bạn bè / Nhóm / Công khai.
10. Tài khoản KOC (và admin) là **nhà sáng tạo**: người dùng theo dõi để thấy bài của họ trong feed creator; bình chọn công khai của KOC gửi tới bạn bè và người theo dõi.

## Quyền riêng tư

- Mặc định outfit riêng tư. Mỗi lần tạo bình chọn cấp quyền cho danh sách người nhận đã xác nhận; chọn nhóm là chọn nhanh danh sách bạn bè hiện tại trong nhóm, không tự thêm người vào bài đã gửi.
- Chia sẻ hồ sơ theo Bạn bè/Nhóm cập nhật theo quan hệ và thành viên hiện tại. Trở về Riêng tư sẽ xoá các bình chọn chứa outfit đó.
- Huỷ kết bạn/chặn thu hồi quyền bài, phiếu và link ảnh; kết bạn lại không tự phục hồi người nhận của bình chọn cũ. Không gửi thông báo huỷ/chặn.
- Các ảnh tủ đồ, ảnh người và kết quả chưa chia sẻ chỉ chủ sở hữu được đọc. Mọi ảnh đi qua `/uploads/:key`: backend kiểm tra phiên và quyền rồi chuyển hướng tới URL R2 ký ngắn hạn (`R2_SIGNED_READ_TTL_SECONDS`, mặc định 5 phút) với cache `private`. Sau khi thu hồi quyền, trình duyệt đã tải có thể còn giữ ảnh tới hết thời hạn đó. Không thể thu hồi bản ảnh người nhận đã tự tải/chụp lại.
- Tuổi tự khai (chưa có xác minh giấy tờ). Chưa khai hoặc dưới 18 chỉ nhận lời mời khi có bạn chung hoặc mã mời. Ngày sinh không công khai, chỉ nhập một lần. Mã mời có thể đổi, mã cũ hết hiệu lực.
- Báo cáo lưu vào bảng `user_reports` (trạng thái open/resolved/dismissed), không báo người bị báo cáo. Moderator/admin xử lý trong tab **Báo cáo** của /admin (xem [vận hành admin](admin-operations.md)); bài bị ẩn biến mất khỏi mọi feed và đường dẫn ảnh.
- Avatar là ảnh tải lên (`POST /api/social/avatar`), được kiểm tra định dạng và kích thước như mọi ảnh upload.

## Kỹ thuật / giới hạn MVP

- Routes: /ban-be, /bang-tin, /bang-tin?poll=ID. Notification lời mời mở /ban-be?tab=requests.
- API có auth: `GET /api/social`, `/search`, `/invite`, `/profile/:id`; `POST /avatar`, `/publish` (bài hoặc bình chọn từ ảnh), `/post-delete` và `POST /:action` cho các thao tác còn lại. Validation và quyền nằm ở backend, không tin dữ liệu client.
- Tìm bạn tự động sau khi nhập 2 ký tự, hỗ trợ tên hiển thị không dấu và `@username`. Kết quả ưu tiên username khớp chính xác/khớp đầu, loại tài khoản hiện tại và người đã chặn.
- Hai adapter cùng interface `SocialService`: `SocialStore` (local, một document JSON trong SQLite) và `PostgresSocialStore` (production, bảng quan hệ có index từ migration 009). Bản PostgreSQL chỉ đọc vùng dữ liệu của người dùng liên quan, ghi phần thay đổi và khoá theo user bằng `pg_advisory_xact_lock`, nên người dùng khác nhau không chờ nhau.
- Feed bài đăng và feed creator trả 100 bài mới nhất; thông báo giữ 200 cái mới nhất mỗi người, xoá sau 180 ngày.
- Trang social tự làm mới mỗi 30 giây khi đang hiển thị; badge thông báo mỗi 60 giây. Không phải push notification hệ điều hành hay websocket.
- Thời hạn do server kiểm tra mỗi vote. Thông báo kết quả được tạo bởi tác vụ nền mỗi phút, và ngay khi người liên quan mở trang; mỗi bình chọn chỉ báo một lần.
- QR tạo trên trình duyệt bằng qrcode, không gửi mã mời tới dịch vụ ngoài. Link localhost không dùng được từ máy bạn bè; cần domain HTTPS và triển khai server để dùng thực tế.
- Không gọi dịch vụ AI trong module social. Không sửa .env và không tự khởi chạy server.
- Test: npm test. `social-store.test.ts` chạy trên SQLite tạm; `postgres-social-store.test.ts` chạy cùng kịch bản trên PostgreSQL nhúng (PGlite) với migration thật, gồm cả kiểm tra backfill từ JSON cũ.

## Chưa làm (P1, theo tài liệu)

- Xin quyền đọc danh bạ để tìm bạn.
- Reaction nhanh / tin nhắn ngắn trong bình chọn.
