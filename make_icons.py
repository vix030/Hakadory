# -*- coding: utf-8 -*-
"""Hakadory (web) のアイコン PNG を生成する。

図柄はデスクトップ版と同じにしたいので、デスクトップ版の make_icon.py の描画を
そのまま読み込んで使う（アイコンの定義を 2 か所に置かないため）。追加ライブラリは
使わない。

デスクトップ版は別のリポジトリにあるため、その場所を次の順で決める:
    1. コマンドライン引数（make_icon.py のパス、またはそれを含むフォルダ）
    2. 環境変数 HAKADORY_DESKTOP_DIR
    3. 既定値 ../02_MADEbyGPT/Hakadory/make_icon.py（このフォルダからの相対）

出力:
    icon-32.png / icon-192.png / icon-512.png  余白なし（favicon・通常表示用）
    icon-512-maskable.png                      余白あり（Android の丸型切り抜き用）

実行:
    py make_icons.py
    py make_icons.py ..\\02_MADEbyGPT\\Hakadory
"""

import importlib.util
import os
import struct
import sys
import zlib

SIZES = (32, 192, 512)
MASKABLE_SIZE = 512
MASKABLE_SCALE = 0.62  # 安全領域（中央 80% の内側）に収まる比率
BACKGROUND = (0x34, 0x36, 0x3C)  # 「標準」配色の地の色
DEFAULT_DESKTOP_DIR = os.path.join("..", "02_MADEbyGPT", "Hakadory")


def renderer_path(given=None):
    """デスクトップ版 make_icon.py の場所を、引数 → 環境変数 → 既定値 の順に決める。"""
    here = os.path.dirname(os.path.abspath(__file__))
    path = given or os.environ.get("HAKADORY_DESKTOP_DIR") or DEFAULT_DESKTOP_DIR
    if not os.path.isabs(path):
        path = os.path.join(here, path)
    if os.path.isdir(path):  # フォルダを渡されたら中の make_icon.py を使う
        path = os.path.join(path, "make_icon.py")
    return os.path.normpath(path)


def load_renderer(given=None):
    """デスクトップ版の make_icon.py を、パス指定で読み込む。"""
    path = renderer_path(given)
    if not os.path.isfile(path):
        raise SystemExit(
            "make_icon.py が見つかりません: %s\n"
            "デスクトップ版 Hakadory の場所を引数か環境変数 HAKADORY_DESKTOP_DIR "
            "で指定してください。" % path)
    spec = importlib.util.spec_from_file_location("hakadory_make_icon", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def rgba_rows(module, size):
    """make_icon.render() の BGRA を RGBA の行に並べ替える。"""
    rows = []
    for row in module.render(size):
        out = bytearray()
        for index in range(0, len(row), 4):
            blue, green, red, alpha = row[index:index + 4]
            out += bytes((red, green, blue, alpha))
        rows.append(bytes(out))
    return rows


def on_background(rows, size, scale=1.0):
    """透過部分を地の色で塗り、必要なら縮小して余白を作る。"""
    source = rows
    if scale != 1.0:
        inner = max(int(round(size * scale)), 1)
        margin = (size - inner) // 2
        blank = bytes((BACKGROUND[0], BACKGROUND[1], BACKGROUND[2], 255)) * size
        source = []
        for y in range(size):
            if y < margin or y >= margin + inner:
                source.append(blank)
                continue
            row = rows[y - margin]
            pad = bytes((BACKGROUND[0], BACKGROUND[1], BACKGROUND[2], 255))
            source.append(pad * margin + row + pad * (size - margin - inner))
        rows = source

    out = []
    for row in rows:
        line = bytearray()
        for index in range(0, len(row), 4):
            red, green, blue, alpha = row[index:index + 4]
            ratio = alpha / 255.0
            line += bytes((
                int(round(red * ratio + BACKGROUND[0] * (1 - ratio))),
                int(round(green * ratio + BACKGROUND[1] * (1 - ratio))),
                int(round(blue * ratio + BACKGROUND[2] * (1 - ratio))),
                255,
            ))
        out.append(bytes(line))
    return out


def scaled_rows(module, size, scale):
    """縮小した図柄を、地の色の正方形の中央に置く。"""
    inner = max(int(round(size * scale)), 1)
    rows = rgba_rows(module, inner)
    return on_background(rows, size, scale=float(inner) / size)


def chunk(tag, payload):
    body = tag + payload
    return struct.pack(">I", len(payload)) + body + struct.pack(">I", zlib.crc32(body))


def write_png(path, rows, size):
    raw = b"".join(b"\x00" + row for row in rows)  # フィルタなし
    data = (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9))
            + chunk(b"IEND", b""))
    with open(path, "wb") as handle:
        handle.write(data)
    return len(data)


def build(target_dir, given=None):
    module = load_renderer(given)
    written = []
    for size in SIZES:
        rows = on_background(rgba_rows(module, size), size)
        path = os.path.join(target_dir, "icon-%d.png" % size)
        written.append((path, write_png(path, rows, size)))
    rows = scaled_rows(module, MASKABLE_SIZE, MASKABLE_SCALE)
    path = os.path.join(target_dir, "icon-%d-maskable.png" % MASKABLE_SIZE)
    written.append((path, write_png(path, rows, MASKABLE_SIZE)))
    return written


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    given = sys.argv[1] if len(sys.argv) > 1 else None
    for name, size in build(here, given):
        print("wrote %s (%d bytes)" % (name, size))
