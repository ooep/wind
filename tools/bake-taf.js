/*
 * 烘焙机场航路预报 TAF → dist/data/obs/taf.json(静态模式「机场」标签数据源)。
 * 用法: node tools/bake-taf.js [dist/data]
 * 数据源:aviationweather.gov TAF API,按机场 ICAO 批量(200/批)。
 * 格式:{ generated, taf: { ICAO: [签发时间s, 有效起s, 有效止s, 原文] } }
 */
'use strict';
const fs = require('fs');
const path = require('path');

const out = process.argv[2] || 'dist/data';
const AIRPORTS = path.join(__dirname, '..', 'public', 'data', 'airports.json');

async function fetchJSON(url, retries = 3) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'fengyun-earth-taf/1.0' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) { lastErr = e; await new Promise((s) => setTimeout(s, 2000 * (i + 1))); }
  }
  throw lastErr;
}

(async () => {
  const icaos = JSON.parse(fs.readFileSync(AIRPORTS, 'utf8')).map((a) => a[0]);
  const taf = {};
  const CH = 200;
  for (let i = 0; i < icaos.length; i += CH) {
    const batch = icaos.slice(i, i + CH).join(',');
    try {
      const arr = await fetchJSON(`https://aviationweather.gov/api/data/taf?ids=${batch}&format=json`);
      for (const t of arr) {
        if (!t.icaoId || !t.rawTAF) continue;
        taf[t.icaoId] = [
          t.issueTime ? Math.round(Date.parse(t.issueTime) / 1000) : null,
          t.validTimeFrom ? Math.round(Date.parse(t.validTimeFrom) / 1000) : null,
          t.validTimeTo ? Math.round(Date.parse(t.validTimeTo) / 1000) : null,
          t.rawTAF,
        ];
      }
    } catch (e) {
      console.error(`  TAF 批次 ${i}-${i + CH} 失败: ${e.message}`);
    }
    if (i + CH < icaos.length) await new Promise((s) => setTimeout(s, 800));
  }
  const dir = path.join(out, 'obs');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'taf.json');
  fs.writeFileSync(file, JSON.stringify({ generated: Math.floor(Date.now() / 1000), taf }));
  console.log(`  taf: ${Object.keys(taf).length} 站 → ${file}(${(fs.statSync(file).size / 1e6).toFixed(2)} MB)`);
})().catch((e) => { console.error('烘焙失败(taf):', e.message); process.exit(1); });
