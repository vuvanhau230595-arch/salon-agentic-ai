// Tài khoản, phân quyền, tuỳ chọn hệ thống (cảnh báo, thông báo, AI), sao lưu & khôi phục cho trang Cài đặt.
// Quyền được kiểm tra ở cổng trong server.js (authz.js); module này vẫn kiểm tra dữ liệu đầu vào và chặn tự khoá mình.
// Mật khẩu không bao giờ được ghi vào nhật ký hay trả về giao diện.
const fs = require('node:fs');
const path = require('node:path');
const { load, save, replaceAll } = require('./db');
const engine = require('./engine');
const users = require('./users');
const authz = require('./authz');
const audit = require('./audit');
const usage = require('./usage');

const bad = (msg, status = 400) => { const e = new Error(msg); e.status = status; return e; };
const log = (kind, text, user, extra = {}) => engine.log(kind, text, { by: user.name, ...extra });

// ----- Thông tin người đang đăng nhập + bảng vai trò -----
function me(user) {
  const role = authz.ROLES[user.role] || { label: user.role, perms: [] };
  return { user: { id: user.id, name: user.name, username: user.username || '', role: user.role, roleLabel: role.label, brands: user.brands || [], shared: !!user.shared }, perms: role.perms };
}
const rolesView = () => Object.fromEntries(Object.entries(authz.ROLES).map(([k, r]) => [k, { label: r.label, desc: r.desc, perms: r.perms }]));

function usersView() {
  const list = users.list();
  return { users: list, roles: rolesView(), permLabels: authz.PERMS, sharedPasswordLogin: users.sharedLoginOn(), activeOwners: users.activeOwners().length };
}

function setSecurity(body, user) {
  if (typeof body.sharedPasswordLogin !== 'boolean') throw bad('sharedPasswordLogin phải là true/false');
  const s = load().settings;
  s.security = s.security || {};
  const before = users.sharedLoginOn();
  if (body.sharedPasswordLogin === before) throw bad('Không có thay đổi nào');
  if (!body.sharedPasswordLogin) {
    if (user.shared) throw bad('Hãy đăng nhập bằng tài khoản chủ RIÊNG (không phải mật khẩu chung) trước khi tắt đăng nhập bằng mật khẩu chung — nếu không bạn sẽ bị khoá ngoài');
    if (!users.activeOwners().length) throw bad('Chưa có tài khoản chủ riêng nào đang hoạt động — tạo một tài khoản chủ trước khi tắt mật khẩu chung');
  }
  s.security.sharedPasswordLogin = body.sharedPasswordLogin;
  log('security', `${user.name} ${body.sharedPasswordLogin ? 'BẬT' : 'TẮT'} đăng nhập bằng mật khẩu chung`, user, { field: 'sharedPasswordLogin', before, after: body.sharedPasswordLogin });
  save();
}

// ----- Tuỳ chọn: ngưỡng cảnh báo, nhóm thông báo, AI -----
function setPrefs(body, user) {
  const s = load().settings;
  const changes = [];
  const set = (grp, key, value) => { const before = s[grp][key]; if (before !== value) { s[grp][key] = value; changes.push([`${grp}.${key}`, before, value]); } };
  const num = (v, name, min, max, int) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < min || n > max || (int && Math.round(n) !== n)) throw bad(`${name}: phải là ${int ? 'số nguyên' : 'số'} từ ${min.toLocaleString('vi-VN')} đến ${max.toLocaleString('vi-VN')}`);
    return n;
  };
  if (body.alerts !== undefined) {
    const a = body.alerts || {};
    const next = {};
    if (a.spikeRatio !== undefined) next.spikeRatio = num(a.spikeRatio, 'Hệ số chi tiêu vọt', 1.1, 10);
    if (a.spikeMinSpend !== undefined) next.spikeMinSpend = num(a.spikeMinSpend, 'Chi tiêu tối thiểu để báo vọt', 0, 1e8, true);
    if (a.cplSpikeRatio !== undefined) next.cplSpikeRatio = num(a.cplSpikeRatio, 'Hệ số giá/tin tăng', 1.1, 10);
    if (a.cplSpikeMinMsgs !== undefined) next.cplSpikeMinMsgs = num(a.cplSpikeMinMsgs, 'Số tin tối thiểu để báo giá tăng', 1, 100, true);
    for (const [k, v] of Object.entries(next)) set('alerts', k, v);
  }
  if (body.notify !== undefined) {
    for (const k of ['approvals', 'alerts', 'errors']) if (body.notify[k] !== undefined) { if (typeof body.notify[k] !== 'boolean') throw bad(`notify.${k} phải là true/false`); set('notify', k, body.notify[k]); }
  }
  if (body.ai !== undefined) {
    if (body.ai.enabled !== undefined) { if (typeof body.ai.enabled !== 'boolean') throw bad('ai.enabled phải là true/false'); set('ai', 'enabled', body.ai.enabled); }
    if (body.ai.model !== undefined) {
      const m = String(body.ai.model).trim();
      if (!/^[A-Za-z0-9._-]{0,60}$/.test(m)) throw bad('Tên model chỉ gồm chữ, số, . _ - (tối đa 60 ký tự)');
      set('ai', 'model', m);
    }
  }
  if (!changes.length) throw bad('Không có thay đổi nào');
  for (const [k, b, a] of changes) log('settings', `${user.name} đổi cài đặt ${k}: ${b} → ${a}`, user, { field: k, before: b, after: a });
  save();
}

