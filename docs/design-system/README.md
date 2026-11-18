# Fitsy Design System

Hướng giao diện: **Trắng đen, ảnh làm chủ**. Khung giao diện đơn sắc; ảnh quần áo là thứ duy nhất có màu.

## Tệp

| Tệp | Nội dung |
|---|---|
| `styles.css` | Token (`:root`) và class của mọi component. Nguồn gốc duy nhất của giá trị. |
| `index.html` | Style guide: nền tảng + 47 component, có Dev Mode và Copy as prompt. |
| `concept.html` | Mockup hai màn: hồ sơ creator và chi tiết look. |
| `icons.html` | Bộ icon SVG (38 icon). |

Mở `index.html` bằng trình duyệt, không cần build.

## Quy tắc màu

- **Đen `#111114`** dẫn mọi hành động: nút chính, tab đang chọn, chip đang chọn.
- **Tím `#6E4BF2`** chỉ cho liên kết, dấu tích KOL/KOC và nhãn trạng thái. Chữ tím trên nền sáng dùng `--secondary-ink`.
- **Hồng `#FF5A6E`** chỉ cho nhãn "Tạo bởi AI". Chữ trên hồng luôn là đen. Không dùng hồng làm chữ.
- Bề mặt tách nhau bằng đường kẻ 1px. Chỉ menu, snackbar, dialog, sheet mới có bóng.
- Mọi cặp chữ/nền trong bảng "Tương phản" đã được tính theo WCAG 2.2.

## Áp dụng vào app Expo (`mobile/src/theme`)

1. `colors.ts`: thay bằng các vai trò trong `styles.css` (`primary`, `onPrimary`, `secondaryInk`, `muted`, `border`…).
2. `tokens.ts`: `spacing` = 2·4·8·12·16·20·24·32·48·64; `radius` = 4·8·12·16·full; thêm `control` = 36·48·56; `type` = 13 kiểu chữ trong mục Chữ.
3. Nạp font Be Vietnam Pro (400/500/600/700) bằng `expo-font`.
4. Dựng lại component theo thứ tự: Button → Chip → Text field → List/Person row → Tabs → Card → Image grid.
   Trong `index.html`, chọn "React Native (Expo, TypeScript)" rồi bấm **Copy as prompt** ở từng component.

## Mở rộng

- **Thêm token**: khai báo biến trong đúng nhóm ở `:root`, rồi tham chiếu. Không viết số hay mã màu trong component.
- **Thêm component**: thêm khối class vào `styles.css`, một `<section id="key">` và một mục `SPECS[key]` trong `index.html` (nút Copy as prompt tự xuất hiện).
- **Chế độ tối**: chưa có. Khi làm, thêm khối `:root[data-theme="dark"]` ghi đè token màu; cần một tông tím sáng hơn vì tím hiện tại trên nền tối chỉ đạt 3,18:1.
- Đặt tên theo vai trò (`--primary`), không theo màu (`--black`).
