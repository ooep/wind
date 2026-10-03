/* 烘焙空间天气 → dist/data/swx/latest.json(极光叠加层信息条用)
 * 数据源:NOAA SWPC 行星 Kp 指数(零密钥,3h 步长)。
 * 输出:{generated, kp:[[iso,val]...], kpLatest:{time,kp}} — 体积 <5KB
 * 兼容两种行格式:对象 {time_tag,Kp} 或数组 [time_tag,Kp,...] */
'use strict';
const fs = require('fs');
const path = require('path');

const OUT = process.argv[2] || 'dist/data';
const URLS = [
  'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json',
  'https://services.swpc.noaa.gov/json/planetary_k_index_1m.json',
];
const CAP = 48; // 6 天窗口(3h 步长 32 点,1m 步长时收紧)

(async () => {
  const t0 = Date.now();
  let rows = null;
  for (const url of URLS) {
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
    /* 跳过表头行;对象行取 .time_tag/.Kp,数组行取 [0]/[1] */
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

  const data = {
    generated: new Date().toISOString(),
    source: 'NOAA SWPC',
    kp: kpArr.map(([t, v]) => [t, Math.round(v * 100) / 100]),
    kpLatest: { time: kpArr[kpArr.length - 1][0], kp: kpArr[kpArr.length - 1][1] },
  };
  const dir = path.join(OUT, 'swx');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'latest.json');
  fs.writeFileSync(file, JSON.stringify(data));
  console.log(`swx: kp=${kpArr.length} latest=${data.kpLatest.kp} → ${file} (${Date.now() - t0}ms)`);
})();
