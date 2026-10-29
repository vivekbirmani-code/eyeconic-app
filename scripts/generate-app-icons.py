"""Generate every app icon/logo asset from the committed logo master.

Source of truth: assets/images/logo-master.png - a 2048x2048 crop of the
official Bhagat Maths crest poster ("BM BATCH POSTER Square") on which the
crest emblem (shield + owl + side flags + BM scroll) occupies 58% of the
canvas side, matching the Android adaptive-icon safe zone. The poster's own
dark-teal background is kept around the emblem so every derived asset stays
a continuous crop of the original artwork - nothing is redrawn or
recomposited.

Outputs (all regenerated, never edit by hand):
  assets/images/Logo.png                     1024x1024 opaque, emblem 76% (in-app logo; NOT the splash
                                              source anymore — see SPLASH_BACKGROUND below)
  assets/images/icon.png                     1024x1024 opaque, emblem 72% (launcher icon / iOS)
  assets/images/adaptive-icon-foreground.png 1024x1024 opaque, emblem 58% (Android adaptive foreground)
  assets/images/favicon.png                  48x48 web favicon
  client/public/Logo.png + favicon.png       copies for the public web client
  android/app/src/main/res/...               mipmap webp icons + splashscreen_logo pngs (when android/ exists;
                                              the splash pngs stay the real logo so restoring the native logo
                                              splash locally is just the styles.xml + colors.xml notes there)

NOT regenerated here (deliberate): assets/images/splash-blank.png — the fully
transparent app.json splash.image. Keep it transparent and committed; it is
what makes expo prebuild / EAS builds produce a logo-less native splash
(prebuild flattens it onto the splash backgroundColor, i.e. the icon becomes
an invisible same-color tile). Restore the logo splash by pointing app.json's
splash.image back to ./assets/images/Logo.png.

Also re-syncs the branding background colors. Since the standalone logo-only
native splash was retired (2026-10-29: transparent splash icon + teal
background handing off to the CinematicSplash), the SPLASH background stays
pinned to the CinematicSplash teal (SPLASH_BACKGROUND) — only the ADAPTIVE
ICON background follows the artwork: app.json adaptiveIcon backgroundColor
and the matching iconBackground entry in android colors.xml. app.json's
splash.backgroundColor is re-pinned to SPLASH_BACKGROUND on every run so a
hand edit can't drift, and android colors.xml's splashscreen_background is
likewise kept in sync with it.
"""

from __future__ import annotations

import re
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets" / "images"
MASTER_PATH = ASSETS / "logo-master.png"

# Emblem height as a fraction of the master canvas side (1895px of 3266px source).
EMBLEM_FRACTION = 0.5802
# Emblem height as a fraction of each output canvas.
LOGO_SCALE = 0.76  # in-app logo: generous, corners are cropped by circular containers
ICON_SCALE = 0.72  # launcher icon: balanced store / home-screen look
ADAPTIVE_SCALE = 0.58  # Android adaptive icon safe zone (~66% circle, artwork inside)

ANDROID_RES = ROOT / "android" / "app" / "src" / "main" / "res"
CLIENT_PUBLIC = ROOT / "client" / "public"

LAUNCHER_PX = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
FOREGROUND_PX = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}
SPLASH_PX = {"mdpi": 288, "hdpi": 432, "xhdpi": 576, "xxhdpi": 864, "xxxhdpi": 1152}

# Native splash background: matches the CinematicSplash (app/index.tsx) base
# teal so the (logo-less) splash hands off to the startup animation with no
# color jump. NOT artwork-derived — see module docstring.
SPLASH_BACKGROUND = "#01b4ae"


def emblem_at(master: Image.Image, scale: float, canvas: int) -> Image.Image:
    """Center-crop the master so the emblem fills `scale` of the crop, resize to canvas."""
    crop_side = min(round(master.width * EMBLEM_FRACTION / scale), master.width)
    offset = (master.width - crop_side) // 2
    img = master.crop((offset, offset, offset + crop_side, offset + crop_side))
    return img.resize((canvas, canvas), Image.Resampling.LANCZOS)


def circular_mask(size: int) -> Image.Image:
    """Antialiased circle alpha mask touching the canvas edges."""
    big = 4
    mask = Image.new("L", (size * big, size * big), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, size * big - 1, size * big - 1), fill=255)
    return mask.resize((size, size), Image.Resampling.LANCZOS)


