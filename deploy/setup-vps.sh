#!/usr/bin/env bash
# Cài / cập nhật Salon Agentic AI trên VPS Ubuntu. Chạy bằng root, thường qua deploy.ps1.
# An toàn khi chạy lại: KHÔNG đụng vào data/, media/, .env đang có.
# Dùng:  bash setup-vps.sh [ten-mien]      vd: bash setup-vps.sh agent.theonehairsalon.vn
set -euo pipefail

APP_DIR=/opt/salon-agentic-ai
SERVICE=salon-agentic-ai
APP_USER=salonagent
PORT=3950
DOMAIN="${1:-}"

say() { printf '\n==> %s\n' "$*"; }
die() { printf '\nLOI: %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" = 0 ] || die "Hay chay bang root (hoac sudo)."
[ -f "$APP_DIR/src/server.js" ] || die "Chua thay ma nguon trong $APP_DIR (deploy.ps1 se giai nen truoc khi chay file nay)."

say "Kiem tra Node.js"
NODE_BIN="$(command -v node || true)"
[ -n "$NODE_BIN" ] || die "VPS chua cai Node.js. Cai Node.js 22 tro len roi chay lai."
NODE_MAJOR="$("$NODE_BIN" -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 22 ] || die "Node.js hien la v$("$NODE_BIN" -v) — can tu v22 tro len."
echo "Node $("$NODE_BIN" -v) tai $NODE_BIN"

say "Tao tai khoan he thong $APP_USER (khong dang nhap duoc)"
id "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"

say "Thu muc du lieu"
mkdir -p "$APP_DIR/data" "$APP_DIR/media" "$APP_DIR/backup"
sed -i 's/\r$//' "$APP_DIR"/deploy/*.sh "$APP_DIR"/deploy/*.service "$APP_DIR"/deploy/*.path "$APP_DIR"/deploy/*.timer 2>/dev/null || true
chmod +x "$APP_DIR"/deploy/*.sh

say "File cau hinh .env"
if [ ! -f "$APP_DIR/.env" ]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  PW="$(head -c 24 /dev/urandom | base64 | tr -d '/+=\n' | head -c 20)"
  sed -i "s|^APP_PASSWORD=.*|APP_PASSWORD=$PW|; s|^PORT=.*|PORT=$PORT|" "$APP_DIR/.env"
  grep -q '^HOST=' "$APP_DIR/.env" || printf '\n# Chi nghe noi bo, Caddy lo phan HTTPS ben ngoai\nHOST=127.0.0.1\n' >> "$APP_DIR/.env"
  NEW_PASSWORD="$PW"
  echo "Da tao .env moi."
else
  NEW_PASSWORD=""
  echo ".env da co — giu nguyen."
fi

say "Phan quyen"
chown -R root:root "$APP_DIR/src" "$APP_DIR/public" "$APP_DIR/deploy"
# File giai nen tu Windows co the mang quyen 666/777 → chi root duoc sua ma nguon
chmod -R u=rwX,go=rX "$APP_DIR/src" "$APP_DIR/public" "$APP_DIR/deploy"
find "$APP_DIR" -maxdepth 1 -type f ! -name .env -exec chown root:root {} + -exec chmod 644 {} +
chown -R "$APP_USER:$APP_USER" "$APP_DIR/data" "$APP_DIR/media" "$APP_DIR/backup"
chown root:"$APP_USER" "$APP_DIR/.env"
chmod 640 "$APP_DIR/.env"

say "Dich vu systemd"
sed "s|__NODE__|$NODE_BIN|g" "$APP_DIR/deploy/$SERVICE.service" > "/etc/systemd/system/$SERVICE.service"
systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null
systemctl restart "$SERVICE"
sleep 2
systemctl is-active --quiet "$SERVICE" || { journalctl -u "$SERVICE" -n 30 --no-pager; die "Dich vu khong chay duoc (xem log o tren)."; }
curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null || die "Dich vu chay nhung khong tra loi tai cong $PORT."
echo "Dich vu dang chay."

say "Sao luu hang ngay (3h30 sang, giu 14 ban)"
printf '30 3 * * * %s %s/deploy/backup-daily.sh\n' "$APP_USER" "$APP_DIR" > /etc/cron.d/salon-agentic-backup
chmod 644 /etc/cron.d/salon-agentic-backup

if [ -n "$DOMAIN" ]; then
  say "Caddy (HTTPS) cho $DOMAIN"
  CADDYFILE=/etc/caddy/Caddyfile
  if ! command -v caddy >/dev/null 2>&1 || [ ! -f "$CADDYFILE" ]; then
    echo "Khong thay Caddy tren VPS nay — bo qua. Ban can reverse proxy HTTPS toi 127.0.0.1:$PORT (xem HUONG-DAN-VPS.md)."
  elif grep -qE "^[[:space:]]*$DOMAIN[[:space:]]*\{" "$CADDYFILE"; then
    echo "$DOMAIN da co trong Caddyfile — giu nguyen."
  else
    BACKUP="$CADDYFILE.bak-$(date +%Y%m%d-%H%M%S)"
    cp "$CADDYFILE" "$BACKUP"
    cat >> "$CADDYFILE" <<EOF

# Salon Agentic AI
$DOMAIN {
	encode gzip
	# Khong quang cao HTTP/3: Safari tren mang di dong yeu hay bao "ket noi mang bi mat" khi thu QUIC
	header -Alt-Svc
	request_body {
		max_size 1100MB
	}
	reverse_proxy 127.0.0.1:$PORT
}
EOF
    if caddy validate --config "$CADDYFILE" >/dev/null 2>&1; then
      systemctl reload caddy
      echo "Da them $DOMAIN vao Caddy (ban sao cu: $BACKUP)."
    else
      cp "$BACKUP" "$CADDYFILE"
      echo "Cau hinh Caddy moi khong hop le — DA KHOI PHUC ban cu, Caddy khong bi dong vao." >&2
    fi
  fi

  # "Nguoi gac": script cai dat Salon POS ghi de toan bo Caddyfile va xoa khoi cua agent.
  # Tac vu nay theo doi file, thay khoi bi mat thi them lai (kiem tra hop le truoc khi nap).
  if command -v caddy >/dev/null 2>&1 && [ -f "$CADDYFILE" ]; then
    say "Nguoi gac Caddyfile (giu khoi $DOMAIN khi Salon POS ghi de)"
    printf '%s\n' "$DOMAIN" > /etc/salon-agentic-caddy.domain
    for u in service path timer; do
      cp "$APP_DIR/deploy/caddy-guard.$u" "/etc/systemd/system/salon-agentic-caddy-guard.$u"
    done
    systemctl daemon-reload
    systemctl enable --now salon-agentic-caddy-guard.path salon-agentic-caddy-guard.timer >/dev/null 2>&1
    systemctl is-active --quiet salon-agentic-caddy-guard.path && echo "Dang theo doi $CADDYFILE." || echo "Canh bao: khong bat duoc tac vu theo doi." >&2
  fi
fi

say "XONG"
echo "Ung dung: http://127.0.0.1:$PORT (noi bo)${DOMAIN:+  |  https://$DOMAIN}"
echo "Xem log:  journalctl -u $SERVICE -f"
if [ -n "$NEW_PASSWORD" ]; then
  echo
  echo "================ MAT KHAU DANG NHAP (chi hien 1 lan) ================"
  echo "  Ten dang nhap: bat ky   |   Mat khau: $NEW_PASSWORD"
  echo "  Luu vao trinh quan ly mat khau. Xem lai trong $APP_DIR/.env"
  echo "====================================================================="
fi
