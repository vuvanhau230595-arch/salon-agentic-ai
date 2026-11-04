#!/usr/bin/env bash
# Giu khoi site cua Salon Agentic AI trong Caddyfile.
# Vi sao can: script cai dat Salon POS ghi lai TOAN BO /etc/caddy/Caddyfile tu dau, lam mat khoi agent.
# Cach lam: neu khoi cua ten mien khong con thi them lai, kiem tra hop le roi moi nap; loi thi khoi phuc.
# An toan: khong dung vao file neu file hien tai da khong hop le; khong chay chong cheo; chi them khi thieu.
set -euo pipefail

CADDYFILE="${CADDYFILE:-/etc/caddy/Caddyfile}"
DOMAIN_FILE="${DOMAIN_FILE:-/etc/salon-agentic-caddy.domain}"
PORT="${PORT:-3950}"
WAIT="${GUARD_WAIT:-8}"            # doi script khac ghi xong (cat > Caddyfile, roi >> , roi restart)
RELOAD="${GUARD_RELOAD:-systemctl reload caddy}"   # dat GUARD_RELOAD=true khi thu nghiem
LOCK="${GUARD_LOCK:-/run/salon-agentic-caddy-guard.lock}"

log() { logger -t salon-agentic-guard "$*" 2>/dev/null || true; echo "$*"; }

exec 9>"$LOCK"
flock -n 9 || exit 0              # dang co ban khac chay

[ -f "$DOMAIN_FILE" ] || exit 0
DOMAIN="$(tr -d '[:space:]' < "$DOMAIN_FILE")"
[[ "$DOMAIN" =~ ^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$ ]] || { log "ten mien khong hop le trong $DOMAIN_FILE"; exit 0; }

sleep "$WAIT"
[ -f "$CADDYFILE" ] || exit 0

has_block() { grep -qE "^[[:space:]]*${DOMAIN//./\\.}[[:space:]]*\{" "$CADDYFILE"; }
has_block && exit 0

# Khong dong vao file dang hong (co the script khac van dang ghi do)
if ! caddy validate --config "$CADDYFILE" --adapter caddyfile >/dev/null 2>&1; then
  log "Caddyfile hien tai khong hop le, khong sua (se thu lai o lan kiem tra sau)"
  exit 0
fi

BACKUP="$CADDYFILE.bak-guard-$(date +%Y%m%d-%H%M%S)"
cp "$CADDYFILE" "$BACKUP"
cat >> "$CADDYFILE" <<EOF

# Salon Agentic AI (tu them lai boi caddy-guard)
$DOMAIN {
	encode gzip
	header -Alt-Svc
	request_body {
		max_size 1100MB
	}
	reverse_proxy 127.0.0.1:$PORT
}
EOF

if caddy validate --config "$CADDYFILE" --adapter caddyfile >/dev/null 2>&1; then
  $RELOAD
  log "Khoi $DOMAIN bi mat khoi Caddyfile -> da them lai va nap (ban sao: $BACKUP)"
else
  cp "$BACKUP" "$CADDYFILE"
  log "Khoi them vao khong hop le -> DA KHOI PHUC Caddyfile cu (khong dung toi Caddy)"
fi

# Giu toi da 10 ban sao cua script nay
ls -1t "$CADDYFILE".bak-guard-* 2>/dev/null | tail -n +11 | xargs -r rm -f
