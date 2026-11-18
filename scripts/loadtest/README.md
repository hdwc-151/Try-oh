# Đo tải Fitsy

Bộ script này dựng máy chủ giống production: cùng router, PostgreSQL, hàng đợi AI, ảnh thu nhỏ và nén phản hồi. Có ba chỗ được thay thế:

- **Đăng nhập**: token chính là id người dùng đã seed, nên không gọi Supabase Auth.
- **AI**: không gọi OpenRouter. Ảnh được trả về sau `LOADTEST_AI_DELAY_MS`, mặc định 25 giây ±20%.
- **Ảnh**: lưu trên đĩa local, không dùng R2.

Không dùng bộ này cho production, và không trỏ nó vào database thật.

## Cần có

- PostgreSQL 16 trống, đã chạy các migration trong `supabase/migrations`.
- [k6](https://k6.io), bản 1.x.
- `npm install` ở thư mục gốc.

## Chạy

```bash
export DATABASE_URL=postgres://user:pass@127.0.0.1:5432/fitsy_load
export DATA_DIR=/tmp/fitsy-load

# 1. Tạo 120 người dùng gói Pro, mỗi người có 30 món đồ, 5 outfit đã lưu và 3 bạn bè.
#    Danh sách token được ghi ra $DATA_DIR/users.json.
npx tsx scripts/loadtest/seed.ts

# 2. Mở máy chủ đo tải ở cổng 8850.
#    Cứ 5 giây máy chủ ghi một dòng loadtest_stats: RAM, heap và độ trễ event loop.
npx tsx scripts/loadtest/server.ts

# 3. Chạy kịch bản: tăng lên 50 người dùng, giữ 3 phút, rồi tăng lên 100 người dùng, giữ 3 phút.
k6 run -e USERS_FILE=$DATA_DIR/users.json scripts/loadtest/k6-fitsy.js
```

Các biến cho k6:

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `PEAK` | 100 | Số người dùng ở đỉnh |
| `TIME_SCALE` | 1 | Ví dụ `0.1` để chạy thử khoảng 1 phút |
| `THUMBS` | 1 | `0` tải ảnh gốc thay cho ảnh thu nhỏ, để so với bản cũ |
| `BASE_URL` | `http://127.0.0.1:8850` | Địa chỉ máy chủ |

Kịch bản gồm ba nhóm người dùng:

- **browse** (100%): mở app, lướt tủ đồ, outfit và trang xã hội.
- **generate** (20%): bấm thử đồ AI.
- **upload** (5%): tải lên một món đồ mới.

## Giả lập cấu hình Render

Để giống gói Render free (0,1 CPU, 512MB), hãy giới hạn CPU cho tiến trình node. Có hai cách:

- Dùng cgroup.
- Dùng `docker run --cpus=0.1 --memory=512m`.

Ngoài ra, đặt `NODE_OPTIONS=--max-old-space-size=384`.
