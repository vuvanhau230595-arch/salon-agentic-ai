// TikTok — chế độ "gói đăng thủ công" (mặc định).
// Không cần đăng ký ứng dụng hay chờ TikTok kiểm duyệt: agent soạn kế hoạch, chú thích, hashtag, chọn video,
// rồi tạo "gói đăng" cho từng bài. Sếp tải video về, dán chú thích và hẹn giờ trên TikTok Studio,
// sau đó bấm "Đã hẹn giờ trên TikTok" / "Đã đăng" để nhật ký và thư viện media khớp thực tế.
const fs = require('node:fs');
const { load, save } = require('./db');
const lib = require('./media');
const xhs = require('./xhs'); // chỉ dùng hàm tiện ích chung: tách hashtag, đổi giờ

const ID = 'tiktok';
const MAX_CAPTION = 2200; // giới hạn chú thích của TikTok (UTF-16)
const STUDIO_URL = 'https://www.tiktok.com/tiktokstudio/upload';
const planner = () => require('./planner');
const engine = () => require('./engine');

const isTiktok = (channel) => channel === ID;
const BATCH_DAYS = 10; // TikTok Studio cho hẹn giờ trước tối đa ~10 ngày

// Các nick TikTok của thương hiệu, ghi ở ô tên tài khoản (Thương hiệu & Kênh), cách nhau dấu phẩy/xuống dòng.
// Chỉ là tên công khai để nhớ đăng lên đâu, không phải mật khẩu hay khoá. Mỗi bài cần đăng lên TẤT CẢ nick này.
// Chế độ API: nick = các tài khoản TikTok đã "Kết nối" cho thương hiệu (theo @username).
function nicksOf(brandId) {
  const tt = require('./connectors/tiktok');
  if (tt.mode() === 'api') return [...new Set(tt.accounts(brandId).filter((a) => a.username).map((a) => '@' + a.username))].slice(0, 10);
  const b = planner().brands()[brandId];
  const raw = b && b.channels && b.channels.tiktok ? String(b.channels.tiktok.handle || '') : '';
  const out = [];
  for (const x of raw.split(/[\s,;]+/)) {
    const n = x.replace(/^https?:\/\/(www\.)?tiktok\.com\//i, '').replace(/[/?#].*$/, '').trim();
    if (!n) continue;
    const nick = n.startsWith('@') ? n : '@' + n;
    if (!out.includes(nick)) out.push(nick);
  }
  return out.slice(0, 10);
}
// Trạng thái từng nick của 1 bài: { nick, status: 'pending'|'external_scheduled'|'published', url }
// Bài gắn 1 nick (post.tiktokNick) chỉ đăng lên nick đó; bài cũ không gắn nick = đăng lên mọi nick
const targetsOf = (post) => (post.tiktokNick ? [post.tiktokNick] : nicksOf(post.brand));
function nickStates(post) {
  const done = post.tiktokNicks || {};
  return targetsOf(post).map((nick) => ({ nick, status: (done[nick] && done[nick].status) || 'pending', url: (done[nick] && done[nick].url) || '' }));
}

// Kiểm tra nhanh trước khi đăng: trả về [{ level: 'block'|'warn'|'info', msg }]
function checks(post, files) {
  const out = [];
  const caption = String(post.text || '');
  if (caption.length > MAX_CAPTION) out.push({ level: 'block', msg: `Chú thích dài ${caption.length} ký tự, TikTok chỉ nhận tối đa ${MAX_CAPTION}.` });
  if (!files.length) out.push({ level: 'block', msg: 'Bài chưa gắn video — TikTok cần video. Gắn video ở Kế hoạch tháng.' });
  if (files.some((f) => f.type !== 'video')) out.push({ level: 'block', msg: 'TikTok chỉ nhận video (không đăng ảnh bằng gói này).' });
  for (const f of files) {
    if (f.missing) out.push({ level: 'block', msg: `Không thấy file "${f.name}" trong thư viện.` });
    else if (f.info && f.info.width && f.info.height && f.info.width > f.info.height) {
      out.push({ level: 'warn', msg: `Video "${f.name}" là khung ngang (${f.info.width}×${f.info.height}). TikTok hiển thị tốt nhất ở khung dọc 9:16 — nên kiểm tra lại.` });
    }
  }
  if (load().settings.tiktokAigc) out.push({ level: 'info', msg: 'Video làm bằng AI: nhớ bật mục "Nội dung do AI tạo" khi đăng trên TikTok.' });
  return out;
}

function buildPackage(post) {
  if (!isTiktok(post.channel)) throw new Error('Chỉ tạo gói đăng TikTok cho bài TikTok');
  const brand = planner().brands()[post.brand] || {};
  const { body, hashtags } = xhs.splitCaption(post.text);
  const files = (post.media || []).map((m) => {
    const f = { name: m.name, type: m.type, path: null, size: 0, info: null, missing: false, downloadUrl: null };
    try {
      f.path = lib.resolve(post.brand, m.name);
      f.size = fs.statSync(f.path).size;
      f.downloadUrl = `/api/media/file?brand=${encodeURIComponent(post.brand)}&name=${encodeURIComponent(m.name)}`;
      if (m.type === 'video') { try { f.info = require('./mp4info').info(f.path); } catch { /* không đọc được thông số thì thôi */ } }
    } catch { f.missing = true; }
    return f;
  });
  const nicks = nickStates(post);
  const handle = nicks.map((n) => n.nick).join(', ');
  const when = xhs.vietnam(post.scheduledAt);
  const aigc = !!load().settings.tiktokAigc;
  return {
    kind: 'tiktok',
    postId: post.id,
    status: post.status,
    brand: post.brand,
    brandName: brand.name || '',
    handle,
    nicks,
    studioUrl: STUDIO_URL,
    body,
    hashtags,
    caption: post.text,
    captionLength: String(post.text || '').length,
    scheduledAt: post.scheduledAt,
    scheduledVietnam: when,
    aigc,
    media: files,
    checks: checks(post, files),
    steps: [
      `Mở TikTok Studio (${STUDIO_URL}) và đăng nhập đúng tài khoản của thương hiệu${handle ? ` (${handle})` : ''}.${nicks.length > 1 ? ` Bài này cần đăng lên cả ${nicks.length} nick: làm lần lượt từng nick (đổi tài khoản ở góc trên TikTok Studio), xong nick nào bấm nút của nick đó bên dưới.` : ''}`,
      'Bấm nút "Tải video về máy" bên dưới, rồi kéo file vào khung tải lên của TikTok Studio. Chờ tải xong.',
      'Dán chú thích vào ô mô tả (nút "Sao chép chú thích"). Hashtag đã nằm ở cuối chú thích.',
      `Kiểm tra các tùy chọn: ai được xem, cho phép bình luận…${aigc ? ' Bật "Nội dung do AI tạo" nếu video làm bằng AI.' : ''}`,
      `Bật "Lên lịch" và đặt giờ ${when} (giờ Việt Nam). TikTok chỉ cho hẹn giờ trong một khoảng nhất định; nếu không đặt được giờ này thì chọn đăng ngay hoặc giờ gần nhất cho phép.`,
      'Quay lại đây bấm "Đã hẹn giờ trên TikTok" (hoặc "Đã đăng" nếu đăng ngay). Có thể dán link bài sau khi đăng.',
    ],
  };
}

const MARK_FROM = ['scheduled', 'awaiting_manual', 'external_scheduled'];
// action: 'external_scheduled' | 'published' | 'reset'. nick: đánh dấu riêng 1 nick (thương hiệu có nhiều nick).
// Bài chỉ chuyển sang "đã hẹn giờ"/"đã đăng" khi MỌI nick đã xong.
function markPost(postId, action, url, nick) {
  const db = load();
  const p = db.posts.find((x) => x.id === postId);
  if (!p) throw new Error('Không tìm thấy bài');
  if (!isTiktok(p.channel)) throw new Error('Chỉ dùng cho bài TikTok');
  // Kiểm tra link TRƯỚC khi đổi gì, để lỗi không làm bài rơi vào trạng thái nửa vời
  const link = String(url || '').trim().slice(0, 300);
  if (link && !/^https?:\/\//i.test(link)) throw new Error('Link bài đăng phải bắt đầu bằng http:// hoặc https://');
  const nicks = targetsOf(p);
  if (p.tiktokNick) nick = nick || p.tiktokNick;
  if (nick || nicks.length > 1) return markNick(p, action, link, nick, nicks);
  if (action === 'reset') {
    if (!['external_scheduled', 'published'].includes(p.status)) throw new Error('Bài chưa ở trạng thái đã hẹn/đã đăng');
    p.status = 'scheduled';
    delete p.skipReason; delete p.url; delete p.publishedAt;
  } else if (['external_scheduled', 'published'].includes(action)) {
    if (!MARK_FROM.includes(p.status)) throw new Error('Bài này chưa được duyệt hoặc đã đăng rồi');
    p.status = action;
    if (action === 'published') { p.publishedAt = new Date().toISOString(); p.manual = true; p.live = false; }
    if (link) p.url = link;
  } else throw new Error('Hành động không hợp lệ');
  engine().log('publish', `TikTok "${p.topic}": ${action === 'published' ? 'Sếp xác nhận ĐÃ ĐĂNG' : action === 'external_scheduled' ? 'đã hẹn giờ trên TikTok' : 'đưa về chờ đăng'}`);
  save();
  return p;
}

function markNick(p, action, link, nick, nicks) {
  if (!nick) throw new Error(`Thương hiệu có ${nicks.length} nick TikTok — chọn nick đã đăng (mở Gói đăng)`);
  if (!nicks.includes(nick)) throw new Error(p.tiktokNick ? `Bài này dành cho nick ${p.tiktokNick}, không phải ${nick}` : `Nick ${nick} không có trong danh sách TikTok của thương hiệu`);
  p.tiktokNicks = p.tiktokNicks || {};
  if (action === 'reset') {
    if (!p.tiktokNicks[nick]) throw new Error('Nick này chưa được đánh dấu');
    delete p.tiktokNicks[nick];
  } else if (['external_scheduled', 'published'].includes(action)) {
    if (!MARK_FROM.includes(p.status) && !(p.status === 'published' && action === 'published')) throw new Error('Bài này chưa được duyệt hoặc đã đăng rồi');
    p.tiktokNicks[nick] = { status: action, at: new Date().toISOString(), ...(link ? { url: link } : (p.tiktokNicks[nick] && p.tiktokNicks[nick].url ? { url: p.tiktokNicks[nick].url } : {})) };
  } else throw new Error('Hành động không hợp lệ');
  // Trạng thái chung của bài theo các nick
  const st = nicks.map((n) => (p.tiktokNicks[n] || {}).status);
  if (st.every((s) => s === 'published')) { p.status = 'published'; p.publishedAt = p.publishedAt || new Date().toISOString(); p.manual = true; p.live = false; }
  else if (st.every((s) => s === 'published' || s === 'external_scheduled')) { p.status = 'external_scheduled'; delete p.publishedAt; }
  else if (['external_scheduled', 'published'].includes(p.status)) { p.status = 'scheduled'; delete p.publishedAt; }
  if (link && !p.url) p.url = link;
  const done = st.filter(Boolean).length;
  engine().log('publish', `TikTok "${p.topic}" · ${nick}: ${action === 'published' ? 'Sếp xác nhận ĐÃ ĐĂNG' : action === 'external_scheduled' ? 'đã hẹn giờ trên TikTok' : 'đưa về chờ đăng'} (${done}/${nicks.length} nick xong)`);
  save();
  return p;
}

// Danh sách cần hẹn giờ trên TikTok Studio trong BATCH_DAYS ngày tới, gom theo từng nick (cả bài đã quá giờ mà chưa đăng).
// Mỗi dòng có giờ đăng, chú thích, link tải video — Sếp ngồi 1 lần/tuần hẹn giờ hết, đến giờ TikTok tự đăng.
function batch(brandId, now = Date.now()) {
  const db = load();
  const brands = planner().brands();
  const until = now + BATCH_DAYS * 864e5;
  const groups = [];
  for (const b of Object.values(brands)) {
    if (brandId && b.id !== brandId) continue;
    const posts = db.posts.filter((p) => isTiktok(p.channel) && p.brand === b.id && ['scheduled', 'awaiting_manual', 'external_scheduled'].includes(p.status) && new Date(p.scheduledAt).getTime() <= until)
      .sort((x, y) => String(x.scheduledAt).localeCompare(String(y.scheduledAt)));
    const nicks = nicksOf(b.id);
    for (const p of posts) if (p.tiktokNick && !nicks.includes(p.tiktokNick)) nicks.push(p.tiktokNick); // nick đã gỡ khỏi danh sách nhưng còn bài
    for (const nick of nicks.length ? nicks : ['']) {
      const items = posts.filter((p) => (!p.tiktokNick || p.tiktokNick === nick) && !(nick ? (p.tiktokNicks || {})[nick] : p.status === 'external_scheduled')).map((p) => ({
        postId: p.id, topic: p.topic || '', caption: p.text || '', scheduledAt: p.scheduledAt, scheduledVietnam: xhs.vietnam(p.scheduledAt),
        overdue: new Date(p.scheduledAt).getTime() < now,
        media: (p.media || []).map((m) => ({ name: m.name, type: m.type, downloadUrl: `/api/media/file?brand=${encodeURIComponent(b.id)}&name=${encodeURIComponent(m.name)}` })),
      }));
      if (items.length) groups.push({ brand: b.id, brandName: b.name, nick, items });
    }
  }
  return { kind: 'tiktok_batch', days: BATCH_DAYS, studioUrl: STUDIO_URL, groups, total: groups.reduce((n, g) => n + g.items.length, 0) };
}

module.exports = { ID, isTiktok, buildPackage, markPost, batch, nicksOf, checks, MAX_CAPTION, STUDIO_URL, BATCH_DAYS };
