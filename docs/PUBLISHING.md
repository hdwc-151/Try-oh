# Build và phát hành Try-oh

Mã đã có cấu hình build/deploy. Việc có workflow hoặc bundle JavaScript không có nghĩa ứng dụng đã được ký, gửi hoặc duyệt trên cửa hàng.

## Backend: Render + Supabase

Ngày 12/11/2026 đã tạo schema trong project Supabase `tapzevmhoqnytdkbsing`: 29 bảng đều bật RLS, migration 001–012 có checksum trong `tryoh_schema_migrations`. Migration 012 thu hồi quyền gọi RPC của hai trigger nội bộ, tối ưu policy thanh toán và bổ sung ba index khóa ngoại. Không sửa 001–011 đã áp dụng.

Cấu hình mặc định hiện dùng Supabase cho Auth, PostgreSQL và ảnh private; Render chạy web/API. `IMAGE_PROVIDER=mock` chỉ kiểm tra luồng sản phẩm. Muốn dùng AI thật, thêm key ở backend và chọn provider sau khi kiểm tra ảnh thật.

### Hai giá trị riêng tư còn cần điền trong Render Environment

| Biến server | Lấy từ Supabase |
| --- | --- |
| `DATABASE_URL` | Nút **Connect → Session pooler**, kèm database password. Giữ xác minh TLS; dùng `sslmode=verify-full`. Nếu cần CA riêng, thêm `DATABASE_CA_CERT_BASE64`. |
| `SUPABASE_SECRET_KEY` | **Project Settings → API Keys → Secret keys**, khóa `sb_secret_...`. Có thể dùng legacy service-role key trong `SUPABASE_SERVICE_ROLE_KEY` thay thế. |

Không gửi hai giá trị trên trong chat, không commit vào repo và không dùng tiền tố `VITE_` hoặc `EXPO_PUBLIC_`. Publishable key là khóa khác, không thay được server key.

Khi khởi động thành công lần đầu, backend tạo bucket `tryoh-private` bằng Storage API với giới hạn 8 MB, MIME JPEG/PNG/WebP và `public=false`. Nếu bucket đã tồn tại nhưng đang public, backend dừng để operator sửa quyền; không tự mở quyền bucket. Mỗi object có UUID, không ghi đè; URL ảnh phải qua API kiểm tra quyền trước khi ký 60–3600 giây. Yêu cầu xóa ảnh thất bại được giữ lại trong cleanup queue.

Sau khi lưu Environment, chọn **Manual Deploy → Deploy latest commit** (Auto Deploy đang tắt). Đặt health check trong Render Settings là `/api/health`, xác minh response có `ready=true` và revision đúng SHA đã vượt CI. HTTP 200 của bản cũ không chứng minh bản mới đã deploy.

Trong Supabase Auth URL Configuration, đặt Site URL theo URL Render thực tế; thêm recovery URL web, `tryoh://auth-callback` và `tryoh://reset-password` theo luồng app. Không tắt email confirmation chỉ để vượt kiểm thử.

Gói Render Free dùng cho prototype, có thời gian khởi động lại khi nhàn rỗi. Ảnh và dữ liệu nằm ở Supabase để không phụ thuộc ổ đĩa tạm của Render.

### Tùy chọn R2

Adapter R2 vẫn được giữ. Nếu có bucket R2 private, đặt `IMAGE_STORAGE=r2` rồi điền bốn biến `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`. Không cần R2 để triển khai cấu hình Supabase ở trên.

### GitHub Settings → Secrets and variables → Actions

| Loại | Tên | Nội dung |
| --- | --- | --- |
| Secret | DATABASE_URL | Connection string Supabase cho migration |
| Secret | DATABASE_CA_CERT_BASE64 | CA certificate khi triển khai yêu cầu CA riêng |
| Secret | RENDER_DEPLOY_HOOK_URL | URL deploy hook bí mật của đúng dịch vụ |
| Variable | PRODUCTION_URL | Origin HTTPS thật của backend |
| Variable | DEPLOY_ENABLED | Chỉ đặt true sau khi hoàn tất cấu hình |

Workflow Deploy backend kiểm tra CI thành công cho đúng SHA của main, áp dụng migration trong transaction, gọi hook với ref=SHA rồi đợi /api/health báo ready và đúng revision. Không coi health của bản cũ là deploy thành công.

Khi DEPLOY_ENABLED chưa true, job deploy được bỏ qua. Điều này chỉ nói chưa bật deploy; không phải bằng chứng đã có website live.

Nếu deploy lỗi sau migration, giữ thay đổi schema tương thích và sửa code/triển khai lại. Không tự xoá bảng để rollback. Xem [DATABASE.md](DATABASE.md).

## Expo project riêng

App có scheme tryoh, Android package và iOS bundle identifier đều là com.hdwc151.tryoh. Đây là định danh dự kiến, cần đăng ký trong tài khoản store của bạn trước release đầu tiên; không đổi sau khi đã phát hành.

Không dùng project/tài khoản Expo của tác giả VN_VTON. app.config.js đọc EXPO_PROJECT_ID và EXPO_ACCOUNT_OWNER của bạn.

~~~powershell
cd mobile
npm ci
Copy-Item .env.example .env
npx eas-cli@27.7.2 login
npx eas-cli@27.7.2 init
~~~

Tạo/chọn project của chính bạn. Nếu CLI không tự sửa được app.config.js động, lấy project ID trên Expo dashboard và đặt EXPO_PROJECT_ID vào môi trường; không chép lại ID của tác giả cũ.

Điền URL backend HTTPS, Supabase URL và publishable key thật vào mobile/.env. Backend mobile cần AUTH_BACKEND=supabase; SQLite/local auth chỉ phục vụ prototype web.

