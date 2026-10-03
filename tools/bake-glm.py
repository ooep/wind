#!/usr/bin/env python3
"""烘焙 GOES GLM 卫星闪电 → dist/data/glm/latest.json

数据源:NOAA GOES-19 GLM-L2-LCFA(光总闪,闪级产品,AWS 开放数据桶零账号,无 CORS → 只能服务端烘焙)。
20 秒一个 netCDF4,取最近 WINDOW_MIN 分钟(跨 UTC 日界回退昨日前缀),并发下载提取
flash_lat/flash_lon/flash_time_offset_of_effect(quality_flag==0 为佳品)。

输出:{generated, window_min, count, points:[[lon, lat, tEpochSec]...]}(新→旧,上限 CAP)
前端:与 Blitzortung 实时流融合 —— 开图即有美洲雷(含云内闪),不用等 WebSocket 积累。
"""
import json
import os
import ssl
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

OUT = sys.argv[2] if len(sys.argv) > 2 else 'dist/data'
BUCKET = 'https://noaa-goes19.s3.amazonaws.com'
PRODUCT = 'GLM-L2-LCFA'
WINDOW_MIN = 75          # 与前端闪电保留窗(90 min)匹配,烘焙侧略收
CAP = 9000               # 点数上限(控体积)
CONC = 12
SAT = 'G19'

S3_NS = '{http://s3.amazonaws.com/doc/2006-03-01/}'
UA = {'User-Agent': 'fengyun-earth'}


def urlopen(url, timeout):
    """证书链校验失败(部分本地 python)时降级为不验证,公开只读桶无凭据风险"""
    try:
        return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout)
    except urllib.error.URLError as e:
        if not isinstance(getattr(e, 'reason', None), ssl.SSLCertVerificationError):
            raise
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout, context=ctx)


def list_keys(path_prefix):
    """列一个 DOY 前缀下的全部产品键(分页)"""
    keys = []
    token = None
    while True:
        url = f'{BUCKET}/?list-type=2&prefix={path_prefix}'
        if token:
            url += '&continuation-token=' + urllib.parse.quote(token)
        url = f'{BUCKET}/?list-type=2&prefix={path_prefix}'
        if token:
            url += '&continuation-token=' + urllib.parse.quote(token)
        with urlopen(url, 30) as r:
            root = ET.fromstring(r.read())
        for c in root.iter(S3_NS + 'Contents'):
            k = c.find(S3_NS + 'Key')
            if k is not None and k.text:
                keys.append(k.text)
        t = root.find(S3_NS + 'NextContinuationToken')
        if t is None:
            break
        token = t.text
    return keys


def scan_time(key):
    """OR_GLM-L2-LCFA_G19_s20262760307400_... → s 起扫时刻(14 位,末位十分秒,取前 13 位)"""
    i = key.find('_s')
    if i < 0:
        return None
    s = key[i + 2:i + 15]
    try:
        return datetime.strptime(s, '%Y%j%H%M%S').replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def fetch_flash(key, cutoff):
    import tempfile
    from netCDF4 import Dataset
    with urlopen(f'{BUCKET}/{key}', 60) as r:
        raw = r.read()
    out = []
    tmp = tempfile.NamedTemporaryFile(suffix='.nc', delete=False)
    try:
        tmp.write(raw)
        tmp.close()
        with Dataset(tmp.name) as nc:
            lat = nc.variables['flash_lat'][:]
            lon = nc.variables['flash_lon'][:]
            dt = nc.variables['flash_time_offset_of_first_event'][:]
            en = nc.variables['flash_energy'][:]
            try:
                qf = nc.variables['flash_quality_flag'][:]
            except KeyError:
                qf = None
            epoch = scan_time(key).timestamp()
            for i in range(len(lat)):
                if qf is not None and qf[i] != 0:
                    continue
                t = epoch + float(dt[i])
                if t < cutoff:
                    continue
                la, lo = float(lat[i]), float(lon[i])
                if -90 <= la <= 90 and -180 <= lo <= 180:
                    # 第 4 位复用为能量档:≥5kJ 强闪 → 前端画大点
                    out.append((round(lo, 2), round(la, 2), round(t), 1 if float(en[i]) >= 5000 else -1))
    finally:
        os.unlink(tmp.name)
    return out
def main():
    t0 = time.time()
    now = datetime.now(timezone.utc)
    cutoff = (now - timedelta(minutes=WINDOW_MIN)).timestamp()
    doy = now.timetuple().tm_yday
    prefixes = [f'{PRODUCT}/{now.year}/{doy:03d}/']
    if now.hour == 0 or now.hour == 23:  # 日界附近同时扫两天,防窗口缺头
        yesterday = now - timedelta(days=1)
        prefixes.append(f'{PRODUCT}/{yesterday.year}/{yesterday.timetuple().tm_yday:03d}/')

    keys = []
    for p in prefixes:
        try:
            keys.extend(list_keys(p))
        except Exception as e:
            print(f'[glm] 列举 {p} 失败: {e}', file=sys.stderr)
    cand = []
    for k in keys:
        st = scan_time(k)
        if st and st.timestamp() >= cutoff - 120 and f'_{SAT}_' in k:
            cand.append((st, k))
    cand.sort(reverse=True)
    cand = cand[:int(WINDOW_MIN * 3.4) + 8]  # 20s 节奏留余量
    if not cand:
        print('glm: 窗口内无文件(卫星延迟?)— 保留旧文件,不覆盖输出', file=sys.stderr)
        sys.exit(1)

    points = []
    ok = 0
    with ThreadPoolExecutor(max_workers=CONC) as ex:
        for res in ex.map(lambda x: fetch_flash(x[1], cutoff), cand):
            ok += 1
            points.extend(res)

    if not points:
        print('glm: 窗口内无有效闪点(可能实为静稳)— 保留旧文件,不覆盖输出', file=sys.stderr)
        sys.exit(1)

    points.sort(key=lambda x: -x[2])
    points = points[:CAP]
    out = {
        'generated': datetime.now(timezone.utc).isoformat(),
        'source': f'GOES-{SAT[1:]} GLM(L2-LCFA, 光总闪)',
        'window_min': WINDOW_MIN,
        'count': len(points),
        'points': points,
    }
    dest = os.path.join(OUT, 'glm', 'latest.json')
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    print(f"glm: {len(points)} 闪点({len(cand)} 文件,{ok} 成功) → {dest} "
          f"{os.path.getsize(dest) // 1024}KB ({time.time() - t0:.0f}s)")


if __name__ == '__main__':
    main()
