/* 烘焙全球海洋浮标/站点实况 → dist/data/buoys/latest.json
 * 数据源:NDBC(零密钥,无 CORS → 只能服务端烘焙):
 *  - 站点目录 data/stations/station_table.txt(竖线分隔,LOCATION 字段含经纬度)
 *  - 每站最新观测 data/latest_obs/{ID}.txt(自由文本键值格式,无数据的站 404 自然过滤)
 * 单位换算:kt→m/s、inHg→hPa、°F→°C、ft→m。
 * 输出:{generated, count, buoys:[[lon,lat,wdir,wspd,wgst,wvht,dpd,pres,atmp,wtmp,name]...]} */
'use strict';
const fs = require('fs');
const path = require('path');

const OUT = process.argv[2] || 'dist/data';
const TABLE = 'https://www.ndbc.noaa.gov/data/stations/station_table.txt';
const OBS = (id) => `https://www.ndbc.noaa.gov/data/latest_obs/${id}.txt`;
const CONC = 24;
const kt2ms = 0.514444, ft2m = 0.3048, inhg2hpa = 33.8639;
const f2c = (f) => Math.round(((f - 32) * 5 / 9) * 10) / 10;

const parseLoc = (s) => {
  const m = s.match(/(-?\d+\.?\d*)\s*([NS])\s+(-?\d+\.?\d*)\s*([EW])/);
  if (!m) return null;
  const lat = parseFloat(m[1]) * (m[2] === 'S' ? -1 : 1);
  const lon = parseFloat(m[3]) * (m[4] === 'W' ? -1 : 1);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) return null;
  return { lat, lon };
};

/* latest_obs 自由文本 → 结构化(全部 SI 单位;缺测 null) */
function parseObs(text) {
  const num = (re) => { const m = text.match(re); return m ? parseFloat(m[1]) : null; };
  const wdir = num(/Wind:\s*\S+\s*\((\d+)[^\d)]*\)/);
  const wspd = num(/Wind:\s*\S+\s*\([^\d)]*\),\s*(\d+\.?\d*)\s*kt/);
  const wgst = num(/Gust:\s*(\d+\.?\d*)\s*kt/);
  let pres = num(/Pres(?:sure)?:\s*(\d{2,3}\.?\d*)\s*(?:hPa)?/);
  if (pres != null && pres < 40) pres = Math.round(pres * inhg2hpa * 10) / 10; // inHg → hPa
  let atmp = num(/Air Temp:\s*(-?\d+\.?\d*)\s*\D?F/);
  if (atmp != null) atmp = f2c(atmp);
  else atmp = num(/Air Temp:\s*(-?\d+\.?\d*)\s*\D?C/);
  let wtmp = num(/Water Temp:\s*(-?\d+\.?\d*)\s*\D?F/);
  if (wtmp != null) wtmp = f2c(wtmp);
  else wtmp = num(/Water Temp:\s*(-?\d+\.?\d*)\s*\D?C/);
  const wvhtFt = num(/(?:Seas|Swell):\s*(\d+\.?\d*)\s*ft/);
  const wvht = wvhtFt != null ? Math.round(wvhtFt * ft2m * 10) / 10 : null;
  const dpd = num(/Period:\s*(\d+\.?\d*)\s*sec/);
  if ([wdir, wspd, wgst, pres, atmp, wtmp, wvht, dpd].every((v) => v == null)) return null;
  return [wdir, wspd != null ? Math.round(wspd * kt2ms * 10) / 10 : null,
    wgst != null ? Math.round(wgst * kt2ms * 10) / 10 : null,
    wvht, dpd, pres, atmp, wtmp];
}

(async () => {
  const t0 = Date.now();
  const r = await fetch(TABLE, { headers: { 'User-Agent': 'fengyun-earth' } });
  if (!r.ok) { console.error(`station_table HTTP ${r.status} — 保留旧文件`); process.exit(1); }
  const text = await r.text();

  const stations = [];
  for (const line of text.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const cols = line.split('|');
    const id = (cols[0] || '').trim();
    if (!/^[A-Za-z0-9]{4,8}$/.test(id)) continue;
    const loc = parseLoc(cols[6] || '');
    if (!loc) continue;
    const name = ((cols[4] || cols[3] || id).trim()).slice(0, 60);
    stations.push({ id, name, ...loc });
  }
  if (!stations.length) { console.error('站点目录解析为空 — 保留旧文件'); process.exit(1); }

  const out = [];
  let dead = 0, total = 0;
  const worker = async () => {
    for (;;) {
      const st = stations.shift();
      if (!st) return;
      total++;
      try {
        const rr = await fetch(OBS(st.id), { headers: { 'User-Agent': 'fengyun-earth' } });
        if (!rr.ok) { dead++; continue; }
        const parsed = parseObs(await rr.text());
        if (!parsed) { dead++; continue; }
        out.push([st.lon, st.lat, ...parsed, st.name]);
      } catch { dead++; }
    }
  };
  await Promise.all(Array.from({ length: CONC }, worker));

  if (!out.length) { console.error('NDBC 全部站无有效观测 — 保留旧文件,不覆盖输出'); process.exit(1); }

  const dir = path.join(OUT, 'buoys');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'latest.json');
  fs.writeFileSync(file, JSON.stringify({ generated: new Date().toISOString(), source: 'NDBC', count: out.length, buoys: out }));
  console.log(`buoys: ${out.length}/${total} 站(无观测 ${dead}) → ${file} ${Math.round(fs.statSync(file).size / 1024)}KB (${Date.now() - t0}ms)`);
})();
