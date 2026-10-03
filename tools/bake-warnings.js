/* 烘焙官方气象预警 → dist/data/warnings/latest.json
 * 数据源(零密钥):
 *  - 美国 NWS api.weather.gov active alerts(带多边形,severity=Moderate/Severe/Extreme)
 *  - 欧洲 meteoalarm.org 按国 atom feed(仅区域代码,无几何 → 聚合到国家级徽标点)
 * 输出:{generated, nws:{alerts:[{id,ev,lv,area,ends,poly}]}, eu:{countries:[{cc,zh,lat,lon,lv,n,items}]}}
 * lv: 1 黄 / 2 橙 / 3 红。多边形抽稀(2dp + 首尾保留 + 上限抽点)控制体积。 */
'use strict';
const fs = require('fs');
const path = require('path');

const OUT = process.argv[2] || 'dist/data';
const NWS_URL = 'https://api.weather.gov/alerts/active?severity=Moderate,Severe,Extreme&status=actual';
const UA = { 'User-Agent': 'fengyun-earth weather site', Accept: 'application/geo+json' };

/* 欧洲各国 meteoalarm feed 名 + 徽标点坐标(经度,纬度,国土中心近似)+ 中文名 */
const EU = [
  ['albania', 'AL', '阿尔巴尼亚', 20.1, 41.1],
  ['andorra', 'AD', '安道尔', 1.5, 42.5],
  ['austria', 'AT', '奥地利', 14.1, 47.6],
  ['belgium', 'BE', '比利时', 4.6, 50.6],
  ['bosnia-herzegovina', 'BA', '波黑', 17.8, 44.0],
  ['bulgaria', 'BG', '保加利亚', 25.2, 42.7],
  ['croatia', 'HR', '克罗地亚', 16.4, 45.2],
  ['cyprus', 'CY', '塞浦路斯', 33.2, 35.1],
  ['czechia', 'CZ', '捷克', 15.3, 49.8],
  ['denmark', 'DK', '丹麦', 10.5, 56.0],
  ['estonia', 'EE', '爱沙尼亚', 25.7, 58.7],
  ['finland', 'FI', '芬兰', 26.0, 63.5],
  ['france', 'FR', '法国', 2.4, 46.8],
  ['germany', 'DE', '德国', 10.4, 51.2],
  ['greece', 'GR', '希腊', 22.5, 39.5],
  ['hungary', 'HU', '匈牙利', 19.4, 47.2],
  ['iceland', 'IS', '冰岛', -18.6, 65.0],
  ['ireland', 'IE', '爱尔兰', -8.1, 53.2],
  ['israel', 'IL', '以色列', 35.0, 31.4],
  ['italy', 'IT', '意大利', 12.6, 42.6],
  ['latvia', 'LV', '拉脱维亚', 24.9, 56.9],
  ['lithuania', 'LT', '立陶宛', 24.0, 55.3],
  ['luxembourg', 'LU', '卢森堡', 6.1, 49.8],
  ['malta', 'MT', '马耳他', 14.4, 35.9],
  ['moldova', 'MD', '摩尔多瓦', 28.5, 47.2],
  ['montenegro', 'ME', '黑山', 19.3, 42.8],
  ['netherlands', 'NL', '荷兰', 5.6, 52.2],
  ['north-macedonia', 'MK', '北马其顿', 21.7, 41.6],
  ['norway', 'NO', '挪威', 9.5, 61.5],
  ['poland', 'PL', '波兰', 19.4, 52.1],
  ['portugal', 'PT', '葡萄牙', -8.2, 39.6],
  ['romania', 'RO', '罗马尼亚', 25.0, 45.9],
  ['serbia', 'RS', '塞尔维亚', 20.9, 44.2],
  ['slovakia', 'SK', '斯洛伐克', 19.7, 48.7],
  ['slovenia', 'SI', '斯洛文尼亚', 14.8, 46.1],
  ['spain', 'ES', '西班牙', -3.7, 40.2],
  ['sweden', 'SE', '瑞典', 15.5, 62.0],
  ['switzerland', 'CH', '瑞士', 8.2, 46.8],
  ['ukraine', 'UA', '乌克兰', 31.2, 49.0],
  ['united-kingdom', 'GB', '英国', -1.5, 52.7],
];

const SEV_LV = { Extreme: 3, Severe: 2, Moderate: 1 };
const COLOR_LV = { Yellow: 1, Orange: 2, Red: 3 };

const toUTC = (s) => {
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 16) : '';
};

async function getJSON(url, headers) {
  const r = await fetch(url, { headers: headers || {} });
  if (!r.ok) throw new Error(`HTTP ${r.status} ${url.slice(0, 80)}`);
  return r.json();
}

/* 多边形抽稀:保留首尾点,2 位小数,>上限时等距抽点 */
function pruneRing(ring, cap) {
  const out = [];
  let last = null;
  for (const [x, y] of ring) {
    const p = [Math.round(x * 100) / 100, Math.round(y * 100) / 100];
    if (!last || p[0] !== last[0] || p[1] !== last[1]) out.push(p);
    last = p;
  }
  if (out.length > cap) {
    const thin = [out[0]];
    const step = (out.length - 1) / (cap - 1);
    for (let i = 1; i < cap - 1; i++) thin.push(out[Math.round(i * step)]);
    thin.push(out[out.length - 1]);
    return thin;
  }
  return out;
}

