#!/usr/bin/env bash
# Sao luu du lieu app (cai dat, ke hoach, bai dang, nhat ky). Giu 14 ban gan nhat.
# KHONG sao luu media/ (nang) — anh/video nen luu them o Drive hoac noi khac.
set -euo pipefail
APP_DIR=/opt/salon-agentic-ai
DB="$APP_DIR/data/db.json"
[ -f "$DB" ] || exit 0
mkdir -p "$APP_DIR/backup"
cp "$DB" "$APP_DIR/backup/db-$(date +%Y%m%d).json"
# Nhat ky kiem toan (audit.jsonl) — chi co khi app da ghi
[ -f "$APP_DIR/data/audit.jsonl" ] && cp "$APP_DIR/data/audit.jsonl" "$APP_DIR/backup/audit-$(date +%Y%m%d).jsonl" || true
ls -1t "$APP_DIR"/backup/audit-*.jsonl 2>/dev/null | tail -n +15 | xargs -r rm -f
ls -1t "$APP_DIR"/backup/db-*.json | tail -n +15 | xargs -r rm -f
