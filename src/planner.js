// Kế hoạch tháng: AI soạn sẵn cả tháng, Sếp duyệt từng bài hoặc duyệt tất cả một lần.
const { load, save, uid } = require('./db');
const { CHANNELS } = require('./connectors').social;
const ai = require('./ai');
const engine = require('./engine');
const lessons = require('./lessons');
const media = require('./media');
const xhs = require('./xhs');

// Kênh có thể gắn cho thương hiệu: handle là tên/ID công khai (không phải khóa bí mật)
const BRAND_CHANNELS = ['facebook_page', 'instagram', 'tiktok', 'youtube', 'xiaohongshu', 'zalo_oa', 'google_ads'];
// Kênh chỉ nhận đúng 1 video mỗi bài
const videoOnly = (channel) => channel === 'tiktok' || channel === 'youtube';
// addressZh: địa chỉ viết tiếng Trung, chèn cuối bài 小红书
// locationZh/taglineZh: dòng nhận diện mở đầu bài 小红书 (tên quán｜khu vực · khẩu hiệu)
const BRAND_TEXT = ['name', 'tagline', 'address', 'addressZh', 'locationZh', 'taglineZh', 'hotline', 'tone', 'postTone', 'services', 'avoid'];
// Nhận diện thương hiệu / chi nhánh / hashtag: kiểm tra chặt ở updateBrand
const HEX = /^#[0-9a-fA-F]{6}$/;
const MAX_BRANCHES = 10;
const EMPTY_IDENTITY = { primary: '', secondary: '', accent: '', font: '', logo: '' };
// ID Trang Facebook và tài khoản quảng cáo của thương hiệu: chỉ chữ số (không phải khóa bí mật)
const BRAND_IDS = { adAccountId: 'ID tài khoản quảng cáo' };
const MAX_PAGES = 10;

// Danh sách Page ID: nhận mảng hoặc chuỗi (mỗi dòng/dấu phẩy 1 ID); mỗi ID chỉ gồm chữ số; bỏ trùng
function parsePageIds(v) {
  const parts = (Array.isArray(v) ? v : String(v || '').split(/[\s,;]+/)).map((s) => String(s).trim()).filter(Boolean);
  const out = [...new Set(parts)];
  for (const id of out) if (!/^\d{5,25}$/.test(id)) throw new Error(`Page ID "${id}" không hợp lệ — chỉ gồm chữ số`);
  if (out.length > MAX_PAGES) throw new Error(`Tối đa ${MAX_PAGES} Page cho mỗi thương hiệu`);
  return out;
}

// Mặc định Facebook Page bật (kênh đang dùng); kênh khác bật khi Sếp chọn.
// Mishang đang dùng trang CÁ NHÂN: Facebook không cho app đăng lên trang cá nhân → tắt cho đến khi có Fanpage.
const emptyChannels = (brandId) => Object.fromEntries(BRAND_CHANNELS.map((c) => [c, { on: c === 'facebook_page' && brandId !== 'mishang', handle: '' }]));

const DEFAULT_BRANDS = {
  // addressZh: cơ sở Sếp đã xác nhận cho kênh 小红书 (436/29 Đỗ Thị Lời, P. Nhiêu Lộc, Q.3)
  the_one: { postTone: 'Tinh tế, thân thiện, tự nhiên, có chuyên môn. Xưng "The One" hoặc "salon"; gọi người đọc là "chị em", "nàng", "các chị đẹp".', name: 'The One Hair Salon', services: 'Cắt tóc nữ, uốn tóc, duỗi tóc, nhuộm tóc, balayage, ombre, highlight, nhuộm màu thời trang, phục hồi Keratin / Collagen / Olaplex, nối tóc', address: '436/29 Đỗ Thị Lời, P. Nhiêu Lộc, Quận 3, TP.HCM | 69/5 Nguyễn Gia Trí, Bình Thạnh, TP.HCM', addressZh: '胡志明市三郡 Nhiêu Lộc坊 Đỗ Thị Lời街 436/29号', locationZh: '胡志明市三郡', taglineZh: 'MORE BEAUTIFUL EVERY VISIT' },
  dark_hair: { name: 'Dark Hair', services: 'Cắt tóc, uốn tóc, duỗi tóc, nhuộm tóc, balayage, highlight, nối tóc, phục hồi tóc, gội dưỡng sinh', address: '104 Cống Quỳnh, Quận 1, TP.HCM', postTone: 'Cá tính, hiện đại, chuyên nghiệp, tự tin nhưng gần gũi. Xưng "Dark Hair" hoặc "salon"; gọi người đọc là "chị em".' },
  mishang: { name: 'Mishang Beauty', address: '' },
};

