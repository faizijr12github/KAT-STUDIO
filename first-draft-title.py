from pathlib import Path
import os
import sys
from PIL import Image, ImageDraw, ImageFont

output, w, h, title = sys.argv[1:]
width, height = int(w), int(h)
image = Image.new("RGBA", (width, height))
draw = ImageDraw.Draw(image)
size = max(18, round(width * .052))
font_path = Path(os.environ.get("KAT_FONT_DIR", Path.home() / "Library/Fonts")) / "Poppins-Bold.ttf"

def load(size):
    try:
        return ImageFont.truetype(str(font_path if font_path.is_file() else "DejaVuSans-Bold.ttf"), size)
    except OSError:
        return ImageFont.load_default()

font = load(size)
while size > 16 and draw.textlength(title, font=font) > width * .78:
    size -= 2
    font = load(size)
x, y = width / 2, height * .15
box = draw.textbbox((x, y), title, font=font, anchor="mm")
padding = round(width * .021)
draw.rounded_rectangle((box[0] - padding, box[1] - padding, box[2] + padding, box[3] + padding),
                       radius=padding // 2, fill=(25, 23, 21, 222))
draw.text((x, y), title, font=font, fill="white", anchor="mm")
image.save(output)
