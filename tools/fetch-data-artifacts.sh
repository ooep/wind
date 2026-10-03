#!/bin/bash
# 拉取各模式最新的数据产物(GitHub Actions artifact)到 dist/data/。
# 数据不再提交 main:数据 workflow 只上传 artifact,部署时按模式取最新成功的产物。
# 某模式无产物或下载失败时,保留仓库内已提交的数据(bootstrap 兜底)。
set -u
export GH_TOKEN="${GH_TOKEN:-$GITHUB_TOKEN}"
REPO="${GITHUB_REPOSITORY:-ooep/wind}"

fetch_model() {
  local wf="$1" model="$2"
  local rid
  rid=$(gh run list --repo "$REPO" --workflow="$wf" --status=success -L 1 --json databaseId --jq '.[0].databaseId // empty' 2>/dev/null || true)
  if [ -z "$rid" ]; then
    echo "[$model] 无成功的 data run,保留仓库内数据"
    return 0
  fi
  echo "[$model] 下载 run $rid 的产物 data-$model"
  rm -rf /tmp/art_$model
  if ! gh run download "$rid" --repo "$REPO" --name "data-$model" --dir "/tmp/art_$model" 2>/dev/null; then
    echo "[$model] 产物下载失败,保留仓库内数据"
    return 0
  fi
  if [ -d "/tmp/art_$model/$model" ]; then
    # 全哨兵守卫:上游摄取失败也会出包(全 -32768),拒绝替换线上数据
    if node tools/check-artifact.js "/tmp/art_$model/$model"; then
      rm -rf "dist/data/$model"
      mkdir -p dist/data
      cp -r "/tmp/art_$model/$model" "dist/data/$model"
      echo "[$model] 已更新到 run 产物"
    else
      echo "[$model] 产物数据全哨兵/无效,保留仓库内数据"
    fi
  else
    echo "[$model] 产物内容异常,保留仓库内数据"
  fi
  # 用后即删,控制私有仓库 artifact 存储配额
  local aid
  aid=$(gh api "repos/$REPO/actions/runs/$rid/artifacts" --jq ".artifacts[] | select(.name==\"data-$model\") | .id" 2>/dev/null || true)
  if [ -n "$aid" ]; then gh api -X DELETE "repos/$REPO/actions/artifacts/$aid" >/dev/null 2>&1 || true; fi
}

fetch_model "update-gfs.yml"   "gfs_raw"
fetch_model "update-gfs.yml"   "gfs_snow"
fetch_model "update-gefs.yml"  "gefs_raw"
fetch_model "update-ecmwf.yml" "ecmwf_raw"
fetch_model "update-aifs.yml"  "aifs_raw"
fetch_model "update-waves.yml" "waves_raw"
fetch_model "update-sst.yml"   "ocean_raw"
fetch_model "update-currents.yml" "currents_raw"
fetch_model "update-geoschem.yml" "chem_raw"

# 观测类:一个 artifact 打包 obs/tropical/aq 三个目录(与 NWP 模式单独目录不同)
fetch_obs() {
  local rid
  rid=$(gh run list --repo "$REPO" --workflow=update-obs.yml --status=success -L 1 --json databaseId --jq '.[0].databaseId // empty' 2>/dev/null || true)
  if [ -z "$rid" ]; then
    echo "[obs] 无成功的 data run,保留仓库内数据"
    return 0
  fi
  echo "[obs] 下载 run $rid 的产物 data-obs"
  rm -rf /tmp/art_obs
  if ! gh run download "$rid" --repo "$REPO" --name "data-obs" --dir /tmp/art_obs 2>/dev/null; then
    echo "[obs] 产物下载失败,保留仓库内数据"
    return 0
  fi
  local ok=0
  for sub in obs tropical aq fires warnings quakes swx buoys rivers tides glm; do
    if [ -d "/tmp/art_obs/$sub" ]; then
      rm -rf "dist/data/$sub"
      cp -r "/tmp/art_obs/$sub" "dist/data/$sub"
      ok=1
    fi
  done
  if [ "$ok" = 1 ]; then echo "[obs] 已更新到 run 产物"; else echo "[obs] 产物内容异常,保留仓库内数据"; fi
  local aid
  aid=$(gh api "repos/$REPO/actions/runs/$rid/artifacts" --jq '.artifacts[] | select(.name=="data-obs") | .id' 2>/dev/null || true)
  if [ -n "$aid" ]; then gh api -X DELETE "repos/$REPO/actions/artifacts/$aid" >/dev/null 2>&1 || true; fi
}
fetch_obs

# 重建全局 index.json(按各模式现有产物)
node tools/build-static.js --out dist/data --index-only
