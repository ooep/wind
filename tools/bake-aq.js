/* 烘焙全球城市空气质量 → dist/data/aq/latest.json(供静态模式直读) */
'use strict';
const fs = require('fs');
const path = require('path');
const aq = require('../server/aq');

(async () => {
  const out = process.argv[2] || 'dist/data';
  const data = await aq.fetchAq();
  const dir = path.join(out, 'aq');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'latest.json'), JSON.stringify(data));
  console.log(`  aq: ${data.cities.length} 城市 → ${path.join(out, 'aq', 'latest.json')}`);
})().catch((e) => { console.error('烘焙失败(aq):', e.message); process.exit(1); });
