#!/usr/bin/env python3
"""
GEOS-5 FP 化学场烘焙(nullschool 空气质量组同源数据):
NASA GMAO OPeNDAP 免账号直读(0.3125°×0.25°,3 小时步长,发布滞后 ~4h)
  - tavg3_2d_aer_Nx:GOCART 气溶胶地表质量浓度 kg/m³(沙尘/PM/硫酸盐/SO2/NH3/OC/BC/硝酸盐)
  - tavg3_2d_chm_Nx:CO2 地表浓度(已是 ppmv,免换算)
→ 降采样 0.5° → per-var 静态包(dist/data/chem_raw/<runKey>/)。

用法:python3 tools/bake-chem.py dist/data
产物:chem_raw/<YYYYMMDD>-<HH>/meta.json + v_*.json(与 build-static per-var 格式一致)
说明:取最近 2 个共同时次(12h 窗口内的 3h 步长);缺测(1e15)→ NaN → -32768。
"""
import base64
import json
import os
import sys
from datetime import datetime, timezone

import numpy as np
import netCDF4
from netCDF4 import num2date

BASE = 'https://opendap.nccs.nasa.gov/dods/GEOS-5/fp/0.25_deg/assim/'
SRC = {'aer': BASE + 'tavg3_2d_aer_Nx', 'chm': BASE + 'tavg3_2d_chm_Nx'}

NI, NJ = 576, 361   # 0.5° 全球网格(lon 0..359.5 / lat 90..-90)
FRAMES = 2          # 取最近 2 个共同时次(当前 + 3h 前)

# 图层键 → (源集合, 源变量, scale, 描述, 换算)  conv='kgug':kg/m³→µg/m³;
# 'ppbv2ug':ppbv→µg/m³(25°C/1atm);None:原值直出
VARS = {
    'dust':  ('aer', 'dusmass',   10,  '沙尘地表质量浓度 µg/m³', 'kgug'),
    'pm25':  ('aer', 'pm25',      10,  'PM2.5 地表质量浓度 µg/m³', 'kgug'),
    'pmtot': ('aer', 'pm',        10,  'PM 总量地表质量浓度 µg/m³', 'kgug'),
    'so2':   ('aer', 'so2smass',  10,  'SO2 地表质量浓度 µg/m³', 'kgug'),
    'so4':   ('aer', 'so4smass',  10,  '硫酸盐地表质量浓度 µg/m³', 'kgug'),
    'nh3':   ('aer', 'nh3smass',  100, '氨地表质量浓度 µg/m³', 'kgug'),
    'oc':    ('aer', 'ocsmass',   10,  '有机碳(烟)地表质量浓度 µg/m³', 'kgug'),
    'bc':    ('aer', 'bcsmass',   10,  '黑碳地表质量浓度 µg/m³', 'kgug'),
    'ni':    ('aer', 'nismass',   100, '硝酸盐地表质量浓度 µg/m³', 'kgug'),
    'co':    ('chm', 'cosc',      1,   'CO 地表浓度 µg/m³(体积比 ppbv × 1.145)', 'ppbv2ug'),
    'co2':   ('chm', 'co2sc',     10,  'CO2 地表浓度 ppmv(GEOS 直出,免换算)', None),
}
KGUG = 1e9  # kg/m³ → µg/m³


def open_ds(url: str, tries: int = 3):
    last = None
    for i in range(tries):
        try:
            return netCDF4.Dataset(url)
        except Exception as e:  # DAP 偶发超时,退避重试
            last = e
            import time
            time.sleep(5 * (i + 1))
    raise RuntimeError(f'OPeNDAP 打不开 {url}: {last}')


def grid_of(ds, var, ti: int, conv) -> np.ndarray:
    """[ti, lat, lon] → 0.5° N→S / lon 0..360 网格;conv='kgug' 时 kg/m³ → µg/m³"""
    a = ds[var][ti, :, :]
    a = np.ma.filled(a, np.nan).astype(np.float64)
    a[a >= 1.0e15] = np.nan
    lats = np.asarray(ds['lat'][:], dtype=np.float64)
    lons = np.asarray(ds['lon'][:], dtype=np.float64)
    if lats[0] < lats[-1]:
        a = a[::-1, :]  # 统一 N→S
        lats = lats[::-1]
    if lons[0] > 0 or lons[-1] <= 0:  # -180..180 → roll 到 0..360
        shift = int(np.argmin(np.abs(lons - (-180.0))))
        a = np.roll(a, -shift, axis=1)
    a = a[::2, ::2]  # 0.25°×0.3125° → 0.5°
    if conv == 'kgug':
        return a * KGUG
    if conv == 'ppbv2ug':
        return a * 1.145  # ppbv → µg/m³(25°C,1atm,M_CO=28.01)
    return a


