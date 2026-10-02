#!/usr/bin/env python3
"""
OISST 海温烘焙:NOAA OISST v2.1 日更分析场(NCEI,0.25° NetCDF4)
→ 降采样 0.5° → per-var 静态包(dist/data/ocean_raw/<runKey>/)。

用法:python3 tools/bake-sst.py dist/data
产物:ocean_raw/<YYYYMMDD>-00/meta.json + v_sst.json(与 build-static per-var 格式一致)
说明:取最近 2 个可用日(发布滞后,昨天优先、失败回退前天);陆地掩膜 → NaN(-32768)。
"""
import base64
import json
import os
import ssl
import sys
import urllib.request
from datetime import date, timedelta

import numpy as np

# 仅本地调试用(无 CA 的 python 环境);CI 不设置,保持证书校验
if os.environ.get("SST_INSECURE"):
    ssl._create_default_https_context = ssl._create_unverified_context

try:
    from netCDF4 import Dataset
except ImportError:
    sys.exit("需要 netCDF4:pip install netCDF4 numpy")

BASE = ("https://www.ncei.noaa.gov/data/sea-surface-temperature-optimum-interpolation"
        "/v2.1/access/avhrr/{ym}/oisst-avhrr-v02r01.{ymd}{suffix}.nc")
UA = {"User-Agent": "fy-earth-sst/1.0 (weather viz; contact: repo owner)"}

NI, NJ = 720, 361         # 0.5° 全球网格 0..359.5 / 90..-90(海岸细节,配合前端陆地遮罩)
SCALE = 100               # 0.01°C 量化


def fetch_day(d: date, out_tmp: str) -> str | None:
    """先取正式版文件,再试 preliminary(近 2 周内只有 preliminary)"""
    for suffix in ("", "_preliminary"):
        url = BASE.format(ym=d.strftime("%Y%m"), ymd=d.strftime("%Y%m%d"), suffix=suffix)
        for attempt in range(2):
            try:
                req = urllib.request.Request(url, headers=UA)
                with urllib.request.urlopen(req, timeout=240) as r, open(out_tmp, "wb") as f:
                    while True:
                        chunk = r.read(1 << 20)
                        if not chunk:
                            break
                        f.write(chunk)
                if os.path.getsize(out_tmp) > 1_000_000:
                    return out_tmp
            except Exception as e:
                if attempt == 1 and suffix == "_preliminary":
                    print(f"  [sst] {d} 不可用:{e}")
                if "404" in str(e):
                    break  # 换文件名,不再重试
    return None


def decode(path: str):
    """文件 → (sst, ssta) 两个 144×73 °C 网格(行 0 = 90N,列 0 = 0E);距平变量缺失时 ssta 为 None"""
    with Dataset(path) as ds:
        arr = ds["sst"][:]  # 自动 scale/offset → °C;维度 (time, zlev, lat, lon)
        if np.ma.isMaskedArray(arr):
            arr = arr.filled(np.nan)
        grid = np.asarray(arr[0, 0], dtype=np.float64)
        try:
            an = ds["anom"][:]  # OISST v2.1 自带:相对 1991-2020 气候态的距平(nullschool SSTA 同源)
            if np.ma.isMaskedArray(an):
                an = an.filled(np.nan)
            grid_a = np.asarray(an[0, 0], dtype=np.float64)
        except (KeyError, IndexError):
            grid_a = None
        lats = np.asarray(ds["lat"][:], dtype=np.float64)
        lons = np.asarray(ds["lon"][:], dtype=np.float64)
    if lats[0] < lats[-1]:
        grid = grid[::-1, :]  # 统一为 N→S
        if grid_a is not None:
            grid_a = grid_a[::-1, :]
        lats = lats[::-1]

    def sample(g):
        out = np.full((NJ, NI), np.nan)
        for j in range(NJ):
            target_lat = 90.0 - j * 0.5
            si = int(np.clip(round((lats[0] - target_lat) / 0.25), 0, len(lats) - 1))
            row = g[si]
            for i in range(NI):
                target_lon = i * 0.5
                sj = int(round(((target_lon - lons[0]) % 360) / 0.25)) % len(lons)
                out[j, i] = row[sj]
        return out

    return sample(grid), (sample(grid_a) if grid_a is not None else None)


