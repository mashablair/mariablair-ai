"""Builds the site icons from images/mb-logo-source.png (the MB monogram on navy).
Run: python3 scripts/make-favicons.py"""
from PIL import Image
from pathlib import Path

root = Path(__file__).resolve().parent.parent
src = Image.open(root / 'images' / 'mb-logo-source.png').convert('RGB')

# Background colour taken from the artwork's corner, so the square padding is invisible.
bg = src.getpixel((4, 4))

# Find the gold artwork: anything noticeably brighter than the background.
w, h = src.size
px = src.load()
xs, ys = [], []
for y in range(h):
    for x in range(w):
        r, g, b = px[x, y]
        if r + g + b > sum(bg) + 90:
            xs.append(x); ys.append(y)
box = (min(xs), min(ys), max(xs) + 1, max(ys) + 1)
art = src.crop(box)

def square(margin):
    """The artwork centered on a square navy tile with `margin` (share of the side) around it."""
    side = round(max(art.size) / (1 - 2 * margin))
    tile = Image.new('RGB', (side, side), bg)
    tile.paste(art, ((side - art.width) // 2, (side - art.height) // 2))
    return tile

out = root / 'images'
roomy = square(0.10)   # phones and app tiles
tight = square(0.04)   # tiny browser-tab icons need every pixel

roomy.resize((180, 180), Image.LANCZOS).save(out / 'apple-touch-icon.png', optimize=True)
tight.resize((32, 32), Image.LANCZOS).save(out / 'favicon-32.png', optimize=True)
tight.resize((48, 48), Image.LANCZOS).save(root / 'favicon.ico', sizes=[(16, 16), (32, 32), (48, 48)])
print('artwork box', box, 'background', bg)
