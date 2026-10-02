/* 烘焙多语言城市标注(一次性工具):
 *   NE 50m populated places(完整版,含 NAME_ZH/DE/ES/FR/PT/RU/EN)
 *   + Open-Meteo Geocoding 补译 zh/ja/ko(按 GeoNames ID 优先、坐标距离兜底匹配)。
 * 产物:public/geo/ne_50m_populated_places_simple.geojson(同名覆盖,前端 basemap 无感升级)。
 * 用法:curl -o /tmp/ne_places_full.json <50m full geojson> && node tools/bake-places-i18n.mjs
 * 缓存:/tmp/om-i18n-cache.json — 重跑只补缺失项,不重复请求。 */
import fs from 'node:fs';

const SRC = '/tmp/ne_places_full.json';
const CACHE = '/tmp/om-i18n-cache.json';
const OUT = new URL('../public/geo/ne_50m_populated_places_simple.geojson', import.meta.url).pathname;
const LANGS = ['zh', 'ja', 'ko'];

const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
const saveCache = () => fs.writeFileSync(CACHE, JSON.stringify(cache));

function havKm(a, b, c, d) {
  const r = Math.PI / 180;
  const x = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(x));
}

async function fetchOm(name, lang, lat, lon) {
  const qs = new URLSearchParams({ name, count: '10', language: lang, format: 'json' });
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?${qs}`, { signal: AbortSignal.timeout(12000) });
      if (r.status === 429) { await new Promise((s) => setTimeout(s, 3000)); continue; }
      if (!r.ok) return null;
      const d = await r.json();
      const res = d.results || [];
      return { res, lat, lon };
    } catch { await new Promise((s) => setTimeout(s, 1500)); }
  }
  return null;
}

/* 从结果里挑出与 NE 城市对应的一条:先按国家过滤(防止远端同名城匹配错),
 * 再 GeoNames ID 精确匹配 → 距离最近的 PPL → 最近 */
function pick(results, gnid, lat, lon, iso) {
  if (!results || !results.length) return null;
  let cands = results;
  if (iso) {
    const same = results.filter((x) => !x.country_code || x.country_code === iso);
    if (same.length) cands = same;
  }
  const byId = cands.find((x) => x.id === gnid);
  if (byId) return byId;
  const ok = cands.filter((x) => havKm(lat, lon, x.latitude, x.longitude) < 40);
  if (!ok.length) return null;
  const ppl = ok.filter((x) => /^PPL/.test(x.feature_code || ''));
  return (ppl.length ? ppl : ok).sort((a, b) =>
    havKm(lat, lon, a.latitude, a.longitude) - havKm(lat, lon, b.latitude, b.longitude))[0];
}

async function pool(items, n, fn) {
  let i = 0, done = 0;
  const workers = Array.from({ length: n }, async () => {
    while (i < items.length) {
      const it = items[i++];
      await fn(it);
      done++;
      if (done % 100 === 0) { saveCache(); console.log(`progress ${done}/${items.length}`); }
    }
  });
  await Promise.all(workers);
}

const src = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const feats = src.features.filter((f) => f.properties && f.properties.NAME);
console.log('features:', feats.length);

/* 收集缺失翻译任务 */
const jobs = [];
for (const f of feats) {
  const p = f.properties;
  for (const lang of LANGS) {
    const key = `${p.GEONAMEID}:${lang}`;
    if (!(key in cache)) jobs.push({ f, lang, key });
  }
}
console.log('translations to fetch:', jobs.length);

await pool(jobs, 6, async ({ f, lang, key }) => {
  const p = f.properties;
  const d = await fetchOm(p.NAME, lang, p.LATITUDE, p.LONGITUDE);
  if (!d) { cache[key] = null; return; }
  const hit = pick(d.res, p.GEONAMEID, p.LATITUDE, p.LONGITUDE, p.ISO_A2);
  /* 只存真正本地化的名字(与 ASCII 名不同),未翻译的回落英文名,不占体积 */
  const name = hit ? hit.name : null;
  cache[key] = name && name !== p.NAMEASCII && name !== p.NAME ? name : null;
});
saveCache();

/* 组装输出 */
const out = {
  type: 'FeatureCollection',
  features: feats.map((f) => {
    const p = f.properties;
    const [lon, lat] = f.geometry.coordinates;
    const zh = cache[`${p.GEONAMEID}:zh`], ja = cache[`${p.GEONAMEID}:ja`], ko = cache[`${p.GEONAMEID}:ko`];
    return {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [+lon.toFixed(4), +lat.toFixed(4)] },
      properties: {
        name: p.NAME,
        name_en: p.NAME_EN || p.NAME,
        name_zh: zh || p.NAME_ZH || null,   /* 简体:OM zh,缺则回落 NE 中文名 */
        name_zht: p.NAME_ZH || null,        /* 繁体:NE 中文名(来源偏繁) */
        name_ja: ja || null,
        name_ko: ko || null,
        name_de: p.NAME_DE || null, name_fr: p.NAME_FR || null, name_es: p.NAME_ES || null,
        name_pt: p.NAME_PT || null, name_ru: p.NAME_RU || null,
        pop_max: p.POP_MAX || 0,
        featurecla: p.FEATURECLA || '',
        worldcity: p.WORLDCITY || 0,
      },
    };
  }),
};
fs.writeFileSync(OUT, JSON.stringify(out));
const named = (k) => out.features.filter((f) => f.properties[k]).length;
console.log('written:', OUT, (fs.statSync(OUT).size / 1024).toFixed(0) + 'KB',
  '| zh:', named('name_zh'), 'ja:', named('name_ja'), 'ko:', named('name_ko'), 'ru:', named('name_ru'));