function brands() {
  const ov = load().settings.brands || {};
  const out = {};
  for (const [id, b] of Object.entries(DEFAULT_BRANDS)) {
    const o = ov[id] || {};
    const channels = emptyChannels(id);
    for (const c of BRAND_CHANNELS) channels[c] = { ...channels[c], ...((o.channels || {})[c] || {}) };
    out[id] = { hotline: '', tone: '', postTone: '', services: '', avoid: '', adAccountId: '', addressZh: '', locationZh: '', taglineZh: '', tagline: '', hashtags: '', ...b, ...o, id, channels, pageIds: Array.isArray(o.pageIds) ? o.pageIds : [], identity: { ...EMPTY_IDENTITY, ...(o.identity || {}) }, branches: Array.isArray(o.branches) ? o.branches : [] };
  }
  return out;
}

// Cập nhật 1 thương hiệu: chỉ nhận các trường cho phép, cắt độ dài
function updateBrand(id, patch) {
  if (!DEFAULT_BRANDS[id]) throw new Error('Thương hiệu không tồn tại');
  const db = load();
  const cur = (db.settings.brands[id] = db.settings.brands[id] || {});
  if (patch.pageIds !== undefined) cur.pageIds = parsePageIds(patch.pageIds);
  for (const [k, label] of Object.entries(BRAND_IDS)) {
    if (typeof patch[k] !== 'string') continue;
    const v = patch[k].trim().replace(/^act_/i, '');
    if (v && !/^\d{5,25}$/.test(v)) throw new Error(`${label} chỉ gồm chữ số (dài 5–25 ký tự)`);
    cur[k] = v;
  }
  for (const k of BRAND_TEXT) {
    if (typeof patch[k] !== 'string') continue;
    const v = patch[k].trim().slice(0, 600);
    if (k === 'name' && !v) throw new Error('Tên thương hiệu không được để trống');
    cur[k] = v;
  }
  if (patch.hashtags !== undefined) {
    // Chuẩn hoá: mỗi từ thành #từ, bỏ trùng, tối đa 12 hashtag
    const tags = [...new Set(String(patch.hashtags).split(/[\s,;]+/).map((t) => t.replace(/^#+/, '').replace(/[^\p{L}\p{N}_]/gu, '')).filter(Boolean).map((t) => '#' + t))];
    if (tags.length > 12) throw new Error('Tối đa 12 hashtag');
    cur.hashtags = tags.join(' ');
  }
  if (patch.identity !== undefined) {
    const i = patch.identity;
    if (!i || typeof i !== 'object') throw new Error('Nhận diện thương hiệu không hợp lệ');
    const next = { ...EMPTY_IDENTITY, ...(cur.identity || {}) };
    for (const k of ['primary', 'secondary', 'accent']) {
      if (i[k] === undefined) continue;
      const v = String(i[k]).trim();
      if (v && !HEX.test(v)) throw new Error(`Màu "${k}" phải dạng #RRGGBB (ví dụ #C46A3A)`);
      next[k] = v.toUpperCase();
    }
    if (i.font !== undefined) next.font = String(i.font).trim().slice(0, 40);
    if (i.logo !== undefined) {
      const v = String(i.logo).trim();
      if (v) {
        try { media.resolve(id, v); } catch (e) { throw new Error('Logo phải là file có trong Thư viện Media của thương hiệu: ' + e.message); }
        if (media.kindOf(v) !== 'image') throw new Error('Logo phải là ảnh (jpg, png, webp)');
      }
      next.logo = v;
    }
    cur.identity = next;
  }
  if (patch.branches !== undefined) {
    if (!Array.isArray(patch.branches)) throw new Error('Danh sách chi nhánh không hợp lệ');
    if (patch.branches.length > MAX_BRANCHES) throw new Error(`Tối đa ${MAX_BRANCHES} chi nhánh`);
    const clean = patch.branches.map((b) => {
      const name = String((b || {}).name || '').trim().slice(0, 80);
      if (!name) throw new Error('Tên chi nhánh không được để trống');
      const map = String(b.map || '').trim().slice(0, 300);
      if (map && !/^https?:\/\//i.test(map)) throw new Error(`Liên kết bản đồ của "${name}" phải bắt đầu bằng http:// hoặc https://`);
      return { id: String(b.id || '').slice(0, 40) || uid('br'), name, address: String(b.address || '').trim().slice(0, 200), addressZh: String(b.addressZh || '').trim().slice(0, 200), phone: String(b.phone || '').trim().slice(0, 30), hours: String(b.hours || '').trim().slice(0, 80), map };
    });
    cur.branches = clean;
    // Địa chỉ chèn cuối bài tự ghép từ các chi nhánh (có chi nhánh thì không sửa tay trường "address")
    if (clean.length) cur.address = clean.map((b) => b.address).filter(Boolean).join(' | ');
  }
  if (patch.channels && typeof patch.channels === 'object') {
    cur.channels = cur.channels || {};
    for (const c of BRAND_CHANNELS) {
      const p = patch.channels[c];
      if (!p) continue;
      cur.channels[c] = { ...(cur.channels[c] || emptyChannels(id)[c]) };
      if (typeof p.on === 'boolean') cur.channels[c].on = p.on;
      if (typeof p.handle === 'string') cur.channels[c].handle = p.handle.trim().slice(0, 200);
    }
  }
  save();
}

// Thương hiệu này có bật kênh đó không? (bài không gắn thương hiệu thì luôn được phép)
function channelEnabled(brandId, channel) {
  if (!brandId) return true;
  const b = brands()[brandId];
  return !!(b && b.channels[channel] && b.channels[channel].on);
}

// Hồ sơ thương hiệu đưa cho AI để viết đúng giọng, đúng dịch vụ
function brandContext(b) {
  const parts = [];
  if (b.tone) parts.push(`Giọng văn: ${b.tone}`);
  if (b.services) parts.push(`Dịch vụ chính: ${b.services}`);
  if (b.hotline) parts.push(`Hotline: ${b.hotline}`);
  if (b.tagline) parts.push(`Khẩu hiệu thương hiệu: ${b.tagline}`);
  if (b.hashtags) parts.push(`Hashtag ưu tiên của thương hiệu: ${b.hashtags}`);
  if (b.avoid) parts.push(`TUYỆT ĐỐI KHÔNG nói/hứa: ${b.avoid}`);
  const own = lessons.activeText(b.id, true);
  if (own) parts.push(own);
  return parts.join('\n');
}
const TYPES = { post: 'Bài đăng', reel: 'Reel / video ngắn', story: 'Story' };
const FALLBACK_TOPICS = [
  'Ưu đãi đang chạy', 'Mẹo chăm sóc tóc tại nhà', 'Feedback khách hàng', 'Before / After',
  'Dịch vụ nổi bật trong tháng', 'Hậu trường salon', 'Kiến thức về màu tóc', 'Giới thiệu đội ngũ thợ',
];

// days: 1=T2 ... 7=CN. Trả về các thời điểm (giờ máy chủ) trong tháng, bỏ ngày đã qua.
function slots(month, days, time) {
  const [y, m] = month.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const out = [];
  for (let d = 1; ; d++) {
    const dt = new Date(y, m - 1, d, hh, mm);
    if (dt.getMonth() !== m - 1) break;
    const dow = dt.getDay() === 0 ? 7 : dt.getDay();
    if (days.includes(dow) && dt.getTime() > Date.now()) out.push(dt);
  }
  return out;
}

function fallbackItem(i, brand, direction, hint) {
  const topic = hint ? hint.charAt(0).toUpperCase() + hint.slice(1) : FALLBACK_TOPICS[i % FALLBACK_TOPICS.length];
  const lines = [`✨ ${topic} – ${brand.name}`, '', direction ? `${direction}` : 'Bạn đang muốn đổi mới mái tóc? Nhắn tin để được tư vấn miễn phí nhé!'];
  if (brand.address) lines.push('', `📍 ${brand.address}`);
  if (brand.hotline) lines.push(`📞 ${brand.hotline}`);
  lines.push('📲 Inbox ngay để giữ lịch đẹp nhé!');
  return { topic, text: lines.join('\n') };
}

async function aiItems(n, brand, channel, type, direction, dates, hints = []) {
  const mediaLines = hints.map((h, i) => (h ? `Bài ${i + 1}: đăng kèm ảnh/video "${h}"` : '')).filter(Boolean);
  const mediaBlock = mediaLines.length
    ? `Mỗi bài đăng kèm ảnh/video có sẵn, nội dung bài phải hợp với file đó (không bịa chi tiết ngoài tên/ghi chú):\n${mediaLines.join('\n')}\n`
    : '';
  const prompt = `ĐÂY LÀ BÀI ĐĂNG CÔNG KHAI trên trang của salon, KHÔNG phải tin nhắn trả lời khách: các quy định xưng hô "em – chị", mở đầu "Dạ", gọi khách "chị yêu", hỏi từng câu... là của TIN NHẮN, không áp dụng cho bài đăng. Viết như bài fanpage chuyên nghiệp: nói với người đọc chung (bạn/nàng), thay mặt salon, mở bằng 1 câu hook, không mở đầu bằng "Dạ".
Lập kế hoạch ${n} nội dung (${TYPES[type]}) cho ${CHANNELS[channel].label} của "${brand.name}" trong tháng.
Ngày đăng: ${dates.map((d) => d.toLocaleDateString('vi-VN')).join(', ')}.
Định hướng của Sếp: ${direction || '(không có — tự đề xuất đa dạng: ưu đãi, mẹo chăm sóc, feedback khách, before/after, dịch vụ nổi bật)'}.
${brand.address ? 'Địa chỉ để chèn cuối bài: ' + brand.address : ''}
${channel === 'tiktok' ? 'Chú thích TikTok: câu đầu là "hook" ngắn gợi tò mò, tổng dưới 150 chữ, 3–5 hashtag ở dòng cuối, chỉ ghi tên khu vực thay vì địa chỉ dài; video dọc 9:16.' : ''}
${brandContext(brand)}
${mediaBlock}Chỉ trả về JSON thuần, không giải thích: mảng đúng ${n} phần tử, mỗi phần tử {"topic":"tiêu đề ngắn","text":"nội dung đăng, tối đa 90 từ, có lời kêu gọi nhắn tin, 3 hashtag"}. Không bịa giá hay khuyến mãi nếu Sếp chưa nêu.`;
  const raw = await ai.raw(prompt, 4000);
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1));
    if (Array.isArray(arr) && arr.length) return arr.map((x) => ({ topic: String(x.topic || ''), text: String(x.text || '') }));
  } catch {}
  return null;
}

async function create(b) {
  const brand = brands()[b.brand];
  if (!brand) throw new Error('Chọn thương hiệu');
  if (!CHANNELS[b.channel]) throw new Error('Chọn kênh');
  if (!channelEnabled(b.brand, b.channel)) {
    throw new Error(`Kênh ${CHANNELS[b.channel].label} đang tắt cho ${brand.name} — bật ở trang Thương hiệu & Kênh trước.`);
  }
  if (!TYPES[b.type]) throw new Error('Chọn loại nội dung');
  if (!/^\d{4}-\d{2}$/.test(b.month || '')) throw new Error('Chọn tháng');
  if (!/^\d{1,2}:\d{2}$/.test(b.time || '')) throw new Error('Chọn giờ đăng');
  const days = (b.days || []).map(Number).filter((d) => d >= 1 && d <= 7);
  if (!days.length) throw new Error('Chọn ít nhất 1 ngày đăng trong tuần');
  const dates = slots(b.month, days, b.time).slice(0, 31);
  if (!dates.length) throw new Error('Không còn ngày nào trong tháng này để đăng (đã qua hết)');
  // Sếp chọn sẵn file từ Thư viện Media ("Lên bài hàng loạt"): mỗi file 1 bài theo đúng thứ tự, số bài = số file
  const chosen = Array.isArray(b.media) ? [...new Set(b.media.map(String))].filter(Boolean) : [];
  if (chosen.length) {
    if (chosen.length > dates.length) throw new Error(`Chỉ còn ${dates.length} ngày đăng trong tháng ${b.month} cho ${chosen.length} file — bớt file hoặc chọn thêm ngày trong tuần`);
    dates.length = chosen.length;
  }

  // TikTok nhiều nick: mỗi ngày đăng, MỖI nick 1 bài riêng với video riêng (không đăng 1 video lên 2 nick)
  const nicks = b.channel === 'tiktok' ? require('./tiktok-manual').nicksOf(b.brand) : [];
  const multi = nicks.length > 1;
  const nickOf = []; // nickOf[i] = nick của bài thứ i (chỉ khi multi)
  if (multi && chosen.length) {
    const need = Math.ceil(chosen.length / nicks.length);
    if (need > dates.length) throw new Error(`${chosen.length} video chia cho ${nicks.length} nick cần ${need} ngày đăng, tháng ${b.month} chỉ còn ${dates.length} ngày — bớt video hoặc chọn thêm ngày`);
    const base = dates.slice(0, need);
    dates.length = 0;
    chosen.forEach((_, i) => { dates.push(base[Math.floor(i / nicks.length)]); nickOf.push(nicks[i % nicks.length]); });
  }

  // Không tạo bài trùng ngày: bỏ các ngày thương hiệu này đã có bài (nháp/chờ duyệt/đã lên lịch/đã đăng) trên cùng kênh
  // (TikTok nhiều nick: tính theo từng nick; bài cũ không gắn nick = chiếm ngày của mọi nick)
  const dayKey = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
  const busy = new Set();
  const mark = (t, nick) => busy.add(multi ? `${dayKey(t)}|${nick || '*'}` : dayKey(t));
  for (const x of load().posts) if (x.brand === b.brand && x.channel === b.channel && !['rejected', 'cancelled', 'failed'].includes(x.status)) mark(x.scheduledAt, x.tiktokNick);
  for (const pl of load().plans) if (pl.brand === b.brand && pl.channel === b.channel && pl.status === 'pending') for (const it of pl.items) if (it.status === 'pending') mark(it.at, it.nick);
  const isBusy = (d, nick) => (multi ? busy.has(`${dayKey(d)}|${nick}`) || busy.has(`${dayKey(d)}|*`) : busy.has(dayKey(d)));
  if (!chosen.length) {
    const free = [];
    for (const d of dates) for (const nick of multi ? nicks : [null]) if (!isBusy(d, nick)) { free.push(d); if (multi) nickOf.push(nick); }
    if (!free.length) throw new Error(`Các ngày đăng trong tháng ${b.month} đều đã có bài của ${brand.name} trên ${CHANNELS[b.channel].label} — không tạo thêm để tránh trùng ngày`);
    dates.length = 0; dates.push(...free.slice(0, 62));
    nickOf.length = dates.length;
  }
  let drafted = null;
  const zh = xhs.isXhs(b.channel); // 小红书: soạn tiếng Trung, mỗi bài có tiêu đề riêng
  const sets = chosen.length ? chosen.map((n) => media.validateSet(b.brand, [n])) : multi ? uniqueVideos(b.brand, dates.length) : media.assign(b.brand, b.type, dates.length, b.channel);
  if (!chosen.length) {
    const empty = sets.filter((s) => !s.length).length;
    const ded = require('./drive').dedicatedFolders(b.brand, b.channel);
    if (empty && ded.length && !multi) engine.log('error', `${brand.name} · ${CHANNELS[b.channel].label}: thư mục Drive "${ded.join('", "')}" chưa có đủ video/ảnh cho ${empty} bài — bỏ video vào thư mục đó rồi bấm "Nạp ngay" (agent không lấy video của kênh khác)`);
  }
  if (multi && !chosen.length) {
    const empty = sets.filter((s) => !s.length).length;
    if (empty) engine.log('error', `TikTok ${brand.name}: thiếu ${empty} video mới cho ${dates.length} bài (${nicks.length} nick, mỗi nick video riêng, không đăng lại video cũ) — thêm video vào Thư viện Media rồi gắn vào các bài còn trống`);
  }
  if (chosen.length && (b.type === 'reel' || videoOnly(b.channel))) { const bad = sets.find((s) => s[0].type !== 'video'); if (bad) throw new Error(`Bài Reel/TikTok/YouTube chỉ nhận video — "${bad[0].name}" là ảnh`); }
  const hints = sets.map((s) => s.map((f) => media.hint(b.brand, f)).join(', '));
  let pipeline = null;
  if (!zh) {
    // Strategy → Copywriter → Quality Control (viết lại tối đa 3 lần): xem src/content-engine.js
    const ce = require('./content-engine');
    const slots = ce.strategy(b.brand, dates, { hints });
    if (b.direction) slots.forEach((sl) => { sl.direction = b.direction; });
    try { pipeline = await ce.produceMany(brand, slots, { hints }); } catch (e) { engine.log('error', `Dây chuyền nội dung lỗi, dùng mẫu: ${e.message}`); }
    if (pipeline) drafted = pipeline.map((r, i) => ({ topic: slots[i].topic, text: r.text }));
    pipeline = pipeline && pipeline.map((r, i) => ({ ...r, slot: slots[i] }));
  }
  if (zh || !pipeline) try { drafted = zh ? await xhs.aiItems(dates.length, brand, b.type, b.direction, dates, hints) : await aiItems(dates.length, brand, b.channel, b.type, b.direction, dates, hints); }
  catch (e) { engine.log('error', `AI soạn kế hoạch lỗi, dùng mẫu: ${e.message}`); }
  // 小红书 không có AI: chỉ có vài mẫu khác nhau — đăng lặp nội dung dễ bị coi là chất lượng thấp, nên chỉ soạn từng đó bài
  if (zh && !drafted && dates.length > xhs.FALLBACKS.length) {
    engine.log('system', `小红书: chưa có AI nên chỉ soạn ${xhs.FALLBACKS.length} bài mẫu khác nhau (không lặp nội dung) thay vì ${dates.length} bài`);
    dates.length = xhs.FALLBACKS.length;
  }

  const items = dates.map((at, i) => {
    const d = (drafted && drafted[i]) || (zh ? xhs.fallbackItem(i, brand) : fallbackItem(i, brand, b.direction, hints[i]));
    const pr = pipeline && pipeline[i];
    return { id: uid('i'), at: at.toISOString(), topic: d.topic, ...(zh ? { title: d.title || '' } : {}), text: d.text, media: sets[i], selected: true, status: 'pending', ...(multi ? { nick: nickOf[i] } : {}),
      ...(pr ? { ...(pr.mode === 'ai' ? { aiText: pr.text } : {}), category: pr.topicCategory, qc: pr.qc, versions: pr.versions.length > 1 ? pr.versions : undefined } : {}) };
  });
  const plan = {
    id: uid('plan'), brand: b.brand, month: b.month, channel: b.channel, type: b.type, time: b.time, days,
    direction: b.direction || '', status: 'pending', aiDrafted: !!drafted, createdAt: new Date().toISOString(), items,
  };
  const db = load();
  db.plans.unshift(plan);
  engine.log('propose', `Soạn kế hoạch ${brand.name} tháng ${b.month}: ${items.length} bài, chờ Sếp duyệt`);
  save();
  return plan;
}

// TikTok nhiều nick: n video KHÁC nhau, chưa từng dùng cho TikTok của thương hiệu (bài đã/sắp đăng, kế hoạch đang chờ).
// Thiếu thì các bài còn lại để trống video (không lấy lại video cũ) — duyệt sẽ báo thiếu video.
function uniqueVideos(brandId, n) {
  const used = new Set();
  const db = load();
  for (const x of db.posts) if (x.brand === brandId && x.channel === 'tiktok' && !['rejected', 'cancelled'].includes(x.status)) for (const m of x.media || []) used.add(m.name);
  for (const pl of db.plans) if (pl.brand === brandId && pl.channel === 'tiktok' && pl.status === 'pending') for (const it of pl.items) if (it.status === 'pending') for (const m of it.media || []) used.add(m.name);
  const forChannel = require('./drive').mediaFilter(brandId, 'tiktok');
  const pool = media.list(brandId).filter((f) => f.type === 'video' && !f.excluded && !f.archived && !used.has(f.name) && forChannel(f)).sort((a, b) => a.uses - b.uses || a.mtime - b.mtime);
  return Array.from({ length: n }, (_, i) => (pool[i] ? [{ name: pool[i].name, type: 'video' }] : []));
}

const dm = (iso) => { const d = new Date(iso); return `${d.getDate()}/${d.getMonth() + 1}`; };

function findItem(planId, itemId) {
  const plan = load().plans.find((p) => p.id === planId);
  if (!plan) throw new Error('Không tìm thấy kế hoạch');
  const item = itemId ? plan.items.find((i) => i.id === itemId) : null;
  if (itemId && !item) throw new Error('Không tìm thấy bài');
  return { plan, item };
}

function editItem(planId, itemId, patch) {
  const { plan, item } = findItem(planId, itemId);
  if (item.status !== 'pending') throw new Error('Bài này đã được xử lý');
  if (typeof patch.text === 'string' && patch.text !== item.text) {
    lessons.record({ type: 'edit', kind: 'plan_item', brand: plan.brand, topic: item.topic, before: item.text, after: patch.text });
    item.text = patch.text;
    if (!xhs.isXhs(plan.channel)) item.qc = require('./content-flow').qcOf({ brand: plan.brand, channel: plan.channel, text: item.text, category: item.category, scheduledAt: item.at });
  }
  if (typeof patch.title === 'string' && xhs.isXhs(plan.channel)) item.title = patch.title.trim().slice(0, 60);
  if (typeof patch.selected === 'boolean') item.selected = patch.selected;
  if (Array.isArray(patch.media)) {
    const set = media.validateSet(plan.brand, patch.media.map(String));
    if (videoOnly(plan.channel) && (set.length > 1 || (set.length === 1 && set[0].type !== 'video'))) {
      throw new Error(`${CHANNELS[plan.channel].label} chỉ nhận đúng 1 video cho mỗi bài`);
    }
    item.media = set;
  }
  save();
}

// Duyệt các bài đang chọn → lên lịch đăng; bài bỏ chọn → bỏ qua
function approve(planId) {
  const { plan } = findItem(planId);
  const db = load();
  if (plan.type === 'reel' || videoOnly(plan.channel)) {
    const missing = plan.items.filter((i) => i.status === 'pending' && i.selected && !(i.media || []).length).length;
    if (missing) throw new Error(`${missing} bài ${videoOnly(plan.channel) ? CHANNELS[plan.channel].label : 'Reel'} chưa có video — gắn video hoặc bỏ chọn bài đó trước khi duyệt`);
  }
  // 小红书: bài vi phạm nặng (liên hệ ngoài, từ cực đoan, tiêu đề quá dài...) không được duyệt
  if (xhs.isXhs(plan.channel)) {
    xhs.assertApprovable(plan.items.filter((i) => i.status === 'pending' && i.selected).map((i) => ({ label: `${dm(i.at)} "${i.title || i.topic}"`, result: xhs.lintItem(plan, i) })));
  }
  // Quality Control: bài thiếu dữ liệu / bịa giá-hotline / nhầm thương hiệu thì không duyệt được (bỏ chọn hoặc sửa trước)
  if (!xhs.isXhs(plan.channel)) {
    const flow = require('./content-flow');
    const probs = [];
    for (const it of plan.items) {
      if (it.status !== 'pending' || !it.selected) continue;
      const r = flow.problemsOf(flow.qcOf({ brand: plan.brand, channel: plan.channel, text: it.text, category: it.category, scheduledAt: it.at }) || { needsInfo: [], issues: [] });
      if (r.length) probs.push(`${dm(it.at)} "${it.topic}": ${r.join('; ')}`);
    }
    if (probs.length) throw new Error(`${probs.length} bài chưa duyệt được — ${probs.slice(0, 3).join(' | ')}${probs.length > 3 ? ' …' : ''}. Sửa hoặc bỏ chọn các bài này.`);
  }
  let n = 0;
  for (const it of plan.items) {
    if (it.status !== 'pending') continue;
    if (it.selected) {
      db.posts.unshift({
        id: uid('post'), channel: plan.channel, brand: plan.brand, topic: it.topic, ...(xhs.isXhs(plan.channel) ? { title: it.title || '' } : {}), text: it.text,
        scheduledAt: it.at, status: 'scheduled', planId: plan.id, ...(it.nick ? { tiktokNick: it.nick } : {}),
        media: (it.media || []).map((m) => ({ ...m })), requireMedia: plan.type === 'reel' || videoOnly(plan.channel),
        ...(it.category ? { category: it.category } : {}), ...(it.aiText ? { aiText: it.aiText } : {}), ...(it.qc ? { qc: it.qc } : {}),
      });
      if (!xhs.isXhs(plan.channel)) require('./learning').capture({ brand: plan.brand, topic: it.topic, category: it.category, aiText: it.aiText, finalText: it.text, qcScore: it.qc && it.qc.score });
      it.status = 'scheduled';
      n++;
    } else {
      it.status = 'rejected';
      lessons.record({ type: 'reject', kind: 'plan_item', brand: plan.brand, topic: it.topic });
    }
  }
  plan.status = 'approved';
  engine.log('approve', `Sếp duyệt kế hoạch ${brands()[plan.brand].name} tháng ${plan.month}: ${n} bài lên lịch`);
  save();
  return n;
}

// Lái tự động: gần cuối tháng thì tự soạn kế hoạch tháng sau theo từng hồ sơ.
// Mặc định vẫn chờ Sếp duyệt; chỉ tự duyệt khi Sếp bật autoApprove. Không bao giờ tự tăng ngân sách.
async function autopilot() {
  const db = load();
  const ap = db.settings.autopilot;
  if (!ap.on || db.settings.paused) return 0;
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const ym = (dt) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}`;
  const daysLeft = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate() - now.getDate();
  const months = [ym(now)];
  if (daysLeft <= ap.draftDaysBefore) months.push(ym(new Date(now.getFullYear(), now.getMonth() + 1, 1)));
  let made = 0;
  for (const pf of ap.profiles) {
    if (!channelEnabled(pf.brand, pf.channel)) continue; // kênh đã tắt: hồ sơ tạm nghỉ
    // Kênh có thư mục Drive riêng mà thư mục chưa có video/ảnh nào dùng được: chờ, không soạn kế hoạch toàn bài trống (báo 1 lần/ngày)
    const ded = require('./drive').dedicatedFolders(pf.brand, pf.channel);
    if (ded.length && !media.assign(pf.brand, pf.type, 1, pf.channel)[0].length) {
      const today = new Date().toISOString().slice(0, 10);
      ap.waiting = ap.waiting || {};
      if (ap.waiting[pf.id] !== today) {
        ap.waiting[pf.id] = today;
        engine.log('system', `Lái tự động: ${brands()[pf.brand].name} · ${CHANNELS[pf.channel].label} đang chờ video — thư mục Drive "${ded.join('", "')}" chưa có file nào. Bỏ video vào thư mục rồi bấm "Nạp ngay" ở Thư viện Media`, { rule: 'autopilot' });
      }
      continue;
    }
    for (const month of months) {
      const exists = db.plans.some((x) => x.brand === pf.brand && x.channel === pf.channel && x.type === pf.type && x.month === month);
      if (exists) continue;
      try {
        const plan = await create({ ...pf, month });
        if (ap.autoApprove) approve(plan.id);
        engine.log('system', `Lái tự động: đã soạn kế hoạch ${brands()[pf.brand].name} tháng ${month}${ap.autoApprove ? ' và tự duyệt' : ', chờ Sếp duyệt'}`, { rule: 'autopilot' });
        made++;
      } catch (e) {
        // tháng này không còn ngày để đăng thì bỏ qua, lỗi khác mới ghi nhật ký
        if (!/đã qua hết/.test(e.message)) engine.log('error', `Lái tự động lỗi: ${e.message}`, { rule: 'autopilot' });
      }
    }
  }
  return made;
}

module.exports = { brands, channelEnabled, updateBrand, brandContext, BRAND_CHANNELS, TYPES, create, editItem, approve, autopilot };
