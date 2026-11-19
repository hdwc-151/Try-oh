# Camera exposure

Kiểm tra ánh sáng trên một mẫu pixel RGBA trước khi người dùng bắt đầu phiên thử đồ. Hàm trả về `dark`, `bright` hoặc `balanced`. Gói chạy cục bộ, không tự mở camera và không gửi ảnh đi.

## Dùng trong ứng dụng

Cài gói bằng `npm install ./hdwc-151-camera-exposure-0.1.0.tgz`. Với web, lấy mẫu từ vùng trang phục trên khung hình đang hiển thị. Ví dụ sau dùng một canvas đã chứa mẫu đó.

~~~js
import { checkCameraExposure } from '@hdwc-151/camera-exposure'

const context = sampleCanvas.getContext('2d', { willReadFrequently: true })
const { data } = context.getImageData(0, 0, sampleCanvas.width, sampleCanvas.height)
const exposure = checkCameraExposure(data)
~~~

Truyền pixel RGBA theo thứ tự R, G, B, A. Hàm tính độ sáng từ RGB. Trên 70% số pixel có độ sáng từ 18 trở xuống cho kết quả `dark`. Trên 70% ở mức 245 trở lên cho kết quả `bright`. Mẫu rỗng hoặc đúng 70% cho kết quả `balanced`, vì vậy ứng dụng nên đợi có khung hình trước khi hiển thị hướng dẫn.

## Tạo gói

Tại thư mục chứa tệp này, chạy `npm install`, `npm test` và `npm pack`. Trong bản sao đầy đủ của Try-oh đã chạy `npm ci` ở thư mục gốc, có thể bỏ bước cài đặt riêng. Tệp TGZ chứa JavaScript ESM và khai báo kiểu TypeScript. Ứng dụng có thể nhúng hàm trực tiếp mà không cần React, Expo hay SDK camera.

Mã kiểm tra ánh sáng được bổ sung trong [Try-oh, commit 02a0de9](https://github.com/hdwc-151/Try-oh/commit/02a0de9).