~~~powershell
npm run check
npx expo start
~~~

Thiết bị thật cần truy cập được backend. localhost trên điện thoại là chính điện thoại đó. Dùng backend HTTPS staging hoặc địa chỉ LAN phù hợp trong môi trường thử nghiệm; store build dùng HTTPS.

## Build đầu tiên và signing

~~~powershell
npx eas-cli@27.7.2 build -p android --profile preview
npx eas-cli@27.7.2 build -p ios --profile preview
~~~

Lần đầu phải hoàn tất hướng dẫn credential của EAS. Android cần keystore; iOS cần Apple Developer team, certificate, provisioning profile và thiết bị được đăng ký nếu dùng internal distribution. Không commit các khóa này.

| Profile | Android | iOS |
| --- | --- | --- |
| preview | APK cài thử | Bản internal cho thiết bị đã đăng ký |
| simulator | Không dùng | Bản cho iOS Simulator |
| production | AAB | Bản store đã ký |

iOS Simulator chạy trên macOS. Windows có thể dùng EAS để build iOS trên cloud, nhưng không chạy iOS Simulator tại chỗ.

## GitHub Actions cho mobile

| Loại | Tên | Nội dung |
| --- | --- | --- |
| Secret | EXPO_TOKEN | Token của tài khoản có quyền với project |
| Variable | EXPO_PROJECT_ID | UUID project riêng |
| Variable | EXPO_ACCOUNT_OWNER | Tài khoản/team Expo riêng |
| Variable | EXPO_PUBLIC_API_URL | Backend HTTPS đã hoạt động |
| Variable | EXPO_PUBLIC_WEB_URL | URL web, nếu khác backend |
| Variable | EXPO_PUBLIC_SUPABASE_URL | Supabase project URL |
| Variable | EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY | Publishable key, được phép nằm trong app |
| Variable | ASC_APP_ID | App Store Connect app ID, cần khi submit iOS |

Actions → Mobile release → Run workflow, chọn platform/profile. Workflow kiểm tra cấu hình, lint/typecheck rồi dùng EAS CLI đã cố định phiên bản. Không bật submit khi chỉ cần APK/bản thử.

Các public variable được đưa vào profile build; token và private key không được chép vào app config. EXPO_PUBLIC_BILLING_MODE mặc định store.

## Gửi lên cửa hàng

Đầu tiên tạo app record trong Google Play Console/App Store Connect, hoàn tất thông tin ứng dụng và thiết lập credential submit ở EAS. Kiểm tra yêu cầu upload lần đầu trong Play Console theo tài khoản thực tế.

~~~powershell
npx eas-cli@27.7.2 build -p all --profile production
npx eas-cli@27.7.2 submit -p android --profile production
npx eas-cli@27.7.2 submit -p ios --profile production
~~~

Hoặc chọn production + submit trong workflow. Tùy chọn --auto-submit gửi chính build vừa tạo; không lấy ngẫu nhiên một build cũ bằng --latest.

Android mặc định track internal và releaseStatus=draft. iOS gửi tới App Store Connect/TestFlight. Cả hai vẫn cần hoàn tất thông tin và bước review/rollout của store; upload không tự biến thành bản public.

## Các việc phải chốt trước public release

- Quyền sử dụng VN_VTON chưa được thể hiện bằng LICENSE trong snapshot; giữ attribution và xác nhận với chủ nguồn. Không tự áp giấy phép mới cho toàn bộ mã.
- @imgly/background-removal công bố AGPL và có lựa chọn giấy phép khác từ tác giả. Chốt cách dùng/phân phối phù hợp trước khi định vị sản phẩm.
- Chạy AI thật bằng tài khoản của bạn và bộ ảnh được phép sử dụng; thông số model, chi phí và chất lượng chưa được kiểm chứng ở môi trường này.
- Chạy trên iPhone và Android thật: chọn/chụp ảnh, EXIF/HEIC, đăng nhập, reset password, rớt mạng lúc tạo ảnh, mở lại app, đọc ảnh riêng, xoá tài khoản.
- Hoàn tất support URL, privacy policy phản ánh provider và retention thực tế, trang yêu cầu xoá tài khoản, ảnh chụp store, age rating và data safety/privacy labels.
- Store build hiện không tích hợp mua credit qua IAP. Backend ẩn cổng thanh toán ngoài theo channel; không quảng bá thanh toán số bằng payOS/MoMo trong store build.
- iOS chưa tích hợp Sign in with Apple. Luồng Google được ẩn trên iOS; email/password vẫn hoạt động. Nếu bật lại social login, cần hoàn tất phương án đáp ứng quy định login của Apple.
- Social có report/block/moderation nhưng vẫn cần vận hành phản hồi report và lọc nội dung trước khi mở public. Bộ test không chứng minh dịch vụ moderation đã có người trực.

Các mục trên là điều kiện thực tế của release này, không phải bằng chứng app chắc chắn được duyệt.

## Nguồn chính thức

- [Expo SDK 58 app config](https://docs.expo.dev/versions/v58.0.0/config/app/).
- [Expo: build từ CI](https://docs.expo.dev/build/building-on-ci/).
- [Expo: submit và sự khác biệt giữa upload, TestFlight và public release](https://docs.expo.dev/deploy/submit-to-app-stores/).
- [Render: deploy hooks và ref](https://render.com/docs/deploy-hooks).
- [Apple: App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/).
- [Apple: xoá tài khoản](https://developer.apple.com/help/app-review/guideline-reference/5-1-1-account-deletion/).
- [Google Play: payments](https://support.google.com/googleplay/android-developer/answer/9858738).
- [IMG.LY: license](https://github.com/imgly/background-removal-js#license).
