/* 烘焙全球活跃火点 → dist/data/fires/latest.json
 * 数据源:NASA GIBS 火点矢量瓦片(VIIRS 375m 热异常,epsg4326/500m 矩阵,L4 共 20×10 片)。
 * 零密钥零依赖:自实现 MVT(protobuf)点要素解码;当日全球点数异常少时回退昨日。
 * 输出:{generated, date, source, count, points:[[lon,lat,conf]...]} conf: 0低/1中/2高 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const LAYER = process.env.FIRES_LAYER || 'VIIRS_SNPP_Thermal_Anomalies_375m_All';
const OUT = process.argv[2] || 'dist/data';
const TILE_URL = (date, row, col) =>
  `https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/${LAYER}/default/${date}/500m/4/${row}/${col}.mvt`;
const COLS = 20, ROWS = 10; // L4 500m 矩阵:每片 18°×18°

/* ---------- 最小 protobuf/MVT 解码(只取点几何 + 关键属性) ---------- */
function varint(buf, p) {
  let val = 0n, shift = 0n;
  for (;;) {
    const b = buf[p.pos++];
    val |= BigInt(b & 0x7f) << shift;
    if (!(b & 0x80)) return Number(val);
    shift += 7n;
    if (shift > 63n) throw new Error('varint overflow');
  }
}
const zz = (v) => (v >>> 1) ^ -(v & 1);

function parseMVT(buf) {
  const points = [];
  const p = { pos: 0 };
  while (p.pos < buf.length) {
    const tag = varint(buf, p);
    const field = tag >> 3, wire = tag & 7;
    if (field === 3 && wire === 2) {
      const len = varint(buf, p);
      const layerBuf = buf.subarray(p.pos, p.pos + len);
      p.pos += len;
      const { extent } = parseLayer(layerBuf, points);
      points.extent = extent;
    } else if (wire === 2) {
      p.pos += varint(buf, p);
    } else if (wire === 0) {
      varint(buf, p);
    } else {
      throw new Error(`unsupported wire type ${wire}`);
    }
  }
  return points;
}

function parseLayer(buf, out) {
  const p = { pos: 0 };
  let name = '', extent = 4096;
  const features = [], keys = [], values = [];
  while (p.pos < buf.length) {
    const tag = varint(buf, p);
    const field = tag >> 3, wire = tag & 7;
    if (field === 1 && wire === 2) { const n = varint(buf, p); name = buf.subarray(p.pos, p.pos + n).toString(); p.pos += n; }
    else if (field === 2 && wire === 2) { const n = varint(buf, p); features.push(buf.subarray(p.pos, p.pos + n)); p.pos += n; }
    else if (field === 3 && wire === 2) { const n = varint(buf, p); keys.push(buf.subarray(p.pos, p.pos + n).toString()); p.pos += n; }
    else if (field === 4 && wire === 2) { const n = varint(buf, p); values.push(decodeValue(buf.subarray(p.pos, p.pos + n))); p.pos += n; }
    else if (field === 5 && wire === 0) extent = varint(buf, p);
    else if (wire === 2) p.pos += varint(buf, p);
    else if (wire === 0) varint(buf, p);
    else throw new Error(`layer wire ${wire}`);
  }
  for (const f of features) {
    const q = { pos: 0 };
    let type = 0, geom = null, tags = null;
    while (q.pos < f.length) {
      const tag = varint(f, q);
      const field = tag >> 3, wire = tag & 7;
      if (field === 2 && wire === 2) { const n = varint(f, q); tags = f.subarray(q.pos, q.pos + n); q.pos += n; }
      else if (field === 3 && wire === 0) type = varint(f, q);
      else if (field === 4 && wire === 2) { const n = varint(f, q); geom = f.subarray(q.pos, q.pos + n); q.pos += n; }
      else if (wire === 2) q.pos += varint(f, q);
      else if (wire === 0) varint(f, q);
      else throw new Error(`feature wire ${wire}`);
    }
    if (type !== 1 || !geom) continue; // 只关心点
    const attrs = {};
    if (tags) {
      const t = { pos: 0 };
      while (t.pos < tags.length) {
        const ki = varint(tags, t), vi = varint(tags, t);
        if (keys[ki] !== undefined) attrs[keys[ki]] = values[vi];
      }
    }
    const g = { pos: 0 };
    let x = 0, y = 0;
    while (g.pos < geom.length) {
      const cmd = varint(geom, g);
      const id = cmd & 7, count = cmd >> 3;
      for (let i = 0; i < count; i++) {
        x += zz(varint(geom, g));
        y += zz(varint(geom, g));
        if (id === 1) out.push({ xy: [x, y], attrs }); // MoveTo = 新点
      }
    }
  }
  return { name, extent };
}

