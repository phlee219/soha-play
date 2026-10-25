"""Draw the app icons (simple chick face) without extra packages."""
import struct, zlib
from pathlib import Path

APP = Path(__file__).resolve().parent.parent / "app"

def png(size):
    bg, face, ink, beak = (255, 214, 165), (255, 205, 60), (59, 47, 42), (255, 138, 91)
    rows = []
    c = size / 2
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            px, py = (x + .5 - c) / size, (y + .5 - c) / size
            col = bg
            if px * px + py * py < .30 ** 2: col = face
            for ex in (-.1, .1):
                if (px - ex) ** 2 + (py + .05) ** 2 < .035 ** 2: col = ink
            if abs(px) < .07 - (py - .06) * .9 and .06 < py < .13: col = beak
            row += bytes(col)
        rows.append(bytes(row))
    def chunk(t, d): return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d))
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)) \
        + chunk(b"IDAT", zlib.compress(b"".join(rows), 9)) + chunk(b"IEND", b"")

for s in (192, 512):
    (APP / f"icon-{s}.png").write_bytes(png(s))
print("ok")
