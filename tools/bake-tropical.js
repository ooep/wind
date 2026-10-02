/* 烘焙 NHC 活动飓风数据 → dist/data/tropical/nhc.json(供静态模式直读) */
'use strict';
const fs = require('fs');
const path = require('path');
const tropical = require('../server/tropical');

(async () => {
  const out = process.argv[2] || 'dist/data';
  const data = await tropical.getNhc(true);
  const dir = path.join(out, 'tropical');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'nhc.json'), JSON.stringify(data));
  console.log(`  tropical/nhc: ${data.storms.length} 场 → ${path.join(out, 'tropical', 'nhc.json')}`);
})().catch((e) => { console.error('烘焙失败(tropical):', e.message); process.exit(1); });
