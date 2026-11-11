# Fitting Room

Ứng dụng thử trang phục bằng ảnh AI, không sử dụng mô hình 3D. Repository hiện dùng FLUX 3 Image Klein qua OpenRouter. Ảnh TRƯỚC và SAU được tạo bằng hai thao tác riêng để người dùng chủ động kiểm soát chi phí; ảnh TRƯỚC là tham chiếu cho ảnh SAU.

## Công nghệ

- Frontend: React, Vite, TypeScript strict, Tailwind, Zustand.
- Backend: Node.js, Express, TypeScript.
- Lưu trữ bản đầu: SQLite cho metadata và thư mục local cho file ảnh.
- Production: Supabase PostgreSQL/Auth và Cloudflare R2 private qua adapter backend.
- Tách nền: `@imgly/background-removal`, chạy trực tiếp trong trình duyệt.

## Cài đặt và chạy

Yêu cầu Node.js 22 trở lên.

```bash
npm install
copy .env.example .env
npm run dev
```

- Web và API: `http://127.0.0.1:8787`
- API health check: `http://127.0.0.1:8787/api/health`

Express nhúng Vite ở chế độ development nên frontend và API dùng chung một cổng. Khi chạy `npm start`, Express phục vụ frontend đã build từ `dist/` trên cùng cổng đó.

`npm run dev` chạy đồng thời Vite và Express. Dữ liệu local được tạo trong `data/` và đã được gitignore.

## Kiểm tra và build

```bash
npm run test
npm run build
npm start
```

`npm start` chạy backend đã build trong `dist-server/` và phục vụ frontend production từ `dist/`.

