/* 大湖包围盒(经纬度 lon0, lon1, lat0, lat1):海洋图层(海浪/海温)的排除区。
 * 这些湖盆是陆地多边形的"洞",遮罩层盖不住,而外推会把最近的海值一路填进来,
 * 导致内陆出现海洋颜色 —— 外推时按壁垒跳过,遮罩与粒子位图按陆地处理。 */
export const LAKE_BOXES = [
  { name: 'Caspian', lon0: 46.5, lon1: 54.5, lat0: 36.5, lat1: 47.5 },
  { name: 'Aral', lon0: 57.5, lon1: 62.0, lat0: 43.5, lat1: 47.0 },
  { name: 'Baikal', lon0: 103.0, lon1: 110.5, lat0: 51.3, lat1: 56.2 },
  { name: 'LadogaOnega', lon0: 30.0, lon1: 36.5, lat0: 60.5, lat1: 63.5 },
  { name: 'GreatLakes', lon0: -93.5, lon1: -75.5, lat0: 40.2, lat1: 49.5 },
  { name: 'GreatBear', lon0: -122.0, lon1: -115.5, lat0: 64.0, lat1: 67.0 },
  { name: 'GreatSlave', lon0: -116.0, lon1: -107.0, lat0: 60.0, lat1: 63.0 },
  { name: 'Victoria', lon0: 31.2, lon1: 35.2, lat0: -3.2, lat1: 0.7 },
  { name: 'Balkhash', lon0: 73.0, lon1: 79.5, lat0: 44.5, lat1: 47.0 },
];

/* 格点中心是否落在任一湖盆内(海洋图层的扩展壁垒) */
export function inLakeBox(lon, lat) {
  for (const b of LAKE_BOXES) {
    if (lon >= b.lon0 && lon <= b.lon1 && lat >= b.lat0 && lat <= b.lat1) return true;
  }
  return false;
}
