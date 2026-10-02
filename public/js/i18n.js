/* i18n:轻量多语言 — 词典 + 语言检测/持久化/切换通知 + 静态 DOM 文案应用。
 * 语言包在 ./i18n/ 下(zh-CN 为源语言内置于本文件,en 为次级回退)。
 * t(key, vars) 取字符串,{name} 插值;ta(key) 取数组(星期/方位等)。
 * 切换语言:setLang(code) → 持久化 + <html lang> + 通知全部订阅者
 * (main.js 重建图层栏/图例/模式胶囊,basemap 重绘地名,panel 重渲染)。 */
import zhTW from './i18n/zh-TW.js';
import en from './i18n/en.js';
import ja from './i18n/ja.js';
import ko from './i18n/ko.js';
import de from './i18n/de.js';
import fr from './i18n/fr.js';
import es from './i18n/es.js';
import pt from './i18n/pt.js';
import ru from './i18n/ru.js';

export const LANGUAGES = [
  { code: 'zh-CN', label: '简体中文' },
  { code: 'zh-TW', label: '繁體中文' },
  { code: 'en', label: 'English' },
  { code: 'ja', label: '日本語' },
  { code: 'ko', label: '한국어' },
  { code: 'de', label: 'Deutsch' },
  { code: 'fr', label: 'Français' },
  { code: 'es', label: 'Español' },
  { code: 'pt', label: 'Português' },
  { code: 'ru', label: 'Русский' },
];