// ----- Sao lưu / khôi phục -----
const backupDir = () => process.env.BACKUP_DIR || (process.env.DB_FILE ? path.join(path.dirname(process.env.DB_FILE), 'backup') : path.join(__dirname, '..', 'backup'));
const DB_NAME = /^db-[A-Za-z0-9-]{4,60}\.json$/;
const AUD_NAME = /^audit-[A-Za-z0-9-]{4,60}\.jsonl$/;
const stamp = () => new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

function listBackups() {
  const dir = backupDir();
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names.filter((n) => DB_NAME.test(n) || AUD_NAME.test(n)).map((n) => { const st = fs.statSync(path.join(dir, n)); return { name: n, kind: DB_NAME.test(n) ? 'data' : 'audit', size: st.size, at: st.mtime.toISOString() }; })
    .sort((a, b) => b.at.localeCompare(a.at)).slice(0, 100);
}
function createBackup(user, prefix = 'db') {
  const dir = backupDir();
  fs.mkdirSync(dir, { recursive: true });
  const ts = stamp();
  const name = `${prefix}-${ts}.json`;
  fs.writeFileSync(path.join(dir, name), JSON.stringify(load(), null, 2));
  let auditName = null;
  try { const a = audit.file(); if (fs.existsSync(a)) { auditName = `audit-${ts}.jsonl`; fs.copyFileSync(a, path.join(dir, auditName)); } } catch { /* không có file nhật ký */ }
  log('data', `${user.name} tạo bản sao lưu ${name}`, user, { field: 'backup' });
  save();
  return { name, audit: auditName };
}
function backupPath(name) {
  if (!DB_NAME.test(name) && !AUD_NAME.test(name)) throw bad('Tên file sao lưu không hợp lệ');
  const p = path.join(backupDir(), name);
  if (path.dirname(p) !== path.resolve(backupDir()) && path.dirname(p) !== backupDir()) throw bad('Đường dẫn không hợp lệ');
  if (!fs.existsSync(p)) throw bad('Không thấy file sao lưu', 404);
  return p;
}
// Khôi phục: chỉ từ file sao lưu CÓ SẴN trên máy chủ, phải gõ đúng cụm xác nhận, luôn tự sao lưu dữ liệu hiện tại trước
function restore(name, confirm, user) {
  if (!DB_NAME.test(name)) throw bad('Chỉ khôi phục được từ file sao lưu dữ liệu (db-….json)');
  if (confirm !== 'KHOI PHUC') throw bad('Gõ đúng "KHOI PHUC" để xác nhận khôi phục');
  const p = backupPath(name);
  if (fs.statSync(p).size > 100 * 1024 * 1024) throw bad('File sao lưu quá lớn (> 100MB)');
  let obj;
  try { obj = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { throw bad('File sao lưu không phải JSON hợp lệ'); }
  if (!obj || typeof obj !== 'object' || !obj.settings || typeof obj.settings !== 'object' || !['posts', 'approvals', 'actions', 'campaigns'].every((k) => Array.isArray(obj[k]))) {
    throw bad('File sao lưu không đúng cấu trúc dữ liệu của hệ thống (thiếu settings/posts/approvals/actions/campaigns)');
  }
  const pre = createBackup(user, 'db-truoc-khoi-phuc'); // lưới an toàn: luôn có đường quay lại
  replaceAll(obj);
  log('data', `${user.name} KHÔI PHỤC dữ liệu từ ${name} (dữ liệu trước đó đã sao lưu ở ${pre.name})`, user, { field: 'restore', before: pre.name, after: name });
  save();
  return { restoredFrom: name, safetyBackup: pre.name };
}

async function handleApi(req, res, url, { readBody, send }, user) {
  const p = url.pathname;
  let m;
  const mine = p === '/api/me' || p === '/api/me/password' || p.startsWith('/api/users') || p === '/api/security' || p === '/api/prefs' || p.startsWith('/api/backups');
  if (!mine) return false;
  try {
    if (req.method === 'GET' && p === '/api/me') return send(res, 200, me(user)), true;
    if (req.method === 'POST' && p === '/api/me/password') {
      const b = await readBody(req);
      if (user.shared) throw bad('Bạn đang đăng nhập bằng mật khẩu chung — đổi mật khẩu chung trong file .env trên máy chủ (APP_PASSWORD), hoặc tạo tài khoản riêng');
      if (!users.authenticate(user.username, b.oldPassword)) throw bad('Mật khẩu hiện tại không đúng');
      users.setPassword(user.id, b.newPassword);
      log('security', `${user.name} đổi mật khẩu của chính mình`, user);
      save();
      return send(res, 200, { ok: true }), true;
    }
    if (req.method === 'GET' && p === '/api/users') return send(res, 200, usersView()), true;
    if (req.method === 'POST' && p === '/api/users') {
      const b = await readBody(req);
      const u = users.create(b);
      log('user', `${user.name} tạo tài khoản ${u.username} (${u.name}) vai trò ${authz.ROLES[u.role].label}${u.brands.length ? ` giới hạn thương hiệu: ${u.brands.join(', ')}` : ''}`, user, { field: 'user', after: u.username });
      save();
      return send(res, 200, usersView()), true;
    }
    if (req.method === 'PUT' && (m = p.match(/^\/api\/users\/([^/]+)$/))) {
      const b = await readBody(req);
      const target = users.byId(m[1]);
      if (target.id === user.id && (b.disabled === true || (b.role !== undefined && b.role !== target.role))) throw bad('Không tự khoá hoặc tự hạ quyền chính mình — nhờ một chủ khác làm');
      const before = users.view(target);
      const u = users.update(m[1], b);
      for (const f of ['role', 'brands', 'disabled', 'name']) if (b[f] !== undefined && JSON.stringify(before[f]) !== JSON.stringify(u[f])) log('user', `${user.name} sửa tài khoản ${u.username}: ${f} ${JSON.stringify(before[f])} → ${JSON.stringify(u[f])}`, user, { field: `user.${f}`, before: JSON.stringify(before[f]), after: JSON.stringify(u[f]) });
      save();
      return send(res, 200, usersView()), true;
    }
    if (req.method === 'POST' && (m = p.match(/^\/api\/users\/([^/]+)\/password$/))) {
      const b = await readBody(req);
      const target = users.byId(m[1]);
      users.setPassword(m[1], b.password);
      log('security', `${user.name} đặt lại mật khẩu của ${target.username}`, user, { field: 'password' });
      save();
      return send(res, 200, { ok: true }), true;
    }
    if (req.method === 'DELETE' && (m = p.match(/^\/api\/users\/([^/]+)$/))) {
      const target = users.byId(m[1]);
      if (target.id === user.id) throw bad('Không tự xoá chính mình');
      const u = users.remove(m[1]);
      log('user', `${user.name} xoá tài khoản ${u.username} (${u.name})`, user, { field: 'user', before: u.username });
      save();
      return send(res, 200, usersView()), true;
    }
    if (req.method === 'POST' && p === '/api/security') { setSecurity(await readBody(req), user); return send(res, 200, usersView()), true; }
    if (req.method === 'POST' && p === '/api/prefs') { setPrefs(await readBody(req), user); return send(res, 200, { settings: load().settings }), true; }
    if (req.method === 'GET' && p === '/api/backups') return send(res, 200, { dir: backupDir(), backups: listBackups() }), true;
    if (req.method === 'POST' && p === '/api/backups') { const r = createBackup(user); return send(res, 200, { ...r, backups: listBackups() }), true; }
    if (req.method === 'GET' && (m = p.match(/^\/api\/backups\/([^/]+)\/download$/))) {
      const file = backupPath(m[1]);
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-disposition': `attachment; filename="${m[1]}"`, 'content-length': fs.statSync(file).size });
      fs.createReadStream(file).pipe(res);
      return true;
    }
    if (req.method === 'POST' && (m = p.match(/^\/api\/backups\/([^/]+)\/restore$/))) { const b = await readBody(req); return send(res, 200, restore(m[1], b.confirm, user)), true; }
  } catch (e) { send(res, e.status || 500, { error: e.message }); return true; }
  return false;
}

module.exports = { me, usersView, setPrefs, setSecurity, listBackups, createBackup, restore, handleApi, backupDir, usage };
