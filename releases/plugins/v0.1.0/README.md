# Fitsy plugins 0.1.0

| Package | Môi trường / Runtime | Tài liệu / API |
| --- | --- | --- |
| `@hdwc-151/camera-exposure` | JavaScript ESM, RGBA | [Kiểm tra ánh sáng camera · Camera exposure](https://github.com/hdwc-151/Try-oh/tree/1388e4c19fcb73aeacdb7b93031a5ea4c256b872/src/plugins/camera-exposure) |
| `@hdwc-151/reference-image-encoder` | Node.js 24+, Sharp | [Chuẩn hóa ảnh WebP · WebP reference encoder](https://github.com/hdwc-151/Try-oh/tree/def196f4a0d154cf96dc8d5ebdd9356ab3cfa2cf/server/plugins/reference-image-encoder) |

### Cài đặt / Install

Chạy lệnh cho gói bạn muốn dùng trong thư mục dự án. Mỗi gói có thể cài độc lập và bao gồm khai báo kiểu TypeScript.

Run the command for the package you need from your project directory. Each package installs independently and includes TypeScript declarations.

~~~sh
npm install https://raw.githubusercontent.com/hdwc-151/Try-oh/main/releases/plugins/v0.1.0/hdwc-151-camera-exposure-0.1.0.tgz
~~~

~~~sh
npm install https://raw.githubusercontent.com/hdwc-151/Try-oh/main/releases/plugins/v0.1.0/hdwc-151-reference-image-encoder-0.1.0.tgz
~~~

### Kiểm tra tệp / Verify downloads

Sau khi tải cả hai tệp và danh sách mã SHA-256 vào cùng một thư mục, chạy lệnh bên dưới trên Linux. Trên Windows, dùng `Get-FileHash *.tgz -Algorithm SHA256` trong PowerShell và đối chiếu với [SHA256SUMS.txt](SHA256SUMS.txt).

On Linux, run the command below in the directory containing both downloads and the checksum file. On Windows, use the PowerShell command above and compare the values.

~~~sh
sha256sum -c SHA256SUMS.txt
~~~
