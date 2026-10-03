/* 烘焙全球主要大河径流(GloFAS)→ dist/data/rivers/latest.json
 * 数据源:Open-Meteo Flood API(零密钥,CORS 开放;点查无格点产品 → 烘焙精选河流点)。
 * 每点取近 2 天 + 未来 3 天日径流(m³/s),前端点大小按对数径流,弹卡看 5 天趋势。
 * 新鲜守卫:20h 内已烘焙则跳过(挂每小时 update-obs,日更即可)。 */
'use strict';
const fs = require('fs');
const path = require('path');

const OUT = process.argv[2] || 'dist/data';
const URL = (lat, lon) => `https://flood-api.open-meteo.com/v1/flood?latitude=${lat}&longitude=${lon}&daily=river_discharge&past_days=2&forecast_days=3&timezone=UTC`;

/* [名称, 中文名, lon, lat] — 每条大河取一个代表性干流点 */
const RIVERS = [
  ['Yangtze (Datong)', '长江·大通', 117.6, 30.85],
  ['Yellow River (Jinan)', '黄河·济南', 117.0, 36.7],
  ['Pearl (Wuzhou)', '珠江·梧州', 111.28, 23.47],
  ['Songhua (Jilin)', '松花江·吉林', 126.55, 43.85],
  ['Mekong (Phnom Penh)', '湄公河·金边', 104.9, 11.6],
  ['Ganges (Hardwar)', '恒河·哈德瓦尔', 78.0, 29.9],
  ['Brahmaputra (Bahadurabad)', '雅鲁藏布·巴哈杜拉巴德', 89.65, 25.15],
  ['Indus (Tarbela)', '印度河·塔贝拉', 72.5, 34.1],
  ['Ob (Salekhard)', '鄂毕河·萨列哈尔德', 66.6, 66.5],
  ['Yenisei (Igarka)', '叶尼塞河·伊加尔卡', 86.5, 67.4],
  ['Lena (Kyusyur)', '勒拿河·丘西尔', 127.5, 70.5],
  ['Amur (Komsomolsk)', '黑龙江·共青城', 137.0, 50.5],
  ['Volga (Volgograd)', '伏尔加河·伏尔加格勒', 44.5, 48.7],
  ['Danube (Budapest)', '多瑙河·布达佩斯', 19.05, 47.5],
  ['Rhine (Lobith)', '莱茵河·洛比特', 6.1, 51.85],
  ['Elbe (Dresden)', '易北河·德累斯顿', 13.75, 51.05],
  ['Po (Pontelagoscuro)', '波河·蓬特拉戈斯库罗', 11.6, 44.9],
  ['Dnieper (Kiev)', '第聂伯河·基辅', 30.55, 50.45],
  ['Don (Kalach)', '顿河·卡拉奇', 42.0, 50.4],
  ['Niger (Lokoja)', '尼日尔河·洛科贾', 6.75, 7.8],
  ['Congo (Mbandaka)', '刚果河·姆班达卡', 18.25, 0.05],
  ['Nile (Cairo)', '尼罗河·开罗', 31.25, 30.1],
  ['Zambezi (Katima Mulilo)', '赞比西河·卡蒂马穆利洛', 24.3, -17.5],
  ['Orange (Vioolsdrif)', '奥兰治河·菲奥尔斯德里夫', 16.8, -28.75],
  ['Mississippi (Vicksburg)', '密西西比河·维克斯堡', -90.9, 32.3],
  ['Missouri (Hermann)', '密苏里河·赫尔曼', -91.45, 38.7],
  ['Ohio (Louisville)', '俄亥俄河·路易斯维尔', -85.75, 38.25],
  ['Rio Grande (Laredo)', '格兰德河·拉雷多', -99.5, 27.5],
  ['Yukon (Pilot Station)', '育空河·皮洛特站', -162.9, 61.9],
  ['Columbia (The Dalles)', '哥伦比亚河·达尔斯', -121.2, 45.6],
  ['Sacramento (Verona)', '萨克拉门托河·维罗纳', -121.65, 38.75],
  ['Mackenzie (Arctic Red R.)', '马更些河·北极红河', -134.3, 67.45],
  ['Fraser (Hope)', '弗雷泽河·霍普', -121.45, 49.4],
  ['Parana (Corrientes)', '巴拉那河·科连特斯', -58.8, -27.45],
  ['Amazon (Obidos)', '亚马逊河·奥比杜斯', -55.5, -1.9],
  ['Orinoco (Ciudad Bolivar)', '奥里诺科河·玻利瓦尔城', -64.15, 8.1],
  ['Magdalena (Calamar)', '马格达莱纳河·卡拉马尔', -74.9, 10.25],
  ['Murray (Blanchetown)', '墨累河·布兰奇特敦', 139.6, -34.85],
  ['Fly (Bosset)', '弗莱河·博塞特', 142.9, -7.6],
  ['Sepik (Ambunti)', '塞皮克河·安布恩蒂', 142.95, -4.2],
  ['Danube (Delta)', '多瑙河·三角洲', 29.1, 45.35],
  ['Rhone (Beaucaire)', '罗讷河·博凯尔', 4.65, 43.85],
  ['Vistula (Tczew)', '维斯瓦河·特切夫', 18.75, 54.1],
  ['Seine (Poses)', '塞纳河·波兹', 1.25, 49.3],
  ['Loire (Montjean)', '卢瓦尔河·蒙让', -0.9, 47.4],
  ['Ebro (Tortosa)', '埃布罗河·托尔托萨', 0.55, 40.75],
  ['Douro (Pinhao)', '杜罗河·皮尼昂', -7.55, 41.2],
  ['Tigris (Baghdad)', '底格里斯河·巴格达', 44.4, 33.35],
  ['Euphrates (Hillah)', '幼发拉底河·希拉', 44.45, 32.45],
  ['Amu Darya (Kerki)', '阿姆河·克尔基', 63.75, 37.85],
  ['Syr Darya (Kazalinsk)', '锡尔河·卡扎林斯克', 61.3, 45.75],
  ['Irrawaddy (Sagaing)', '伊洛瓦底江·实皆', 95.95, 21.9],
  ['Chao Phraya (Nakhon Sawan)', '昭披耶河·那空沙旺', 100.15, 15.7],
  ['Red River (Hanoi)', '红河·河内', 105.85, 21.05],
  ['Xi (Wuzhou alt)', '西江·梧州(备用)', 111.3, 23.5],
  ['Han (Hanjiang)', '汉江·仙桃', 113.45, 30.65],
];

