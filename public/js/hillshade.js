/* 地形晕渲底图(AWS Terrain Tiles / terrarium 编码,SRTM 30m 等混合源):
 * 免登录、CORS 开放。每瓦片解码高程(RGB→米)→ 3×3 盒模糊抑噪 → 坡面光照 → 深色系晕渲。
 * 配色对齐站点深色主题:海洋按深度微调,陆地低地深灰 → 高地亮灰,仅极高雪峰提亮。 */
const TERRARIUM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

const OCEAN_DEEP = [9, 18, 32];
const OCEAN_SHALLOW = [14, 28, 46];
const LAND_LOW = [34, 40, 50];
const LAND_HIGH = [104, 112, 126];
const SNOW = [150, 160, 176];

/* 西北向光照;STRENGTH 抑制过度坡面响应 */
const LX = -0.58, LY = -0.58, LZ = 0.57, STRENGTH = 1.35;

export const HillshadeLayer = L.GridLayer.extend({
  createTile(coords, done) {
    const size = this.getTileSize();
    const tile = document.createElement('canvas');
    tile.width = size.x; tile.height = size.y;
    const ctx = tile.getContext('2d');
    const attempt = (retry) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          ctx.drawImage(img, 0, 0, size.x, size.y);
          shade(ctx, size.x, size.y);
        } catch { /* tainted canvas 等异常:保留空瓦片 */ }
        done(null, tile);
      };
      img.onerror = () => {
        if (retry > 0) setTimeout(() => attempt(retry - 1), 900);
        else done(null, tile);
      };
      img.src = L.Util.template(TERRARIUM, coords);
    };
    attempt(1);
    return tile;
  },
});

function shade(ctx, w, h) {
  const data = ctx.getImageData(0, 0, w, h);
  const px = data.data;
  const n = w * h;
  const elev = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    elev[i] = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768;
  }
  /* 3×3 盒模糊:压掉 SRTM 高频噪点,保留山体尺度起伏 */
  const blur = new Float32Array(n);
  for (let y = 0; y < h; y++) {
    const y0 = y > 0 ? y - 1 : 0, y1 = y < h - 1 ? y + 1 : h - 1;
    for (let x = 0; x < w; x++) {
      const x0 = x > 0 ? x - 1 : 0, x1 = x < w - 1 ? x + 1 : w - 1;
      let s = 0;
      for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) s += elev[yy * w + xx];
      blur[y * w + x] = s / ((y1 - y0 + 1) * (x1 - x0 + 1));
    }
  }
  for (let y = 0; y < h; y++) {
    const yb = Math.min(h - 1, y + 1);
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const e = blur[i];
      let r, g, b;
      if (e <= 0.5) {
        const t = Math.min(1, Math.max(0, -e / 5000));
        r = OCEAN_SHALLOW[0] + (OCEAN_DEEP[0] - OCEAN_SHALLOW[0]) * t;
        g = OCEAN_SHALLOW[1] + (OCEAN_DEEP[1] - OCEAN_SHALLOW[1]) * t;
        b = OCEAN_SHALLOW[2] + (OCEAN_DEEP[2] - OCEAN_SHALLOW[2]) * t;
      } else {
        const xr = Math.min(w - 1, x + 1);
        const dx = (blur[y * w + xr] - e) * STRENGTH;
        const dy = (blur[yb * w + x] - e) * STRENGTH;
        let light = 0.55 + (LX * dx + LY * dy + LZ) / Math.sqrt(dx * dx + dy * dy + 1);
        light = Math.min(1.18, Math.max(0.42, light));
        const t = Math.min(1, e / 4500);
        const base = [
          LAND_LOW[0] + (LAND_HIGH[0] - LAND_LOW[0]) * t,
          LAND_LOW[1] + (LAND_HIGH[1] - LAND_LOW[1]) * t,
          LAND_LOW[2] + (LAND_HIGH[2] - LAND_LOW[2]) * t,
        ];
        const snowT = e > 5200 ? Math.min(0.85, (e - 5200) / 1600) : 0;
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
