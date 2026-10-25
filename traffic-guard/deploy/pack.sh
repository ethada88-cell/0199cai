#!/usr/bin/env bash
# 打可部署发布包（不含 node_modules / .next / 生产账号数据 / .env 密钥）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
NAME="traffic-guard-deploy-${STAMP}"
OUT_DIR="${1:-/tmp}"
STAGE="$(mktemp -d)"
DEST="${STAGE}/${NAME}"
trap 'rm -rf "${STAGE}"' EXIT

mkdir -p "$DEST"
echo "Staging from ${ROOT} -> ${DEST}"

# 用 tar 管道拷贝，排除开发与运行时数据
tar -C "${ROOT}" \
  --exclude=node_modules \
  --exclude=.next \
  --exclude=.git \
  --exclude=./.env \
  --exclude=./.env.local \
  --exclude=./.env.production \
  --exclude='data/accounts' \
  --exclude='data/sites' \
  --exclude='data/clicks' \
  --exclude='data/cache' \
  --exclude='data/events.jsonl' \
  --exclude='data/sites.json' \
  --exclude='*.tsbuildinfo' \
  --exclude='deploy/releases' \
  --exclude=dist \
  -cf - . | tar -C "${DEST}" -xf -

mkdir -p \
  "${DEST}/data/accounts" \
  "${DEST}/data/sites" \
  "${DEST}/data/clicks" \
  "${DEST}/data/cache" \
  "${DEST}/deploy/releases"

if [[ -f "${ROOT}/node_modules/ip2region-ts/data/ip2region.xdb" ]]; then
  cp -f "${ROOT}/node_modules/ip2region-ts/data/ip2region.xdb" "${DEST}/data/ip2region.xdb"
fi

touch \
  "${DEST}/data/accounts/.gitkeep" \
  "${DEST}/data/sites/.gitkeep" \
  "${DEST}/data/clicks/.gitkeep" \
  "${DEST}/data/cache/.gitkeep"

cp -f "${DEST}/deploy/DEPLOY.md" "${DEST}/DEPLOY.md"
cp -f "${DEST}/deploy/.env.example" "${DEST}/.env.example"

mkdir -p "${OUT_DIR}"
ARCHIVE="${OUT_DIR}/${NAME}.tar.gz"
tar -C "${STAGE}" -czf "${ARCHIVE}" "${NAME}"

echo "---- archive ----"
ls -lh "${ARCHIVE}"
tar -tzf "${ARCHIVE}" | head -40
echo "... ($(tar -tzf "${ARCHIVE}" | wc -l) entries)"
echo "PACKED=${ARCHIVE}"