const FRESH_MS = 20 * 3600e3;

(async () => {
  const t0 = Date.now();
  const dir = path.join(OUT, 'rivers');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'latest.json');

  /* 新鲜守卫:20h 内的包直接复用 */
  if (fs.existsSync(file)) {
    try {
      const old = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Date.parse(old.generated) > Date.now() - FRESH_MS) {
        console.log(`rivers: 包仅 ${Math.round((Date.now() - Date.parse(old.generated)) / 360e3) / 100}h 新,跳过`);
        return;
      }
    } catch { /* 重烘 */ }
  }

  const results = await Promise.allSettled(RIVERS.map(async ([name, zh, lon, lat]) => {
    const r = await fetch(URL(lat, lon), { headers: { 'User-Agent': 'fengyun-earth' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    const times = d.daily?.time, qs = d.daily?.river_discharge;
    if (!Array.isArray(times) || !Array.isArray(qs)) throw new Error('格式异常');
    const series = times.map((t, i) => [t, Number.isFinite(qs[i]) ? Math.round(qs[i] * 10) / 10 : null]);
    return { name, zh, lon, lat, series };
  }));
  const stations = results.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  if (!stations.length) { console.error('Open-Meteo Flood 全部失败 — 保留旧文件,不覆盖输出'); process.exit(1); }
  console.error(`rivers: ${RIVERS.length - stations.length} 点失败(不株连)`);

  fs.writeFileSync(file, JSON.stringify({ generated: new Date().toISOString(), source: 'GloFAS via Open-Meteo Flood', count: stations.length, stations }));
  console.log(`rivers: ${stations.length}/${RIVERS.length} → ${file} ${Math.round(fs.statSync(file).size / 1024)}KB (${Date.now() - t0}ms)`);
})();
