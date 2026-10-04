"""Assemble captured PNG frames into a GIF.  Usage: make_gif.py <frames_dir> <out.gif> [width] [fps]"""
import glob
import sys
from PIL import Image

frames_dir, out = sys.argv[1], sys.argv[2]
width = int(sys.argv[3]) if len(sys.argv) > 3 else 300
fps = int(sys.argv[4]) if len(sys.argv) > 4 else 20

frames = []
for path in sorted(glob.glob(f"{frames_dir}/*.png")):
    im = Image.open(path).convert("RGB")
    im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    frames.append(im)

# One shared palette keeps colours stable from frame to frame
sample = Image.new("RGB", (width * 4, frames[0].height))
for i, k in enumerate([0, len(frames) // 3, 2 * len(frames) // 3, len(frames) - 1]):
    sample.paste(frames[k], (i * width, 0))
palette = sample.quantize(colors=160, method=Image.MEDIANCUT)
quantised = [f.quantize(palette=palette, dither=Image.NONE) for f in frames]
quantised[0].save(out, save_all=True, append_images=quantised[1:], duration=round(1000 / fps), loop=0, optimize=True)
print(out, len(frames), "frames")
