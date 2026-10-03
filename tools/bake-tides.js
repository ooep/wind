/* 烘焙 NOAA 潮汐站预报 → dist/data/tides/latest.json
 * 数据源:NOAA CO-OPS(零密钥,美国沿岸):
 *  - 站点目录 MDAPI stations.json?type=tidepredictions(~3500 站,含坐标)
 *  - 每站 hi/lo 预报(当日+次日,必须带 begin_date/end_date,否则 400)
 * 输出:{generated, count, stations:[{id,name,state,lon,lat,tides:[[iso,'H'|'L',m]...]}]}
 * 3500 站请求量大 → 每日一次(20h 新鲜守卫),并发 30。 */
'use strict';
const fs = require('fs');
const path = require('path');

const OUT = process.argv[2] || 'dist/data';
const MDAPI = 'https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=tidepredictions';
const PRED = (id, b, e) => `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=predictions&application=fengyun_earth&begin_date=${b}&end_date=${e}&datum=MLLW&time_zone=lst_ldt&units=metric&interval=hilo&format=json&station=${id}`;
const CONC = 30;
const FRESH_MS = 20 * 3600e3;

const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');

(async () => {
  const t0 = Date.now();
  const dir = path.join(OUT, 'tides');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'latest.json');

  if (fs.existsSync(file)) {
    try {
      const old = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Date.parse(old.generated) > Date.now() - FRESH_MS) {
        console.log(`tides: 包仅 ${Math.round((Date.now() - Date.parse(old.generated)) / 360e3) / 100}h 新,跳过`);
        return;
      }
    } catch { /* 重烘 */ }
  }

  const r = await fetch(MDAPI, { headers: { 'User-Agent': 'fengyun-earth' } });
  if (!r.ok) { console.error(`MDAPI HTTP ${r.status} — 保留旧文件`); process.exit(1); }
  const meta = (await r.json()).stations || [];
  const begin = ymd(new Date()), end = ymd(new Date(Date.now() + 2 * 86400e3));
  if (!meta.length) { console.error('MDAPI 站点为空 — 保留旧文件'); process.exit(1); }

  const out = [];
  const worker = async () => {
    for (;;) {
      const st = meta.shift();
      if (!st) return;
      if (!Number.isFinite(st.lat) || !Number.isFinite(st.lng)) continue;
      try {
        const rr = await fetch(PRED(st.id, begin, end), { headers: { 'User-Agent': 'fengyun-earth' } });
        if (!rr.ok) continue;
        const d = await rr.json();
        const ps = d.predictions;
        if (!Array.isArray(ps) || !ps.length) continue;
        out.push({
          id: String(st.id), name: (st.name || '').slice(0, 48), state: st.state || '',
          lon: st.lng, lat: st.lat,
          tides: ps.slice(0, 10).map((p) => [p.t, p.type, Math.round(parseFloat(p.v) * 100) / 100]),
        });
      } catch { /* 单站失败不株连 */ }
    }
  };
  await Promise.all(Array.from({ length: CONC }, worker));

  if (!out.length) { console.error('CO-OPS 全部站无预报 — 保留旧文件,不覆盖输出'); process.exit(1); }

  fs.writeFileSync(file, JSON.stringify({ generated: new Date().toISOString(), source: 'NOAA CO-OPS', count: out.length, stations: out }));
  console.log(`tides: ${out.length}/${meta.length + out.length} 站 → ${file} ${Math.round(fs.statSync(file).size / 1024)}KB (${Date.now() - t0}ms)`);
})();
