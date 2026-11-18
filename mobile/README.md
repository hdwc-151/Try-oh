# Try-oh Mobile

**Tiếng Việt** · [English](#english) · [README dự án](../README.md) · [Phát hành](../docs/PUBLISHING.md)

Ứng dụng Expo/React Native dùng chung tài khoản, tủ đồ, lịch sử và dữ liệu bạn bè với Try-oh Web.

## Mở demo do người khác host

Cài **Expo Go trên điện thoại** và quét QR từ phiên Metro đang chạy. Android quét trong Expo Go. iPhone mở từ Camera và dùng cùng tài khoản Expo với phiên CLI phía host. Nếu khác mạng, host chạy `npx expo start --tunnel`. Nếu xem web trên laptop, chỉ cần trình duyệt. [Hướng dẫn Expo](https://docs.expo.dev/get-started/start-developing/).

QR chuyển bundle từ Metro. Đăng nhập và thử đồ vẫn kết nối tới `EXPO_PUBLIC_API_URL`. Nếu QR mở được nhưng báo lỗi mạng, cần kiểm tra API từ điện thoại. `localhost` trên điện thoại trỏ về chính điện thoại.

## Tự host

Chạy trong thư mục `mobile/`:

~~~powershell
npm ci
if (!(Test-Path .env)) { Copy-Item .env.example .env }
~~~

Điền ba biến public trong `.env`:

- `EXPO_PUBLIC_API_URL` là URL backend điện thoại mở được.
- `EXPO_PUBLIC_SUPABASE_URL` và `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` lấy từ đúng project Supabase backend dùng.

~~~powershell
npm run check
npx expo start --tunnel
~~~

Backend mobile dùng Supabase Auth và PostgreSQL. Deep link bản cài là `tryoh://auth-callback` và `tryoh://reset-password`. Với OAuth trong Expo Go trên Android, cấu hình đúng URL callback `exp://...` của phiên test ở backend. iOS dùng email/password.

## Tạo bản cài độc lập

Thiết lập project EAS của bạn, `EXPO_PROJECT_ID`, `EXPO_ACCOUNT_OWNER` và biến public. Cả hai nền tảng dùng định danh `com.hdwc151.tryoh`.

~~~bash
npx eas-cli@27.7.2 build --platform android --profile preview
npx eas-cli@27.7.2 build --platform ios --profile preview
~~~

| Profile | Android | iOS |
| --- | --- | --- |
| `preview` | APK cài thử | Ad hoc cho iPhone đã đăng ký |
| `production` | AAB cho Google Play | Bản ký cho TestFlight/App Store Connect |
| `simulator` | — | iOS Simulator trên macOS |

Bản cài đã chứa bundle. Camera trực tiếp cần bản native có WebRTC và backend bật Decart. Căn khung camera hiển thị video trên thiết bị. Khi xác nhận bắt đầu, camera gửi video và ảnh tham chiếu sang Decart, với audio tắt. Bản store ẩn thanh toán ngoài. [Thiết lập ký và phát hành](../docs/PUBLISHING.md).

## English

To join a hosted demo, install **Expo Go on the phone** and scan the host's Metro QR. If you are on different networks, the host uses `--tunnel`. A physical iPhone uses the same Expo account as the host CLI. A laptop tester opens the web URL in a browser.

To host, run `npm ci` in `mobile/`, copy `.env.example` to `.env`, and set the reachable API URL, Supabase URL and matching public key. Run `npm run check` and `npx expo start --tunnel`. The API connection is independent of the Metro tunnel.

The EAS preview profile produces an Android APK or a signed iOS build for registered devices. TestFlight uses a signed production build. Live camera try-on requires WebRTC in the native app and Decart on the backend. [English project README](../README.en.md#android-and-ios) · [Expo internal distribution](https://docs.expo.dev/build/internal-distribution/). Framing runs on the device. Confirming starts the video session and uses the displayed allowance.