const ZH_CN = {
  'meta.title': '风云地球 FengyunEarth · 实时全球气象可视化',
  'lang.label': '语言',
  /* 顶栏 / 设置 */
  'ui.searchPh': '搜索城市 / 地点…',
  'ui.myLoc': '我的位置',
  'ui.favBtn': '收藏地点',
  'ui.particles': '风场粒子',
  'ui.particlesTitle': '切换风场粒子动画',
  'ui.overlayHead': '实时叠加',
  'ui.satTitle': '卫星通道',
  'ui.opacity': '透明度',
  'ui.bm': '底图',
  'ui.bmTitle': '底图:矢量线划不会被气象图层遮挡;深色为本地陆地填充;卫星为影像+线划混合;地形为等高线图',
  'ui.bmVector': '矢量线划', 'ui.bmDark': '深色陆地', 'ui.bmSat': '卫星 + 线划', 'ui.bmTerrain': '地形(实验)',
  'ui.bmHillshade': '地形晕渲(NASA SRTM)',
  'ui.unitsTitle': '单位设置',
  'ui.legendBtnTitle': '图例显示 / 隐藏',
  'ui.globeTitle': '3D 地球视图',
  'ui.measureTitle': '测距 / 测面积',
  'ui.fsTitle': '全屏切换',
  'ui.shareTitle': '复制分享链接',
  'ui.aboutTitle': '数据来源与说明',
  'ui.settings': '设置',
  'ui.modelPillTitle': '当前图层的数值预报模式(自建原始数据管道,无 key 无配额)',
  'ui.pipeGroup': '自建管道',
  'ui.omGroup': 'Open-Meteo 备用',
  'ui.playTitle': '播放 / 暂停(空格)',
  'ui.speedTitle': '播放速度',
  'ui.stepBackT': '后退1小时', 'ui.stepFwdT': '前进1小时', 'ui.stepNowT': '回到当前', 'ui.stepNow': '现在',
  'ui.nowFab': '⟲ 回到当前',
  'ui.panelTitle': '位置',
  'ui.panelFav': '收藏此地点',
  'ui.gridLoading': '正在加载气象场数据…',
  'ui.meInfo': '点击地图加点',
  'ui.meDone': '完成', 'ui.meClear': '清除', 'ui.meExit': '退出',
  'ui.attribData': '数据', 'ui.attribLightning': '闪电', 'ui.attribTC': '台风', 'ui.attribBasemap': '底图',
  'ui.legendCycle': '点击切换单位',
  /* 分组 / 图层 / 叠加 */
  'group.obs': '观测', 'group.wind': '风', 'group.temp': '温湿', 'group.cloud': '云雨', 'group.snow': '雪',
  'group.conv': '对流气压', 'group.ground': '土壤', 'group.fire': '火险', 'group.ocean': '海洋', 'group.air': '空气', 'group.chem': '空气场',
  'layer.wind': '风场', 'layer.gust': '阵风', 'layer.barbs': '风向杆', 'layer.temp': '温度', 'layer.feels': '体感',
  'layer.wetbulb': '湿球温度', 'layer.dew': '露点', 'layer.humidity': '湿度', 'layer.frzlvl': '0°C层高度',
  'layer.cloud': '总云量', 'layer.lcdc': '低云', 'layer.mcdc': '中云', 'layer.hcdc': '高云', 'layer.cwat': '云水',
  'layer.fog': '雾', 'layer.precip': '降水', 'layer.precip24': '降水·24h', 'layer.precip72': '降水·72h',
  'layer.ptype': '相态', 'layer.vis': '能见度', 'layer.snow': '积雪', 'layer.newsnow': '新雪',
  'layer.cape': '雷暴 CAPE', 'layer.cin': '对流抑制', 'layer.pwat': '可降水', 'layer.pressure': '气压',
  'layer.gph': '位势高度', 'layer.soilw': '土壤湿度', 'layer.soilt': '土壤温度', 'layer.fire': '火险',
  'layer.wpd': '风功率密度', 'layer.ssta': '海温距平', 'layer.dust': '沙尘', 'layer.pm25f': 'PM2.5 场',
  'layer.pmtot': 'PM 总量', 'layer.so2f': 'SO₂ 场', 'layer.so4f': '硫酸盐', 'layer.nh3f': '氨',
  'layer.ocf': '有机碳(烟)', 'layer.bcf': '黑碳', 'layer.nif': '硝酸盐', 'layer.co2f': '二氧化碳',
  'layer.radar': '雷达', 'layer.wvh': '波高', 'layer.wvp': '波周期', 'layer.swvh': '涌浪高度', 'layer.swvp': '涌浪周期',
  'layer.wwh': '风浪高度', 'layer.wwp': '风浪周期', 'layer.wve': '波浪能量', 'layer.sst': '海温',
  'layer.aqi': '空气质量', 'layer.no2': '二氧化氮', 'layer.o3': '臭氧', 'layer.so2': '二氧化硫', 'layer.uv': 'UV 指数',
  /* 卫星观测(GIBS)与后续扩充图层 */
  'layer.fires': '活跃火点', 'layer.imerg': '卫星降水', 'layer.lst': '地表温度', 'layer.smap': '卫星土壤湿',
  'layer.frozen': '冻土', 'layer.ndvi': '植被指数', 'layer.aerosol': '气溶胶指数', 'layer.chl': '叶绿素',
  'layer.seaice': '海冰浓度', 'layer.vapor': '大气水汽',
  'layer.gustmax': '最大阵风·过程', 'layer.solar': '太阳辐射', 'layer.icing': '积冰风险', 'layer.cat': '晴空湍流',
  'layer.thermals': '热气流·边界层顶', 'layer.cloudbase': '云底高度', 'layer.cloudtop': '云顶高度',
  'layer.extprob': '极端天气概率', 'layer.ffmc': '可燃物含水率', 'layer.cof': '一氧化碳',
  'layer.sw2h': '涌浪2·高度', 'layer.sw2p': '涌浪2·周期', 'layer.sw3h': '涌浪3·高度', 'layer.sw3p': '涌浪3·周期',
  'group.satobs': '卫星观测', 'group.sun': '太阳', 'group.aviation': '航空',
  'fireConf': ['低', '中', '高'],
  'lv.strong': '强', 'lv.medium': '中', 'lv.light': '轻',
  'ffmc.wet': '湿', 'ffmc.ok': '适中', 'ffmc.dry': '干', 'ffmc.vdry': '极干',
  'overlay.lightning': '闪电', 'overlay.lightning.title': 'Blitzortung 实时闪电 · 最近 90 分钟',
  'overlay.satellite': '卫星', 'overlay.satellite.title': '卫星云图:GOES/向日葵9 红外与真彩(10 分钟)/ 全球真彩·夜光(VIIRS 每日)',
  'overlay.tropical': '台风', 'overlay.tropical.title': '活动热带气旋路径:JMA(西太平洋)+ NOAA NHC(大西洋/东太平洋)',
  'overlay.stations': '站点', 'overlay.stations.title': '全球机场/气象站 METAR 实测(NOAA,每小时更新)',
  'overlay.snowcover': '雪盖', 'overlay.snowcover.title': '雪盖观测:NASA VIIRS NDSI 日产品(卫星反演雪盖范围,每日更新)',
  'overlay.aurora': '极光', 'overlay.aurora.title': 'NOAA SWPC OVATION 极光概率(未来 30-90 分钟,每 30 分钟更新)',
  /* 模式 */
  'model.gfs_raw': 'NOAA GFS 0.5°(AWS 开放数据,原始 GRIB2 自解码)',
  'model.gfs_snow': 'NOAA GFS 0.5° 高分辨雪包(仅积雪/新雪,AWS 开放数据,原始 GRIB2 自解码)',
  'model.gefs_raw': 'NOAA GEFS 控制成员 0.5°(AWS 开放数据,原始 GRIB2 自解码)',
  'model.ecmwf_raw': 'ECMWF IFS 0.25°(ECMWF Open Data,原始 GRIB2 自解码)',
  'model.aifs_raw': 'ECMWF AIFS 0.25°(AI 模式,ECMWF Open Data,原始 GRIB2 自解码)',
  'model.waves_raw': 'NOAA GFS Wave 0.25°(海浪模式,AWS 开放数据,原始 GRIB2 自解码)',
  'model.ocean_raw': 'NOAA OISST 日更海温(NCEI,逐日分析场)',
  'model.best_match': 'Open-Meteo 最佳匹配', 'model.gfs_seamless': 'Open-Meteo NOAA GFS',
  'model.icon_seamless': 'Open-Meteo DWD ICON', 'model.ecmwf_ifs025': 'Open-Meteo ECMWF IFS',
  'modelShort.gfs_raw': 'NOAA GFS', 'modelShort.gfs_snow': 'GFS 雪', 'modelShort.gefs_raw': 'NOAA GEFS',
  'modelShort.ecmwf_raw': 'ECMWF IFS', 'modelShort.aifs_raw': 'ECMWF AIFS', 'modelShort.waves_raw': 'NOAA Wave',
  'modelShort.ocean_raw': 'OISST 海温', 'modelShort.best_match': 'OM 最佳匹配', 'modelShort.gfs_seamless': 'OM GFS',
  'modelShort.icon_seamless': 'OM ICON', 'modelShort.ecmwf_ifs025': 'OM ECMWF',
  'panelModel.gfs_raw': 'NOAA GFS 0.5°(自建管道)', 'panelModel.gefs_raw': 'NOAA GEFS 0.5°(自建管道)',
  'panelModel.ecmwf_raw': 'ECMWF IFS 0.25°(自建管道)', 'panelModel.aifs_raw': 'ECMWF AIFS 0.25°(自建管道)',
  'panelModel.best_match': 'Open-Meteo 最佳匹配', 'panelModel.gfs_seamless': 'Open-Meteo GFS',
  'panelModel.icon_seamless': 'Open-Meteo ICON', 'panelModel.ecmwf_ifs025': 'Open-Meteo ECMWF',
  'panel.modelFallback': 'Open-Meteo 模式数据',
  'level.surface': '表面',
  /* 单位设置 */
  'urow.temp': '温度', 'urow.wind': '风速', 'urow.pressure': '气压', 'urow.precip': '降水',
  'urow.timefmt': '时间制', 'urow.tz': '时区',
  'unit.C': '°C', 'unit.F': '°F', 'unit.ms': 'm/s', 'unit.kmh': 'km/h', 'unit.kt': '节', 'unit.mph': 'mph',
  'unit.hpa': 'hPa', 'unit.inhg': 'inHg', 'unit.mm': 'mm', 'unit.in': 'in',
  'unit.24h': '24 小时', 'unit.12h': '12 小时', 'unit.local': '本地', 'unit.utc': 'UTC',
  /* 通用词汇 */
  'dir8': ['北', '东北', '东', '东南', '南', '西南', '西', '西北'],
  'dir8E': ['东', '东南', '南', '西南', '西', '西北', '北', '东北'],
  'weekdays': ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
  'windFmt': '{dir}风',
  'ptypelv': ['—', '雨', '冻雨', '雪'],
  'foglv': ['—', '可能', '大概率', '雾'],
  'firelv.ext': '极端', 'firelv.vhigh': '很高', 'firelv.high': '高', 'firelv.med': '中', 'firelv.low': '低',
  /* toast / hint */
  'toast.layerUnavailable': '「{name}」的数据模式尚未上线,请稍后再试',
  'toast.layerLoadFail': '图层数据加载失败:{msg}',
  'toast.partialVars': '部分图层数据未就绪:{msg}',
  'toast.stale': '上游数据源限流中,正在展示约 {h} 小时前缓存的气象数据',
  'toast.quota': '数据源当日免费配额已用尽,明日自动恢复;设置 OPEN_METEO_API_KEY 环境变量可获得更高配额(见 README)',
  'toast.ratelimit': '上游数据源限流中,90 秒后自动重试…',
  'toast.gridFail': '气象格点加载失败:{msg},15 秒后自动重试',
  'toast.geoUnsupported': '浏览器不支持定位',
  'toast.locating': '正在获取位置…',
  'toast.locFail': '定位失败:未授权或不可用',
  'toast.copyOk': '分享链接已复制到剪贴板',
  'toast.copyFail': '复制失败,请手动复制地址栏链接',
  'toast.fullscreen': '浏览器拒绝了全屏请求',
  'toast.firstVisit': '点击地图任意位置查看该点详细预报 · 悬停可读取数值 · 空格播放时间动画',
  'hint.layer': '图层 · {name}',
  'hint.switched': '图层 · {name} · 已切换到 {model}',
  'hint.model': '模式 · {model}',
  'hint.level': '气压层 · {v} hPa',
  'hint.noUnit': '该图层暂无单位切换',
  'hint.legendOff': '图例已隐藏', 'hint.legendOn': '图例已显示',
  /* 时间轴 */
  'tl.now': '当前', 'tl.past': '过去 {n} 小时', 'tl.fcst': '预报 +{n} 小时',
  'tl.radarExtrap': '雷达外推', 'tl.local': '本地',
  /* 点位面板 */
  'panel.locating': '定位中…',
  'panel.elev': ' · 海拔 {n} m',
  'panel.cachedAt': ' · 缓存于 {t}(上游限流)',
  'panel.src': '数据源:{model},插值到该点坐标{stale}',
  'panel.loadFail': '加载失败',
  'panel.errBody': '{msg},请稍后重试。',
  'panel.fallbackName': '{lat}, {lon}',
  'tab.h48': '48 小时', 'tab.mg': '气象图', 'tab.d7': '7 天', 'tab.ag': '剖面', 'tab.ap': '机场',
  'tab.aq': '空气', 'tab.cmp': '对比', 'tab.wave': '海浪',
  'pstat.feels': '体感 {v}°', 'pstat.wind': '风速 {dir}', 'pstat.gust': '阵风', 'pstat.rh': '相对湿度',
  'pstat.msl': '海平面气压', 'pstat.cloud': '云量', 'pstat.precipNow': '当前降水',
  'panel.cmpFetching': '并行获取多模式预报…', 'panel.cmpNone': '各模式数据暂不可用,请稍后重试',
  'panel.cmpNote': '温度曲线逐 3h(虚线轴 °C);曲线缺失表示该模式数据暂未就绪',
  'chart.temp': '温度', 'chart.wind': '风速 {u}', 'chart.precip': '降水 mm',
  'panel.seriesShort': '序列数据不足',
  'chart.mgTemp': '— 温度', 'chart.mgDew': '-- 露点', 'chart.mgPrcp': '▮降水', 'chart.mgPres': '—气压', 'chart.mgWind': '↑风向风速 m/s',
  'panel.waveFetching': '获取海浪预报…', 'panel.waveNone': '该位置无海浪数据(内陆或数据未覆盖)',
  'chart.waveH': '波高 m · 箭头=浪向', 'panel.waveSrc': '数据源:Open-Meteo Marine(ECMWF WAM)· 波高 / 浪向 / 周期预报',
  'panel.agFetching': '获取气压层数据…', 'chart.agLegend': '温度填色 · 白虚线=0°C · 箭头=风向风速',
  'panel.agSrc': '数据源:Open-Meteo(GFS 气压层)· 1000→150 hPa 对数高度轴',
  'ap.fetching': '检索附近机场与观测…',
  'ap.wind': '风 {v}', 'ap.vrb': '不定', 'ap.gust': ' 阵{v}', 'ap.vis': '能见度 {v}', 'ap.noObs': '暂无该站观测',
  'ap.raw': '原文', 'ap.taf': 'TAF 预报', 'ap.updated': ' · 观测更新于 {t}',
  'ap.src': 'METAR/TAF:aviationweather.gov(NOAA,公有领域){age}',
  'air.uv': 'UV 指数{band}', 'air.aqi': 'US AQI{band}', 'air.o3': '臭氧 O₃', 'air.no2': '二氧化氮',
  'air.so2': '二氧化硫', 'air.dust': '沙尘', 'air.pollen': '{name}花粉 粒/m³',
  'chart.uv48': 'UV 指数(48h)',
  'air.src': '数据源:Open-Meteo Air Quality(CAMS 全球)· 灰柱=PM2.5 相对量',
  'pollen.grass': '草', 'pollen.birch': '桦树', 'pollen.mugwort': '艾草', 'pollen.olive': '橄榄', 'pollen.ragweed': '豚草', 'pollen.alder': '桤木',
  'day.today': '今天', 'day.tomorrow': '明天',
  'panel.daysNote': '日期为当地时间;💧 为降水概率峰值(GFS 自建管道无此项,显示 —)。',
  /* 天气现象(WMO) */
  'wmo.0': '晴', 'wmo.1': '基本晴', 'wmo.2': '多云', 'wmo.3': '阴',
  'wmo.45': '雾', 'wmo.48': '雾凇', 'wmo.51': '小毛毛雨', 'wmo.53': '毛毛雨', 'wmo.55': '浓毛毛雨',
  'wmo.56': '冻毛毛雨', 'wmo.57': '浓冻毛毛雨',
  'wmo.61': '小雨', 'wmo.63': '中雨', 'wmo.65': '大雨', 'wmo.66': '冻雨', 'wmo.67': '强冻雨',
  'wmo.71': '小雪', 'wmo.73': '中雪', 'wmo.75': '大雪', 'wmo.77': '雪粒',
  'wmo.80': '小阵雨', 'wmo.81': '阵雨', 'wmo.82': '强阵雨', 'wmo.85': '阵雪', 'wmo.86': '强阵雪',
  'wmo.95': '雷暴', 'wmo.96': '雷暴伴冰雹', 'wmo.99': '强雷暴伴冰雹', 'wmo.unknown': '—',
  /* 空气质量分级 */
  'aqiBand': ['优', '良', '轻度污染', '中度污染', '重度污染', '严重污染'],
  'uvBand': ['低', '中', '高', '很高', '极高'],
  'aqi.gen': 'CAMS 预报 · {h}:00 更新', 'aqi.genShort': 'CAMS 预报',
  'aqi.tipA': '空气令人满意,基本无健康风险|极少数敏感人群应减少户外活动|敏感人群症状可能轻度加剧|普遍建议减少长时间户外活动|健康人群普遍出现症状|所有人应避免户外活动',
  'aqi.tipB': '浓度基于 CAMS 全球模式,城市代表值',
  /* 站点实况 */
  'wx.TS': '雷暴', 'wx.RA': '雨', 'wx.SN': '雪', 'wx.DZ': '毛毛雨', 'wx.SH': '阵雨', 'wx.GR': '冰雹',
  'wx.FZ': '冻雨', 'wx.FG': '雾', 'wx.BR': '轻雾', 'wx.HZ': '霾', 'wx.FU': '烟', 'wx.DU': '浮尘',
  'wx.SS': '沙暴', 'wx.DS': '尘暴', 'wx.BLDU': '扬沙', 'wx.BLSN': '吹雪', 'wx.VCSH': '附近阵雨',
  'wx.TSRA': '雷雨', 'wx.RASN': '雨夹雪', 'wx.UP': '未知降水',
  'wx.strong': '大', 'wx.weak': '小',
  'st.metar': 'METAR 实测', 'st.justNow': '刚刚', 'st.hoursAgo': '{n} 小时前', 'st.gust': ' 阵风{v}m/s',
  /* 台风 */
  'trop.td': '热带低压', 'trop.ts': '热带风暴', 'trop.ty': '台风/飓风', 'trop.major': '强台风/强飓风',
  'trop.default': '热带气旋', 'trop.jma': '日本气象厅', 'trop.nhc': 'NOAA NHC',
  'trop.number': '第{n}号', 'trop.dir': '{dir}方向',
  /* 卫星通道 */
  'satCh.auto': '自动 · 按视野', 'satCh.irh': '红外 · 向日葵9(亚洲/大洋洲)', 'satCh.irw': '红外 · GOES-West(太平洋)',
  'satCh.ire': '红外 · GOES-East(美洲/大西洋)', 'satCh.geow': '真彩 · GOES-West(昼夜融合)',
  'satCh.geoe': '真彩 · GOES-East(昼夜融合)', 'satCh.truecolor': '真彩 · 全球(VIIRS 每日)',
  'satCh.night': '夜光 · 全球(VIIRS 每日)', 'sat.attribution': 'NASA GIBS / VIIRS 昼夜波段',
  /* 收藏 / 测量 / 3D / 搜索 */
  'favs.empty': '暂无收藏', 'favs.emptyHint': '点击地图任意位置,在面板右上角点 ☆ 收藏该地点', 'favs.del': '删除收藏',
  'me.click': '点击地图加点 · 双击或「完成」闭合量面积 · Esc 退出',
  'me.start': '测量模式已开启:点击地图开始量算', 'me.need2': '至少需要 2 个点',
  'me.seg': '本段 {seg} · 总计 {total} / {nm} nm', 'me.polygon': '周长 {total} / {nm} nm · 面积 {area}',
  'me.more': ' · 继续点击加点',
  'globe.back': '✕ 返回地图', 'globe.backTitle': '返回 2D 地图', 'globe.err': '地球底图加载失败:{msg}',
  'search.none': '未找到匹配地点', 'search.favsCap': '★ 收藏地点', 'search.resultsCap': '─ 搜索结果 ─',
  /* 错误 */
  'err.modelMissing': '静态数据未包含模式 {model}',
  'err.varMissing': '变量 {vk} 数据尚未生成({status}),等待下一轮数据管道',
  'err.gridHttp': '格点加载失败 ({status})',
  'err.pointHttp': '预报加载失败 ({status})',
  'err.marine': '海浪数据加载失败',
  'err.geocode': '地名检索失败',
  'err.radar': '雷达数据加载失败',
  'err.obsNotReady': '观测数据未就绪({status}),首次部署后约 1 小时内可用',
  'err.obsLoad': '观测数据加载失败',
  'err.agLoad': '高空剖面数据加载失败', 'err.agEmpty': '高空剖面数据为空',
  'err.aqLoad': '空气质量数据加载失败', 'err.aqEmpty': '空气质量数据为空',
  'err.elev': '海拔查询失败',
  'err.airports': '机场库加载失败({status})',
  'err.noGlobal': '模式 {model} 的静态数据尚未生成',
  'err.globalHttp': '全局数据包加载失败({status})',
  'err.globalNoGrid': '全局数据包缺少网格定义',
  /* 关于弹窗(每项 [标题, HTML 正文]) */
  'about.title': '数据来源与说明',
  'about.rows': [
    ['气象模式数据', '<b>自建管道(默认),三套模式可切换:</b><br>① <b>NOAA GFS</b> 0.5°(主引擎)② <b>NOAA GEFS</b> 控制成员 0.5°(集合预报)③ <b>ECMWF IFS</b> 0.25°(欧洲中期天气预报中心,全球参考模式)。<br>全部直接获取官方原始 GRIB2(GFS/GEFS 来自 <a href="https://registry.opendata.aws/noaa-gfs-bdp-pds/" target="_blank" rel="noopener">AWS 开放数据</a>,ECMWF 来自 <a href="https://confluence.ecmwf.int/display/DAC/ECMWF+open+data" target="_blank" rel="noopener">ECMWF Open Data</a>,均无 key 无配额),自研解码器解析、单位换算、格点采样与点预报在本服务内完成。GFS/GEFS 时间窗为过去 24h ~ 未来 7 天;ECMWF 因发布延迟约 6~8 小时。预报存在模式误差,请以官方气象部门发布为准。另含 <b>NOAA GFS Wave</b> 海浪专用模式(「海洋」分组)。'],
    ['海浪模式', '<b>NOAA GFS Wave</b> 全球 0.25°(与大气 GFS 同源 AWS 开放数据,public domain)— 有效波高 / 主波周期 / 主波方向 / 涌浪高度与周期 / 风浪高度与周期 / 波浪能量(kW/m,按 0.49·H²·T 计算),原始 GRIB2(JPEG2000 压缩)自解码,粒子按波高着色传播方向推进;时间窗过去 24h ~ 未来 7.5 天,0-120h 逐小时。'],
    ['空气质量图层', 'Open-Meteo Air Quality(CAMS 全球)— 全球主要城市 US AQI / PM2.5 / PM10 / O₃ / NO₂ / SO₂ / UV 逐小时预报,定时烘焙后随站点分发。'],
    ['降水雷达', '<a href="https://www.rainviewer.com/" target="_blank" rel="noopener">RainViewer</a> — 汇聚各国气象局雷达站观测,约 10 分钟更新;含未来 30 分钟外推。'],
    ['实时闪电', '<a href="https://blitzortung.org/" target="_blank" rel="noopener">Blitzortung.org</a> — 社区雷电探测网络(全球数千 volunteer 探测站),WebSocket 实时推送,展示最近 90 分钟落雷,颜色越亮越新。'],
    ['台风 / 飓风', '西太平洋:日本气象厅 <a href="https://www.jma.go.jp/jma/indexe.html" target="_blank" rel="noopener">JMA</a> 官方路径与预报(过去轨迹 / 24-72h 预报 / 概率圆);大西洋与东中太平洋:NOAA <a href="https://www.nhc.noaa.gov/" target="_blank" rel="noopener">NHC</a> 预报轨迹 + 过去实况(ATCF),每小时刷新。'],
    ['站点实况', '<a href="https://aviationweather.gov/" target="_blank" rel="noopener">aviationweather.gov</a>(NOAA,公有领域)— 全球约 900 个机场/气象站 METAR 实测(气温/露点/风/气压/天气现象),每小时更新,点击站点圆点查看详情。'],
    ['卫星云图图层', '<a href="https://worldview.earthdata.nasa.gov/" target="_blank" rel="noopener">NASA GIBS</a> — 全球真彩(VIIRS,每日)与 GOES-East/West 红外(10.3µm 云顶温度,10 分钟刷新),可与任意主图层叠加并随时间轴回放。'],
    ['机场 METAR/TAF', '<a href="https://aviationweather.gov/" target="_blank" rel="noopener">aviationweather.gov</a>(NOAA,公有领域)— 全球机场实况报文与航路预报,服务端每小时烘焙;机场库来自 <a href="https://davidmegginson.github.io/ourairports-data/" target="_blank" rel="noopener">OurAirports</a>(公有领域,约 5700 个)。'],
    ['空气质量 / UV', 'Open-Meteo Air Quality(CAMS 全球)— PM2.5 / PM10 / O₃ / NO₂ / SO₂ / 沙尘 / US AQI / UV 指数,逐小时预报;欧洲另含花粉。'],
    ['空气质量全球场(GEOS-5)', '<b>NASA GMAO GEOS-5 FP</b>(OPeNDAP 免账号直读,3 小时步长)— 沙尘 / PM2.5 / PM 总量 / SO₂ / 硫酸盐 / 氨 / 有机碳 / 黑碳 / 硝酸盐地表质量浓度与 CO₂ 地表浓度,与 earth.nullschool 空气质量组同源;点击「空气场」分组图层即自动切换到该模式查看。'],
    ['极光 / 海温距平 / 风功率密度', '<b>极光</b>:NOAA SWPC OVATION Prime(未来 30-90 分钟概率,每 30 分钟更新);<b>海温距平</b>:NOAA OISST v2.1 相对 1991-2020 气候态(nullschool SSTA 同源);<b>风功率密度</b>:由 10m 风场派生 ½ρv³。'],
    ['高空剖面', 'Open-Meteo 气压层数据(GFS)— 1000→150 hPa 共 11 层的温度/风/云,用于点位「剖面」视图。'],
    ['卫星影像', '<a href="https://worldview.earthdata.nasa.gov/" target="_blank" rel="noopener">NASA GIBS / Worldview</a> — NASA 官方 VIIRS/MODIS 真彩影像,每日更新。'],
    ['地名检索', 'Open-Meteo Geocoding(GeoNames 数据),结果跟随界面语言本地化。'],
    ['底图', '<a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener">Natural Earth</a> 矢量线划(海岸线/国界/湖泊/城市标注,已本地化,公有领域);「深色陆地」为本地渲染的陆地填充;「卫星 + 线划」影像来自 NASA GIBS;「地形」来自 <a href="https://opentopomap.org/" target="_blank" rel="noopener">OpenTopoMap</a>(CC-BY-SA)。矢量底图渲染在气象图层之上,不会被填色遮挡。城市标注按界面语言显示本地化名称。'],
    ['快捷键', '<b>空格</b> 播放/暂停时间动画 · <b>←</b>/<b>→</b> 前后步进 1 小时 · <b>↑</b>/<b>↓</b> 切换图层 · <b>PgUp</b>/<b>PgDn</b> 升降气压层 · <b>+</b>/<b>−</b> 缩放地图 · <b>F</b> 聚焦搜索 · <b>Esc</b> 关闭面板/弹窗/测量。鼠标悬停地图任意位置可读取当前图层数值;点击左栏底部色标可循环切换单位;时间轴右侧可调播放速度'],
  ],
  'about.license': '开放数据许可:NOAA GFS 为美国官方产出(public domain);Open-Meteo 数据 CC BY 4.0(非商业免费,商业使用需授权)。本站为技术演示,不构成任何气象决策依据。',
  'panel.sun': '🌅 {rise} 日出 · 🌇 {set} 日落(当地)',
  'panel.noData': '无数据',
  'panel.aqFetching': '获取空气质量与 UV…',
  'st.temp': '气温', 'st.dew': '露点', 'st.wind': '风', 'st.msl': '海平面气压', 'st.vis': '能见度', 'st.wx': '天气',
  'trop.maxWind': '最大风速', 'trop.pressure': '中心气压', 'trop.movement': '移向移速', 'trop.issue': '发布时间',
  'globe.hint': '拖拽旋转 · 滚轮缩放 · 点击查询该点',
};

