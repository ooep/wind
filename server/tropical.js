/*
 * NHC 活动飓风/热带气旋(NOAA 官方,public domain):
 *  - CurrentStorms.json:风暴索引(名称/分类/强度/位置)
 *  - gis/forecast/archive/{id}_5day_latest.zip:预报轨迹线 + 预报点(shapefile)
 *  - data/atcf/btk/b{id}.dat:过去实况轨迹(ATCF 文本)
 * 自带最小 zip / shapefile / dbf 解析(零依赖),供 /api/tropical/nhc 路由与烘焙脚本共用。
 */
'use strict';

const zlib = require('zlib');

const NHC_INDEX = 'https://www.nhc.noaa.gov/CurrentStorms.json';
const NHC_GIS = 'https://www.nhc.noaa.gov/gis/forecast/archive';
const NHC_BTK = 'https://ftp.nhc.noaa.gov/atcf/btk';

async function fetchBuf(url, retries = 3) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'fengyun-earth/1.0 (weather viz demo)' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    } catch (e) {
      lastErr = e;
      await new Promise((s) => setTimeout(s, 1500 * (i + 1)));
    }
  }
  throw lastErr;
}

/* ---------------- 最小 zip 读取 ---------------- */

function zipEntries(buf) {
  // 从尾部找 End of Central Directory
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('zip: EOCD 未找到');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    entries.set(name, { method, compSize, localOff });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return {
    get(name) {
      const e = entries.get(name);
      if (!e) return null;
      const lo = e.localOff;
      if (buf.readUInt32LE(lo) !== 0x04034b50) throw new Error('zip: local header 异常');
      const nameLen = buf.readUInt16LE(lo + 26);
      const extraLen = buf.readUInt16LE(lo + 28);
      const data = buf.subarray(lo + 30 + nameLen + extraLen, lo + 30 + nameLen + extraLen + e.compSize);
      return e.method === 0 ? Buffer.from(data) : zlib.inflateRawSync(data);
    },
    names: [...entries.keys()],
  };
}

/* ---------------- Shapefile / DBF ---------------- */

function parseSHP(buf) {
  const out = [];
  let p = 100; // 主头 100 字节
  while (p + 8 <= buf.length) {
    const contentLen = buf.readInt32BE(p + 4) * 2;
    let q = p + 8;
    const type = buf.readInt32LE(q);
    if (type === 1) { // Point
      out.push({ type: 1, x: buf.readDoubleLE(q + 4), y: buf.readDoubleLE(q + 12) });
    } else if (type === 3) { // PolyLine
      const numParts = buf.readInt32LE(q + 36);
      const numPoints = buf.readInt32LE(q + 40);
      const parts = [];
      for (let i = 0; i < numParts; i++) parts.push(buf.readInt32LE(q + 44 + i * 4));
      const ptsBase = q + 44 + numParts * 4;
      const points = [];
      for (let i = 0; i < numPoints; i++) points.push([buf.readDoubleLE(ptsBase + i * 16), buf.readDoubleLE(ptsBase + i * 16 + 8)]);
      const lines = parts.map((start, i) => points.slice(start, parts[i + 1] ?? numPoints));
      out.push({ type: 3, lines });
    } else if (type === 5) { // Polygon(备用:预警锥)
      const numParts = buf.readInt32LE(q + 36);
      const numPoints = buf.readInt32LE(q + 40);
      const parts = [];
      for (let i = 0; i < numParts; i++) parts.push(buf.readInt32LE(q + 44 + i * 4));
      const ptsBase = q + 44 + numParts * 4;
      const points = [];
      for (let i = 0; i < numPoints; i++) points.push([buf.readDoubleLE(ptsBase + i * 16), buf.readDoubleLE(ptsBase + i * 16 + 8)]);
      const rings = parts.map((start, i) => points.slice(start, parts[i + 1] ?? numPoints));
      out.push({ type: 5, rings });
    }
    p += 8 + contentLen;
  }
  return out;
}

function parseDBF(buf) {
  const numRecords = buf.readInt32LE(4);
  const headerLen = buf.readInt16LE(8);
  const recordLen = buf.readInt16LE(10);
  const fields = [];
  for (let p = 32; p < headerLen - 1; p += 32) {
    if (buf[p] === 0x0d) break;
    const name = buf.subarray(p, p + 11).toString('ascii').replace(/\0.*$/, '').trim();
    fields.push({ name, type: String.fromCharCode(buf[p + 11]), len: buf[p + 16] });
  }
  const records = [];
  for (let r = 0; r < numRecords; r++) {
    const base = headerLen + r * recordLen;
    if (base + recordLen > buf.length) break;
    const rec = {};
    let p = base + 1;
    for (const f of fields) {
      const raw = buf.subarray(p, p + f.len).toString('utf8').trim();
      p += f.len;
      rec[f.name] = f.type === 'N' || f.type === 'F' ? (raw === '' || /9999/.test(raw) ? null : Number(raw)) : (raw || null);
    }
    records.push(rec);
  }
  return records;
}

