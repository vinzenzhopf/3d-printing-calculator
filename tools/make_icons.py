"""Draws the app icons (PWA manifest, apple-touch-icon) into public/icons/.

Usage: python tools/make_icons.py   (needs Pillow)
Motif: a nozzle over stacked print layers on a blue tile.
"""
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "public" / "icons"
BLUE = (13, 110, 253)
WHITE = (255, 255, 255)
LIGHT = (158, 197, 254)


def draw(size: int, maskable: bool) -> Image.Image:
    s = size / 512
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if maskable:
        d.rectangle([0, 0, size, size], fill=BLUE)  # full bleed, content inside the safe zone
        inset = 0.12
    else:
        d.rounded_rectangle([0, 0, size - 1, size - 1], radius=int(96 * s), fill=BLUE)
        inset = 0.0

    def box(x0, y0, x1, y1):
        # Scale the 512 design into the (optionally inset) area.
        k = 1 - 2 * inset
        o = inset * 512
        return [int((o + x0 * k) * s), int((o + y0 * k) * s), int((o + x1 * k) * s), int((o + y1 * k) * s)]

    # Nozzle: body + tip.
    d.rounded_rectangle(box(196, 70, 316, 150), radius=int(14 * s), fill=WHITE)
    d.polygon([tuple(box(216, 150, 0, 0)[:2]), tuple(box(296, 150, 0, 0)[:2]), tuple(box(256, 205, 0, 0)[:2])], fill=WHITE)
    # Print layers, the top one still being laid down.
    layers = [(110, 402), (126, 386), (142, 370), (158, 272)]  # top layer ends under the nozzle
    for i, (x0, x1) in enumerate(layers):
        y0 = 390 - i * 46
        d.rounded_rectangle(box(x0, y0, x1, y0 + 34), radius=int(17 * s), fill=WHITE if x1 - x0 > 150 else LIGHT)
    return img


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    for size in (192, 512):
        draw(size, False).save(OUT / f"icon-{size}.png")
    draw(512, True).save(OUT / "maskable-512.png")
    draw(180, True).convert("RGB").save(OUT / "apple-touch-icon.png")
    draw(64, False).save(OUT / "favicon.png")
    print("icons written to", OUT.relative_to(ROOT))


if __name__ == "__main__":
    main()
