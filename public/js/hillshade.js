/* 地形晕渲底图(AWS Terrain Tiles / terrarium 编码,SRTM 30m 等混合源):
 * 免登录、CORS 开放。每瓦片解码高程(RGB→米)→ 计算坡面光照 → 深色系晕渲。
 * 海洋(高程≤0)按深度微调色相,陆地按高程做暗色阶梯 + 西北向光照,风格对齐深色主题。 */
const TERRARIUM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

const OCEAN_DEEP = [10, 20, 36];
const OCEAN_SHALLOW = [16, 34, 54];
const LAND_LOW = [38, 48, 62];
const LAND_HIGH = [168, 176, 190];
const SNOW = [214, 222, 232];

/* 光照方向(西北)与强度 */
const LX = -0.62, LY = -0.62, LZ = 0.48, STRENGTH = 2.1;

export const HillshadeLayer = L.GridLayer.extend({
  createTile(coords, done) {
    const size = this.getTileSize();
    const tile = document.createElement('canvas');
    tile.width = size.x; tile.height = size.y;
    const ctx = tile.getContext('2d');
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        ctx.drawImage(img, 0, 0, size.x, size.y);
        shade(ctx, size.x, size.y, coords.z);
      } catch { /* tainted canvas 等异常:保留空瓦片 */ }
      done(null, tile);
    };
    img.onerror = () => done(null, tile);
    img.src = L.Util.template(TERRARIUM, coords);
    return tile;
  },
});

function shade(ctx, w, h, z) {
  const data = ctx.getImageData(0, 0, w, h);
  const px = data.data;
  const elev = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    elev[i] = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768;
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const e = elev[i];
      let r, g, b;
      if (e <= 0.5) {
        // 海洋:深度越深越暗,无光照
        const t = Math.min(1, Math.max(0, -e / 5000));
        r = OCEAN_SHALLOW[0] + (OCEAN_DEEP[0] - OCEAN_SHALLOW[0]) * t;
        g = OCEAN_SHALLOW[1] + (OCEAN_DEEP[1] - OCEAN_SHALLOW[1]) * t;
        b = OCEAN_SHALLOW[2] + (OCEAN_DEEP[2] - OCEAN_SHALLOW[2]) * t;
      } else {
        const xr = Math.min(w - 1, x + 1), yb = Math.min(h - 1, y + 1);
        const dx = (elev[y * w + xr] - e) * STRENGTH;
        const dy = (elev[yb * w + x] - e) * STRENGTH;
        // 邻域取值在高程平缓处近似偏导;晕渲 = 环境光 + 法线·光照
        let light = 0.62 + (LX * dx + LY * dy + LZ) / Math.sqrt(dx * dx + dy * dy + 1);
        light = Math.min(1.45, Math.max(0.25, light));
        // 高程阶梯:低地深灰 → 高地亮灰 → 雪线白
        const t = Math.min(1, e / 3200);
        const base = [
          LAND_LOW[0] + (LAND_HIGH[0] - LAND_LOW[0]) * t,
          LAND_LOW[1] + (LAND_HIGH[1] - LAND_LOW[1]) * t,
          LAND_LOW[2] + (LAND_HIGH[2] - LAND_LOW[2]) * t,
        ];
        const snowT = e > 3600 ? Math.min(1, (e - 3600) / 1200) : 0;
        r = base[0] * light + (SNOW[0] - base[0]) * snowT;
        g = base[1] * light + (SNOW[1] - base[1]) * snowT;
        b = base[2] * light + (SNOW[2] - base[2]) * snowT;
      }
      const o = i * 4;
      px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = 255;
    }
  }
  ctx.putImageData(data, 0, 0);
}