/* ---------------- NHC 数据组织 ---------------- */

function stormIdToBasin(id) {
  // 'ep182026' → btk 文件 'bep182026.dat'
  return `b${id}.dat`;
}

async function fetchPastTrack(id) {
  try {
    const buf = await fetchBuf(`${NHC_BTK}/${stormIdToBasin(id)}`, 2);
    const track = [];
    for (const line of buf.toString('utf8').split('\n')) {
      const f = line.split(',');
      if (f.length < 10 || !/^\d{10}$/.test((f[2] || '').trim())) continue;
      const lat = atcfCoord(f[6]);
      const lon = atcfCoord(f[7]);
      if (lat == null || lon == null) continue;
      track.push({ lat, lon, ms: Date.parse(`${f[2].trim().slice(0, 4)}-${f[2].slice(4, 6)}-${f[2].slice(6, 8)}T${f[2].slice(8, 10)}:00:00Z`) });
    }
    track.sort((a, b) => a.ms - b.ms);
    return track.map((t) => [t.lat, t.lon]);
  } catch {
    return null; // b-deck 缺失常见于新生系统,可容忍
  }
}

/* ATCF 坐标:'92N' → 9.2,'926W' → -92.6,'072E' → 7.2 */
function atcfCoord(s) {
  const m = /^\s*(\d+)([NSEW])\s*$/.exec(String(s || ''));
  if (!m) return null;
  const v = Number(m[1]) / 10;
  return m[2] === 'S' || m[2] === 'W' ? -v : v;
}

async function fetchNhcStorm(storm) {
  const id = storm.id; // 'ep182026'
  const out = {
    source: 'nhc',
    id,
    name: storm.name || null,
    number: storm.binNumber || null,
    nameLocal: null,
    category: storm.classification || null,
    intensityKt: Number(storm.intensity) || null,
    pressureHpa: Number(storm.pressure) || null,
    position: [storm.latitudeNumeric, storm.longitudeNumeric],
    movement: { dirDeg: Number(storm.movementDir) || null, speedKt: Number(storm.movementSpeed) || null },
    issue: storm.lastUpdate || null,
    pastTrack: null,
    forecast: [],
  };
  const [pastTrack, gis] = await Promise.all([
    fetchPastTrack(id).catch(() => null),
    fetchBuf(`${NHC_GIS}/${id}_5day_latest.zip`).then(zipEntries).catch(() => null),
  ]);
  out.pastTrack = pastTrack;
  if (gis) {
    const linName = gis.names.find((n) => n.endsWith('_5day_lin.shp'));
    const ptsShp = gis.names.find((n) => n.endsWith('_5day_pts.shp'));
    const ptsDbf = gis.names.find((n) => n.endsWith('_5day_pts.dbf'));
    if (linName) {
      const recs = parseSHP(gis.get(linName));
      // 预报轨迹线(含当前位置到 120h):取最长折线
      const lines = recs.filter((r) => r.type === 3).flatMap((r) => r.lines).sort((a, b) => b.length - a.length);
      if (lines.length) out.forecastLine = lines[0].map((p) => [p[1], p[0]]); // shp: [lon,lat]
    }
    if (ptsShp && ptsDbf) {
      const pts = parseSHP(gis.get(ptsShp)).filter((r) => r.type === 1);
      const attrs = parseDBF(gis.get(ptsDbf));
      out.forecast = pts.map((pt, i) => {
        const a = attrs[i] || {};
        return {
          lat: pt.y, lon: pt.x,
          tau: a.TAU != null ? a.TAU : null,
          kt: a.MAXWIND != null ? a.MAXWIND : null,
          hpa: a.MSLP != null ? a.MSLP : null,
          dvlbl: a.DVLBL || null,
          ms: a.FLDATELBL ? null : null,
        };
      }).filter((p) => p.tau > 0).sort((a, b) => a.tau - b.tau);
    }
  }
  return out;
}

let cache = null;
let cacheAt = 0;

async function getNhc(force) {
  if (!force && cache && Date.now() - cacheAt < 10 * 60_000) return cache;
  const idx = JSON.parse((await fetchBuf(NHC_INDEX)).toString('utf8'));
  const storms = await Promise.allSettled((idx.activeStorms || []).map(fetchNhcStorm));
  const ok = storms.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  if (ok.length || (idx.activeStorms || []).length === 0) {
    cache = { generated: Math.floor(Date.now() / 1000), storms: ok };
    cacheAt = Date.now();
  } else if (!cache) {
    throw new Error('NHC 数据抓取失败');
  }
  return cache;
}

module.exports = { getNhc, zipEntries, parseSHP, parseDBF };
