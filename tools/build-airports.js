/*
 * 烘焙机场数据库:OurAirports CSV → public/data/airports.json(紧凑数组)。
 * 用法: node tools/build-airports.js [airports.csv]
 * 筛选:large/medium 机场 + 有定期航班的 small 机场(共约 6~8k)。
 * 行格式:[icao, iata, 名称, 纬度, 经度, 海拔ft, 国家ISO, 城市]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const input = process.argv[2] || '/tmp/airports.csv';
const OUT = path.join(__dirname, '..', 'public', 'data', 'airports.json');

const lines = fs.readFileSync(input, 'utf8').split('\n');
/* 表头形如 "id","ident","type",… — 去掉引号再定位列 */
const header = parseCsvLine(lines[0]).map((h) => h.replace(/^"|"$/g, ''));
const col = (name) => header.indexOf(name);
const C = {
  type: col('type'), name: col('name'), lat: col('latitude_deg'), lon: col('longitude_deg'),
  elev: col('elevation_ft'), country: col('iso_country'), city: col('municipality'),
  sched: col('scheduled_service'), icao: col('icao_code'), iata: col('iata_code'), ident: col('ident'),
};

/* CSV 单行解析(容忍引号内逗号) */
function parseCsvLine(line) {
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') inQ = false;
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

const airports = [];
for (let li = 1; li < lines.length; li++) {
  const line = lines[li];
  if (!line.trim()) continue;
  const f = parseCsvLine(line);
  const type = f[C.type];
  const scheduled = f[C.sched] === 'yes';
  const keep = type === 'large_airport' || type === 'medium_airport' || (type === 'small_airport' && scheduled);
  if (!keep) continue;
  let icao = (f[C.icao] || '').trim();
  if (!icao) {
    const ident = (f[C.ident] || '').trim();
    if (/^[A-Z]{4}$/.test(ident)) icao = ident; else continue;
  }
  const lat = Number(f[C.lat]), lon = Number(f[C.lon]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
  airports.push([
    icao,
    (f[C.iata] || '').trim(),
    f[C.name],
    Math.round(lat * 1000) / 1000,
    Math.round(lon * 1000) / 1000,
    Number(f[C.elev]) || 0,
    f[C.country] || '',
    f[C.city] || '',
  ]);
}

airports.sort((a, b) => a[0] < b[0] ? -1 : 1);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(airports));
const mb = (fs.statSync(OUT).size / 1e6).toFixed(2);
console.log(`airports.json → ${OUT} (${mb} MB, ${airports.length} 个机场)`);
