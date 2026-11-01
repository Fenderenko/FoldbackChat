"""Icons of the app, drawn in pure Python (no PIL): the leaf mark — a circle with one sharp corner.

assets/icon<N>.png       light leaf on a dark rounded tile (exe, windows, settings page)
assets/tray-light<N>.png light leaf alone, for a dark taskbar
assets/tray-dark<N>.png  dark leaf alone, for a light taskbar
"""
import os
import struct
import zlib

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'assets')
TILE = (0x12, 0x12, 0x12)
LIGHT = (0xF4, 0xF4, 0xF4)
DARK = (0x14, 0x14, 0x14)
APP_SIZES = [16, 24, 32, 48, 256]
TRAY_SIZES = [16, 20, 24, 32, 40, 48]


def leaf(x, y):
    """Leaf in a 24-unit box: circle r 9 at the centre, the lower-left quarter square (corner rounded by 1.6)."""
    if (x - 12) ** 2 + (y - 12) ** 2 <= 81:
        return True
    if 3 <= x <= 12 and 12 <= y <= 21:
        r = 1.6
        if x < 3 + r and y > 21 - r:
            return (x - (3 + r)) ** 2 + (y - (21 - r)) ** 2 <= r * r
        return True
    return False


def rounded(x, y, size, r):
    """Rounded square 0..size with corner radius r."""
    cx = min(max(x, r), size - r)
    cy = min(max(y, r), size - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def render(size, glyph_scale, fg, tile):
    """RGBA rows; the glyph (24-unit box) is scaled to glyph_scale of the canvas and centred."""
    ss = 16 if size <= 48 else 4
    unit = size * glyph_scale / 24.0
    off = (size - 24 * unit) / 2.0
    radius = size * 0.22
    rows = []
    for py in range(size):
        row = bytearray()
        for px in range(size):
            g = t = 0
            for sy in range(ss):
                for sx in range(ss):
                    x = px + (sx + 0.5) / ss
                    y = py + (sy + 0.5) / ss
                    if tile and rounded(x, y, size, radius):
                        t += 1
                    if leaf((x - off) / unit, (y - off) / unit):
                        g += 1
            n = ss * ss
            ga = g / n
            if tile:
                ta = t / n
                # Glyph lies inside the tile: blend over the tile colour, alpha is the tile's.
                rgb = [round(fg[i] * ga + tile[i] * (1 - ga)) if ta else 0 for i in range(3)]
                a = round(255 * ta)
            else:
                rgb = list(fg)
                a = round(255 * ga)
            row += bytes(rgb + [a])
        rows.append(bytes(row))
    return rows


def png(rows, size):
    raw = b''.join(b'\x00' + r for r in rows)
    chunk = lambda tag, data: struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')


def save(name, rows, size):
    with open(os.path.join(ROOT, name), 'wb') as f:
        f.write(png(rows, size))


if __name__ == '__main__':
    for s in APP_SIZES:
        save(f'icon{s}.png', render(s, 0.8, LIGHT, TILE), s)
    for s in TRAY_SIZES:
        save(f'tray-light{s}.png', render(s, 1.0, LIGHT, None), s)
        save(f'tray-dark{s}.png', render(s, 1.0, DARK, None), s)
    print('ok')
