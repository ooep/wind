/* 烘焙全球地震 → dist/data/quakes/latest.json
 * 数据源:USGS GeoJSON feed(零密钥):2.5级+/24h 与 4.5级+/7d,按事件 id 去重合并。
 * 输出:{generated, count, quakes:[[lon,lat,mag,depthKm,timeMs,place]...]}(新→旧) */
'use strict';
const fs = require('fs');
const path = require('path');

const OUT = process.argv[2] || 'dist/data';
const FEEDS = [
  'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson',
  'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson',
];
const CAP = 1500;

(async () => {
  const t0 = Date.now();
  const byId = new Map();
  for (const url of FEEDS) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'fengyun-earth' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      for (const f of d.features || []) {
        const c = f.geometry && f.geometry.type === 'Point' ? f.geometry.coordinates : null;
        const p = f.properties || {};
        if (!c || typeof p.mag !== 'number' || !p.place) continue;
        byId.set(f.id, [c[0], c[1], p.mag, Math.round(c[2] ?? -1), p.time, p.place]);
      }
    } catch (e) {
      console.error(`[usgs] ${url.slice(-24)}: ${e.message}`);
    }
  }
  if (!byId.size) {
    console.error('USGS 全部 feed 失败 — 保留旧文件,不覆盖输出');
    process.exit(1);
  }
  const quakes = [...byId.values()]
    .sort((a, b) => b[4] - a[4])
    .slice(0, CAP)
    .map((q) => [q[0], q[1], q[2], q[3], q[4], q[5].slice(0, 90)]);

  const dir = path.join(OUT, 'quakes');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'latest.json');
  fs.writeFileSync(file, JSON.stringify({ generated: new Date().toISOString(), source: 'USGS', count: quakes.length, quakes }));
  const kb = Math.round(fs.statSync(file).size / 1024);
  console.log(`quakes: ${quakes.length} → ${file} ${kb}KB (${Date.now() - t0}ms)`);
})();
