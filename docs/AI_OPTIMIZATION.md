# Tối ưu AI cho Try-oh

Cập nhật nghiên cứu: 12/11/2026. Chưa chạy inference thật hoặc đo GPU trong lần phát triển này. Các thông số của tác giả dưới đây không phải benchmark của Try-oh.

## Quyết định hiện tại

Giữ adapter OpenRouter/Gemini của VN_VTON để bảo toàn luồng nhiều món và hai góc ảnh. Prototype mặc định dùng mock để kiểm tra sản phẩm mà không cần mua lượt AI. Không coi ảnh mock là kết quả thử đồ thật.

Không huấn luyện từ đầu ở giai đoạn này. Ưu tiên làm cho một lượt tạo ảnh có thể theo dõi, không bị gọi lặp, rồi mới chọn model theo số đo trên bộ ảnh riêng và GPU thực tế.

## Đã triển khai

| Vấn đề | Cách xử lý trong code | Giới hạn |
| --- | --- | --- |
| Gửi lại khi mạng rớt | Idempotency-Key theo user; biên nhận SQLite/PostgreSQL; lưu trước khi trả kết quả | Cùng mã và body mới được replay; giữ 7 ngày |
| Hai instance gọi cùng yêu cầu | INSERT có khoá duy nhất; chỉ bên claim thành công đi tiếp | Không phải cơ chế chạy lại job sau crash |
| Bấm liên tục | Client gộp promise; giữ mã sau lỗi mạng để lấy lại kết quả | Receipt ở client nằm trong RAM; không tự retry sau khi khởi động lại app |
| Mã bị dùng cho dữ liệu khác | SHA-256 của method, path và JSON đã chuẩn hoá; trả 409 | Tạo ý định mới phải dùng mã mới |
| Encode lại cùng ảnh | Cache WebP theo hash nội dung, gộp encode đồng thời | Tối đa 16 MB, 128 entry, TTL 5 phút mỗi process |
| Lộ ảnh qua cache | Vẫn đọc input đã được kiểm tra quyền; không cache output AI giữa user | Xoá tài khoản xả cache; không log ảnh/base64 |
| Dồn quá nhiều request | Semaphore, giới hạn hàng chờ và thời gian chờ | Hàng chờ vẫn nằm trong process, không phải durable worker |
| Chi phí ngoài dự kiến | Trần lượt theo user/ngày, credit ledger, hoàn credit khi lỗi đã xác định | Giá thật phụ thuộc model, nhà cung cấp, retry và lưu trữ |

Biên nhận pending sau crash không tự bị chiếm lại. Operator kiểm tra kết quả đã lưu và sổ credit/provider trước khi hoàn lượt thủ công. Tự động chạy lại một paid request khi chưa rõ trạng thái có thể tạo chi phí hai lần.

Không có khẳng định phần trăm tăng tốc cho các thay đổi này. Test xác nhận tính đúng đắn và giới hạn cache; tốc độ cần đo thực tế.

## Các phương án cần so sánh

| Phương án | Điểm cần đánh giá | Điều kiện phát hành |
| --- | --- | --- |
| API chỉnh ảnh hiện có | Giữ mặt, logo, nhiều món, ảnh trước/sau; p95 và usage.cost | Kiểm tra model ID còn hoạt động trong tài khoản, điều khoản và chính sách dữ liệu |
| IDM-VTON | Baseline nghiên cứu chuyên thử đồ, độ trung thực trang phục | Repo tác giả ghi CC BY-NC-SA 4.0; không chọn làm backend thương mại mặc định [1] |
| FASHN VTON v1.5 | Maskless; ba nhóm tops/bottoms/one-pieces; so 20/30/50 bước [2][3] | Code/weights chính công bố Apache-2.0, nhưng parser mặc định kế thừa SegFormer có giới hạn nghiên cứu/đánh giá [4][5] |

