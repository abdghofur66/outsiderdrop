#!/usr/bin/env python3
"""Buat semua ikon OutsiderDrop + lencana logo OutsiderDev.

Pemakaian: python3 scripts/make_icons.py [logo.png]
Tanpa logo (mis. offline), ikon dibuat tanpa lencana.
Hasil: public/icon-192.png, public/icon-512.png, public/favicon.png,
       build/icon.ico (exe Windows), ikon peluncur Android (mipmap-*).
"""
import os
import sys
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BRAND = (11, 122, 117, 255)   # #0b7a75
SS = 4                        # supersampling agar garis halus


def arrow(draw, cx, cy, s, width):
    """Panah unduh: batang, kepala panah, dan garis dasar (sama dengan icon.svg)."""
    w = (255, 255, 255, 255)
    top, mid = cy - 0.30 * s, cy + 0.10 * s
    draw.line([(cx, top), (cx, mid)], fill=w, width=width)
    draw.line([(cx - 0.17 * s, mid - 0.17 * s), (cx, mid), (cx + 0.17 * s, mid - 0.17 * s)], fill=w, width=width, joint='curve')
    draw.line([(cx - 0.25 * s, cy + 0.30 * s), (cx + 0.25 * s, cy + 0.30 * s)], fill=w, width=width)
    r = width / 2
    for x, y in [(cx, top), (cx - 0.17 * s, mid - 0.17 * s), (cx + 0.17 * s, mid - 0.17 * s),
                 (cx - 0.25 * s, cy + 0.30 * s), (cx + 0.25 * s, cy + 0.30 * s), (cx, mid)]:
        draw.ellipse([x - r, y - r, x + r, y + r], fill=w)


def badge(logo, d):
    """Lencana bulat putih berisi logo OutsiderDev, dengan bayangan lembut."""
    pad = int(d * 0.12)
    canvas = Image.new('RGBA', (d + pad * 2, d + pad * 2), (0, 0, 0, 0))
    sh = Image.new('RGBA', canvas.size, (0, 0, 0, 0))
    ImageDraw.Draw(sh).ellipse([pad, pad + d * 0.04, pad + d, pad + d + d * 0.04], fill=(0, 0, 0, 90))
    canvas.alpha_composite(sh.filter(ImageFilter.GaussianBlur(d * 0.05)))
    ImageDraw.Draw(canvas).ellipse([pad, pad, pad + d, pad + d], fill=(255, 255, 255, 255))
    inner = int(d * 0.74)
    k = inner / max(logo.width, logo.height)   # perbesar/perkecil agar pas
    lg = logo.resize((max(1, round(logo.width * k)), max(1, round(logo.height * k))), Image.LANCZOS)
    canvas.alpha_composite(lg, (pad + (d - lg.width) // 2, pad + (d - lg.height) // 2))
    return canvas, pad


def full_icon(size, logo, rounded=True):
    """Ikon persegi utuh (web, exe, Android lama)."""
    S = size * SS
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    dr = ImageDraw.Draw(im)
    if rounded:
        dr.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.23), fill=BRAND)
    else:
        dr.rectangle([0, 0, S, S], fill=BRAND)
    shift = 0.08 if logo else 0
    arrow(dr, S * (0.5 - shift), S * (0.5 - shift), S * 0.78, int(S * 0.085))
    if logo:
        d = int(S * 0.46)
        b, pad = badge(logo, d)
        im.alpha_composite(b, (S - d - int(S * 0.03) - pad, S - d - int(S * 0.03) - pad))
    return im.resize((size, size), Image.LANCZOS)


def adaptive_fg(size, logo):
    """Lapisan depan ikon adaptif Android: isi di zona aman (66% tengah), latar transparan."""
    S = size * SS
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    dr = ImageDraw.Draw(im)
    safe = S * 0.62
    shift = 0.04 if logo else 0
    arrow(dr, S * (0.5 - shift), S * (0.5 - shift), safe * 0.78, int(S * 0.055))
    if logo:
        d = int(S * 0.27)
        b, pad = badge(logo, d)
        c = S * 0.5 + safe * 0.26
        im.alpha_composite(b, (int(c - d / 2 - pad), int(c - d / 2 - pad)))
    return im.resize((size, size), Image.LANCZOS)


def main():
    logo = None
    if len(sys.argv) > 1 and os.path.exists(sys.argv[1]):
        try:
            logo = Image.open(sys.argv[1]).convert('RGBA')
            bbox = logo.getbbox()
            if bbox:
                logo = logo.crop(bbox)
        except Exception as e:  # logo rusak: tetap buat ikon tanpa lencana
            print('Logo tidak bisa dibaca:', e)
            logo = None
    print('Lencana OutsiderDev:', 'ya' if logo else 'tidak (logo tidak tersedia)')

    pub = os.path.join(ROOT, 'public')
    full_icon(192, logo).save(os.path.join(pub, 'icon-192.png'))
    full_icon(512, logo).save(os.path.join(pub, 'icon-512.png'))
    full_icon(64, logo).save(os.path.join(pub, 'favicon.png'))

    os.makedirs(os.path.join(ROOT, 'build'), exist_ok=True)
    big = full_icon(256, logo)
    big.save(os.path.join(ROOT, 'build', 'icon.ico'), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])

    res = os.path.join(ROOT, 'android', 'app', 'src', 'main', 'res')
    for dpi, base in [('mdpi', 48), ('hdpi', 72), ('xhdpi', 96), ('xxhdpi', 144), ('xxxhdpi', 192)]:
        d = os.path.join(res, 'mipmap-' + dpi)
        os.makedirs(d, exist_ok=True)
        full_icon(base, logo).save(os.path.join(d, 'ic_launcher.png'))
        adaptive_fg(int(base * 2.25), logo).save(os.path.join(d, 'ic_launcher_foreground.png'))


if __name__ == '__main__':
    main()
