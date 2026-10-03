/*
 * 气象派生量(纯函数,无 IO):server.js 的 live 网格与 tools/build-static.js 的烘焙
 * 共用同一实现,保证两种模式派生结果一致;所有函数 NaN 安全(输入缺测 → 输出 NaN)。
 */
'use strict';

/* Magnus 公式露点(°C) */
function dewPoint(tC, rh) {
  if (!Number.isFinite(tC) || !Number.isFinite(rh) || rh <= 0) return NaN;
  const a = 17.62, b = 243.12;
  const gamma = Math.log(Math.max(rh, 0.1) / 100) + (a * tC) / (b + tC);
  return (b * gamma) / (a - gamma);
}

/* Stull(2011)湿球温度(°C)——FFMC 高湿分支需要湿球 */
function wetBulb(tC, rh) {
  if (!Number.isFinite(tC) || !Number.isFinite(rh)) return NaN;
  const h = Math.max(1, Math.min(100, rh));
  return tC * Math.atan(0.151977 * Math.sqrt(h + 8.313659))
    + Math.atan(tC + h) - Math.atan(h - 1.676331)
    + 0.00391838 * Math.pow(h, 1.5) * Math.atan(0.023101 * h) - 4.686035;
}

/* 云底高度(m):LCL 的 Rossby 近似 125×(T−Td),钳 0..20000。
 * 地面湿度过饱和(雾)时 LCL≈0。 */
function lclHeight(tC, rh) {
  const td = dewPoint(tC, rh);
  if (!Number.isFinite(td)) return NaN;
  return Math.max(0, Math.min(20000, 125 * (tC - td)));
}

/* 细可燃物含水率(% 干重):Simard(1968)/加拿大 EMC 平衡含水率(高湿分支用湿球)
 * + 正在降水的浸润抬升(经验:雨强 ≥5 mm/h 时趋近饱和 +40)。 */
function fineFuelMoisture(tC, rh, precipRate) {
  if (!Number.isFinite(tC) || !Number.isFinite(rh)) return NaN;
  const h = Math.max(1, Math.min(100, rh));
  let emc;
  if (h < 10) emc = 0.03229 + 0.281073 * h - 0.000578 * h * h;
  else if (h < 50) emc = 2.22749 + 0.160107 * h - 0.014784 * Math.sqrt(h);
  else {
    const tw = wetBulb(tC, h);
    emc = 21.0606 + 0.005565 * h * h - 0.00035 * h * (Number.isFinite(tw) ? tw : tC) - 0.483199 * h;
  }
  emc = Math.max(0, emc);
  const wet = Number.isFinite(precipRate) && precipRate > 0 ? Math.min(40, precipRate * 8) : 0;
  return Math.min(120, emc + wet);
}

/* 潜在积冰指数 0-100:温度 -40..0°C 且 RH≥60% 时按湿度与温度窗(-10°C 峰值)线性抬升,
 * 其余为 0(无积冰条件,非缺测)。航空参考层,非取代官方 AIRMET。 */
function icingIndex(tC, rh) {
  if (!Number.isFinite(tC) || !Number.isFinite(rh)) return NaN;
  if (tC > 0 || tC < -40 || rh < 60) return 0;
  const rhF = (rh - 60) / 40;
  const tF = 1 - Math.abs(tC + 10) / 30;
  return Math.round(Math.max(0, Math.min(1, rhF * tF)) * 100);
}

/* 网格 Ellrod 晴空湍流指数:相邻两气压层的 u/v/位势高度网格(N→S、W→E 均匀经纬网格)
 * → 每点 TI×1e8(经验分档:<2 轻 / 2-4.5 中 / >4.5 强)。
 * 垂直风切变用两层风差/几何厚度;水平形变取两层形变的平均(经度向按 cos(lat) 修正)。 */
function catGrid(u1, v1, h1, u2, v2, h2, ni, nj, dlatDeg) {
  const out = new Float32Array(ni * nj).fill(NaN);
  const defAt = (u, v, j, i) => {
    const p = j * ni + i;
    const iR = (i + 1) % ni, iL = (i - 1 + ni) % ni;
    const jU = Math.max(0, j - 1), jD = Math.min(nj - 1, j + 1);
    const du = u[j * ni + iR] - u[j * ni + iL], dv = v[j * ni + iR] - v[j * ni + iL];
    const duY = u[jD * ni + i] - u[jU * ni + i], dvY = v[jD * ni + i] - v[jU * ni + i];
    if (![du, dv, duY, dvY].every(Number.isFinite)) return NaN;
    const lat = 90 - (j + 0.5) * dlatDeg;
    const dx = 2 * dlatDeg * 111320 * Math.max(0.2, Math.cos(lat * Math.PI / 180));
    const dy = 2 * dlatDeg * 110540;
    const dUdx = du / dx, dVdy = dvY / dy, dVdx = dv / dx, dUdy = duY / dy;
    return Math.hypot(dUdx - dVdy, dVdx + dUdy);
  };
  for (let j = 0; j < nj; j++) {
    for (let i = 0; i < ni; i++) {
      const p = j * ni + i;
      const dz = h2[p] - h1[p];
      if (!Number.isFinite(dz) || dz < 100) continue;
      const du = u2[p] - u1[p], dv = v2[p] - v1[p];
      if (!Number.isFinite(du) || !Number.isFinite(dv)) continue;
      const vws = Math.hypot(du / dz, dv / dz);
      const d1 = defAt(u1, v1, j, i), d2 = defAt(u2, v2, j, i);
      const def = Number.isFinite(d1) && Number.isFinite(d2) ? (d1 + d2) / 2 : (Number.isFinite(d1) ? d1 : d2);
      if (!Number.isFinite(def)) continue;
      out[p] = vws * def * 1e8;
    }
  }
  return out;
}

/* 累计最大值:对 [帧×点] 的 Float32Array 逐帧做运行最大(过程最大阵风用) */
function cumMaxFrames(arr, nFrames, nPts) {
  const out = Float32Array.from(arr);
  for (let t = 1; t < nFrames; t++) {
    const cur = t * nPts, prev = (t - 1) * nPts;
    for (let p = 0; p < nPts; p++) {
      const v = out[cur + p];
      const pv = out[prev + p];
      out[cur + p] = Number.isNaN(v) ? pv : (Number.isNaN(pv) ? v : Math.max(v, pv));
    }
  }
  return out;
}

/* 雷暴复合指数(mm/h):降水强度按 CAPE 加权 —— 无对流时即普通降水,
 * CAPE 4000 J/kg 时强度 ×5,雷雨区在图上一目了然(诊断量,非官方产品)。 */
function thunderIndex(precip, cape) {
  if (!Number.isFinite(precip)) return NaN;
  if (precip <= 0.05) return 0;
  const c = Number.isFinite(cape) ? Math.max(0, Math.min(4000, cape)) : 0;
  return precip * (1 + c / 1000);
}

module.exports = { dewPoint, wetBulb, lclHeight, fineFuelMoisture, icingIndex, catGrid, cumMaxFrames, thunderIndex };
