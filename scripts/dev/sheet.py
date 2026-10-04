"""Contact sheet of captured frames.  Usage: sheet.py <frames_dir> <out.png> [every] [cols] [start] [end]"""
import glob
import sys
from PIL import Image, ImageDraw

d, out = sys.argv[1], sys.argv[2]
every = int(sys.argv[3]) if len(sys.argv) > 3 else 10
cols = int(sys.argv[4]) if len(sys.argv) > 4 else 8
paths = sorted(glob.glob(f"{d}/*.png"))
start = int(sys.argv[5]) if len(sys.argv) > 5 else 0
end = int(sys.argv[6]) if len(sys.argv) > 6 else len(paths)
paths = paths[start:end:every]
w = 240
ims = []
for i, p in enumerate(paths):
    im = Image.open(p).convert("RGB")
    im = im.resize((w, round(im.height * w / im.width)))
    ImageDraw.Draw(im).text((4, im.height - 14), str(start + i * every), fill=(255, 255, 0))
    ims.append(im)
h = ims[0].height
rows = (len(ims) + cols - 1) // cols
sheet = Image.new("RGB", (cols * w, rows * h))
for i, im in enumerate(ims):
    sheet.paste(im, ((i % cols) * w, (i // cols) * h))
sheet.save(out)
