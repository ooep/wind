#!/bin/sh
# Cloudflare Pages 构建脚本:把前端与已提交的静态数据组装成单一输出目录 _site。
# Pages 项目绑定本仓库后,每次 main 有新提交(含数据 Action 提交的 dist/data)都会自动执行并重新部署。
set -e
mkdir -p _site/dist/data
cp -r public/. _site/
cp -r dist/data/. _site/dist/data/
cat > _site/_headers <<'EOF'
/*
  Cache-Control: public, max-age=300
/dist/data/*
  Cache-Control: public, max-age=86400
/dist/data/index.json
  Cache-Control: no-cache
EOF
echo "_site 组装完成:"
find _site -type f | head -20
