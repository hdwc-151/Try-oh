# Reference image encoder

Chuẩn hóa ảnh tham chiếu thành WebP trước khi gửi sang dịch vụ AI. Các yêu cầu đồng thời có cùng nội dung dùng chung một lần mã hóa. Gói chỉ xử lý ảnh đầu vào, không gọi mô hình và không tính lượt sử dụng.

## Dùng trong máy chủ Node.js

Cài bằng `npm install ./hdwc-151-reference-image-encoder-0.1.0.tgz` trên Node.js 24 trở lên. npm cài `sharp` cho hệ điều hành đang dùng. Tạo một bộ mã hóa dùng lại trong vòng đời dịch vụ, sau đó truyền dữ liệu ảnh mà máy chủ đã cho phép người dùng đọc.

~~~js
import { ReferenceImageEncoder } from '@hdwc-151/reference-image-encoder'

const encoder = new ReferenceImageEncoder()
const { data, mimeType } = await encoder.encode(authorizedImageBuffer)
// data là chuỗi base64. mimeType là image/webp.
~~~

Bộ mã hóa tự xoay theo thông tin EXIF, giữ tỷ lệ, giới hạn cạnh dài ở 1.024 pixel và không phóng lớn ảnh. Giới hạn ảnh đầu vào là 24 triệu pixel. Bộ nhớ đệm mặc định giữ tối đa 128 mục với ngân sách 16 MiB tính theo độ dài chuỗi base64 và thời hạn 5 phút. Có thể truyền hai số lần lượt là ngân sách byte và thời hạn mili giây khi gọi hàm tạo. Gọi `encoder.clear()` để giải phóng dữ liệu đã lưu. Mỗi tiến trình máy chủ có bộ nhớ đệm riêng.

## Tạo gói

Tại thư mục chứa tệp này, chạy `npm install`, `npm test` và `npm pack`. Trong bản sao đầy đủ của Try-oh đã chạy `npm ci` ở thư mục gốc, có thể bỏ bước cài đặt riêng. Bộ kiểm thử dùng ảnh tổng hợp trên CPU.

Mã xử lý ảnh được bổ sung trong [Try-oh, commit 6a5e0ae](https://github.com/hdwc-151/Try-oh/commit/6a5e0ae).