Test của các repository PostgreSQL (credit ledger, social, moderation, dọn ảnh R2) chạy trên PostgreSQL nhúng [PGlite](https://pglite.dev) với toàn bộ migration trong `supabase/migrations/`, không cần Supabase hay Docker. Helper nằm ở `server/__tests__/pglite-pool.ts`.

## Biến môi trường

### Chung

| Biến | Mặc định | Mô tả |
| --- | --- | --- |
| `HOST` | local `127.0.0.1`, production `0.0.0.0` | Interface Express lắng nghe |
| `PORT` | `8787` | Cổng Express; Render tự cấp, không đặt tay |
| `DATA_DIR` | `./data` | Vị trí SQLite và thư mục ảnh khi chạy local |
| `PERSISTENCE_BACKEND` | `sqlite` | `sqlite` ở local; production `postgres` |
| `AUTH_BACKEND` | `local` | `local` ở development; production `supabase` |
| `IMAGE_STORAGE` | `local` | `local` ở development; production `r2` |
| `APP_BASE_URL` | `RENDER_EXTERNAL_URL` rồi `http://127.0.0.1:8787` | URL gốc dùng cho email khôi phục mật khẩu và đọc ảnh local |
| `AUTH_SESSION_DAYS` | `30` | Số ngày duy trì phiên đăng nhập |
| `COOKIE_SECURE` | theo `NODE_ENV` | Production mặc định bật; local HTTP đặt `false` |
| `TRUST_PROXY_HOPS` | trống | Số proxy tin cậy; Render đặt `1` |
| `ADMIN_EMAILS` | trống | Email được phép bootstrap admin; tài khoản còn phải có `app_metadata.role = admin` trên Supabase |
| `LEGACY_DATA_CLAIM_TOKEN` | trống | Token một lần để account đầu tiên claim dữ liệu bản cũ; xoá sau migration |
| `ALLOW_LOCAL_BACKENDS` | trống | Khi `NODE_ENV=production`, server từ chối khởi động với `sqlite`/`local` (dữ liệu mất sau mỗi lần deploy). Đặt `true` chỉ khi cố ý chạy thử như vậy |

### Supabase và R2 (production)

| Biến | Mặc định | Mô tả |
| --- | --- | --- |
| `DATABASE_URL` | trống | URI pooler của Supabase, thêm `sslmode=require` |
| `DATABASE_POOL_MAX` | `5` | Số kết nối tối đa mỗi tiến trình (1–20) |
| `DATABASE_QUERY_TIMEOUT_MS` | `20000` | Thời hạn mỗi query; query treo báo lỗi thay vì giữ kết nối |
| `DATABASE_CA_CERT_BASE64` | trống | Base64 của Supabase database CA để xác minh TLS |
| `SUPABASE_URL` | trống | Project URL |
| `SUPABASE_PUBLISHABLE_KEY` | trống | Publishable key cho Supabase Auth phía backend (`SUPABASE_ANON_KEY` cũng được nhận) |
| `SUPABASE_SERVICE_ROLE_KEY` | trống | Chỉ dùng để xoá tài khoản Auth; không bao giờ đặt vào `VITE_*`/`EXPO_PUBLIC_*` |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | trống | Bucket R2 private và token chỉ có quyền trên bucket đó |
| `R2_PREFIX` | `uploads` | Tiền tố object để tách môi trường |
| `R2_PUBLIC_URL` | trống | Tuỳ chọn: domain HTTPS riêng của bucket, được thêm vào CSP `img-src` |
| `R2_SIGNED_READ_TTL_SECONDS` | `300` | Thời hạn URL ký ngắn hạn khi trình duyệt đọc ảnh R2 (60–3600) |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | trống | OAuth client của Google; đặt cả hai thì nút "Tiếp tục với Google" mới hiện (web + mobile) |
| `MOBILE_AUTH_REDIRECT_URLS` | `fitsy://auth-callback` | Danh sách deep link app mobile được phép nhận lại sau khi đăng nhập Google |

### AI

| Biến | Mặc định | Mô tả |
| --- | --- | --- |
| `IMAGE_PROVIDER` | `openrouter` | `openrouter`, `gemini` hoặc `mock` |
| `OPENROUTER_API_KEY` | trống | Chỉ đặt ở backend |
| `OPENROUTER_IMAGE_MODEL` | `black-forest-labs/flux-3-image-klein` | Model tạo/chỉnh ảnh |
| `OPENROUTER_VISION_MODEL` | trống | Model nhận diện món đồ cho AI Extract |
| `OPENROUTER_IMAGE_RESOLUTION` | `768` | Độ phân giải output |
| `OPENROUTER_IMAGE_ASPECT_RATIO` | `4:5` | Tỷ lệ ảnh toàn thân |
| `OPENROUTER_TIMEOUT_MS` | `120000` | Timeout mỗi request OpenRouter |
| `AI_MAX_CONCURRENCY` | `1` (Render đặt `3`) | Số request tạo ảnh chạy song song mỗi tiến trình |
| `AI_MAX_WAITING_REQUESTS` | `8` (Render đặt `12`) | Số request được xếp hàng; vượt thì trả 503 `ai_queue_busy` |
| `AI_QUEUE_TIMEOUT_MS` | `30000` (Render đặt `60000`) | Thời gian chờ tối đa trong hàng |
| `AI_DAILY_REQUEST_LIMIT` | trống (tắt) | Trần tổng request AI (tách đồ + tạo ảnh) của cả hệ thống mỗi 24 giờ |
| `GEMINI_API_KEY`, `GEMINI_IMAGE_MODEL`, `GEMINI_TIMEOUT_MS` | trống, `gemini-3.1-flash-image`, `120000` | Khi dùng Gemini |
| `MOCK_DELAY_MS` | `2000` | Độ trễ mỗi ảnh mock |
| `MUAPI_API_KEY` | trống | Chưa dùng |

### Giới hạn tốc độ

| Biến | Mặc định | Mô tả |
| --- | --- | --- |
| `API_REQUESTS_PER_MINUTE`, `API_RATE_LIMIT_BURST` | `600`, `120` | Token bucket theo phiên (hoặc IP khi chưa đăng nhập) mỗi instance |
| `API_IP_REQUESTS_PER_MINUTE`, `API_IP_RATE_LIMIT_BURST` | gấp 4 hai giá trị trên | Trần chung theo IP cho mọi phiên |
| `AI_REQUESTS_PER_15_MIN` | `10` | Lượt AI (tạo ảnh, tách đồ) mỗi user |
| `AUTH_LOGIN_ACCOUNT_PER_15_MIN`, `AUTH_LOGIN_IP_PER_15_MIN` | `10`, `60` | Thử đăng nhập |
| `AUTH_REGISTER_IP_PER_HOUR` | `20` | Đăng ký từ một IP |
| `AUTH_RESET_ACCOUNT_PER_15_MIN`, `AUTH_RESET_IP_PER_15_MIN` | `5`, `30` | Email khôi phục mật khẩu |

### Thanh toán

| Biến | Mặc định | Mô tả |
| --- | --- | --- |
| `PAYOS_CLIENT_ID`, `PAYOS_API_KEY`, `PAYOS_CHECKSUM_KEY` | trống | VietQR/payOS; bỏ trống thì ẩn nút |
| `MOMO_ENVIRONMENT`, `MOMO_PARTNER_CODE`, `MOMO_ACCESS_KEY`, `MOMO_SECRET_KEY` | `sandbox`, trống | MoMo |
| `MOMO_REQUEST_TYPE`, `MOMO_ENDPOINT` | `captureWallet`, theo môi trường | Ghi đè tuỳ chọn |

Không đặt API key trong biến có tiền tố `VITE_`, vì các biến đó sẽ bị đóng gói vào frontend.

## Deploy production: Render + Supabase + Cloudflare R2

1. Trong Supabase SQL Editor, chạy lần lượt [`001_initial_schema.sql`](supabase/migrations/001_initial_schema.sql), [`002_admin_access.sql`](supabase/migrations/002_admin_access.sql), [`003_rate_limits.sql`](supabase/migrations/003_rate_limits.sql), [`004_image_credits.sql`](supabase/migrations/004_image_credits.sql), [`005_subscription_plans.sql`](supabase/migrations/005_subscription_plans.sql), [`006_billing.sql`](supabase/migrations/006_billing.sql), [`007_credit_ledger_and_performance.sql`](supabase/migrations/007_credit_ledger_and_performance.sql), [`008_account_deletion_retention.sql`](supabase/migrations/008_account_deletion_retention.sql) và [`009_social_normalized.sql`](supabase/migrations/009_social_normalized.sql). **Chạy migration trước khi deploy code tương ứng**: code mới ghi vào `credit_ledger` và các bảng social mới. Các file tự tạo bảng, index, RLS và trigger; không tạo bảng thủ công.
2. Trong Supabase **Connect**, lấy URI **Session pooler** (port `5432`) và dùng làm `DATABASE_URL`. Mật khẩu có ký tự đặc biệt phải được percent-encode. Trong **Database Settings → SSL Configuration**, tải certificate, chuyển file sang Base64 và đặt vào `DATABASE_CA_CERT_BASE64` để Render xác minh TLS đầy đủ.
3. Tạo một bucket R2 **private**. Tạo API token giới hạn Object Read/Write chỉ cho bucket đó; không bật public development URL.
4. Trên Render, `render.yaml` đã khai báo service: build `npm ci --include=dev && npm run build && npm prune --omit=dev`, start `npm start`, health check `/api/health`. Các biến cố định đã có trong file; điền các biến bí mật (`sync: false`) trong dashboard:

```env
DATABASE_URL=postgresql://...
DATABASE_CA_CERT_BASE64=...
SUPABASE_URL=https://PROJECT_REF.supabase.co
SUPABASE_PUBLISHABLE_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=fitting-room
OPENROUTER_API_KEY=...
ADMIN_EMAILS=owner@example.com
```

Không đặt `PORT`; Render tự cấp. `APP_BASE_URL` có thể bỏ qua trên Render vì backend dùng `RENDER_EXTERNAL_URL`.

Ảnh R2 không có URL public. Frontend luôn gọi `/uploads/:key`: backend kiểm tra phiên và quyền xem (ảnh của mình, hoặc ảnh được chia sẻ qua bạn bè/nhóm/bình chọn/bài đăng), rồi chuyển hướng 302 sang URL R2 ký ngắn hạn, nên byte ảnh không đi qua Render. `?proxy=1` stream ảnh qua backend cho các chỗ cần xử lý pixel cùng origin. Quyết định cho phép được cache 30 giây mỗi user.

Rate limiting gồm token bucket trong RAM (trần theo IP + bucket theo phiên) và bộ đếm PostgreSQL atomic cho auth/AI dùng chung giữa nhiều instance. Chi tiết trong [`docs/rate-limiting.md`](docs/rate-limiting.md).

Module social dùng các bảng quan hệ có index (migration 009): mỗi request chỉ đọc vùng dữ liệu của người dùng liên quan, mỗi thao tác ghi chỉ khoá theo user (`pg_advisory_xact_lock`), nên người dùng không xếp hàng chờ nhau. Migration 009 tự backfill từ `social_state` cũ và giữ nguyên bảng đó để rollback; xoá `social_state` sau khi xác nhận ổn định.

Tác vụ nền chạy trong tiến trình web, an toàn khi nhiều instance vì dùng khoá hàng: gửi kết quả bình chọn hết hạn, dọn thông báo cũ, và hàng đợi `storage_cleanup_queue` xoá object R2 (ảnh tạm quá 24 giờ, ảnh của tài khoản đã xoá) có retry. Object còn được tham chiếu ở bất kỳ bảng nào sẽ không bị xoá.

Khi tăng số người dùng, nên dùng Supabase **transaction pooler** (port `6543`) và tăng `DATABASE_POOL_MAX`; các khoá trong code đều là khoá theo transaction nên tương thích. Gói free của Render ngủ sau 15 phút không có request và chỉ có một instance.

Supabase Auth có thể yêu cầu xác minh email. Nếu bật, sau đăng ký người dùng phải mở email rồi đăng nhập; nếu tắt, đăng ký tạo phiên ngay. `SUPABASE_SERVICE_ROLE_KEY` chỉ dùng cho xoá tài khoản, không dùng cho đăng ký/đăng nhập.

Để tính năng **Quên mật khẩu** hoạt động, vào Supabase **Authentication → URL Configuration**:

- đặt **Site URL** thành URL production, ví dụ `https://vn-vton.onrender.com`;
- thêm chính xác `https://vn-vton.onrender.com/reset-password` vào **Redirect URLs**;
- khi chạy local, có thể thêm `http://127.0.0.1:8787/reset-password`;
- app mobile cần thêm `fitsy://auth-callback` và `fitsy://reset-password` (giữ `tryoh://auth-callback` đến khi người dùng đã cập nhật hết bản app cũ).

Backend gọi Supabase gửi email và frontend chỉ nhận recovery token từ phần URL fragment. API trả thông báo chung dù email có tồn tại hay không để tránh dò tài khoản. Email production gửi qua SMTP riêng (Brevo) cấu hình tại Supabase **Authentication → SMTP Settings**, không dùng dịch vụ email mặc định bị giới hạn của Supabase.

## Đăng nhập, tài khoản và credit

- Đăng ký bằng tên hiển thị, email và mật khẩu tối thiểu 8 ký tự. Lỗi đăng ký dùng thông báo chung để không lộ email đã tồn tại.
- Production (`AUTH_BACKEND=supabase`): Supabase Auth quản lý mật khẩu và phiên; backend xác thực access token bằng `getClaims`. Role ứng dụng (`user`, `koc`, `moderator`, `admin`) và trạng thái khoá nằm trong bảng `profiles`.
- **Đăng nhập bằng Google** (`AUTH_BACKEND=supabase` + `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`). Backend tự chạy OAuth với Google thay vì để Supabase chạy, nên màn chọn tài khoản của Google hiện tên miền Fitsy chứ không phải `<project>.supabase.co`:
  1. `GET /api/auth/oauth/google?next=/…` (web) hoặc `?client=mobile&redirect=fitsy://auth-callback` → tạo PKCE verifier + `state` lưu trong bộ nhớ máy chủ (10 phút, dùng một lần); web nhận thêm cookie `HttpOnly` `fitting_room_oauth` để ràng buộc đúng trình duyệt → chuyển sang `accounts.google.com`.
  2. `GET /api/auth/oauth/callback` đổi mã với Google (client secret + verifier, back channel) lấy `id_token` → `POST /auth/v1/token?grant_type=id_token` của Supabase lấy phiên.
  3. Web: đặt cookie phiên rồi quay về `next` (chỉ nhận đường dẫn nội bộ). Mobile: redirect về deep link kèm mã dùng một lần, app đổi mã tại `POST /api/auth/oauth/session` (2 phút, dùng một lần) rồi `setSession`.
  - Lỗi quay về `/?auth_error=…` (web) hoặc `…?auth_error=…` (mobile): `google_cancelled`, `google_expired`, `google_failed`, `google_unavailable`.
  - `state`, mã hand-off và PKCE verifier nằm trong bộ nhớ tiến trình: nhiều instance cần sticky routing, restart giữa chừng thì người dùng đăng nhập lại.
  - Tài khoản Google trùng email đã xác minh được Supabase gộp vào tài khoản cũ. Tài khoản chỉ có Google không có mật khẩu (`hasPassword=false`) nên phần đổi email/mật khẩu được ẩn.
  - Cấu hình: Google Cloud Console → OAuth client (Web application), Authorized redirect URI là **`<APP_BASE_URL>/api/auth/oauth/callback`** (không phải domain Supabase); Supabase → Authentication → Providers → Google: bật và dán **cùng** Client ID/Secret để Supabase chấp nhận `id_token`. Không cần thêm Redirect URL nào trong Supabase cho luồng này. Chạy migration 010 để tên Google vào `profiles`.
- Local (`AUTH_BACKEND=local`): mật khẩu băm `scrypt` với salt riêng, chỉ hash token phiên được lưu trong SQLite. Cookie `HttpOnly`, `SameSite=Lax`.
- Tủ đồ, ảnh người, kết quả và “Bộ đồ của tôi” đều phân vùng theo `user_id`.
- **Xoá tài khoản** (Cài đặt → Tài khoản, cả web và mobile): xoá tài khoản Supabase Auth; các bảng dữ liệu xoá theo `ON DELETE CASCADE`; ảnh trên R2 được đưa vào hàng đợi dọn dẹp có retry. Đơn thanh toán được giữ lại nhưng ẩn danh (migration 008).
- **Credit**: tài khoản mới có 10 lượt tạo ảnh trọn đời (gói Free). Tạo ảnh và tách đồ bằng AI (mỗi món tách ra 1 lượt, tối đa 5 món một lần) đều trừ credit; request lỗi được hoàn. Admin không tiêu credit. Mọi thay đổi số dư (dùng, hoàn, mua gói, admin chỉnh, hết hạn gói) đều ghi vào sổ `credit_ledger`.
- **Gói trả phí** (Plus/Pro/Max) cộng thêm credit vào số dư hiện có và gia hạn 30 ngày; hết hạn thì về Free và số dư về 0. Webhook payOS/MoMo gửi lặp không cộng hai lần.
- Bản mobile phát hành qua cửa hàng gửi header `X-Client-Channel: store`; backend không trả cổng thanh toán ngoài cho bản này.
- Dữ liệu local cũ **không** tự chuyển cho người đăng ký đầu tiên. Muốn claim, operator cấu hình `LEGACY_DATA_CLAIM_TOKEN` và gửi token qua header `X-Legacy-Data-Claim-Token` đúng một lần khi đăng ký account đầu tiên.

### Chạy với OpenRouter / FLUX 3 Image Klein

Tạo key tại OpenRouter và đảm bảo tài khoản còn hạn mức. Trên Render, đặt key trong mục Environment. Khi chạy local, ưu tiên biến môi trường của tiến trình thay vì ghi key vào file được chia sẻ:

```env
IMAGE_PROVIDER=openrouter
OPENROUTER_API_KEY=YOUR_SERVER_SIDE_API_KEY
OPENROUTER_IMAGE_MODEL=black-forest-labs/flux-3-image-klein
OPENROUTER_IMAGE_RESOLUTION=768
OPENROUTER_IMAGE_ASPECT_RATIO=4:5
```

Nếu một key từng xuất hiện trong ảnh chụp, chat, log hoặc workspace gửi cho người khác, phải revoke/rotate key đó; chỉ xoá chuỗi khỏi file không làm key cũ an toàn trở lại.

Backend đọc ảnh local, chuyển thành data URL và gửi qua `input_references`. OpenRouter trả ảnh base64; backend lưu output bằng `ImageStorage`. Chi phí thật của mỗi request được ghi từ `usage.cost` nhưng không log ảnh người dùng.

### Chuyển lại Gemini

Tạo API key trong Google AI Studio, sau đó sửa `.env` ở backend:

```env
IMAGE_PROVIDER=gemini
GEMINI_API_KEY=YOUR_SERVER_SIDE_API_KEY
GEMINI_IMAGE_MODEL=gemini-3.1-flash-image
GEMINI_TIMEOUT_MS=120000
```

Không commit `.env`. Backend đọc ảnh người và ảnh đồ từ storage local, chuyển chúng thành inline image data rồi mới gọi Gemini; Google không cần truy cập URL localhost. Output Gemini được lưu lại qua `ImageStorage` và chỉ key ảnh được ghi vào database.

## Cấu trúc

```text
src/
  components/       Giao diện: tủ đồ, phòng thử, bộ đồ, social, cài đặt, gói, KOC Studio, admin
  garment_normalizer/  Chuẩn hoá ảnh món đồ chạy trong Web Worker
  hooks/ store/     Hook React và Zustand store
  services/         API client (thêm header chống CSRF), tách nền trên trình duyệt
server/
  admin/            Phân quyền, audit log, moderation báo cáo
  auth/             Auth local (SQLite) và Supabase; route /api/auth, xoá tài khoản
  billing/          payOS, MoMo, webhook, sổ giao dịch Excel
  credits/ plans/   Credit, sổ credit_ledger, gói Free/Plus/Pro/Max
  http/             Security headers/CSP, rate limit, kiểm tra ảnh upload, phân trang
  prompts/          Prompt FLUX
  providers/        Adapter OpenRouter/Gemini/mock; API key chỉ đọc từ env backend
  routes/           Tủ đồ, AI Extract, tạo ảnh, dữ liệu người dùng
  services/         Tách món đồ bằng AI, hàng đợi AI có giới hạn
  social/           Bạn bè, nhóm, bình chọn, bài đăng (SQLite JSON cho local, bảng quan hệ cho PostgreSQL)
  storage/          Repository SQLite/PostgreSQL, lưu ảnh local/R2, hàng đợi dọn R2
  __tests__/        Helper PGlite cho test PostgreSQL
supabase/migrations/  Migration 001–009, chạy theo thứ tự
mobile/             App Expo/React Native dùng chung backend
```

## Đã hoàn thành ở Giai đoạn 1

- Layout ba vùng responsive, không có Three.js hoặc mô hình 3D.
- Upload ảnh mặt trước bắt buộc và mặt sau tùy chọn.
- Kiểm tra JPG/PNG/WebP và giới hạn 10MB cho ảnh món đồ.
- Xem ảnh gốc và ảnh đã tách nền cạnh nhau; có thể chọn ảnh khác và tách lại.
- Lưu, tải và xóa món đồ qua Express + SQLite + thư mục ảnh.
- Mỗi nhóm chỉ chọn một món, có nút bỏ chọn và phần tóm tắt bộ đồ.

## Đã hoàn thành ở Giai đoạn 2

- Upload ảnh người dùng dạng JPG/PNG/WebP, tối đa 10MB.
- Resize trên trình duyệt để cạnh dài tối đa 1024px; backend chỉ lưu bản đã resize.
- Cảnh báo ảnh ngang, tỷ lệ bất thường hoặc độ phân giải thấp. Kiểm tra tư thế hiện là heuristic và checklist người dùng, chưa dùng model pose detection.
- Checkbox bắt buộc xác nhận ảnh chính chủ và đồng ý gửi tới dịch vụ AI bên thứ ba.
- Checkbox tự reset khi đổi hoặc xoá ảnh.
- API xoá ảnh người dùng và toàn bộ kết quả; schema kết quả đã sẵn sàng cho Giai đoạn 3.

## Đã hoàn thành ở Giai đoạn 3 — OpenRouter và Gemini

- Interface `ImageProvider` dùng chung cho mock, Gemini và OpenRouter.
- Prompt hai góc nằm riêng trong `server/prompts/try-on-prompt.ts`.
- FLUX nhận ảnh người, tối đa bốn món đồ và dùng ảnh TRƯỚC làm reference cho ảnh SAU.
- Góc SAU ưu tiên ảnh mặt sau của món đồ khi có.
- Nút chính chỉ tạo ảnh TRƯỚC. Khi thành công, người dùng chủ động bấm “Tạo ảnh sau”; mỗi ảnh là một request tính phí riêng.
- Loading, lỗi và nút tạo lại được quản lý riêng theo từng góc.
- Phân loại lỗi quota, timeout, nội dung bị từ chối và provider không khả dụng.
- Output OpenRouter/Gemini được lưu bằng `ImageStorage`; file cũ được dọn khi tạo lại, đổi ảnh người hoặc xoá dữ liệu.

## Đã hoàn thành ở Giai đoạn 4 — Bộ đồ của tôi

- Ảnh TRƯỚC được lưu ngay vào lịch sử; ảnh SAU là tuỳ chọn và được cập nhật vào đúng bộ khi người dùng chủ động tạo.
- Trang “Bộ đồ của tôi” hiển thị nhiều lần thử, hỗ trợ phóng to cặp ảnh và xoá từng bộ.
- Ảnh lịch sử được bảo toàn khi tạo bộ mới; “Xoá toàn bộ dữ liệu” dọn cả lịch sử và file liên quan.
- Chưa có tải ZIP; tính năng này vẫn nằm trong phần còn lại của Giai đoạn 4.

## Chưa làm

- Tải ZIP bộ đồ (phần còn lại của Giai đoạn 4).
- Provider MuAPI.
- Google Play Billing / App Store in-app purchase cho bản mobile trên cửa hàng.
- Shop và gợi ý sản phẩm có link affiliate của KOL/KOC: kiến trúc và chi phí đã phân tích, chờ chốt nguồn affiliate (xem [`docs/tryoh-implementation-roadmap.md`](docs/tryoh-implementation-roadmap.md)).

## Chuẩn hoá trang phục (Module garment_normalizer)

Module độc lập tại [`src/garment_normalizer/`](src/garment_normalizer) nhận ảnh món đồ sau khi tách nền (PNG RGBA) và chuẩn hoá để mọi món đồ nằm đúng khung, thẳng, cùng tỉ lệ:

- **Kiến trúc 2 tầng độc lập**:
  1. `core/`: Hàm thuần trên `RGBAImage = { data: Uint8ClampedArray; width; height }`, không DOM, chạy và test trực tiếp trong Node.js/Vitest.
  2. `io/`: Xử lý I/O, canvas multi-step halving resize, và chạy ngầm qua **Web Worker** (`postMessage` truyền `ArrayBuffer` dạng transferable, không đơ UI).
- **Lưu ý Safari di động**: Mobile Safari có giới hạn bộ nhớ/diện tích Canvas (`canvas.maxArea`), do đó `max_input_px` được mặc định là `2048` (trên các thiết bị iOS cũ hoặc bộ nhớ thấp có thể điều chỉnh xuống `1536`).
- **Hiệu năng thực tế (Benchmark)**: Ảnh độ phân giải $2048 \times 2048$ hoàn thành toàn bộ pipeline core trong **~930ms** (ngưỡng yêu cầu < 1.5 giây).
- **Kiểm thử tự động**: 10 kịch bản kiểm thử toàn diện tại `src/garment_normalizer/__tests__/phase8_comprehensive.test.ts` (kiểm tra lệch tâm, nghiêng ±10°, nghiêng 25°, cắt mép, xoá rác, lấp lỗ, khử viền đỏ, tính lũy đẳng idempotent, và tỉ lệ relative).

## Module bạn bè & bình chọn

Đã thêm **Bảng tin** (/bang-tin) và **Bạn bè** (/ban-be): lời mời, nhóm, QR/link cá nhân, chia sẻ outfit và bình chọn 1–3 bộ. Xem [hướng dẫn social](docs/social-module.md) để test bằng nhiều tài khoản và hiểu quyền ảnh, tuổi tự khai, báo cáo và giới hạn MVP. Không cần API key mới.

## Kiểm thử với mock provider

Để kiểm thử không tốn phí, đặt trong `.env`:

```env
IMAGE_PROVIDER=mock
MOCK_DELAY_MS=2000
```

Mock tạo từng ảnh theo đúng thao tác của người dùng. Mỗi ảnh là SVG có nhãn `NOT AI OUTPUT`; đây chỉ là dữ liệu giả để kiểm thử loading, lỗi, tạo lại và bố cục, không phải kết quả thử đồ AI.
