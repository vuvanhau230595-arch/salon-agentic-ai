#!/usr/bin/env bash
# Thu "nguoi gac Caddyfile" tren VPS bang BAN SAO tam, khong dung toi /etc/caddy/Caddyfile that.
# Chay:  Get-Content -Raw deploy\caddy-guard.sh | ssh root@VPS "tr -d '\015\357\273\277' > /tmp/guard-test.sh"
#        Get-Content -Raw test\caddy-guard-vps-test.sh | ssh root@VPS "tr -d '\015\357\273\277' | bash -s"
set -u
export CADDYFILE=/tmp/cf-test DOMAIN_FILE=/tmp/dom-test GUARD_WAIT=0 GUARD_RELOAD=true GUARD_LOCK=/tmp/lock-test
GUARD=/tmp/guard-test.sh
FAIL=0
ok() { echo "  OK: $*"; }
bad() { echo "  SAI: $*"; FAIL=1; }
agent_blocks() { grep -c '^agent.theonehairsalon.vn' /tmp/cf-test || true; }
drop_agent() { sed -i '/^agent.theonehairsalon.vn {/,/^}/d' /tmp/cf-test; }

echo agent.theonehairsalon.vn > /tmp/dom-test
cp /etc/caddy/Caddyfile /tmp/cf-test
[ "$(agent_blocks)" = 1 ] || { echo "Caddyfile that dang thieu khoi agent — dung thu (khoi phuc truoc)"; exit 2; }

echo "=== 1. Khoi dang co: khong duoc sua gi"
md5sum < /tmp/cf-test > /tmp/before.md5
bash $GUARD
md5sum < /tmp/cf-test | cmp -s - /tmp/before.md5 && ok "file khong doi" || bad "file bi doi"

echo "=== 2. Mat khoi (giong Salon POS ghi de): phai them lai"
drop_agent
[ "$(agent_blocks)" = 0 ] && ok "da bo khoi agent (mo phong)" || bad "mo phong that bai"
bash $GUARD
[ "$(agent_blocks)" = 1 ] && ok "khoi agent da duoc them lai" || bad "khong them lai"
[ "$(grep -c '^pos.theonehairsalon.vn' /tmp/cf-test)" = 2 ] && ok "hai khoi pos con nguyen" || bad "khoi pos bi mat"
caddy validate --config /tmp/cf-test --adapter caddyfile >/dev/null 2>&1 && ok "Caddyfile sau khi them HOP LE" || bad "Caddyfile khong hop le"

echo "=== 3. Chay lai: khong them trung"
bash $GUARD
[ "$(agent_blocks)" = 1 ] && ok "van 1 khoi" || bad "them trung"

echo "=== 4. File dang hong: khong duoc dong vao"
drop_agent
echo 'pos.xxx { reverse_proxy' >> /tmp/cf-test
cp /tmp/cf-test /tmp/broken.copy
bash $GUARD
cmp -s /tmp/cf-test /tmp/broken.copy && ok "giu nguyen file hong" || bad "da sua file hong"

echo "=== 5. Ten mien sai trong file cau hinh: bo qua"
echo 'ten mien!sai' > /tmp/dom-test
bash $GUARD
cmp -s /tmp/cf-test /tmp/broken.copy && ok "khong sua gi" || bad "da sua file"

echo "=== 6. Hai ban chay cung luc: ban sau bo qua"
echo agent.theonehairsalon.vn > /tmp/dom-test
cp /etc/caddy/Caddyfile /tmp/cf-test
drop_agent
GUARD_WAIT=3 bash $GUARD & sleep 1
GUARD_WAIT=0 bash $GUARD
wait
[ "$(agent_blocks)" = 1 ] && ok "chi them 1 khoi" || bad "so khoi agent: $(agent_blocks)"

find /tmp -maxdepth 1 \( -name 'cf-test*' -o -name 'dom-test' -o -name 'lock-test' -o -name 'before.md5' -o -name 'broken.copy' -o -name 'guard-test.sh' \) -delete
echo "--- da don dep"
[ $FAIL = 0 ] && echo "TAT CA DAT" || echo "CO LOI"
exit $FAIL