const DICTS = {
  'zh-CN': ZH_CN,
  'zh-TW': zhTW, en, ja, ko, de, fr, es, pt, ru,
};

/* 回退链:当前语言 → 指定回退(zh-TW→zh-CN,繁简互通优于英文)→ en → zh-CN */
const FALLBACK = { 'zh-TW': 'zh-CN' };

let lang = null;
const listeners = [];

function detect() {
  let saved = null;
  try { saved = localStorage.getItem('fy_lang'); } catch { /* 隐私模式 */ }
  if (saved && DICTS[saved]) return saved;
  const cands = navigator.languages || [navigator.language || 'en'];
  for (const c of cands) {
    if (!c) continue;
    const lo = c.toLowerCase();
    if (lo.startsWith('zh')) return /tw|hk|mo|hant/.test(lo) ? 'zh-TW' : 'zh-CN';
    if (DICTS[c]) return c;
    const base = lo.split('-')[0];
    if (DICTS[base]) return base;
  }
  return 'zh-CN';
}

export function getLang() { return lang; }
export function onChange(cb) { listeners.push(cb); }

export function setLang(code) {
  if (!DICTS[code] || code === lang) return;
  lang = code;
  try { localStorage.setItem('fy_lang', code); } catch { /* 隐私模式 */ }
  document.documentElement.lang = code;
  applyDom();
  for (const cb of listeners) cb(code);
}

