#!/usr/bin/env python3
"""J2K 码流 → 原始样本流(小端 uint16),供 Node 端 GRIB2 模板 5.40 解码调用。

依赖:Pillow(pip 轮子内置 OpenJPEG)。用法:python3 j2k.py <codestream.j2k>
输出:stdout 二进制(uint16 小端,样本按扫描序)。
"""
import io
import struct
import sys

from PIL import Image


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: j2k.py <codestream>", file=sys.stderr)
        return 2
    try:
        im = Image.open(io.BytesIO(open(sys.argv[1], "rb").read()))
        im.load()
    except Exception as e:  # noqa: BLE001
        print(f"decode error: {e}", file=sys.stderr)
        return 1
    # I;16 模式:openjpeg 输出 16bit 容器,样本左对齐(高位在左)
    samples = list(im.getdata())
    sys.stdout.buffer.write(struct.pack(f"<{len(samples)}H", *samples))
    return 0


if __name__ == "__main__":
    sys.exit(main())
