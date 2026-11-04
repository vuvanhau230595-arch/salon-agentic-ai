// API cho trang Lịch đăng: xem bài theo khoảng ngày, đổi giờ (kéo thả), sửa nội dung, huỷ bài.
// Quy tắc an toàn: bài ĐÃ ĐĂNG không sửa được; sửa nội dung bài đã duyệt/bị từ chối/bị lỗi thì quay về "chờ duyệt"
// (tạo mục duyệt mới) — không thể lách duyệt bằng cách sửa sau; đổi giờ thì giữ nguyên trạng thái duyệt.
const { load, save, uid } = require('./db');
const { social } = require('./connectors');
const engine = require('./engine');
const planner = require('./planner');
const media = require('./media');
const xhs = require('./xhs');

const EDITABLE = new Set(['draft', 'scheduled', 'rejected', 'failed']);
const MOVABLE = new Set(['draft', 'scheduled', 'awaiting_manual', 'missed']);
const CANCELLABLE = new Set(['draft', 'scheduled', 'rejected', 'failed', 'awaiting_manual', 'missed']);
const MAX_TEXT = 10000;

const bad = (msg, status = 400) => { const e = new Error(msg); e.status = status; return e; };
const fbLink = (externalId) => {
  const m = /^(\d+)_(\d+)$/.exec(String(externalId || ''));
  return m ? `https://www.facebook.com/${m[1]}/posts/${m[2]}` : '';
};

// Tên ngắn của Page để hiện trên ô lịch: bỏ tên thương hiệu ở đầu ("The One Hair Salon - Quận 3" → "Quận 3")
function shortPage(name, brandName) {
  const n = String(name || '');
  const i = n.indexOf(' - ');
  let s = i > 0 ? n.slice(i + 3) : (brandName && n.toLowerCase().startsWith(brandName.toLowerCase()) ? n.slice(brandName.length) : n);
  s = s.replace(/^[\s,–-]+/, '').trim();
  return s || n;
}

// Bài đăng lên tài khoản nào: Page Facebook (đã chọn hoặc tất cả Page), Instagram liên kết với Page đó, nick TikTok
function accountsOf(p, brand) {
  if (!brand) return [];
  const ch = require('./channels-api');
  const names = ch.pageNames();
  const pageIds = Array.isArray(p.pageIds) && p.pageIds.length ? brand.pageIds.filter((id) => p.pageIds.includes(id)) : brand.pageIds;
  if (p.channel === 'facebook_page') return pageIds.map((id) => ({ kind: 'fb', id, name: names[id] || `Page ${id}`, short: shortPage(names[id] || `Page ${id}`, brand.name) }));
  if (p.channel === 'instagram') {
    const ig = ch.igOfPages();
    const out = [];
    for (const id of pageIds) if (ig[id] && !out.some((a) => a.id === ig[id].id)) out.push({ kind: 'ig', id: ig[id].id, pageId: id, name: '@' + (ig[id].username || ig[id].id), short: '@' + (ig[id].username || ig[id].id), via: names[id] || '' });
    return out;
  }
  if (p.channel === 'tiktok') {
    const nick = p.tiktokNick || ((brand.channels.tiktok || {}).handle || '');
    return nick ? [{ kind: 'tt', name: nick, short: nick }] : [];
  }
  return [];
}

function view(d, p) {
  const brand = planner.brands()[p.brand];
  const apps = d.approvals.filter((a) => a.type === 'post_publish' && (a.payload || {}).postId === p.id).sort((x, y) => new Date(y.at) - new Date(x.at));
  const ap = apps.find((a) => a.status === 'pending') || apps[0] || null;
  const ch = social.CHANNELS[p.channel] || {};
  return {
    id: p.id, brand: p.brand || null, brandName: brand ? brand.name : '', channel: p.channel, channelLabel: ch.label || p.channel,
    manual: !!ch.manual, status: p.status, tiktokNick: p.tiktokNick || '', topic: p.topic || '', title: p.title || '', text: p.text || '', scheduledAt: p.scheduledAt,
    media: (p.media || []).map((m) => ({ name: m.name, type: m.type, url: `/api/media/file?brand=${encodeURIComponent(p.brand || '')}&name=${encodeURIComponent(m.name)}` })),
    error: p.error || '', skipReason: p.skipReason || '', attempts: p.attempts || 0, url: p.url || '', live: !!p.live,
    results: Object.entries(p.results || {}).map(([pageId, externalId]) => ({ pageId, externalId, link: fbLink(externalId) })),
    pages: brand ? brand.pageIds.length : 0, accounts: accountsOf(p, brand),
    category: p.category || '', qc: p.qc || null, rewrites: p.rewrites || 0, attemptLog: (p.attemptLog || []).slice(0, 5),
    approvalId: ap ? ap.id : null, approvalStatus: ap ? ap.status : null,
    editable: EDITABLE.has(p.status), movable: MOVABLE.has(p.status), cancellable: CANCELLABLE.has(p.status),
    ...(xhs.isXhs(p.channel) ? { lint: xhs.lintPost(p) } : {}),
  };
}

