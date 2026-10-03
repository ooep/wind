#!/usr/bin/env python3
"""GRIB2 消息 → JSON 元数据 + float32 数值流(供 Node 端对 JS 解码器不认识的
数据表示模板(如 ECMWF 新输出的 5.42 CCSDS 压缩)做兜底解码。

用法:python3 ecc.py <message.grib2>
输出:stdout = 第一行 JSON({ni,nj,la1,lo1,la2,lo2,dlon,dlat,scan}) + 其后 float32 小端数值
依赖:pip install eccodes(轮子内置 ecCodes 二进制,免系统依赖)
"""
import json
import sys

from eccodes import (
    codes_new_from_message,
    codes_get,
    codes_get_values,
    codes_release,
)


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: ecc.py <message.grib2>", file=sys.stderr)
        return 2
    with open(sys.argv[1], "rb") as f:
        gid = codes_new_from_message(f.read())
    if not gid:
        print("ecc.py: 不是有效的 GRIB 消息", file=sys.stderr)
        return 1
    try:
        ni = int(codes_get(gid, "Ni"))
        nj = int(codes_get(gid, "Nj"))
        meta = {
            "ni": ni,
            "nj": nj,
            "la1": float(codes_get(gid, "latitudeOfFirstGridPointInDegrees")),
            "lo1": float(codes_get(gid, "longitudeOfFirstGridPointInDegrees")),
            "la2": float(codes_get(gid, "latitudeOfLastGridPointInDegrees")),
            "lo2": float(codes_get(gid, "longitudeOfLastGridPointInDegrees")),
            "dlon": float(codes_get(gid, "longitudeDirectionInDegrees")
                          if False else codes_get(gid, "iDirectionIncrementInDegrees")),
            "dlat": float(codes_get(gid, "jDirectionIncrementInDegrees")),
            "scan": int(codes_get(gid, "scanningMode")),
        }
        vals = codes_get_values(gid)  # numpy float64,扫描序与消息一致
        sys.stdout.write(json.dumps(meta) + "\n")
        sys.stdout.flush()  # text 层与 binary 层缓冲独立,不 flush 会乱序
        sys.stdout.buffer.write(vals.astype("<f4").tobytes())
        sys.stdout.buffer.flush()
        return 0
    finally:
        codes_release(gid)


if __name__ == "__main__":
    sys.exit(main())
