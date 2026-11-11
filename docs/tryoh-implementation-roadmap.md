# Lộ trình triển khai Fitsy

Tài liệu này chuyển đặc tả sản phẩm thành phạm vi kỹ thuật có thể kiểm chứng. Nguyên tắc là không giả lập các luồng tiền, catalog hay kiểm duyệt khi chưa có quy tắc nghiệp vụ.

## Đã có trong bản hiện tại

- Đăng ký, đăng nhập, quên và đặt lại mật khẩu.
- Tủ đồ theo tài khoản: tải ảnh, tách nền, sửa tên/danh mục, ảnh trước/sau, xoá và xem lớn.
- Tìm kiếm món đồ theo tên, lọc theo danh mục và tiến độ tủ đồ khởi đầu 20 món.
- Chọn nhiều lớp trang phục, ảnh người mẫu, tạo và lưu kết quả thử đồ.
- Bạn bè: tìm theo tên hoặc username, link/mã mời, lời mời, nhóm, chặn và báo cáo.
- Bình chọn outfit riêng tư, thông báo, phân quyền outfit và thu hồi quyền khi huỷ kết bạn.
- Hồ sơ, chế độ tối, onboarding lần đầu và điều hướng dưới dành cho điện thoại.
- Lưu trữ production qua PostgreSQL/Supabase Auth/R2 theo adapter đã cấu hình.
- Bài đăng, bình chọn từ ảnh, theo dõi nhà sáng tạo (KOC) và KOC Studio.
- Gói Free/Plus/Pro/Max, thanh toán payOS/MoMo, credit có sổ `credit_ledger`, trang quản trị và audit log.
- Xoá tài khoản (Auth + database + hàng đợi dọn ảnh R2), giữ đơn thanh toán ẩn danh.
- Moderation: báo cáo có trạng thái, ẩn bài, khoá tài khoản.
- Hạn mức AI: rate limit theo user, hàng đợi có giới hạn, trần AI toàn hệ thống; social chuẩn hoá thành bảng quan hệ để chịu tải nhiều người dùng.

## Phạm vi năm 1 cần hoàn thiện tiếp

### P0 — trước khi mời người dùng thật

- Kiểm thử end-to-end trên điện thoại cho onboarding, upload, thử đồ, bình chọn và đặt lại mật khẩu.
- Đồng bộ cài đặt theme/onboarding trên nhiều thiết bị nếu sản phẩm yêu cầu; hiện trạng thái giao diện được lưu trên thiết bị, còn hồ sơ và quyền riêng tư lưu ở máy chủ.
- Chạy migration 007–009 trên Supabase trước khi deploy bản hiện tại.
- Google Play Billing / App Store in-app purchase trước khi đưa app mobile lên cửa hàng.
- Theo dõi lỗi không chứa ảnh, token hoặc thông tin nhạy cảm.

### P1 — Shop và gợi ý sản phẩm (hướng ưu tiên)

Gợi ý sản phẩm trên Shopee, TikTok Shop và shop ngoài sàn mà KOL/KOC gắn link affiliate; gợi ý phối với tủ đồ là tính năng phụ. Kiến trúc và chi phí đã phân tích trong tài liệu [Fitsy — Gợi ý sản phẩm Shop & phối đồ](https://claude.ai/artifact/KZX9FqAMdgVHmFaZFeAXud). Tóm tắt:

1. Catalog chung `products` + `product_links` theo KOC; nguồn ban đầu là link KOC dán trong KOC Studio, sau đó API affiliate (Shopee, TikTok Shop, AccessTrade) và feed shop ngoài sàn. Không scrape dữ liệu sàn.
2. Embedding ảnh sản phẩm (OpenRouter trước, FashionCLIP sau) trong pgvector HNSW; tạo ứng viên từ vector gần nhất, KOC đang theo dõi, xu hướng và về sau collaborative filtering (`implicit`).
3. Mọi lượt mua đi qua `/go/:productId` để đếm click và ghi công KOC; bảng `product_events` lưu xem/thử/click/đơn để học lại.
4. Ghi nhãn “Liên kết tiếp thị”, làm mới giá và tồn kho hằng đêm, ẩn sản phẩm hết hàng.

Cần chốt trước khi code: tài khoản affiliate làm trước, có bắt đầu chỉ với link KOC dán tay không, Fitsy có thu hoa hồng không, nơi chạy embedding.

## Phạm vi năm 2 — Inspiration/KOC

Đã có: role KOC, KOC Studio, bài đăng và theo dõi nhà sáng tạo. Chưa bật kiếm tiền cho KOC cho tới khi chốt:

- Điều kiện trở thành KOC, phí/gói dùng thử và giới hạn.
- Cách ghi nhận affiliate, ngưỡng và lịch thanh toán.
- Ngưỡng báo cáo, quy trình khiếu nại, khoá tài khoản và kiểm duyệt.
- Phạm vi tạo nội dung bằng mô hình sinh ảnh và nghĩa vụ gắn nhãn.
- Thuế, hoá đơn, điều khoản người bán/người sáng tạo.

Khi các quyết định trên có chủ sở hữu và tiêu chí chấp nhận, nên tách thành module catalog, attribution, ledger/payout và moderation; không lưu số dư bằng phép cộng trừ rải rác trong mã ứng dụng.

## Tiêu chí “hoàn chỉnh”

- Mỗi luồng có trạng thái tải, rỗng, lỗi, thành công và khả năng thử lại.
- Quyền xem được kiểm tra ở máy chủ và ở endpoint ảnh, không chỉ ẩn trên giao diện.
- Dữ liệu tồn tại sau redeploy và có quy trình sao lưu/khôi phục.
- Responsive từ 320 px, điều khiển bàn phím, focus rõ và thông báo trạng thái cho trình đọc màn hình.
- Build, kiểm thử đơn vị, kiểm thử tích hợp và smoke test production đều đạt.