function list({ from, to, brand, channel, status, q } = {}, now = Date.now()) {
  const d = load();
  const t0 = from ? new Date(from).getTime() : now - 30 * 864e5;
  const t1 = to ? new Date(to).getTime() : now + 60 * 864e5;
  if (Number.isNaN(t0) || Number.isNaN(t1)) throw bad('Khoảng thời gian không hợp lệ');
  const needle = String(q || '').trim().toLowerCase();
  const rows = d.posts.filter((p) => {
    const t = new Date(p.scheduledAt).getTime();
    return t >= t0 && t <= t1 && (!brand || p.brand === brand) && (!channel || p.channel === channel) && (!status || p.status === status)
      && (!needle || `${p.topic} ${p.title || ''} ${p.text}`.toLowerCase().includes(needle));
  }).sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt)).slice(0, 500);
  return rows.map((p) => view(d, p));
}

function find(id) {
  const p = load().posts.find((x) => x.id === String(id));
  if (!p) throw bad('Không tìm thấy bài', 404);
  return p;
}

// Đổi giờ đăng (kéo thả). Bài chờ duyệt giữ nguyên mục duyệt; bài đã quá giờ chờ đăng tay được hẹn lại.
function reschedule(id, scheduledAt, now = Date.now()) {
  const d = load();
  const p = find(id);
  if (!MOVABLE.has(p.status)) throw bad(p.status === 'published' ? 'Bài đã đăng, không đổi giờ được' : `Bài đang ở trạng thái "${p.status}", không đổi giờ được`);
  const t = new Date(scheduledAt);
  if (Number.isNaN(t.getTime())) throw bad('Thời gian không hợp lệ');
  if (t.getTime() < now - 60e3) throw bad('Không đặt giờ đăng trong quá khứ');
  const before = p.scheduledAt;
  if (t.toISOString() === before) throw bad('Giờ mới trùng giờ hiện tại');
  p.scheduledAt = t.toISOString();
  if (p.status === 'awaiting_manual') p.status = 'scheduled';
  if (p.status === 'missed') { p.status = 'scheduled'; p.attempts = 0; } // hẹn lại bài bị bỏ lỡ
  delete p.skipReason;
  engine.log('calendar', `Sếp đổi giờ đăng bài "${p.topic}": ${before} → ${p.scheduledAt}`, { by: 'Sếp', postId: p.id, field: 'scheduledAt', before, after: p.scheduledAt });
  save();
  return view(d, p);
}

