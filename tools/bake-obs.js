/* 烘焙全球 METAR 站点实况 → dist/data/obs/latest.json(供静态模式直读) */
'use strict';
const fs = require('fs');
const path = require('path');
const obs = require('../server/obs');

(async () => {
  const out = process.argv[2] || 'dist/data';
  const data = await obs.getObs(true);
  const dir = path.join(out, 'obs');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'latest.json'), JSON.stringify(data));
  console.log(`  obs: ${data.count} 站点 → ${path.join(out, 'obs', 'latest.json')}`);
})().catch((e) => { console.error('烘焙失败(obs):', e.message); process.exit(1); });
