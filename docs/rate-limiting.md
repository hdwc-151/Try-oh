# Rate limiting production

## Các tầng

1. **Trần theo IP** (RAM): mọi `/api/*` trừ health check đi qua token bucket theo IP, mặc định gấp 4 giới hạn của một phiên. Tầng này luôn áp dụng, nên gửi token giả đổi liên tục không tạo được bucket mới để vượt giới hạn.
2. **Bucket theo phiên** (RAM): request có Bearer token hoặc cookie phiên được tính theo phiên đó; chưa đăng nhập thì theo IP. Nhờ vậy nhiều người dùng thật chung một IP nhà mạng (CGNAT) không chặn lẫn nhau. Hai tầng RAM rất nhanh, không ghi database, giới hạn theo từng instance.
3. **Fixed window trong PostgreSQL**: đăng ký, đăng nhập, quên mật khẩu, tạo đơn thanh toán (10 đơn/giờ mỗi tài khoản), tạo ảnh (`ai.generate.user`, theo user) và tách đồ bằng AI (`ai.extract.user`, theo user + IP). Câu lệnh upsert atomic nên nhiều Render instance dùng chung quota. Admin không bị giới hạn tạo ảnh.
4. **Trần AI toàn hệ thống** (tuỳ chọn): `AI_DAILY_REQUEST_LIMIT` đếm tổng request tạo ảnh + tách đồ của mọi người dùng trong 24 giờ, dùng chung bộ đếm PostgreSQL. Bỏ trống thì tắt.
5. **Hàng đợi AI**: mỗi tiến trình chạy tối đa `AI_MAX_CONCURRENCY` request tới provider, xếp hàng tối đa `AI_MAX_WAITING_REQUESTS`, chờ tối đa `AI_QUEUE_TIMEOUT_MS`. Đầy hoặc quá hạn thì trả HTTP 503 mã `ai_queue_busy` và hoàn credit.

IP, email và token phiên được SHA-256 trước khi trở thành bucket key. Bảng rate limit không cấp quyền cho `anon` hoặc `authenticated`.

## Triển khai

Bảng `api_rate_limits` tạo bởi `supabase/migrations/003_rate_limits.sql` (chạy theo thứ tự cùng các migration khác). Không cần thêm Redis cho quy mô hiện tại.

Các biến có thể tinh chỉnh:

| Biến | Mặc định | Ý nghĩa |
| --- | ---: | --- |
| `API_REQUESTS_PER_MINUTE` | 600 | Tốc độ nạp token cho một phiên (hoặc IP khi chưa đăng nhập) trên mỗi instance |
| `API_RATE_LIMIT_BURST` | 120 | Burst tối đa của một phiên trên mỗi instance |
| `API_IP_REQUESTS_PER_MINUTE` | 4 × `API_REQUESTS_PER_MINUTE` | Trần chung theo IP cho mọi phiên |
| `API_IP_RATE_LIMIT_BURST` | 4 × `API_RATE_LIMIT_BURST` | Burst chung theo IP |
| `AUTH_LOGIN_ACCOUNT_PER_15_MIN` | 10 | Thử đăng nhập cho một tài khoản |
| `AUTH_LOGIN_IP_PER_15_MIN` | 60 | Thử đăng nhập từ một IP; cao hơn quota tài khoản để tránh chặn NAT |
| `AUTH_REGISTER_IP_PER_HOUR` | 20 | Đăng ký từ một IP mỗi giờ |
| `AUTH_RESET_ACCOUNT_PER_15_MIN` | 5 | Email reset cho một tài khoản |
| `AUTH_RESET_IP_PER_15_MIN` | 30 | Email/reset từ một IP |
| `AI_REQUESTS_PER_15_MIN` | 10 | Lượt tạo ảnh, và riêng lượt tách đồ, cho một user |
| `AI_DAILY_REQUEST_LIMIT` | trống (tắt) | Tổng request AI của cả hệ thống mỗi 24 giờ |
| `AI_MAX_CONCURRENCY` | 1 (Render đặt 3) | Request AI chạy song song mỗi tiến trình |
| `AI_MAX_WAITING_REQUESTS` | 8 (Render đặt 12) | Request AI được xếp hàng mỗi tiến trình |
| `AI_QUEUE_TIMEOUT_MS` | 30000 (Render đặt 60000) | Thời gian chờ tối đa trong hàng |

Phản hồi bị chặn bởi rate limit có HTTP 429, `Retry-After`, `RateLimit-*`, `X-RateLimit-*` và mã `rate_limit_exceeded`.

## Khi traffic lớn hơn

- Đặt Cloudflare trước Render và bật WAF/rate limiting ở edge cho bot, quốc gia hoặc path bị tấn công. Không tin trực tiếp `X-Forwarded-For`; giữ `TRUST_PROXY_HOPS` đúng topology.
- Khi auth/AI đạt lưu lượng rất lớn, thay `PostgresRateLimitStore` bằng Redis/Valkey dùng Lua atomic. Interface `RateLimitStore` đã tách sẵn nên router không cần sửa.
- Không dùng PostgreSQL cho limiter toàn bộ request: tầng token bucket cố ý chạy trong RAM để không biến mỗi lần tải dữ liệu thành một database write.

