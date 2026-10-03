#!/usr/bin/env python3
"""
HYCOM 海流烘焙:HYCOM GLBy0.08 "latest" FMRC 集合(tds.hycom.org,零注册 OPeNDAP)
经 pydap 服务端 stride 降采样读取表面流 u/v → 最近邻重排到规则经纬网格 → per-var 静态包。

用法:
  python3 tools/bake-currents.py dist/data                       # 生产:0.5° 最近 8 个 12:00 帧
  python3 tools/bake-currents.py dist/data --deg 1 --max-frames 2  # 仓库 bootstrap 轻量包
产物:currents_raw/<YYYYMMDD>-12/meta.json + v_u.json + v_v.json + v_cur.json
说明:陆地/海底为缺测(HYCOM 填充值)→ NaN(-32768);cur = hypot(u, v)。
"""
import base64
import json
import math
import os
import re
import sys
import time
from datetime import datetime, timedelta, timezone

import numpy as np

try:
    from pydap.client import open_url
except ImportError:
    sys.exit("需要 pydap:pip install pydap numpy")

URL = "https://tds.hycom.org/thredds/dodsC/GLBy0.08/latest"
SCALE = 100  # 0.01 m/s 量化


def read_strided(var, ti, s_lat, s_lon, tries=3):
    """单帧表面流,服务端 stride 读取(HYCOM 缺测为填充值,统一清洗为 NaN)"""
    last = None
    for i in range(tries):
        try:
            a = np.asarray(var[ti, 0, ::s_lat, ::s_lon].data, dtype=np.float64)
            a = a.reshape(a.shape[-2], a.shape[-1])  # pydap 保留标量维(time/depth)→ 收成 2D
            a[(a < -10) | (a > 10)] = np.nan  # 缺测填充(HYCOM 各版本 -30000/9e36 等)一律视为无效
            return a
        except Exception as e:
            last = e
            time.sleep(5 * (i + 1))
    raise RuntimeError(f"OPeNDAP 读取失败: {last}")


def remap(grid, src_lat, src_lon, tg_lat, tg_lon):
    """最近邻重排到目标规则网格(行 0 = 北)"""
    iy = np.abs(src_lat[None, :] - tg_lat[:, None]).argmin(axis=1)
    ix = np.abs(src_lon[None, :] - tg_lon[:, None]).argmin(axis=1)
    return grid[np.ix_(iy, ix)]


def main():
    args = sys.argv[1:]
    out_root = args[0] if args and not args[0].startswith("--") else "dist/data"

    def opt(name, dflt):
        return float(args[args.index(name) + 1]) if name in args else dflt

    deg = opt("--deg", 0.5)          # 目标网格分辨率
    max_frames = int(opt("--max-frames", 8))

    NJ = int(round(170 / deg)) + 1   # 90 .. -80
    NI = int(round(360 / deg))
    tg_lat = 90 - deg * np.arange(NJ)
    tg_lon = deg * np.arange(NI)

    print(f"[currents] 打开 {URL}")
    ds = open_url(URL)
    lat = np.asarray(ds["lat"][:].data, dtype=np.float64)
    lon = np.asarray(ds["lon"][:].data, dtype=np.float64)
    tvals = np.asarray(ds["time"][:].data, dtype=np.float64)
    units = ds["time"].attributes.get("units", "")
    m = re.search(r"hours since ([\d-]+) ([\d:]+)", units)
    if not m:
        sys.exit(f"无法解析时间轴单位: {units}")
    origin = datetime.strptime(f"{m.group(1)} {m.group(2)}", "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc)

    # 选帧:距当前时刻最近的 12:00 UTC 帧起,向后取满 max_frames(分析 + 预报尾);
    # 集合末段可能远超当下,取"最后 N 帧"会全为纯预报,故以 now 为锚
    hours = np.asarray(tvals, dtype=np.int64)
    cand = [int(h) for h in hours if h % 24 == 0]
    if not cand:
        cand = [int(h) for h in hours]
    now_h = (datetime.now(timezone.utc) - origin).total_seconds() / 3600
    k = min(range(len(cand)), key=lambda i: abs(cand[i] - now_h))
    picks = cand[k:k + max_frames]
    if len(picks) < max_frames:
        need = max_frames - len(picks)
        picks = cand[max(0, k - need):k] + picks
    anchor = cand[k]
    print(f"[currents] 时间轴 {origin + timedelta(hours=float(hours[0]))} .. {origin + timedelta(hours=float(hours[-1]))},选 {len(picks)} 帧")

    u_var, v_var = ds["water_u"], ds["water_v"]
    frames_u, frames_v, times = [], [], []
    for h in picks:
        ti = int(np.where(hours == h)[0][0])
        ts = origin + timedelta(hours=float(h))
        u = read_strided(u_var, ti, 12, 6)   # 原生 0.04°lat/0.08°lon → ~0.48°
        v = read_strided(v_var, ti, 12, 6)
        s_lat = lat[::12]
        s_lon = lon[::6]
        u = remap(u, s_lat, s_lon, tg_lat, tg_lon)
        v = remap(v, s_lat, s_lon, tg_lat, tg_lon)
        frames_u.append(u)
        frames_v.append(v)
        times.append(ts.strftime("%Y-%m-%dT%H:00"))
        spd = np.hypot(u, v)
        print(f"  [currents] {ts:%Y-%m-%d %H:%M}Z 流速 {np.nanmin(spd):.2f}~{np.nanpercentile(spd, 99):.2f} m/s")

    run_dt = origin + timedelta(hours=float(anchor))
    run_key = run_dt.strftime("%Y%m%d") + "-12"
    out_dir = os.path.join(out_root, "currents_raw", run_key)
    os.makedirs(out_dir, exist_ok=True)

    generated = int(datetime.now(timezone.utc).timestamp())
    meta = {
        "model": "currents_raw", "runKey": run_key,
        "times": times, "generated": generated, "format": "per-var",
        "grid": {"ni": NI, "nj": NJ, "lon0": 0, "dlon": deg, "lat0": 90, "dlat": deg},
        "vars": {
            "u": {"scale": SCALE, "file": "v_u.json"},
            "v": {"scale": SCALE, "file": "v_v.json"},
            "cur": {"scale": SCALE, "file": "v_cur.json"},
        },
    }
    total = 0
    for vk, frames in (("u", frames_u), ("v", frames_v), ("cur", [np.hypot(a, b) for a, b in zip(frames_u, frames_v)])):
        stack = np.stack(frames)
        finite = np.isfinite(stack).sum() / stack.size
        if finite < 0.05:
            sys.exit(f"{vk} 有效值仅 {finite:.1%},判定上游不可用,放弃发布")
        q = np.where(np.isnan(stack), -32768, np.clip(np.round(stack * SCALE), -32767, 32767)).astype(np.int16)
        fp = os.path.join(out_dir, f"v_{vk}.json")
        with open(fp, "w") as f:
            json.dump({"scale": SCALE, "data": base64.b64encode(q.tobytes()).decode()}, f)
        total += os.path.getsize(fp)
        print(f"  [currents] v_{vk}.json {os.path.getsize(fp) / 1e6:.2f} MB(有效 {finite:.0%})")
    with open(os.path.join(out_dir, "meta.json"), "w") as f:
        json.dump(meta, f)
    print(f"[currents] currents_raw/{run_key} 完成:{len(picks)} 帧,{deg}°,共 {total / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
