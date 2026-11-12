# Try-oh — AI Virtual Try-On

[CI và kiểm thử](https://github.com/hdwc-151/Try-oh/actions/workflows/ci.yml) · [Phát hành](docs/PUBLISHING.md) · [Database](docs/DATABASE.md) · [Tối ưu AI](docs/AI_OPTIMIZATION.md) · [Nguồn mã](UPSTREAM.md)

Try-oh là prototype thử trang phục bằng ảnh: tải ảnh người và quần áo, tạo góc trước/sau, lưu outfit và chia sẻ có kiểm soát. Web và app Expo dùng chung API.

Dự án bắt đầu từ [VN_VTON](https://github.com/NHNam1306/VN_VTON), snapshot 768ea6ecd01e88146b0645d9ebd056d878d4a9f4. Đã đối chiếu đủ 313 file gốc bằng Git blob hash trước khi phát triển riêng. Nguồn chưa có root LICENSE trong snapshot; giữ attribution và chốt quyền phát hành với chủ nguồn.

## Trạng thái sản phẩm

| Phần | Trạng thái |
| --- | --- |
| Prototype web | Chạy local bằng SQLite, lưu ảnh local và AI mock, không cần API key |
| Web/API | React + Vite + Express; có đăng nhập, tủ đồ, tạo ảnh, lịch sử và social |
| Database production | Adapter Supabase PostgreSQL, RLS/index, migration có lock/checksum/rollback |
| Ảnh production | Supabase Storage hoặc R2 private; API kiểm tra quyền rồi cấp URL ký ngắn hạn |
| App Android/iOS | Expo SDK 58; định danh Try-oh riêng, profile preview/production/simulator |
| AI thật | Có adapter OpenRouter/Gemini; cần key/model khả dụng và kiểm tra bằng ảnh thật |
| Phát hành store | Có workflow build/submit; chưa có binary ký hoặc lần submit được xác nhận |
| Public backend | Render + Supabase; cần cấu hình DATABASE_URL và Supabase server key trước khi chạy |

Mock chỉ phục vụ kiểm tra luồng ứng dụng, không mô phỏng chất lượng thử đồ. Ảnh AI không chứng minh quần áo vừa kích cỡ thực tế.

## Chạy nhanh trên Windows

Cài Node.js 24 LTS và Git, rồi mở PowerShell:

~~~powershell
git clone https://github.com/hdwc-151/Try-oh.git
cd Try-oh
npm ci
Copy-Item .env.example .env
npm run dev
~~~

Mở http://127.0.0.1:8787, đăng ký một tài khoản local, tải ảnh người và ít nhất một món đồ. IMAGE_PROVIDER=mock đã được chọn trong file mẫu; không cần mua lượt AI để thử UI.

Dữ liệu nằm trong data/. Không xoá thư mục này nếu muốn giữ tài khoản/ảnh local. Local auth không gửi email thật; mobile hiện dùng Supabase Auth và cần backend staging tương ứng.

Trên macOS/Linux, thay Copy-Item bằng cp.

### Chạy bằng Docker

~~~bash
docker compose up --build
~~~

compose.yaml chạy prototype mock, bind vào máy local và giữ SQLite/ảnh bằng named volume. Chế độ này dùng ALLOW_LOCAL_BACKENDS=true có chủ đích; production dùng Supabase Auth/PostgreSQL và Supabase Storage private (hoặc R2).

## Kiểm thử và build

~~~powershell
npm test
npm run build
npm run smoke
npm start
~~~

Smoke test tạo database tạm, dùng ảnh giả và mock provider. Nó kiểm tra server đã build, đăng ký, tải ảnh, tạo outfit, gửi lại cùng mã chỉ trừ một credit, đọc ảnh và xoá tài khoản. Không kết nối database production hoặc gọi AI có phí.

CI còn chạy trình duyệt Chromium ở desktop/mobile viewport, kiểm tra lỗi runtime và xuất ảnh chụp trong artifact tryoh-web-api. Ảnh chụp dùng dữ liệu kiểm thử, không phải kết quả AI thật.

| Job CI | Kiểm tra |
| --- | --- |
| web-api | Audit mức high, unit/integration, build, HTTP smoke, browser smoke |
| mobile | Audit mức high, lint/TypeScript, Expo config, export JS bundle iOS và Android |
| container | Build Docker image và chạy health check dưới user thường |
| research-plan | Kiểm tra manifest/profile benchmark mà không tải model/GPU |

Test PostgreSQL dùng PGlite với stub Auth của Supabase. Bundle JS không thay thế native build đã ký hay kiểm thử thiết bị thật.

## Mobile

~~~powershell
cd mobile
npm ci
Copy-Item .env.example .env
npm run check
npx expo start
~~~

Điền EXPO_PUBLIC_API_URL, Supabase URL và publishable key của bạn. EXPO_PUBLIC_* nằm trong app nên không được chứa service-role key, AI key hoặc database password.

App dùng scheme tryoh và bundle/package com.hdwc151.tryoh. Project ID và owner của tác giả cũ đã được bỏ khỏi cấu hình tĩnh; tạo EAS project riêng theo [hướng dẫn phát hành](docs/PUBLISHING.md).

Các profile:

- preview: APK Android hoặc iOS internal build.
- simulator: iOS Simulator trên macOS.
- production: Android AAB và iOS store build.

Store mode mặc định ẩn thanh toán ngoài. Chưa tích hợp IAP để mua credit. iOS dùng email/password; nút Google được ẩn cho đến khi hoàn tất phương án social login phù hợp.

## AI và khả năng chịu lỗi

Mỗi lượt tạo ảnh có Idempotency-Key theo user. Backend lưu biên nhận SQLite/PostgreSQL trước khi trả kết quả, trả 409 cho request đang chạy hoặc khi dùng lại mã với body khác. Client giữ mã khi mạng rớt để phục hồi kết quả và gộp các lần bấm đồng thời.

OpenRouter có cache tiền xử lý WebP tối đa 16 MB, TTL 5 phút, gộp encode trùng. Đây là cache input đã được kiểm tra quyền; không chia sẻ output AI giữa người dùng.

Semaphore và giới hạn hàng chờ bảo vệ tài nguyên. Biên nhận chống trùng chưa phải hàng đợi có khả năng tiếp tục job sau crash. Không tự retry paid request khi chưa rõ provider đã tính phí hay chưa.

Đọc [AI_OPTIMIZATION.md](docs/AI_OPTIMIZATION.md) cho đối chiếu model, giới hạn giấy phép parser và protocol benchmark. Script experiments/benchmark_fashn.py có profile 20/30/50 bước, warmup, seed, hash weights và đo VRAM; chưa có benchmark GPU thật trong repo.

## Database và deploy

~~~powershell
npm run build
npm run db:status
npm run db:migrate
~~~

Chỉ chạy các lệnh database khi DATABASE_URL trỏ đúng Supabase project cần thao tác. Migration phải chạy trước code mới. File đã áp dụng không được sửa; thêm migration tiếp theo.

render.yaml cấu hình backend production. Workflow Deploy backend chỉ chạy khi DEPLOY_ENABLED=true, CI đúng commit đã xanh và các secret đã được cấu hình; migrate trước, deploy đúng SHA rồi xác nhận health/revision.

[Hướng dẫn từng bước và bảng secret/variable](docs/PUBLISHING.md) bao gồm Render, Supabase, R2, Expo, Apple và Google Play. Không đưa khoá vào Git hoặc gửi qua issue.

## Cấu trúc repo

| Đường dẫn | Nội dung |
| --- | --- |
| src/ | Web React, state, gọi API, xử lý ảnh |
| server/ | API, auth, credit, billing, social, storage và AI adapters |
| server/db/ | Runner migration và kiểm thử rollback/checksum |
| server/services/ | Giới hạn AI, biên nhận chống trùng, cache tiền xử lý |
| mobile/ | Expo Router / React Native cho Android và iOS |
| supabase/migrations/ | 10 migration nguồn và migration biên nhận AI mới |
| experiments/ | Benchmark nghiên cứu, không nằm trong runtime sản phẩm |
| benchmarks/ | Manifest mẫu và rubric; ảnh riêng/results được ignore |
| .github/workflows/ | CI, deploy backend và mobile release |
| docs/ | Hướng dẫn database, tối ưu, phát hành, tài liệu vận hành nguồn |
| Dockerfile / compose.yaml | Container production và prototype local |

[UPSTREAM.md](UPSTREAM.md) lưu provenance; [tài liệu nguồn](docs/upstream/README.md) được giữ để tham khảo và có thể chứa tên/cấu hình cũ. README và hướng dẫn Try-oh hiện tại là nguồn chính cho cài đặt.

## English

Try-oh extends VN_VTON into a separate web and Expo prototype. Use Node 24, npm ci, copy .env.example, then npm run dev. Mock AI is enabled by default. The repository includes durable per-user AI retry receipts, bounded reference preprocessing, atomic PostgreSQL migrations, Docker checks, browser smoke tests and mobile/backend release workflows.

Real AI quality, GPU performance, signed mobile binaries and public store availability require verification with your own infrastructure and accounts. See docs/PUBLISHING.md and UPSTREAM.md before distribution.