def main():
    out_root = sys.argv[1] if len(sys.argv) > 1 else 'dist/data'
    dss = {}
    for key, url in SRC.items():
        try:
            dss[key] = open_ds(url)
        except RuntimeError as e:
            if key == 'aer':
                sys.exit(str(e))  # 主集合不可用,放弃本轮
            print(f'  [chem] 警告:{e};本轮跳过 co2')

    # 时间轴对齐:两个集合纪元不同,必须解码成真实时刻(POSIX 秒)再求交集
    def posix_of(ds):
        t = ds['time']
        d = num2date(t[:], t.units, getattr(t, 'calendar', 'standard'))
        return np.asarray(netCDF4.date2num(d, 'seconds since 1970-01-01', 'standard'), dtype=np.int64)

    asec = posix_of(dss['aer'])
    take = asec[-FRAMES:]
    if 'chm' in dss:
        cset = {int(x) for x in posix_of(dss['chm'])}
        take = np.asarray([x for x in take if int(x) in cset], dtype=np.int64)
    if len(take) == 0:
        sys.exit('aer 与 chm 无共同时次,放弃')
    stamps = [num2date(x, 'seconds since 1970-01-01', 'standard') for x in take]
    times = [f'{s.year:04d}-{s.month:02d}-{s.day:02d}T{s.hour:02d}:{s.minute:02d}' for s in stamps]
    print(f'  [chem] 时次:{times}')

    frames = {}  # var → [帧, ...]
    for var, (src, sname, _, desc, conv) in VARS.items():
        if src not in dss:
            print(f'  [chem] 跳过 {var}(源集合不可用)')
            continue
        ds = dss[src]
        sec = posix_of(ds)
        try:
            idx = [int(np.where(sec == int(x))[0][0]) for x in take]
        except IndexError:
            print(f'  [chem] 跳过 {var}(时次缺)')
            continue
        try:
            fs = [grid_of(ds, sname, i, conv) for i in idx]
            if var == 'co2':  # 保守钳制到物理范围(防归档异常值)
                for f in fs:
                    f[(f < 350) | (f > 600)] = np.nan
            if var == 'co':   # CO 背景约 100-200 µg/m³,火羽流可上万;钳掉负值与归档异常
                for f in fs:
                    f[(f < 0) | (f > 40000)] = np.nan
            peak = max(float(np.nanmax(f)) for f in fs)
            frames[var] = fs
            print(f'  [chem] {var}({desc})完成,峰值 {peak:.2f}')
        except Exception as e:
            print(f'  [chem] {var} 失败:{e}')

    if not frames:
        sys.exit('无任何变量成功,放弃')

    latest = stamps[-1]
    run_key = f'{latest.year:04d}{latest.month:02d}{latest.day:02d}-{(latest.hour // 3) * 3:02d}'
    out_dir = os.path.join(out_root, 'chem_raw', run_key)
    os.makedirs(out_dir, exist_ok=True)

    meta = {
        'model': 'chem_raw', 'runKey': run_key, 'times': times,
        'generated': int(datetime.now(timezone.utc).timestamp()),
        'format': 'per-var',
        'grid': {'ni': NI, 'nj': NJ, 'lon0': 0, 'dlon': 0.5, 'lat0': 90, 'dlat': 0.5},
        'vars': {},
    }
    for var, fs in frames.items():
        stack = np.stack(fs)
        scale = VARS[var][2]
        q = np.where(np.isnan(stack), -32768,
                     np.clip(np.round(stack * scale), -32767, 32767)).astype(np.int16)
        b64 = base64.b64encode(q.tobytes()).decode()
        meta['vars'][var] = {'scale': scale, 'file': f'v_{var}.json'}
        with open(os.path.join(out_dir, f'v_{var}.json'), 'w') as f:
            json.dump({'scale': scale, 'data': b64}, f)
        mb = os.path.getsize(os.path.join(out_dir, f'v_{var}.json')) / 1e6
        print(f'  [chem] v_{var}.json {mb:.2f} MB')

    with open(os.path.join(out_dir, 'meta.json'), 'w') as f:
        json.dump(meta, f)
    total = sum(os.path.getsize(os.path.join(out_dir, f)) for f in os.listdir(out_dir)) / 1e6
    print(f'  [chem] chem_raw/{run_key} 完成:{len(frames)} 变量 × {len(times)} 帧,共 {total:.1f} MB')


if __name__ == '__main__':
    main()
