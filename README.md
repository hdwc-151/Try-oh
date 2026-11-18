# Try-oh — Thử đồ ảo bằng AI

**Tiếng Việt** · [English](README.en.md) · [Mobile](mobile/README.md) · [Phát hành](docs/PUBLISHING.md) · [CI](https://github.com/hdwc-151/Try-oh/actions/workflows/ci.yml)

Try-oh cho phép tải ảnh người và quần áo, tạo ảnh thử góc trước và sau, lưu outfit, chia sẻ và bình chọn. Web React và ứng dụng Android/iOS dùng chung API.

## Cần cài gì để chạy demo?

Bản demo web có nút **Vào demo** để tạo phiên riêng trong trình duyệt. Dùng ảnh mẫu. Xem [cấu hình bản demo web](docs/PUBLISHING.md#bản-demo-web).

| Cách thử | Thiết bị của người thử | Máy host |
| --- | --- | --- |
| Mở link web | Trình duyệt | Web/API ở địa chỉ truy cập được |
| Quét QR Expo `exp://` | Expo Go trên điện thoại | Metro đang chạy và API truy cập được |
| Cài Try-oh độc lập | APK trên Android hoặc bản ký cho iPhone | Bản cài đã có bundle. Backend vẫn cần hoạt động |
| Tự chạy repo | Node.js 24 và npm. Cài Git nếu clone | Web và API chạy cùng tiến trình |

### Tự chạy web trên Windows

Tải [ZIP](https://github.com/hdwc-151/Try-oh/archive/refs/heads/main.zip) rồi giải nén, hoặc dùng Git:

~~~powershell
git clone https://github.com/hdwc-151/Try-oh.git
cd Try-oh
~~~

Mở PowerShell tại thư mục gốc có `server/`, `src/`, `mobile/`:

~~~powershell
npm ci
if (!(Test-Path .env)) { Copy-Item .env.example .env }
npm run dev
~~~

Mở [http://127.0.0.1:8787](http://127.0.0.1:8787). Đăng ký tài khoản local, tải ảnh người, thêm một món đồ, chọn món đồ rồi tạo ảnh góc trước. Mặc định bản demo dùng SQLite, ảnh lưu local và AI mock, nên có thể thử luồng mà không cần Supabase hoặc key AI.

Trên macOS/Linux, thay dòng sao chép bằng `test -f .env || cp .env.example .env`. Nếu đã cài Docker, dùng `docker compose up --build`. Giữ thư mục `data/` hoặc Docker volume để giữ dữ liệu local.

### Mở demo do máy khác host

- **Laptop** mở URL web do host gửi. `127.0.0.1` chỉ truy cập được trên chính máy chạy server.
- **Điện thoại** cài Expo Go và quét QR từ cửa sổ Metro. Ở khác mạng, host chạy `npx expo start --tunnel`. iPhone thật dùng cùng tài khoản Expo với phiên CLI của host. [Hướng dẫn chạy Expo](https://docs.expo.dev/get-started/start-developing/).
- **Bản cài độc lập** dùng link APK hoặc TestFlight/ad hoc. Người thử mở app Try-oh trực tiếp, không cần chạy Metro. [Hướng dẫn mobile](mobile/README.md).

## Kiểm thử

~~~bash
npm test
npm run build
npm run smoke
npm --prefix mobile ci
npm --prefix mobile run check
~~~

CI chạy audit, kiểm thử API, PostgreSQL mô phỏng, trình duyệt desktop/mobile, xuất bundle JavaScript cho Android/iOS và kiểm tra container. Smoke test dùng ảnh giả để thử đăng ký, tạo outfit, credit và xóa tài khoản. Bản cài đã ký và thiết bị thật cần được kiểm tra riêng.

## Database và triển khai

Render chạy web/API. Supabase giữ tài khoản, PostgreSQL và ảnh trong kho private. R2 là lựa chọn thay thế kho ảnh. Điền `DATABASE_URL` và `SUPABASE_SECRET_KEY` trong Render Environment trước khi deploy. Từ thư mục gốc của repo, chạy build và migration bằng kết nối của đúng môi trường:

~~~bash
npm run build
npm run db:status
npm run db:migrate
~~~

Migration 001–012 được giữ nguyên. Các migration 013–016 thêm phiên thử trực tiếp, trạng thái OAuth dùng một lần, quyền hiển thị hồ sơ và tương thích tên tài khoản cũ. Sau khi deploy, kiểm tra `/api/health` báo sẵn sàng và đúng revision trước khi gửi link cho tester. [Cấu hình Render, Supabase, CI và EAS](docs/PUBLISHING.md).

## Cấu trúc

| Đường dẫn | Vai trò |
| --- | --- |
| `src/features/`, `src/shared/` | React/TypeScript cho web |
| `server/` | Express API, auth, tủ đồ, social, credit, ảnh và AI |
| `mobile/` | Expo SDK 58, React Native và Expo Router |
| `supabase/migrations/` | PostgreSQL, RLS, index và lịch sử migration |
| `experiments/`, `benchmarks/` | Thí nghiệm AI và tiêu chí đánh giá |
| `.github/workflows/`, `docs/` | CI, phát hành và hướng dẫn vận hành |

Bản đồng bộ VN_VTON bổ sung giữ nền ảnh, thống kê tủ đồ, so sánh trước/sau, thẻ chia sẻ, quét mã kết bạn, bình chọn outfit và quyền hiển thị hồ sơ. Khi mất mạng lúc tạo ảnh, web và mobile tra biên nhận theo mã gốc. Camera trực tiếp cần Decart và bản cài có WebRTC. Để `DECART_API_KEY` trống khi chạy mock.

Giao diện chủ yếu dùng tiếng Việt. README có bản tiếng Việt và tiếng Anh. Xem [database](docs/DATABASE.md), [tối ưu AI](docs/AI_OPTIMIZATION.md) và [nguồn VN_VTON](UPSTREAM.md).