function pruneGeom(geom) {
  if (!geom) return null;
  const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.type === 'MultiPolygon' ? geom.coordinates : null;
  if (!polys) return null;
  const out = [];
  for (const poly of polys) {
    if (out.length >= 4) break;               // 最多 4 个子多边形
    out.push(poly.slice(0, 3).map((ring, i) => pruneRing(ring, i === 0 ? 160 : 40)));
  }
  return out.length ? out : null;
}

async function bakeNWS() {
  const alerts = [];
  let url = NWS_URL;
  for (let page = 0; page < 4 && url && alerts.length < 700; page++) {
    const d = await getJSON(url, UA);
    for (const f of d.features || []) {
      const p = f.properties || {};
      const lv = SEV_LV[p.severity] || 0;
      if (!lv || p.status !== 'Actual') continue;
      const poly = pruneGeom(f.geometry);
      if (!poly) continue;
      alerts.push({
        id: (p.id || '').split('/').pop(),
        ev: p.event || '',
        lv,
        area: p.areaDesc || '',
        ends: toUTC(p.ends || p.expires || ''),
        poly,
      });
    }
    url = (d.pagination && d.pagination.next) || null;
  }
  const rank = { 3: 0, 2: 1, 1: 2 };
  alerts.sort((a, b) => rank[a.lv] - rank[b.lv] || (a.ends > b.ends ? 1 : -1));
  return alerts;
}

/* meteoalarm atom 条目(零依赖 regex 解析);源数据存在双重转义(&amp;amp;),循环解到无实体为止 */
const unesc = (s) => {
  for (let i = 0; i < 3 && /&(?:amp|lt|gt|quot|apos);/.test(s); i++) {
    s = s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
  }
  return s;
};
function parseAtom(xml) {
  const entries = [];
  for (const m of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1];
    const tag = (t) => { const x = e.match(new RegExp(`<cap:${t}>([^<]*)</cap:${t}>`)); return x ? unesc(x[1].trim()) : ''; };
    const ev = tag('event');                     // 形如 "Yellow Wind Warning"
    const color = ev.split(' ')[0];
    const lv = COLOR_LV[color] || 0;
    if (!lv) continue;
    entries.push({
      ev: unesc(ev.replace(/^(Yellow|Orange|Red)\s+/, '')),
      lv,
      area: tag('areaDesc'),
      ends: toUTC(tag('expires')),
      sent: tag('sent'),
    });
  }
  return entries;
}

async function bakeEU() {
  const countries = [];
  let okFeeds = 0;
  await Promise.all(EU.map(async ([slug, cc, zh, lon, lat]) => {
    try {
      const r = await fetch(`https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-${slug}`, { headers: { 'User-Agent': 'fengyun-earth' } });
      if (!r.ok) return;
      const entries = parseAtom(await r.text());
      okFeeds++;
      if (!entries.length) return;
      /* 同名预警合并,记录区域清单 */
      const byEv = new Map();
      let lv = 0;
      for (const it of entries) {
        lv = Math.max(lv, it.lv);
        const k = `${it.lv}|${it.ev}`;
        if (!byEv.has(k)) byEv.set(k, { ev: it.ev, lv: it.lv, areas: [] });
        const g = byEv.get(k);
        if (g.areas.length < 10 && it.area && !g.areas.includes(it.area)) g.areas.push(it.area);
      }
      countries.push({
        cc, zh, lat, lon, lv, n: entries.length,
        items: [...byEv.values()].sort((a, b) => b.lv - a.lv).slice(0, 12),
      });
    } catch { /* 单国失败不株连 */ }
  }));
  countries.sort((a, b) => b.lv - a.lv || b.n - a.n);
  return { countries, okFeeds };
}

(async () => {
  const t0 = Date.now();
  const dir = path.join(OUT, 'warnings');
  fs.mkdirSync(dir, { recursive: true });

  const [nws, eu] = await Promise.all([bakeNWS().catch((e) => { console.error('[nws]', e.message); return []; }), bakeEU()]);

  /* 守卫:两源全失败时保留旧文件,避免空包上线 */
  if (!nws.length && !eu.countries.length) {
    console.error('所有预警源均为空 — 视为摄取失败,不覆盖输出');
    process.exit(1);
  }
  const data = {
    generated: new Date().toISOString(),
    source: 'NWS api.weather.gov + meteoalarm.org',
    nws: { count: nws.length, alerts: nws },
    eu: { okFeeds: eu.okFeeds, countries: eu.countries },
  };
  const file = path.join(dir, 'latest.json');
  fs.writeFileSync(file, JSON.stringify(data));
  const kb = Math.round(fs.statSync(file).size / 1024);
  console.log(`warnings: nws=${nws.length} eu_countries=${eu.countries.length}/${eu.okFeeds} → ${file} ${kb}KB (${Date.now() - t0}ms)`);
})();