/* MVT value 消息:1=string 2=double 4=uint 5=int 6=sint 7=bool */
function decodeValue(buf) {
  const p = { pos: 0 };
  let type = -1, raw = null;
  while (p.pos < buf.length) {
    const tag = varint(buf, p);
    const field = tag >> 3, wire = tag & 7;
    if (wire === 2) { const n = varint(buf, p); raw = buf.subarray(p.pos, p.pos + n); p.pos += n; if (type < 0) type = field; }
    else { raw = varint(buf, p); if (type < 0) type = field; }
  }
  if (type === 1 && raw) return raw.toString();
  if (type === 7) return raw === 1 || raw === true;
  return raw;
}

/* ---------- 抓取 ---------- */
async function fetchTile(url, tries = 2) {
  for (let i = 0; i < tries; i++) {
    let r;
    try { r = await fetch(url, { signal: AbortSignal.timeout(25000) }); }
    catch { await new Promise((res) => setTimeout(res, 1200)); continue; }
    if (r.status === 404) return null;          // 空瓦片/当日未出
    if (!r.ok) { await new Promise((res) => setTimeout(res, 1500)); continue; }
    let buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
    return buf;
  }
  return null;
}

function confOf(attrs) {
  const c = attrs.conf ?? attrs.confidence ?? attrs.Confidence ?? attrs.CONFIDENCE;
  if (typeof c === 'string') {
    const s = c.toLowerCase();
    if (s === 'h' || s === 'high') return 2;
    if (s === 'l' || s === 'low') return 0;
    return 1;
  }
  if (typeof c === 'number' && Number.isFinite(c)) return c >= 70 ? 2 : c >= 30 ? 1 : 0;
  return 1;
}

async function bakeDate(date) {
  const jobs = [];
  for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) jobs.push([row, col]);
  const raw = new Array(jobs.length);
  let done = 0, seenAttrs = null;
  const WORKERS = 8;
  let next = 0;
  await Promise.all(Array.from({ length: WORKERS }, async () => {
    for (;;) {
      const i = next++;
      if (i >= jobs.length) return;
      const [row, col] = jobs[i];
      const buf = await fetchTile(TILE_URL(date, row, col));
      if (!buf) raw[i] = null;
      else {
        try {
          raw[i] = parseMVT(buf);
          if (!seenAttrs && raw[i].length) seenAttrs = raw[i][0].attrs;
        } catch (e) {
          console.error(`  tile ${row}/${col} 解码失败: ${e.message}`);
        }
      }
      done++;
      if (done % 50 === 0) console.log(`  ${date}: ${done}/${jobs.length} 瓦片`);
    }
  }));
  if (seenAttrs) console.log(`  属性样例: ${JSON.stringify(seenAttrs).slice(0, 200)}`);
  const seen = new Set();
  const points = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const pts = raw[row * COLS + col];
      if (!pts || !pts.length) continue;
      const ext = pts.extent || 4096;
      for (const { xy, attrs } of pts) {
        const lon = -180 + (col + xy[0] / ext) * 18;
        const lat = 90 - (row + xy[1] / ext) * 18;
        if (lat < -85 || lat > 85) continue;
        const key = `${lon.toFixed(3)},${lat.toFixed(3)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        points.push([Number(lon.toFixed(3)), Number(lat.toFixed(3)), confOf(attrs)]);
      }
    }
  }
  return { points };
}

(async () => {
  const now = new Date();
  const dstr = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
  let date = dstr(now);
  let { points } = await bakeDate(date);
  if (points.length < 500) {
    // 全球单日火点通常数千起:过少视为当日产品未铺完,回退昨日
    const y = new Date(now.getTime() - 86400e3);
    console.log(`  ${date} 仅 ${points.length} 点,回退昨日重烤`);
    date = dstr(y);
    ({ points } = await bakeDate(date));
  }
  const out = {
    generated: Math.round(Date.now() / 1000),
    date,
    source: `NASA GIBS ${LAYER} (FIRMS/NRT)`,
    count: points.length,
    points,
  };
  const dir = path.join(OUT, 'fires');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'latest.json'), JSON.stringify(out));
  console.log(`  fires: ${points.length} 点(${date}) → ${path.join(dir, 'latest.json')} ${Math.round(JSON.stringify(out).length / 1024)}KB`);
})().catch((e) => { console.error('烘焙失败(fires):', e.message); process.exit(1); });
