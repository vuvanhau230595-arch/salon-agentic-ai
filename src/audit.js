// Nhật ký kiểm toán (audit log): mọi việc hệ thống/agent/Sếp làm được ghi thêm vào file chỉ-ghi-thêm (JSONL) cạnh db.json,
// bền hơn db.actions (chỉ giữ 300 dòng). Mỗi dòng: ai làm (Sếp / agent nào / hệ thống), hành động, đối tượng, thời gian,
// kết quả, lỗi, giá trị trước/sau. Chuỗi trông giống token bị che trước khi ghi. Xoay file khi quá lớn, giữ vài bản cũ.
const fs = require('node:fs');
const path = require('node:path');
const { load, uid } = require('./db');

// Mặc định data/audit.jsonl; khi đặt DB_FILE (kiểm thử) thì lấy theo tên file đó để không dùng chung giữa các lượt chạy
const file = () => process.env.AUDIT_FILE || (process.env.DB_FILE ? process.env.DB_FILE.replace(/\.json$/i, '') + '.audit.jsonl' : path.join(__dirname, '..', 'data', 'audit.jsonl'));
const maxBytes = () => Number(process.env.AUDIT_MAX_BYTES) || 5 * 1024 * 1024;
const KEEP = 3; // số file cũ giữ lại (audit.1.jsonl … audit.3.jsonl)

