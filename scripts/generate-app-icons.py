"""Generate mobile app icon assets from Logo.png with correct safe-zone padding."""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets" / "images"
LOGO_PATH = ASSETS / "Logo.png"
BRAND_TEAL = (1, 180, 174, 255)  # #01b4ae

# Android adaptive icons mask the outer ~17% on each side; keep artwork in ~58%.
ADAPTIVE_SCALE = 0.58
# iOS squircle mask is less aggressive; 72% gives a balanced store/home-screen look.
ICON_SCALE = 0.72


def remove_white_background(img: Image.Image, threshold: int = 245) -> Image.Image:
    rgba = img.convert("RGBA")
    arr = np.array(rgba)
    white = (arr[:, :, 0] > threshold) & (arr[:, :, 1] > threshold) & (arr[:, :, 2] > threshold)
    arr[white, 3] = 0
    return Image.fromarray(arr)


def scale_and_center(img: Image.Image, canvas_size: int, scale: float) -> Image.Image:
    target = int(round(canvas_size * scale))
    resized = img.resize((target, target), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    offset = (canvas_size - target) // 2
    canvas.paste(resized, (offset, offset), resized)
    return canvas


def main() -> None:
    logo = Image.open(LOGO_PATH)
    logo_no_bg = remove_white_background(logo)

    adaptive_fg = scale_and_center(logo_no_bg, 1024, ADAPTIVE_SCALE)
    adaptive_fg.save(ASSETS / "adaptive-icon-foreground.png", optimize=True)

    icon_fg = scale_and_center(logo_no_bg, 1024, ICON_SCALE)
    icon = Image.new("RGBA", (1024, 1024), BRAND_TEAL)
    icon.paste(icon_fg, (0, 0), icon_fg)
    icon.save(ASSETS / "icon.png", optimize=True)

    favicon = icon.resize((48, 48), Image.Resampling.LANCZOS)
    favicon.save(ASSETS / "favicon.png", optimize=True)

    print("Generated icon.png, adaptive-icon-foreground.png, and favicon.png")


if __name__ == "__main__":
    main()
