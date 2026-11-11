"""Vẽ bộ icon app Fitsy (iOS, Android adaptive, monochrome, splash, favicon).

Toạ độ theo khung 64x64 giống public/fitsy-mark.svg; vẽ ở độ phân giải gấp 4 rồi thu nhỏ để mép mịn.
Dùng: python3 fitsy_icons.py <thư mục assets/images>
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

NAVY = (20, 26, 60, 255)      # #141A3C
WHITE = (255, 255, 255, 255)
PINK = (255, 90, 110, 255)    # #FF5A6E
SS = 4                        # hệ số siêu lấy mẫu


# Hình gốc (khung 64) — chữ F nét 6.5, đầu nét bo tròn; sparkle tách khỏi gạch trên.
F_RECTS = [(0, 0, 6.5, 26.5), (0, 0, 19.5, 6), (6.5, 12, 16.5, 18)]
F_CAPS = [(19.5, 3, 3), (16.5, 15, 3), (3.25, 26.5, 3.25)]
SPARK_C, SPARK_R, SPARK_W = (27.5, -6.5), 6.5, 1.9   # tâm, bán kính, độ dày eo
# Khung bao cả cụm để căn giữa trong ô 64.
BBOX = (0, SPARK_C[1] - SPARK_R, SPARK_C[0] + SPARK_R, 26.5 + 3.25)
SHIFT = (32 - (BBOX[0] + BBOX[2]) / 2, 32 - (BBOX[1] + BBOX[3]) / 2)


def draw_mark(draw, scale, ox, oy, f_color, spark_color):
    """Chữ F bo tròn đầu nét + sparkle 4 cánh, căn giữa khung 64."""
    def p(x, y):
        return (ox + (x + SHIFT[0]) * scale, oy + (y + SHIFT[1]) * scale)

    for x0, y0, x1, y1 in F_RECTS:
        draw.rectangle([p(x0, y0), p(x1, y1)], fill=f_color)
    for cx, cy, r in F_CAPS:
        draw.ellipse([p(cx - r, cy - r), p(cx + r, cy + r)], fill=f_color)

    cx, cy = SPARK_C
    r, w = SPARK_R, SPARK_W
    star = [(cx, cy - r), (cx + w, cy - w), (cx + r, cy), (cx + w, cy + w),
            (cx, cy + r), (cx - w, cy + w), (cx - r, cy), (cx - w, cy - w)]
    draw.polygon([p(x, y) for x, y in star], fill=spark_color)


def svg_mark():
    """Cùng hình dạng dưới dạng path SVG (khung 64) để web dùng chung."""
    sx, sy = SHIFT
    f = []
    for x0, y0, x1, y1 in F_RECTS:
        f.append(f'<rect x="{x0+sx:g}" y="{y0+sy:g}" width="{x1-x0:g}" height="{y1-y0:g}"/>')
    for cx, cy, r in F_CAPS:
        f.append(f'<circle cx="{cx+sx:g}" cy="{cy+sy:g}" r="{r:g}"/>')
    cx, cy = SPARK_C[0] + sx, SPARK_C[1] + sy
    r, w = SPARK_R, SPARK_W
    pts = [(cx, cy - r), (cx + w, cy - w), (cx + r, cy), (cx + w, cy + w),
           (cx, cy + r), (cx - w, cy + w), (cx - r, cy), (cx - w, cy - w)]
    star = ' '.join(f'{x:g},{y:g}' for x, y in pts)
    return ''.join(f), star


def render(size, *, background=None, rounded=False, mark_box=None,
           f_color=WHITE, spark_color=PINK):
    """size: cạnh ảnh; mark_box: cạnh khung 64 khi đặt giữa ảnh (mặc định full ảnh)."""
    big = size * SS
    img = Image.new('RGBA', (big, big), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    if background is not None:
        if rounded:
            draw.rounded_rectangle([0, 0, big - 1, big - 1], radius=big * 18 / 64, fill=background)
        else:
            draw.rectangle([0, 0, big, big], fill=background)
    box = (mark_box or size) * SS
    off = (big - box) / 2
    draw_mark(draw, box / 64, off, off, f_color, spark_color)
    return img.resize((size, size), Image.LANCZOS)


def main(out_dir):
    out = Path(out_dir)
    # iOS: vuông full, không trong suốt (hệ điều hành tự bo góc).
    render(1024, background=NAVY).convert('RGB').save(out / 'icon.png')
    # Android adaptive: nền navy riêng, tiền cảnh nằm trong vùng an toàn 66%.
    render(1024, mark_box=620).save(out / 'android-icon-foreground.png')
    Image.new('RGB', (1024, 1024), NAVY[:3]).save(out / 'android-icon-background.png')
    # Android 13+ themed icon: chỉ một màu.
    render(1024, mark_box=620, spark_color=WHITE).save(out / 'android-icon-monochrome.png')
    # Splash: ô bo góc đặt giữa nền navy.
    render(512, background=NAVY, rounded=True, mark_box=512).save(out / 'splash-icon.png')
    render(64, background=NAVY, rounded=True).save(out / 'favicon.png')


if __name__ == '__main__':
    main(sys.argv[1])
