// Tài khoản người dùng + vai trò. Mật khẩu băm bằng scrypt (muối riêng), lưu trong secrets.json (0600), KHÔNG vào db.json.
// Mật khẩu chung APP_PASSWORD (cũ) vẫn dùng được như tài khoản "Chủ hệ thống" để không bao giờ bị khoá ngoài hệ thống.
const crypto = require('node:crypto');
const secrets = require('./secrets');
const { load, save, uid } = require('./db');

const ROLES = ['owner', 'manager', 'editor', 'viewer'];
const bad = (msg, status = 400) => { const e = new Error(msg); e.status = status; return e; };
const norm = (u) => String(u || '').trim().toLowerCase();
const store = () => secrets.load().users;
const persist = () => secrets.save();
const KEYLEN = 64;

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${crypto.scryptSync(pw, salt, KEYLEN).toString('hex')}`;
}
function verifyHash(pw, stored) {
  const [alg, saltHex, hashHex] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const got = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), KEYLEN);
  const want = Buffer.from(hashHex, 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
const DUMMY = hashPassword('khong-ai-biet-mat-khau-nay'); // so sánh giả khi tên đăng nhập không tồn tại (chống dò tên bằng thời gian)

function checkPassword(pw, username) {
  const p = String(pw || '');
  if (p.length < 10) throw bad('Mật khẩu phải từ 10 ký tự trở lên');
  if (p.length > 200) throw bad('Mật khẩu quá dài');
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) throw bad('Mật khẩu phải có cả chữ và số');
  if (username && p.toLowerCase().includes(norm(username))) throw bad('Mật khẩu không được chứa tên đăng nhập');
}
function checkUsername(u) {
  const v = norm(u);
  if (!/^[a-z0-9][a-z0-9._-]{2,29}$/.test(v)) throw bad('Tên đăng nhập 3–30 ký tự: chữ thường không dấu, số, . _ - (bắt đầu bằng chữ hoặc số)');
  return v;
}
function checkBrands(brands) {
  const ids = Object.keys(require('./planner').brands());
  const list = [...new Set((Array.isArray(brands) ? brands : []).map(String))];
  const miss = list.find((b) => !ids.includes(b));
  if (miss) throw bad(`Thương hiệu "${miss}" không tồn tại`);
  return list;
}

// Hiển thị công khai: không bao giờ có mã băm
const view = (u) => ({ id: u.id, name: u.name, username: u.username, role: u.role, brands: u.brands || [], disabled: !!u.disabled, createdAt: u.createdAt, lastLoginAt: u.lastLoginAt || null });
const list = () => store().map(view);
const byId = (id) => { const u = store().find((x) => x.id === String(id)); if (!u) throw bad('Không tìm thấy tài khoản', 404); return u; };
const sharedLoginOn = () => (load().settings.security || {}).sharedPasswordLogin !== false;
const activeOwners = () => store().filter((u) => u.role === 'owner' && !u.disabled);

// Không để hệ thống không còn ai là chủ: khi tắt đăng nhập mật khẩu chung thì phải còn ≥ 1 chủ đang hoạt động
function guardOwner(changingUser, next) {
  if (sharedLoginOn()) return;
  const wasOwner = changingUser.role === 'owner' && !changingUser.disabled;
  const stillOwner = next === 'delete' ? false : (next.role ?? changingUser.role) === 'owner' && !(next.disabled ?? changingUser.disabled);
  if (wasOwner && !stillOwner && activeOwners().length <= 1) throw bad('Đây là tài khoản chủ cuối cùng và đăng nhập bằng mật khẩu chung đang tắt — không thể xoá/tắt/hạ quyền, sẽ không còn ai quản trị được');
}

function create({ name, username, role, brands, password }) {
  const n = String(name || '').trim().slice(0, 60);
  if (!n) throw bad('Tên hiển thị không được để trống');
  const u = checkUsername(username);
  if (store().some((x) => x.username === u)) throw bad('Tên đăng nhập này đã có');
  if (!ROLES.includes(role)) throw bad('Vai trò không hợp lệ');
  checkPassword(password, u);
  const user = { id: uid('u'), name: n, username: u, role, brands: checkBrands(brands), hash: hashPassword(password), disabled: false, createdAt: new Date().toISOString(), lastLoginAt: null };
  store().push(user);
  persist();
  return view(user);
}

function update(id, patch) {
  const u = byId(id);
  const next = {};
  if (patch.name !== undefined) { next.name = String(patch.name).trim().slice(0, 60); if (!next.name) throw bad('Tên hiển thị không được để trống'); }
  if (patch.role !== undefined) { if (!ROLES.includes(patch.role)) throw bad('Vai trò không hợp lệ'); next.role = patch.role; }
  if (patch.brands !== undefined) next.brands = checkBrands(patch.brands);
  if (patch.disabled !== undefined) next.disabled = !!patch.disabled;
  if (!Object.keys(next).length) throw bad('Không có thay đổi nào');
  guardOwner(u, next);
  Object.assign(u, next);
  persist();
  return view(u);
}
function setPassword(id, password) {
  const u = byId(id);
  checkPassword(password, u.username);
  u.hash = hashPassword(password);
  u.passwordChangedAt = new Date().toISOString();
  persist();
}
function remove(id) {
  const u = byId(id);
  guardOwner(u, 'delete');
  secrets.load().users = store().filter((x) => x.id !== u.id);
  persist();
  return view(u);
}

// Trả về tài khoản nếu đúng tên + mật khẩu và đang hoạt động; null nếu sai. Luôn tốn thời gian băm như nhau.
function authenticate(username, password) {
  const u = store().find((x) => x.username === norm(username));
  const ok = verifyHash(String(password ?? ''), u ? u.hash : DUMMY);
  if (!u || !ok || u.disabled) return null;
  u.lastLoginAt = new Date().toISOString();
  persist();
  return u;
}
const hasUser = (username) => store().some((x) => x.username === norm(username));
// Tài khoản đang hoạt động theo tên đăng nhập (cho phiên cookie: quyền/khoá đổi là áp dụng ngay, không cần đăng nhập lại)
const activeByUsername = (username) => store().find((x) => x.username === norm(username) && !x.disabled) || null;

module.exports = { ROLES, list, view, create, update, setPassword, remove, authenticate, hasUser, activeByUsername, byId, sharedLoginOn, activeOwners, checkPassword, hashPassword, verifyHash };
void save;