def main():
    out_root = sys.argv[1] if len(sys.argv) > 1 else "dist/data"
    days = []
    import datetime as _dt
    now = _dt.datetime.now(_dt.timezone.utc).date()
    for off in (1, 2, 3):  # 昨天 → 前天 → 大前天,取最先成功的 2 个
        d = now - timedelta(days=off)
        tmp = f"/tmp/oisst-{d.strftime('%Y%m%d')}.nc"
        if fetch_day(d, tmp):
            days.append((d, tmp))
        if len(days) == 2:
            break
    if not days:
        sys.exit("OISST 连续 3 日均不可用,放弃")

    days.sort(key=lambda x: x[0])  # 时间升序
    frames, frames_a, times = [], [], []
    for d, path in days:
        s, a = decode(path)
        frames.append(s)
        frames_a.append(a)
        times.append(d.strftime("%Y-%m-%dT12:00"))
        print(f"  [sst] 已解码 {d}(海温 {np.nanmin(s):.1f}~{np.nanmax(s):.1f} °C)")

    stack = np.stack(frames)  # (nT, NJ, NI)
    nT = stack.shape[0]
    q = np.where(np.isnan(stack), -32768, np.clip(np.round(stack * SCALE), -32767, 32767)).astype(np.int16)
    b64 = base64.b64encode(q.tobytes()).decode()
    have_a = all(a is not None for a in frames_a)
    b64_a = None
    if have_a:
        stack_a = np.stack(frames_a)
        q_a = np.where(np.isnan(stack_a), -32768, np.clip(np.round(stack_a * SCALE), -32767, 32767)).astype(np.int16)
        b64_a = base64.b64encode(q_a.tobytes()).decode()
        print(f"  [sst] 海温距平完成({np.nanmin(stack_a):.2f}~{np.nanmax(stack_a):.2f} °C)")

    latest = days[-1][0]
    run_key = latest.strftime("%Y%m%d") + "-00"
    out_dir = os.path.join(out_root, "ocean_raw", run_key)
    os.makedirs(out_dir, exist_ok=True)

    generated = int(_dt.datetime.now(_dt.timezone.utc).timestamp())
    meta = {
        "model": "ocean_raw", "runKey": run_key,
        "times": times, "generated": generated, "format": "per-var",
        "grid": {"ni": NI, "nj": NJ, "lon0": 0, "dlon": 0.5, "lat0": 90, "dlat": 0.5},
        "vars": {"sst": {"scale": SCALE, "file": "v_sst.json"}},
    }
    if have_a:
        meta["vars"]["ssta"] = {"scale": SCALE, "file": "v_ssta.json"}
    with open(os.path.join(out_dir, "meta.json"), "w") as f:
        json.dump(meta, f)
    with open(os.path.join(out_dir, "v_sst.json"), "w") as f:
        json.dump({"scale": SCALE, "data": b64}, f)
    if have_a:
        with open(os.path.join(out_dir, "v_ssta.json"), "w") as f:
            json.dump({"scale": SCALE, "data": b64_a}, f)
    mb = os.path.getsize(os.path.join(out_dir, "v_sst.json")) / 1e6
    extra = f" + v_ssta.json {os.path.getsize(os.path.join(out_dir, 'v_ssta.json')) / 1e6:.2f} MB" if have_a else ""
    print(f"  [sst] ocean_raw/{run_key} 完成:{nT} 帧,v_sst.json {mb:.2f} MB{extra}")


if __name__ == "__main__":
    main()
