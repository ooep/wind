/* 数据看门狗:检查生产 index.json 各模式起报(runKey)龄期,超阈自动补跑对应数据工作流。
 *
 * 背景:GitHub cron 高负载时会整程丢弃或延迟数小时(2026-10-03 GFS/GEFS/Wave 的
 * 当日 cron 均未触发),数据模式曾静默滞后 1-2 天才被发现。本脚本把状态页的
 * "起报龄期显红"(同阈值体系)升级为自动自愈:
 *   - 超阈且对应用工作流空闲 → dispatch 数据工作流补跑;
 *   - 超阈但工作流近 75 分钟内已有 run(可能在冷摄入)→ 改 dispatch deploy-data
 *     (把已产出的 artifact 组装上生产,等价于人工"再 dispatch 一次 deploy-data");
 *   - 一切以生产 URL 为准,Actions 缓存/队列状态不参与判断。
 * 零依赖 node ≥18。
 */
const GH = process.env.GITHUB_TOKEN;
const REPO = 'ooep/wind';
const PROD = 'https://fengyun-ak4.pages.dev/dist/data/index.json';
const RECENT_MS = 75 * 60e3; // 工作流近期已有 run 时视为"管道活着",只补部署不再开轮

/* 起报龄期阈值(小时)——与 public/status.html MODEL_FRESH 同步维护 */
const FRESH = { gfs_raw: 12, gefs_raw: 12, ecmwf_raw: 15, aifs_raw: 21, waves_raw: 12, gfs_snow: 12, ocean_raw: 48, chem_raw: 40, currents_raw: 48 };
/* 慢上游(日更/滞后 1-2 天属常态)用更宽的触发倍率,避免无效重烘 */
const SLOW = new Set(['ocean_raw', 'chem_raw', 'currents_raw']);
const WF = {
  gfs_raw: 'update-gfs.yml',
  gefs_raw: 'update-gefs.yml',
  ecmwf_raw: 'update-ecmwf.yml',
  aifs_raw: 'update-aifs.yml',
  waves_raw: 'update-waves.yml',
  ocean_raw: 'update-sst.yml',
  chem_raw: 'update-geoschem.yml',
  currents_raw: 'update-currents.yml',
  gfs_snow: 'update-gfs.yml', // 雪包由 GFS 工作流一并烘焙
};
const DEPLOY_WF = 'deploy-data.yml';

const api = (path, opts = {}) =>
  fetch(`https://api.github.com/repos/${REPO}/${path}`, {
    ...opts,
    headers: { Authorization: `token ${GH}`, Accept: 'application/vnd.github+json', ...(opts.headers || {}) },
  });

function runKeyMs(runKey) {
  const m = /^(\d{8})-(\d{2})$/.exec(String(runKey || ''));
  return m ? Date.parse(`${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6, 8)}T${m[2]}:00:00Z`) : NaN;
}

const index = await (await fetch(PROD, { headers: { 'user-agent': 'fy-watchdog/1.0' } })).json();
const models = index.models || {};
const now = Date.now();
let acted = 0;

for (const [m, e] of Object.entries(models)) {
  const fresh = FRESH[m];
  const wf = WF[m];
  if (!fresh || !wf) continue;
  const runMs = runKeyMs(e.runKey);
  if (!Number.isFinite(runMs)) { console.log(`[skip] ${m} runKey ${e.runKey} 无法解析`); continue; }
  const ageH = (now - runMs) / 3600e3;
  const threshold = fresh * (SLOW.has(m) ? 1.5 : 1.2);
  if (ageH <= threshold) { console.log(`[ok] ${m} 起报 ${ageH.toFixed(1)}h ≤ ${threshold}h`); continue; }

  const runs = await api(`actions/workflows/${wf}/runs?per_page=3`).then((r) => r.json()).catch(() => ({}));
  const rs = runs.workflow_runs || [];
  const busy = rs.some((r) => ['in_progress', 'queued', 'pending', 'waiting'].includes(r.status));
  if (busy) { console.log(`[skip] ${m} 起报 ${ageH.toFixed(1)}h > ${threshold}h,但 ${wf} 有 run 在跑/排队,不叠加 dispatch`); continue; }
  const recent = rs.some((r) => r.status === 'completed' && now - Date.parse(r.run_started_at) < RECENT_MS);
  if (recent) {
    /* 数据管道刚跑过但生产没更新 → 组装/部署环节断档(artifact 竞速或部署失败),补一次部署 */
    const res = await api(`actions/workflows/${DEPLOY_WF}/dispatches`, { method: 'POST', body: JSON.stringify({ ref: 'main' }) });
    acted++;
    console.log(`[redeploy] ${m} 起报 ${ageH.toFixed(1)}h > ${threshold}h,${wf} 近 75min 内已跑过 → dispatch ${DEPLOY_WF}: HTTP ${res.status}`);
    continue;
  }
  const res = await api(`actions/workflows/${wf}/dispatches`, { method: 'POST', body: JSON.stringify({ ref: 'main' }) });
  acted++;
  console.log(`[refill] ${m} 起报 ${ageH.toFixed(1)}h > ${threshold}h → dispatch ${wf}: HTTP ${res.status}`);
}

console.log(acted ? `看门狗触发 ${acted} 项补跑/补部署` : '所有模式起报龄期正常,无需干预');