// Sửa nội dung. Bài đã duyệt / bị từ chối / bị lỗi → quay về chờ duyệt, tạo mục duyệt mới.
function edit(id, body) {
  const d = load();
  const p = find(id);
  if (!EDITABLE.has(p.status)) throw bad(p.status === 'published' ? 'Bài đã đăng, không sửa được' : `Bài đang ở trạng thái "${p.status}", không sửa được ở đây`);
  const next = { ...p };
  if (body.topic !== undefined) { next.topic = String(body.topic).trim().slice(0, 200); if (!next.topic) throw bad('Chủ đề không được để trống'); }
  if (body.title !== undefined) next.title = String(body.title).trim().slice(0, 200);
  if (body.text !== undefined) {
    next.text = String(body.text).trim();
    if (!next.text) throw bad('Nội dung không được để trống');
    if (next.text.length > MAX_TEXT) throw bad(`Nội dung quá dài (tối đa ${MAX_TEXT} ký tự)`);
  }
  if (body.media !== undefined) {
    if (!Array.isArray(body.media)) throw bad('Danh sách media không hợp lệ');
    let files = [];
    try { files = body.media.length ? media.validateSet(p.brand, body.media.map(String)) : []; } catch (e) { throw bad(e.message); }
    if (p.requireMedia && !files.length) throw bad('Bài Reel/video cần có video — không bỏ hết media được');
    next.media = files;
  }
  if (body.scheduledAt !== undefined) {
    const t = new Date(body.scheduledAt);
    if (Number.isNaN(t.getTime())) throw bad('Thời gian không hợp lệ');
    if (t.getTime() < Date.now() - 60e3) throw bad('Không đặt giờ đăng trong quá khứ');
    next.scheduledAt = t.toISOString();
  }
  const changed = ['topic', 'title', 'text', 'scheduledAt'].some((k) => (next[k] || '') !== (p[k] || '')) || JSON.stringify(next.media || []) !== JSON.stringify(p.media || []);
  if (!changed) throw bad('Không có thay đổi nào');
  const wasApproved = p.status !== 'draft';
  const before = { topic: p.topic, text: p.text };
  Object.assign(p, next);
  if (p.text !== before.text && p.brand && !xhs.isXhs(p.channel)) {
    require('./lessons').record({ type: 'edit', kind: 'post', brand: p.brand, topic: p.topic, before: before.text, after: p.text });
    p.qc = require('./content-flow').qcOf(p); // chấm lại ngay theo nội dung mới
  }
  if (p.media && !p.media.length) delete p.media;
  delete p.skipReason; delete p.error; p.attempts = 0;
  const brand = planner.brands()[p.brand] || { name: '' };
  const label = (social.CHANNELS[p.channel] || {}).label || p.channel;
  const title = `Bài ${label} · ${brand.name}: ${p.topic}`;
  const detail = xhs.isXhs(p.channel) ? `${p.title || ''}\n\n${p.text}` : p.text;
  const pending = d.approvals.find((a) => a.type === 'post_publish' && a.status === 'pending' && (a.payload || {}).postId === p.id);
  if (pending) { pending.title = title; pending.detail = detail; }
  else {
    p.status = 'draft';
    d.approvals.unshift({ id: uid('p'), type: 'post_publish', key: p.id, status: 'pending', at: new Date().toISOString(), title, detail, payload: { postId: p.id } });
  }
  engine.log('calendar', `Sếp sửa bài "${p.topic}"${wasApproved ? ' — quay về chờ duyệt lại' : ''}`, { by: 'Sếp', postId: p.id, field: 'content', before: before.text.slice(0, 80), after: p.text.slice(0, 80) });
  save();
  return view(d, p);
}

// Huỷ bài: không đăng nữa; mục duyệt đang chờ được đóng lại
function cancel(id) {
  const d = load();
  const p = find(id);
  if (!CANCELLABLE.has(p.status)) throw bad(p.status === 'published' ? 'Bài đã đăng, không huỷ được' : `Bài đang ở trạng thái "${p.status}", không huỷ được`);
  p.status = 'cancelled';
  for (const a of d.approvals) {
    if (a.type === 'post_publish' && a.status === 'pending' && (a.payload || {}).postId === p.id) {
      Object.assign(a, { status: 'rejected', decidedAt: new Date().toISOString(), decidedBy: 'Sếp', note: 'Huỷ bài từ Lịch đăng', dry: d.settings.dryRun });
    }
  }
  engine.log('calendar', `Sếp huỷ bài "${p.topic}"`, { by: 'Sếp', postId: p.id, field: 'status', before: 'chưa đăng', after: 'cancelled' });
  save();
  return view(d, p);
}

async function handleApi(req, res, url, { readBody, send }) {
  const p = url.pathname;
  let m;
  if (!p.startsWith('/api/posts')) return false;
  try {
    if (req.method === 'GET' && p === '/api/posts') {
      const q = url.searchParams;
      return send(res, 200, { posts: list({ from: q.get('from'), to: q.get('to'), brand: q.get('brand'), channel: q.get('channel'), status: q.get('status'), q: q.get('q') }) }), true;
    }
    if (req.method === 'POST' && (m = p.match(/^\/api\/posts\/([^/]+)\/reschedule$/))) {
      const b = await readBody(req);
      return send(res, 200, { post: reschedule(m[1], b.scheduledAt) }), true;
    }
    if (req.method === 'POST' && (m = p.match(/^\/api\/posts\/([^/]+)\/qc$/))) {
      return send(res, 200, { qc: require('./content-flow').recheck(m[1]) }), true;
    }
    if (req.method === 'POST' && (m = p.match(/^\/api\/posts\/([^/]+)\/rewrite$/))) {
      const b = await readBody(req).catch(() => ({}));
      return send(res, 200, await require('./content-flow').rewrite(m[1], b.instruction)), true;
    }
    if (req.method === 'PUT' && (m = p.match(/^\/api\/posts\/([^/]+)$/))) {
      return send(res, 200, { post: edit(m[1], await readBody(req)) }), true;
    }
    if (req.method === 'DELETE' && (m = p.match(/^\/api\/posts\/([^/]+)$/))) {
      return send(res, 200, { post: cancel(m[1]) }), true;
    }
  } catch (e) {
    send(res, e.status || 500, { error: e.message });
    return true;
  }
  return false;
}

module.exports = { list, reschedule, edit, cancel, view, handleApi };
