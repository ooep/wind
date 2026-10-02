#!/usr/bin/env node
/* 部署侧全哨兵守卫:解码 artifact 内 v_*.json(Int16 base64,-32768=无数据),
 * 统计非哨兵值占比;<0.5% 视为上游摄取失败的全空包,退出码 1。
 * fetch-data-artifacts.sh 用它决定是否替换 dist/data/<model>,防止污染线上。 */
'use strict';
const fs = require('fs');
const path = require('path');

const dir = process.argv[2];
if (!dir || !fs.existsSync(dir)) {
  console.error(`[check] 目录不存在: ${dir}`);
  process.exit(1);
}

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/^v_.+\.json$/.test(e.name)) files.push(p);
  }
})(dir);

if (!files.length) {
  console.error('[check] 未找到任何 v_*.json,产物结构异常');
  process.exit(1);
}

let total = 0, valid = 0;
for (const f of files) {
  try {
    const { data } = JSON.parse(fs.readFileSync(f, 'utf8'));
    const buf = Buffer.from(data, 'base64');
    const n = buf.length >> 1;
    for (let i = 0; i < n; i++) {
      if (buf.readInt16LE(i * 2) !== -32768) valid++;
      total++;
    }
  } catch (e) {
    console.error(`[check] 解析失败 ${path.basename(f)}: ${e.message}`);
  }
}
const pct = total ? (100 * valid) / total : 0;
console.log(`[check] ${files.length} 个变量文件,非哨兵值 ${valid}/${total} (${pct.toFixed(2)}%)`);
if (pct < 0.5) {
  console.error('[check] 有效值不足 0.5%,判定全哨兵/损坏包');
  process.exit(1);
}