// Che chuỗi giống token/khoá để không lộ bí mật vào nhật ký
const SECRET_RE = /(EAA[A-Za-z0-9]{12,}|sk-[A-Za-z0-9_-]{16,}|act_[A-Za-z0-9]{3,}_[A-Za-z0-9]{12,}|(access_token|client_secret|refresh_token|password|api[_-]?key)(=|":\s*")[^&\s",]+)/gi;
const redact = (s) => String(s ?? '').replace(SECRET_RE, (m, a, k) => (k ? `${k}=[đã che]` : '[đã che]'));
const cut = (s, n) => redact(s).slice(0, n);
const show = (v) => (v === undefined || v === null ? '' : cut(typeof v === 'object' ? JSON.stringify(v) : v, 300));

const KIND_LABEL = {
  pause: 'Tắt chiến dịch', propose: 'Đề xuất', approve: 'Duyệt', reject: 'Từ chối', publish: 'Đăng bài', reply: 'Trả lời khách', error: 'Lỗi', system: 'Hệ thống',
  ads_change: 'Đổi quảng cáo', automation: 'Đổi quy trình', calendar: 'Lịch đăng', monthplan: 'Kế hoạch tháng', settings: 'Cài đặt', user: 'Tài khoản', security: 'Bảo mật', data: 'Dữ liệu', brand: 'Thương hiệu', lesson: 'Bài học AI', media: 'Thư viện media',
};

function actorOf(extra, agentName) {
  // "Sếp" là tên mặc định trong code: nếu đang có người dùng cụ thể thao tác thì ghi đúng tên họ
  if (extra.by) return { type: 'user', name: String(extra.by === 'Sếp' ? require('./auth-ctx').actorName('Sếp') : extra.by).slice(0, 60) };
  if (agentName) return { type: 'agent', name: agentName };
  return { type: 'system', name: 'Hệ thống' };
}
function objectOf(x) {
  if (x.campaignId) return { type: 'Chiến dịch', id: String(x.campaignId) };
  if (x.postId) return { type: 'Bài đăng', id: String(x.postId) };
  if (x.workflow) return { type: 'Quy trình', id: String(x.workflow) };
  if (x.taskId) return { type: 'Công việc', id: String(x.taskId) };
  if (x.month && x.brand) return { type: 'Kế hoạch tháng', id: `${x.month}/${x.brand}` };
  if (x.agent) return { type: 'Agent', id: String(x.agent) };
  if (x.brand) return { type: 'Thương hiệu', id: String(x.brand) };
  return null;
}
function statusOf(kind, extra) {
  if (kind === 'error') return 'error';
  if (extra.dry) return 'dry';
  if (kind === 'propose') return 'proposed';
  return 'ok';
}

// Chuẩn hoá 1 dòng nhật ký
function normalize(kind, text, extra = {}, now = Date.now()) {
  let agentName = '';
  try {
    const id = require('./usage').currentAgent();
    if (id && id !== 'ui') agentName = (require('./engine').AGENTS[id] || {}).name || id;
  } catch { /* bỏ qua */ }
  const { by, dry, rule, before, after, field, ...rest } = extra;
  const ob = objectOf({ ...rest, ...extra });
  return {
    id: uid('au'), at: new Date(now).toISOString(), kind, kindLabel: KIND_LABEL[kind] || kind,
    actor: actorOf(extra, agentName), action: cut(text, 500), status: statusOf(kind, extra),
    object: ob, rule: rule || null, field: field ? cut(field, 60) : null, before: show(before), after: show(after),
    error: kind === 'error' ? cut(text, 500) : '', dry: !!dry,
  };
}

function rotate() {
  const f = file();
  try { if (fs.statSync(f).size < maxBytes()) return; } catch { return; }
  const ext = path.extname(f), base = f.slice(0, -ext.length);
  for (let i = KEEP; i >= 1; i--) {
    const from = i === 1 ? f : `${base}.${i - 1}${ext}`, to = `${base}.${i}${ext}`;
    try { if (i === KEEP) fs.rmSync(to, { force: true }); fs.renameSync(from, to); } catch { /* chưa có file cũ */ }
  }
}

let ensured = null;
// Lần đầu (chưa có file): nhập 300 dòng db.actions hiện có làm lịch sử, đánh dấu imported
function ensure() {
  const f = file();
  if (ensured === f) return;
  ensured = f;
  fs.mkdirSync(path.dirname(f), { recursive: true });
  if (fs.existsSync(f)) return;
  const old = load().actions.slice().reverse();
  const lines = old.map((a) => {
    const { id, at, kind, text, ...extra } = a;
    return JSON.stringify({ ...normalize(kind, text, extra, new Date(at).getTime()), at, imported: true });
  });
  if (lines.length) fs.writeFileSync(f, lines.join('\n') + '\n');
}

function record(kind, text, extra = {}) {
  try {
    ensure();
    rotate();
    fs.appendFileSync(file(), JSON.stringify(normalize(kind, text, extra)) + '\n');
  } catch { /* nhật ký kiểm toán không được làm hỏng việc chính */ }
}

// Đọc các file (mới → cũ): audit.jsonl rồi .1 .2 .3
function readAll() {
  ensure();
  const f = file(), ext = path.extname(f), base = f.slice(0, -ext.length);
  const out = [];
  for (const p of [f, ...Array.from({ length: KEEP }, (_, i) => `${base}.${i + 1}${ext}`)].reverse()) { // cũ nhất trước
    let txt = '';
    try { txt = fs.readFileSync(p, 'utf8'); } catch { continue; }
    for (const line of txt.split('\n')) { if (!line) continue; try { out.push(JSON.parse(line)); } catch { /* dòng hỏng: bỏ qua */ } }
  }
  return out.reverse(); // mới nhất trước
}

const bad = (msg) => { const e = new Error(msg); e.status = 400; return e; };
function parseTime(v, name) {
  if (!v) return null;
  const t = new Date(v).getTime();
  if (Number.isNaN(t)) throw bad(`${name} không hợp lệ`);
  return t;
}

function query(f = {}) {
  const from = parseTime(f.from, 'Từ ngày'), to = parseTime(f.to, 'Đến ngày');
  const q = String(f.q || '').trim().toLowerCase();
  const all = readAll();
  const rows = all.filter((e) => {
    const t = new Date(e.at).getTime();
    return (from === null || t >= from) && (to === null || t <= to) && (!f.actor || e.actor.name === f.actor || e.actor.type === f.actor)
      && (!f.kind || e.kind === f.kind) && (!f.status || e.status === f.status) && (!f.object || (e.object && e.object.type === f.object))
      && (!q || `${e.action} ${e.actor.name} ${e.object ? e.object.id : ''} ${e.before} ${e.after}`.toLowerCase().includes(q));
  });
  const facet = (fn) => { const m = {}; for (const e of rows) { const k = fn(e); if (k) m[k] = (m[k] || 0) + 1; } return m; };
  return {
    rows, total: rows.length,
    facets: { kinds: facet((e) => e.kind), actors: facet((e) => e.actor.name), status: facet((e) => e.status), objects: facet((e) => e.object && e.object.type) },
    all: all.length,
  };
}

function page(f = {}) {
  const limit = Math.min(100, Math.max(1, Number(f.limit) || 25));
  const offset = Math.max(0, Number(f.offset) || 0);
  const r = query(f);
  return { total: r.total, all: r.all, facets: r.facets, rows: r.rows.slice(offset, offset + limit), limit, offset };
}

// CSV (UTF-8 có BOM để Excel đọc đúng tiếng Việt); chặn công thức Excel (=,+,-,@) ở đầu ô
const cell = (v) => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return `"${s.replace(/"/g, '""')}"`;
};
function toCsv(f = {}) {
  const rows = query(f).rows.slice(0, 20000);
  const head = ['Thời gian', 'Người thực hiện', 'Loại người thực hiện', 'Hành động', 'Loại', 'Đối tượng', 'Mã đối tượng', 'Trạng thái', 'Trước', 'Sau', 'Quy tắc', 'Lỗi'];
  const S = { ok: 'Thành công', error: 'Lỗi', dry: 'Chạy thử', proposed: 'Đề xuất' };
  const ACT = { user: 'Sếp', agent: 'Agent', system: 'Hệ thống' };
  return '﻿' + [head.map(cell).join(','), ...rows.map((e) => [e.at, e.actor.name, ACT[e.actor.type], e.action, e.kindLabel, e.object ? e.object.type : '', e.object ? e.object.id : '', S[e.status] || e.status, e.before, e.after, e.rule || '', e.error].map(cell).join(','))].join('\r\n');
}

async function handleApi(req, res, url, { send }) {
  const p = url.pathname;
  if (!p.startsWith('/api/audit')) return false;
  const q = url.searchParams;
  const f = { from: q.get('from'), to: q.get('to'), actor: q.get('actor'), kind: q.get('kind'), status: q.get('status'), object: q.get('object'), q: q.get('q'), limit: q.get('limit'), offset: q.get('offset') };
  try {
    if (req.method === 'GET' && p === '/api/audit') return send(res, 200, page(f)), true;
    if (req.method === 'GET' && p === '/api/audit/export') {
      const csv = toCsv(f);
      res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="nhat-ky-${new Date().toISOString().slice(0, 10)}.csv"` });
      res.end(csv);
      return true;
    }
  } catch (e) { send(res, e.status || 500, { error: e.message }); return true; }
  return false;
}

module.exports = { record, query, page, toCsv, handleApi, normalize, redact, KIND_LABEL, file };