function lookup(key) {
  return DICTS[lang]?.[key] ?? DICTS[FALLBACK[lang]]?.[key] ?? DICTS.en[key] ?? DICTS['zh-CN'][key];
}
function lookupRaw(key) {
  for (const d of [DICTS[lang], DICTS[FALLBACK[lang]], DICTS.en, DICTS['zh-CN']]) {
    if (d && key in d) return d[key];
  }
  return undefined;
}
/* 键是否存在(供「缺省回落原值」的场景使用,如动态图层的 label) */
export function has(key) { return lookupRaw(key) !== undefined; }

/* 字符串取值,{var} 插值;数组请用 ta() */
export function t(key, vars) {
  const s = lookup(key);
  if (typeof s !== 'string') return s != null ? String(s) : key;
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
}
/* 数组取值(星期/方位/分级) */
export function ta(key) {
  const a = lookup(key);
  return Array.isArray(a) ? a : [];
}

/* Open-Meteo Geocoding 的 language 参数 */
export function omLang() {
  switch (lang) {
    case 'zh-CN': return 'zh';
    case 'zh-TW': return 'zh-tw';
    default: return lang;
  }
}
/* Natural Earth 地名文件的本地化字段名(null = 用原始 name) */
export function neNameField() {
  switch (lang) {
    case 'zh-CN': case 'zh-TW': return 'name_zh';
    case 'ja': return 'name_ja';
    case 'ko': return 'name_ko';
    case 'de': return 'name_de';
    case 'fr': return 'name_fr';
    case 'es': return 'name_es';
    case 'pt': return 'name_pt';
    case 'ru': return 'name_ru';
    default: return null;
  }
}

/* 应用静态 DOM 文案(首次进入与每次切换语言时调用) */
export function applyDom(root = document) {
  document.title = t('meta.title');
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-ph]')) el.placeholder = t(el.dataset.i18nPh);
  for (const el of root.querySelectorAll('[data-i18n-title]')) el.title = t(el.dataset.i18nTitle);
  for (const el of root.querySelectorAll('[data-i18n-og]')) el.label = t(el.dataset.i18nOg);
}

/* 顶栏语言选择器:填充选项并接管 change */
export function initLangSelect() {
  const sel = document.getElementById('lang-select');
  if (!sel) return;
  sel.innerHTML = LANGUAGES.map((l) => `<option value="${l.code}">${l.label}</option>`).join('');
  sel.value = lang;
  sel.addEventListener('change', () => setLang(sel.value));
}

lang = detect();
document.documentElement.lang = lang;