def median_border_hex(img: Image.Image) -> str:
    """Median color of the outer 3% frame - the artwork's own backdrop color."""
    ring = max(round(img.width * 0.03), 8)
    regions = (
        (0, 0, img.width, ring),
        (0, img.height - ring, img.width, img.height),
        (0, ring, ring, img.height - ring),
        (img.width - ring, ring, img.width, img.height - ring),
    )
    channels: list[bytes] = [[] for _ in range(3)]
    for box in regions:
        data = img.crop(box).tobytes()
        for i in range(3):
            channels[i].extend(data[i::3])
    rgb = tuple(sorted(c)[len(c) // 2] for c in channels)
    return "#{:02x}{:02x}{:02x}".format(*rgb)


def sync_colors(hex_color: str) -> None:
    """Sync branding background colors: adaptive icon follows the artwork,
    splash stays pinned to the CinematicSplash teal (see module docstring)."""
    app_json = ROOT / "app.json"
    text = app_json.read_text(encoding="utf-8")
    for section, color, expected in (("splash", SPLASH_BACKGROUND, 1), ("adaptiveIcon", hex_color, 1)):
        text, n = re.subn(
            rf'("{section}"\s*:\s*\{{[^{{}}]*?"backgroundColor"\s*:\s*")#[0-9a-fA-F]{{6}}(")',
            rf"\g<1>{color}\g<2>",
            text,
        )
        if n != expected:
            raise RuntimeError(f"app.json: '{section}' backgroundColor matched {n} times, expected {expected}")
    app_json.write_text(text, encoding="utf-8")

    colors_xml = ANDROID_RES / "values" / "colors.xml"
    if colors_xml.exists():
        xml = colors_xml.read_text(encoding="utf-8")
        for name, color in (("splashscreen_background", SPLASH_BACKGROUND), ("iconBackground", hex_color)):
            xml, n = re.subn(
                rf'(<color name="{name}">)#[0-9a-fA-F]{{6}}(</color>)', rf"\g<1>{color}\g<2>", xml
            )
            if n != 1:
                raise RuntimeError(f"colors.xml: '{name}' matched {n} times, expected 1")
        colors_xml.write_text(xml, encoding="utf-8")


def main() -> None:
    master = Image.open(MASTER_PATH).convert("RGB")
    if master.size != (2048, 2048):
        raise RuntimeError(f"unexpected master size {master.size}, expected 2048x2048")

    logo = emblem_at(master, LOGO_SCALE, 1024)
    logo.save(ASSETS / "Logo.png", optimize=True)

    icon = emblem_at(master, ICON_SCALE, 1024)
    icon.save(ASSETS / "icon.png", optimize=True)

    adaptive = emblem_at(master, ADAPTIVE_SCALE, 1024)
    adaptive.save(ASSETS / "adaptive-icon-foreground.png", optimize=True)

    favicon = icon.resize((48, 48), Image.Resampling.LANCZOS)
    favicon.save(ASSETS / "favicon.png", optimize=True)

    if CLIENT_PUBLIC.exists():
        logo.save(CLIENT_PUBLIC / "Logo.png", optimize=True)
        favicon.save(CLIENT_PUBLIC / "favicon.png", optimize=True)

    hex_color = median_border_hex(logo)
    sync_colors(hex_color)
    print(f"backdrop color: {hex_color}")

    if ANDROID_RES.exists():
        icon_round = icon.convert("RGBA")
        icon_round.putalpha(circular_mask(1024))
        for dpi, size in LAUNCHER_PX.items():
            icon.resize((size, size), Image.Resampling.LANCZOS).save(
                ANDROID_RES / f"mipmap-{dpi}" / "ic_launcher.webp", lossless=True
            )
            icon_round.resize((size, size), Image.Resampling.LANCZOS).save(
                ANDROID_RES / f"mipmap-{dpi}" / "ic_launcher_round.webp", lossless=True
            )
        for dpi, size in FOREGROUND_PX.items():
            adaptive.resize((size, size), Image.Resampling.LANCZOS).save(
                ANDROID_RES / f"mipmap-{dpi}" / "ic_launcher_foreground.webp", lossless=True
            )
        for dpi, size in SPLASH_PX.items():
            logo.resize((size, size), Image.Resampling.LANCZOS).save(
                ANDROID_RES / f"drawable-{dpi}" / "splashscreen_logo.png", optimize=True
            )

    print("Generated Logo.png, icon.png, adaptive-icon-foreground.png, favicon.png"
          + (", client copies, android res" if ANDROID_RES.exists() else ""))


if __name__ == "__main__":
    main()
