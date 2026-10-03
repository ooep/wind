/* 烘焙空间天气 → dist/data/swx/latest.json(极光叠加层信息条用)
 * 数据源:NOAA SWPC(零密钥):行星 Kp 指数(3h 步长)+ 太阳风速度/磁场最新值(summary)。
 * 输出:{generated, kp:[[iso,val]...], kpLatest, wind:{speed,bt,bz,time}} — 体积 <5KB
 * Kp 兼容两种行格式:对象 {time_tag,Kp} 或数组 [time_tag,Kp,...] */
'use strict';
const fs = require('fs');
const path = require('path');

const OUT = process.argv[2] || 'dist/data';
const KP_URLS = [
  'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json',
  'https://services.swpc.noaa.gov/json/planetary_k_index_1m.json',
];
const SUMMARY_URLS = {
  speed: 'https://services.swpc.noaa.gov/products/summary/solar-wind-speed.json',
  mag: 'https://services.swpc.noaa.gov/products/summary/solar-wind-mag-field.json',
};
const CAP = 48; // 6 天窗口(3h 步长 32 点,1m 步长时收紧)

(async () => {
  const t0 = Date.now();
  let rows = null;
  for (const url of KP_URLS) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'fengyun-earth' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      if (Array.isArray(d) && d.length) { rows = d; break; }
    } catch (e) {
      console.error(`[swpc] ${url.slice(-36)}: ${e.message}`);
    }
  }
  if (!rows) {
    console.error('SWPC Kp 源全部失败 — 保留旧文件,不覆盖输出');
    process.exit(1);
  }

  const kpArr = [];
  for (const row of rows) {
    if (row && typeof row === 'object' && !Array.isArray(row)) {
      const v = parseFloat(row.Kp ?? row.kp);
      if (row.time_tag && Number.isFinite(v)) kpArr.push([row.time_tag, v]);
    } else if (Array.isArray(row) && typeof row[1] === 'number') {
      kpArr.push([row[0], row[1]]);
    }
  }
  if (!kpArr.length) {
    console.error('SWPC Kp 无有效行 — 保留旧文件,不覆盖输出');
    process.exit(1);
  }
  kpArr.sort((a, b) => (a[0] < b[0] ? -1 : 1));
  kpArr.splice(0, Math.max(0, kpArr.length - CAP));

  /* 太阳风 summary(可选,失败不株连):[{"proton_speed":306,"time_tag":...}] / [{"bt":8,"bz_gsm":-3,...}] */
  let wind = null;
  const [spd, mag] = await Promise.all([
    fetch(SUMMARY_URLS.speed).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    fetch(SUMMARY_URLS.mag).then((r) => (r.ok ? r.json() : null)).catch(() => null),
  ]);
  const speed = spd && spd[0] ? parseFloat(spd[0].proton_speed) : NaN;
  const bt = mag && mag[0] ? parseFloat(mag[0].bt) : NaN;
  const bz = mag && mag[0] ? parseFloat(mag[0].bz_gsm) : NaN;
  if ([speed, bt, bz].every(Number.isFinite)) {
    wind = { speed, bt, bz, time: spd[0].time_tag || null };
  }

  const data = {
    generated: new Date().toISOString(),
    source: 'NOAA SWPC',
    kp: kpArr.map(([t, v]) => [t, Math.round(v * 100) / 100]),
    kpLatest: { time: kpArr[kpArr.length - 1][0], kp: kpArr[kpArr.length - 1][1] },
    wind,
  };
  const dir = path.join(OUT, 'swx');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'latest.json');
  fs.writeFileSync(file, JSON.stringify(data));
  console.log(`swx: kp=${kpArr.length} latest=${data.kpLatest.kp} wind=${wind ? wind.speed + 'km/s Bz' + wind.bz : 'n/a'} → ${file} (${Date.now() - t0}ms)`);
})();
