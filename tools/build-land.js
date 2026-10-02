/*
 * 烘焙陆地多边形(深色底图用):world-atlas land-50m TopoJSON → 紧凑坐标数组。
 * 用法: node tools/build-land.js <land-50m.json> [out]
 * 输出 public/geo/land-50m.json:{ rings: [ [ [lon,lat],... ] 外环... ] , bbox 逐环 }
 * 坐标量化到 0.01°(最大缩放 10 级下 1km 精度足够),文件约为原始一半。
 */
'use strict';
const fs = require('fs');

const input = process.argv[2] || '/tmp/land-50m.json';
const OUT = process.argv[3] || require('path').join(__dirname, '..', 'public', 'geo', 'land-50m.json');
const Q = (v) => Math.round(v * 100) / 100;

const topo = JSON.parse(fs.readFileSync(input, 'utf8'));
const { scale, translate } = topo.transform;

/* 解码 arc:delta 整数 → 绝对坐标 */
const arcs = topo.arcs.map((arc) => {
  let x = 0, y = 0;
  return arc.map(([dx, dy]) => {
    x += dx; y += dy;
    return [Q(x * scale[0] + translate[0]), Q(y * scale[1] + translate[1])];
  });
});
function ringCoords(ring) {
  const out = [];
  for (const idx of ring) {
    let pts = idx >= 0 ? arcs[idx] : arcs[~idx].slice().reverse();
    if (out.length) pts = pts.slice(1); // 环内去重复点
    out.push(...pts);
  }
  return out;
}

const geoms = topo.objects.land.geometries;
const rings = [];
let pts = 0;
function collect(arcRings) {
  for (let i = 0; i < arcRings.length; i++) {
    const c = ringCoords(arcRings[i]);
    if (c.length < 4) continue;
    let minLon = 180, maxLon = -180, minLat = 90, maxLat = -90;
    for (const [lon, lat] of c) {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
    rings.push({ c, b: [minLon, minLat, maxLon, maxLat] });
    pts += c.length;
  }
}
for (const g of geoms) {
  if (g.type === 'Polygon') collect(g.arcs);
  else if (g.type === 'MultiPolygon') for (const poly of g.arcs) collect(poly);
}

/* 紧凑序列化:{r:[lon,lat...扁平],b:[bbox]} */
const out = {
  rings: rings.map((r) => ({ r: r.c.flat(), b: r.b })),
};
fs.writeFileSync(OUT, JSON.stringify(out));
const mb = (fs.statSync(OUT).size / 1e6).toFixed(2);
console.log(`land-50m.json → ${OUT} (${mb} MB, ${rings.length} 环, ${pts} 点)`);
