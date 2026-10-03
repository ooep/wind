/* 烘焙潮汐叠加层数据 → dist/data/tides/(双源独立,互不株连)
 *
 * 源 1 latest.json — NOAA CO-OPS 潮位预报(零密钥,美国沿岸 ~3500 站):
 *  - 站点目录 MDAPI stations.json?type=tidepredictions
 *  - 每站 hi/lo 预报(当日+次日,必须带 begin_date/end_date,否则 400)
 *  输出:{generated, source, count, stations:[{id,name,state,lon,lat,tides:[[iso,'H'|'L',m]...]}]}
 *
 * 源 2 global.json — UHSLC 全球验潮站逐时实测(零密钥,ERDDAP global_hourly_fast):
 *  - 一条 CSV 查询取全部站最近 30h 水位(相对本站基准面,mm);实测而非预报
 *  输出:{generated, source, count, stations:[{id,name,country,lon,lat,lv:[[iso,m]...≤24点]}]}
 *
 * 各源 20h 新鲜守卫;单源失败保留其旧包;两源同时失败才 exit 1。 */
'use strict';
const fs = require('fs');
const path = require('path');

const OUT = process.argv[2] || 'dist/data';
const MDAPI = 'https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=tidepredictions';
const PRED = (id, b, e) => `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=predictions&application=fengyun_earth&begin_date=${b}&end_date=${e}&datum=MLLW&time_zone=lst_ldt&units=metric&interval=hilo&format=json&station=${id}`;
const UH_ERD = (since) => `https://uhslc.soest.hawaii.edu/erddap/tabledap/global_hourly_fast.csv?time,sea_level,uhslc_id,station_name,station_country,latitude,longitude&time>=${since}`;
const UH_INFO = 'https://uhslc.soest.hawaii.edu/erddap/info/global_hourly_fast/index.csv';
const CONC = 30;
const FRESH_MS = 20 * 3600e3;

const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');

function freshGuard(file) {
  if (!fs.existsSync(file)) return false;
  try {
    const old = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Date.parse(old.generated) > Date.now() - FRESH_MS) {
      console.log(`  ${path.basename(file)}: 仅 ${Math.round((Date.now() - Date.parse(old.generated)) / 360e3) / 100}h 新,跳过`);
      return true;
    }
  } catch { /* 重烘 */ }
  return false;
}

/* NOAA CO-OPS 高低潮预报。成功返回站数,上游不可用抛错(由外层兜旧包)。 */
async function bakeNOAA(dir) {
  const file = path.join(dir, 'latest.json');
  if (freshGuard(file)) return 0;
  const r = await fetch(MDAPI, { headers: { 'User-Agent': 'fengyun-earth' } });
  if (!r.ok) throw new Error(`MDAPI HTTP ${r.status}`);
  const meta = (await r.json()).stations || [];
  if (!meta.length) throw new Error('MDAPI 站点为空');
  const begin = ymd(new Date()), end = ymd(new Date(Date.now() + 2 * 86400e3));

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
  if (!out.length) throw new Error('CO-OPS 全部站无预报');
  fs.writeFileSync(file, JSON.stringify({ generated: new Date().toISOString(), source: 'NOAA CO-OPS', count: out.length, stations: out }));
  console.log(`  latest.json: ${out.length} 站(美国沿岸预报)→ ${Math.round(fs.statSync(file).size / 1024)}KB`);
  return out.length;
}

/* UHSLC 数据集时间轴末端(Fast Delivery 滞后 4-6 周,不能拿"现在"当锚):
 * 从 ERDDAP info 的 time actual_range(纪元秒)解析最大时刻。 */
async function uhslcMaxTime() {
  const r = await fetch(UH_INFO, { headers: { 'User-Agent': 'fengyun-earth' } });
  if (!r.ok) throw new Error(`ERDDAP info HTTP ${r.status}`);
  for (const row of parseCsv(await r.text())) {
    if (row.length >= 5 && row[1] === 'time' && row[2] === 'actual_range') {
      const parts = String(row[4]).split(',').map((s) => parseFloat(s));
      const max = parts[parts.length - 1];
      if (Number.isFinite(max)) return max * 1000;
    }
  }
  throw new Error('无法解析 time actual_range');
}

/* UHSLC 全球验潮站逐时实测(Fast Delivery,RQ 数据自动拼接)。返回站数。 */
async function bakeUHSLC(dir) {
  const file = path.join(dir, 'global.json');
  if (freshGuard(file)) return 0;
  const maxT = await uhslcMaxTime();
  const since = new Date(maxT - 30 * 3600e3).toISOString().slice(0, 19) + 'Z';
  const r = await fetch(UH_ERD(since), { headers: { 'User-Agent': 'fengyun-earth' } });
  if (!r.ok) throw new Error(`ERDDAP HTTP ${r.status}`);
  const rows = parseCsv(await r.text());
  if (rows.length < 3) throw new Error('ERDDAP 返回为空');
  const head = rows[0].map((s) => s.trim());
  const col = (name) => head.indexOf(name);
  const cT = col('time'), cV = col('sea_level'), cId = col('uhslc_id'),
    cName = col('station_name'), cCc = col('station_country'), cLat = col('latitude'), cLon = col('longitude');

  const byId = new Map();
  for (let i = 2; i < rows.length; i++) {
    const row = rows[i];
    const mm = parseFloat(row[cV]);
    const lat = parseFloat(row[cLat]), lon = parseFloat(row[cLon]);
    if (!Number.isFinite(mm) || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const id = row[cId];
    let st = byId.get(id);
    if (!st) {
      st = { id: `U${id}`, name: (row[cName] || '').slice(0, 48), country: row[cCc] || '', lon: Math.round(lon * 1000) / 1000, lat: Math.round(lat * 1000) / 1000, lv: [] };
      byId.set(id, st);
    }
    st.lv.push([row[cT].slice(0, 16), Math.round(mm) / 1000]);
  }
  const stations = [...byId.values()];
  for (const st of stations) {
    st.lv.sort((a, b) => (a[0] < b[0] ? -1 : 1));
    st.lv = st.lv.slice(-24);
  }
  if (!stations.length) throw new Error('UHSLC 无有效站');
  fs.writeFileSync(file, JSON.stringify({ generated: new Date().toISOString(), source: 'UHSLC Fast Delivery', count: stations.length, stations }));
  console.log(`  global.json: ${stations.length} 站(全球实测)→ ${Math.round(fs.statSync(file).size / 1024)}KB`);
  return stations.length;
}

/* 小型 CSV 解析(处理引号内的逗号/换行 —— UHSLC 站名含逗号) */
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

(async () => {
  const t0 = Date.now();
  const dir = path.join(OUT, 'tides');
  fs.mkdirSync(dir, { recursive: true });
  let fails = 0;
  try { await bakeNOAA(dir); } catch (e) { console.error(`  NOAA 预报烘焙失败(保留旧包): ${e.message}`); fails++; }
  try { await bakeUHSLC(dir); } catch (e) { console.error(`  UHSLC 实测烘焙失败(保留旧包): ${e.message}`); fails++; }
  if (fails === 2) { console.error('tides: 两个源全部失败,不产出'); process.exit(1); }
  console.log(`tides: 完成 (${Date.now() - t0}ms)`);
})();