FASHN công bố khoảng 8 GB VRAM, output 576×864 và khoảng 5 giây trên H100 [3]. Không suy ra thời gian trên RTX 5060 Ti hoặc trên điện thoại từ số này. Điện thoại nên gọi backend; chưa có bằng chứng phù hợp để chạy pipeline này trực tiếp trên iOS/Android.

Không gắn pipeline FASHN mặc định vào luồng trả phí khi chưa xử lý giấy phép parser và chưa đánh giá các trường hợp nhiều món/góc sau. Apache-2.0 của model chính không tự thay đổi giấy phép của toàn bộ pipeline.

## Benchmark có thể tái lập

Script experiments/benchmark_fashn.py chỉ tải model khi chạy thật. Bản dry-run không cần Torch, GPU hoặc ảnh riêng:

~~~bash
python experiments/benchmark_fashn.py --manifest benchmarks/cases.example.json --dry-run
~~~

Để nghiên cứu, tạo môi trường Python 3.11/3.12 riêng, clone repo FASHN chính thức [2], ghi lại commit đang dùng, cài theo hướng dẫn tác giả và tải weights. Cài Torch/CUDA tương ứng với GPU; không dùng Python environment của backend Node.

Đặt ảnh có quyền sử dụng trong benchmarks/private, copy cases.example.json thành manifest riêng rồi chạy:

~~~bash
python experiments/benchmark_fashn.py --manifest benchmarks/cases.example.json --weights-dir PATH_TO_WEIGHTS --research-only --profiles fast balanced quality --repeats 3 --warmup 1
~~~

Script lưu hash weights và pipeline, tên GPU, Torch/CUDA, dtype, seed, số bước, thời gian sau synchronize, peak VRAM và output từng lượt. Warmup không nằm trong số đo. Dùng cùng tập ảnh/seed để so các profile; không lấy p95 từ hai ảnh ví dụ làm kết luận cho sản phẩm.

Tuỳ chọn --compile là một thí nghiệm riêng. Đo cả cold start và lượt đã warm trước khi bật lâu dài. Chỉ thêm quantization/offload khi model thật sự hỗ trợ và có số đo. Tài liệu Diffusers chỉ ra đánh đổi tốc độ/bộ nhớ; offload có thể giảm VRAM nhưng tăng thời gian [6][7]. Các API của Diffusers không mặc nhiên áp dụng được cho pipeline FASHN.

## Thứ tự thực nghiệm

1. Chốt tập holdout và rubric trong [evaluation-rubric.md](../benchmarks/evaluation-rubric.md).
2. Đo API baseline: số lượt thành công, p50/p95, chi phí thực, lỗi nội dung.
3. So 20/30/50 bước trên cùng GPU, cùng seed và batch=1.
4. Thử compile sau warmup; ghi riêng thời gian biên dịch.
5. Nếu thiếu VRAM mới thử các phương án giảm bộ nhớ phù hợp model.
6. Chỉ thay backend khi đạt tiêu chí nghiệm thu, quyền sử dụng đã rõ và không làm mất tính năng cần thiết.

Chi phí GPU trên một output thành công phải cộng cả thời gian idle/cold start, lỗi, lưu trữ và egress. Không so giá thuê theo giờ với giá API một ảnh mà bỏ qua tỷ lệ sử dụng.

## Nguồn chính thức

1. [IDM-VTON, README và license](https://github.com/yisol/IDM-VTON).
2. [FASHN VTON v1.5, mã inference và CLI](https://github.com/fashn-AI/fashn-vton-1.5).
3. [Model card và giới hạn phần cứng](https://huggingface.co/fashn-ai/fashn-vton-1.5).
4. [License của FASHN Human Parser](https://github.com/fashn-AI/fashn-human-parser/blob/main/LICENSE).
5. [SegFormer license, mục 3.3](https://github.com/NVlabs/SegFormer/blob/master/LICENSE).
6. [Diffusers: compile, quantization và offload](https://huggingface.co/docs/diffusers/en/optimization/speed-memory-optims).
7. [Diffusers: giảm bộ nhớ](https://huggingface.co/docs/diffusers/main/optimization/memory).
