// Trung tâm Kênh: bảng kết nối theo thương hiệu × nền tảng với trạng thái THẬT.
// Nguyên tắc: không tuyên bố "đã kết nối" khi chưa kiểm tra API — chưa kiểm tra thì ghi "Chưa kiểm tra". Việc kiểm tra chỉ ĐỌC
// (không đăng/đổi gì), kết quả lưu ở db.channelChecks (không có token). Nền tảng chưa tích hợp ghi rõ "chưa hỗ trợ" kèm lý do.
const { load, save } = require('./db');
const meta = require('./meta');
const social = require('./connectors/social');
const tiktok = require('./connectors/tiktok');
const youtube = require('./connectors/youtube');
const secrets = require('./secrets');
const planner = require('./planner');
const engine = require('./engine');

const bad = (msg, status = 400) => { const e = new Error(msg); e.status = status; return e; };
const NEED = {
  facebook_page: ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'pages_manage_engagement'],
  instagram: ['instagram_basic', 'instagram_content_publish', 'instagram_manage_comments'],
  ads: ['ads_read', 'ads_management'],
};

// Nền tảng chưa tích hợp: nói rõ thiếu gì, để Sếp biết cần làm gì tiếp
const UNSUPPORTED = {
  zalo_oa: { label: 'Zalo OA', why: 'Chưa tích hợp. Zalo có API cho Official Account (gửi tin, đăng bài) nhưng cần đăng ký ứng dụng Zalo, được duyệt quyền và viết phần kết nối.' },
  threads: { label: 'Threads', why: 'Chưa tích hợp. Threads có API đăng bài (quyền threads_content_publish) nhưng cần ứng dụng Meta được cấp quyền Threads và phần code kết nối.' },
};

const keyOf = (brand, channel, id) => `${brand}:${channel}:${id}`;
const checks = () => (load().channelChecks = load().channelChecks || {});
let checking = false;

// ---------- Kiểm tra thật (chỉ đọc) ----------
async function verifyPage(brandId, pageId, now) {
  const k = keyOf(brandId, 'facebook_page', pageId);
  const res = { at: new Date(now).toISOString(), ok: false, level: 'error', name: '', error: '', instagram: null, note: '' };
  try {
    const token = await social.pageToken(pageId); // lỗi ở đây = Page chưa gán cho người dùng hệ thống / thiếu quyền
    const r = await meta.call(`/${pageId}`, { token, params: { fields: 'name,category,instagram_business_account{id,username}' } });
    res.name = r.name || '';
    if (r.instagram_business_account) res.instagram = { id: String(r.instagram_business_account.id), username: r.instagram_business_account.username || '' };
    try { await meta.call(`/${pageId}/posts`, { token, params: { fields: 'id', limit: 1 } }); res.ok = true; res.level = 'ok'; }
    catch (e) { res.ok = true; res.level = 'warn'; res.note = `Lấy được Page nhưng không đọc được bài viết: ${e.message}`; }
  } catch (e) { res.error = e.message; }
  checks()[k] = res;
  return res;
}
async function verifyAds(brandId, accountId, now) {
  const k = keyOf(brandId, 'ads', accountId);
  const res = { at: new Date(now).toISOString(), ok: false, level: 'error', name: '', error: '', note: '' };
  try {
    const r = await meta.call(`/${meta.adAccount(accountId)}`, { params: { fields: 'name,account_status,currency' } });
    res.name = r.name || '';
    const notes = [];
    if (r.currency && r.currency !== 'VND') notes.push(`đơn vị tiền là ${r.currency}`);
    if (r.account_status !== undefined && r.account_status !== 1) notes.push(`trạng thái tài khoản = ${r.account_status} (1 là bình thường)`);
    res.ok = true; res.level = notes.length ? 'warn' : 'ok'; res.note = notes.join('; ');
  } catch (e) { res.error = e.message; }
  checks()[k] = res;
  return res;
}
async function verifyTiktok(brandId, openId, now) {
  const k = keyOf(brandId, 'tiktok', openId);
  const res = { at: new Date(now).toISOString(), ok: false, level: 'error', name: '', error: '', note: '' };
  try {
    const token = await tiktok.freshToken(brandId, openId);
    const info = await tiktok.call('/v2/post/publish/creator_info/query/', { token });
    res.name = info.creator_username ? '@' + info.creator_username : '';
    const onlyPrivate = (info.privacy_level_options || []).every((p) => p === 'SELF_ONLY');
    res.ok = true; res.level = onlyPrivate ? 'warn' : 'ok';
    res.note = onlyPrivate ? 'Chỉ đăng được chế độ riêng tư (ứng dụng chưa audit hoặc tài khoản đang riêng tư)' : '';
  } catch (e) { res.error = e.message; }
  checks()[k] = res;
  return res;
}

// YouTube: làm mới token + đọc kênh (channels?mine=true, 1 đơn vị hạn mức). API không cho biết dự án đã qua audit chưa → luôn nhắc khoá riêng tư.
async function verifyYoutube(brandId, now) {
  const c = youtube.summary(brandId);
  const k = keyOf(brandId, 'youtube', c.channelId);
  const res = { at: new Date(now).toISOString(), ok: false, level: 'error', name: '', error: '', note: '' };
  try {
    const ch = await youtube.myChannel(await youtube.freshToken(brandId));
    res.name = ch.title;
    res.ok = true; res.level = 'ok';
    if (ch.id !== c.channelId) { res.level = 'warn'; res.note = `Tài khoản Google giờ trả về kênh khác (${ch.title}) — kết nối lại nếu đổi kênh`; }
  } catch (e) { res.error = e.message; }
  checks()[k] = res;
  return res;
}

// Kiểm tra mọi kênh (hoặc 1 thương hiệu). Chạy tuần tự để tránh chạm giới hạn API; không chạy 2 lượt cùng lúc.
async function verify({ brand } = {}, now = Date.now()) {
  if (checking) throw bad('Đang có một lượt kiểm tra khác — chờ xong rồi bấm lại', 409);
  const brands = planner.brands();
  if (brand && !brands[brand]) throw bad('Thương hiệu không tồn tại', 404);
  checking = true;
  try {
    const d = load();
    const perms = { at: new Date(now).toISOString(), granted: null, error: '' };
    if (process.env.META_ACCESS_TOKEN) {
      try { perms.granted = ((await meta.call('/me/permissions')).data || []).filter((p) => p.status === 'granted').map((p) => p.permission); }
      catch (e) { perms.error = e.message; }
    } else perms.error = 'Chưa có META_ACCESS_TOKEN';
    d.channelPerms = perms;
    for (const b of Object.values(brands)) {
      if (brand && b.id !== brand) continue;
      if (process.env.META_ACCESS_TOKEN) {
        for (const pageId of b.pageIds) await verifyPage(b.id, pageId, now);
        if (b.adAccountId) await verifyAds(b.id, b.adAccountId, now);
      }
      if (tiktok.configured()) for (const a of tiktok.accounts(b.id)) await verifyTiktok(b.id, a.openId, now);
      if (youtube.configured() && youtube.connected(b.id)) await verifyYoutube(b.id, now);
    }
    engine.log('system', `Đã kiểm tra kết nối kênh${brand ? ` của ${brands[brand].name}` : ''} (chỉ đọc)`, { rule: 'channels' });
    save();
  } finally { checking = false; }
}

// ---------- Dựng bảng ----------
const LEVEL = { ok: 'on', warn: 'dry', error: 'off', none: '' };
function row(base) { return { actions: [], permissions: [], note: '', error: '', lastCheckedAt: null, lastUsedAt: null, ...base }; }

function permsFor(kind, perms) {
  if (!perms || !perms.granted) return [];
  return NEED[kind].map((p) => ({ name: p, granted: perms.granted.includes(p) }));
}

// Instagram đăng được khi: có token Meta, có PUBLIC_BASE_URL (Meta kéo ảnh/video từ link công khai) và token có quyền đăng
function igStatus(perms, on) {
  if (!require('./connectors/instagram').baseUrl()) return { status: 'limited', statusText: 'Đã liên kết với Page — thiếu PUBLIC_BASE_URL', note: 'Instagram lấy ảnh/video qua link công khai của app: đặt PUBLIC_BASE_URL (địa chỉ https của app) trong .env rồi chạy lại.' };
  if (perms && perms.granted && !perms.granted.includes('instagram_content_publish')) return { status: 'limited', statusText: 'Đã liên kết — token thiếu quyền đăng', note: 'Token Meta chưa có quyền instagram_content_publish: thêm quyền này khi tạo token cho người dùng hệ thống rồi cập nhật bằng set-token.ps1.' };
  return { status: 'connected', statusText: 'Đã kết nối — agent tự đăng được', note: on ? 'Đăng qua tài khoản liên kết với Page: ảnh PNG/WebP tự đổi sang JPG (khung dọc quá 4:5 được cắt bớt phía dưới), carousel tối đa 10 ảnh/video, video đăng thành Reel.' : 'Kênh đang tắt cho thương hiệu này — bài sẽ không đăng lên Instagram.' };
}

function list(now = Date.now()) {
  const d = load();
  const perms = d.channelPerms || null;
  const brands = planner.brands();
  const rows = [];
  const cc = checks();
  const lastPublish = (pageId) => d.posts.filter((p) => p.status === 'published' && p.results && p.results[pageId]).map((p) => p.scheduledAt).sort().pop() || null;
  for (const b of Object.values(brands)) {
    const ch = b.channels;
    // Facebook Pages
    for (const pageId of b.pageIds) {
      const c = cc[keyOf(b.id, 'facebook_page', pageId)];
      const sync = (d.channelSync || {})[pageId] || {};
      rows.push(row({
        id: keyOf(b.id, 'facebook_page', pageId), brand: b.id, brandName: b.name, channel: 'facebook_page', channelLabel: 'Facebook Page', externalId: pageId,
        name: c && c.name ? c.name : `Page ${pageId}`, enabled: !!ch.facebook_page.on,
        status: c ? (c.ok ? (c.level === 'warn' ? 'limited' : 'connected') : 'error') : 'unchecked',
        statusText: !c ? 'Chưa kiểm tra' : !c.ok ? 'Lỗi kết nối' : c.level === 'warn' ? 'Kết nối một phần' : 'Đã kết nối (đã kiểm tra)',
        permissions: permsFor('facebook_page', perms), error: c && !c.ok ? c.error : '', note: c && c.note ? c.note : (ch.facebook_page.on ? '' : 'Kênh đang tắt cho thương hiệu này — bài sẽ không đăng lên Page.'),
        lastCheckedAt: c ? c.at : null, lastUsedAt: [lastPublish(pageId), sync.commentsAt].filter(Boolean).sort().pop() || null,
        actions: ['remove', 'toggle'],
      }));
      // Instagram liên kết với Page
      if (c && c.instagram) {
        rows.push(row({
          id: keyOf(b.id, 'instagram', c.instagram.id), brand: b.id, brandName: b.name, channel: 'instagram', channelLabel: 'Instagram', externalId: c.instagram.id,
          name: c.instagram.username ? '@' + c.instagram.username : `IG ${c.instagram.id}`, enabled: !!ch.instagram.on,
          ...igStatus(perms, ch.instagram.on),
          permissions: permsFor('instagram', perms), lastCheckedAt: c.at, actions: ['toggle'],
          lastUsedAt: lastPublish(`ig_${c.instagram.id}`),
        }));
      }
    }
    if (!b.pageIds.length) {
      rows.push(row({ id: keyOf(b.id, 'facebook_page', 'none'), brand: b.id, brandName: b.name, channel: 'facebook_page', channelLabel: 'Facebook Page', externalId: '', name: 'Chưa gán Page', enabled: !!ch.facebook_page.on, status: 'not_connected', statusText: 'Chưa gán Page', note: 'Thêm Page ID (Page phải được gán cho người dùng hệ thống trong Meta Business).', actions: ['toggle'] }));
    }
    // Tài khoản quảng cáo (dùng cho trang Quảng cáo)
    if (b.adAccountId) {
      const c = cc[keyOf(b.id, 'ads', b.adAccountId)];
      rows.push(row({
        id: keyOf(b.id, 'ads', b.adAccountId), brand: b.id, brandName: b.name, channel: 'ads', channelLabel: 'Facebook Ads', externalId: b.adAccountId,
        name: c && c.name ? c.name : `Tài khoản ${b.adAccountId}`, enabled: true,
        status: c ? (c.ok ? (c.level === 'warn' ? 'limited' : 'connected') : 'error') : 'unchecked',
        statusText: !c ? 'Chưa kiểm tra' : !c.ok ? 'Lỗi kết nối' : c.level === 'warn' ? 'Kết nối, có lưu ý' : 'Đã kết nối (đã kiểm tra)',
        permissions: permsFor('ads', perms), error: c && !c.ok ? c.error : '', note: c && c.note ? c.note : '', lastCheckedAt: c ? c.at : null, lastUsedAt: d.lastSync || null,
      }));
    }
    // TikTok: mỗi tài khoản 1 dòng; bài TikTok của thương hiệu đăng lên tất cả. Dòng đầu có nút "Thêm tài khoản".
    const ttAccs = tiktok.accounts(b.id);
    const apiMode = tiktok.mode() === 'api';
    const canAdd = apiMode && tiktok.configured() && ttAccs.length < tiktok.MAX_ACCOUNTS;
    if (ttAccs.length) {
      ttAccs.forEach((ttAcc, i) => {
        const ttc = cc[keyOf(b.id, 'tiktok', ttAcc.openId)];
        rows.push(row({
          id: keyOf(b.id, 'tiktok', ttAcc.openId), brand: b.id, brandName: b.name, channel: 'tiktok', channelLabel: 'TikTok', externalId: ttAcc.openId || '',
          name: (ttc && ttc.name) || (ttAcc.username ? '@' + ttAcc.username : 'Tài khoản TikTok'), enabled: !!ch.tiktok.on,
          status: ttAcc.needsReauth ? 'error' : ttc ? (ttc.ok ? (ttc.level === 'warn' ? 'limited' : 'connected') : 'error') : 'unchecked',
          statusText: ttAcc.needsReauth ? 'Cần kết nối lại' : ttc ? (ttc.ok ? (ttc.level === 'warn' ? 'Kết nối một phần' : 'Đã kết nối (đã kiểm tra)') : 'Lỗi kết nối') : 'Đã đăng nhập — chưa kiểm tra',
          note: ttc && ttc.note ? ttc.note : (apiMode ? (ttAccs.length > 1 ? `Bài TikTok của thương hiệu đăng lên cả ${ttAccs.length} tài khoản.` : '') : 'Đang ở chế độ gói đăng thủ công: agent soạn nội dung, Sếp đăng bằng TikTok Studio.'),
          error: ttc && !ttc.ok ? ttc.error : '', lastCheckedAt: ttc ? ttc.at : null, lastUsedAt: lastPublish(`tt_${ttAcc.openId}`),
          actions: [...(i === 0 && canAdd ? ['connect'] : []), 'disconnect', 'toggle'],
        }));
      });
    } else {
      const ready = tiktok.configured();
      const nicks = require('./tiktok-manual').nicksOf(b.id);
      rows.push(row({
        id: keyOf(b.id, 'tiktok', 'none'), brand: b.id, brandName: b.name, channel: 'tiktok', channelLabel: 'TikTok', externalId: '',
        name: apiMode ? (ch.tiktok.handle || 'Chưa kết nối') : (nicks.length ? nicks.join(', ') : 'Chưa nhập nick'), enabled: !!ch.tiktok.on,
        status: apiMode ? 'not_connected' : 'manual', statusText: apiMode ? 'Chưa kết nối' : `Gói đăng thủ công${nicks.length ? ` · ${nicks.length} nick` : ''}`,
        note: apiMode ? (ready ? 'Bấm "Kết nối" để đăng nhập TikTok.' : 'Chưa cấu hình TIKTOK_CLIENT_KEY/SECRET trong .env.') : (nicks.length ? `Mỗi bài TikTok cần đăng lên cả ${nicks.length} nick (TikTok Studio). Danh sách cần hẹn giờ: Lịch đăng → "📅 Lên lịch TikTok".` : 'Bấm "Nhập nick TikTok" để ghi các nick của thương hiệu (không cần mật khẩu hay mã TikTok).'),
        actions: apiMode && ready ? ['connect', 'toggle'] : apiMode ? ['toggle'] : ['nicks', 'toggle'],
        nicks,
      }));
    }
    // YouTube: mỗi thương hiệu 1 kênh, tải video Shorts bằng API
    const yt = youtube.summary(b.id);
    const ytLock = 'Dự án Google Cloud chưa qua kiểm tra (audit) YouTube API thì mọi video tải lên bằng API bị khoá ở chế độ riêng tư — nộp đơn audit (xem HUONG-DAN-YOUTUBE.md).';
    if (yt.connected) {
      const ytc = cc[keyOf(b.id, 'youtube', yt.channelId)];
      rows.push(row({
        id: keyOf(b.id, 'youtube', yt.channelId), brand: b.id, brandName: b.name, channel: 'youtube', channelLabel: 'YouTube', externalId: yt.channelId,
        name: (ytc && ytc.name) || yt.title || 'Kênh YouTube', enabled: !!(ch.youtube && ch.youtube.on),
        status: yt.needsReauth ? 'error' : ytc ? (ytc.ok ? (ytc.level === 'warn' ? 'limited' : 'connected') : 'error') : 'unchecked',
        statusText: yt.needsReauth ? 'Cần kết nối lại' : ytc ? (ytc.ok ? (ytc.level === 'warn' ? 'Kết nối một phần' : 'Đã kết nối (đã kiểm tra)') : 'Lỗi kết nối') : 'Đã đăng nhập — chưa kiểm tra',
        note: ytc && ytc.note ? ytc.note : ytLock,
        error: ytc && !ytc.ok ? ytc.error : '', lastCheckedAt: ytc ? ytc.at : null, lastUsedAt: lastPublish(`yt_${yt.channelId}`),
        actions: [...(youtube.configured() ? ['connect'] : []), 'disconnect', 'toggle'],
      }));
    } else {
      const ready = youtube.configured();
      rows.push(row({
        id: keyOf(b.id, 'youtube', 'none'), brand: b.id, brandName: b.name, channel: 'youtube', channelLabel: 'YouTube', externalId: '',
        name: (ch.youtube && ch.youtube.handle) || 'Chưa kết nối', enabled: !!(ch.youtube && ch.youtube.on), status: 'not_connected', statusText: 'Chưa kết nối',
        note: ready ? `Bấm "Kết nối YouTube" rồi đăng nhập đúng tài khoản Google sở hữu kênh của thương hiệu. ${ytLock}` : 'Chưa có khoá OAuth YouTube: nhập Client ID + Client secret ở Cài đặt → Kết nối API → YouTube (cần PUBLIC_BASE_URL https).',
        actions: ready ? ['connect', 'toggle'] : ['toggle'],
      }));
    }
    // 小红书 (đăng thủ công)
    rows.push(row({ id: keyOf(b.id, 'xiaohongshu', 'manual'), brand: b.id, brandName: b.name, channel: 'xiaohongshu', channelLabel: '小红书 Xiaohongshu', externalId: '', name: ch.xiaohongshu.handle || '—', enabled: !!ch.xiaohongshu.on, status: 'manual', statusText: 'Gói đăng thủ công', note: 'Không có API đăng bài: agent soạn tiếng Trung + kiểm tra tuân thủ, Sếp đăng trên trang creator rồi đánh dấu lại.', actions: ['toggle'] }));
    // Chưa hỗ trợ
    for (const [id, u] of Object.entries(UNSUPPORTED)) {
      rows.push(row({ id: keyOf(b.id, id, 'unsupported'), brand: b.id, brandName: b.name, channel: id, channelLabel: u.label, externalId: '', name: (ch[id] && ch[id].handle) || '—', enabled: false, status: 'unsupported', statusText: 'Chưa hỗ trợ', note: u.why }));
    }
  }
  for (const r of rows) r.level = LEVEL[{ connected: 'ok', limited: 'warn', error: 'error', unchecked: 'none', not_connected: 'none', manual: 'none', unsupported: 'none' }[r.status]];
  const lastCheck = Object.values(cc).map((c) => c.at).sort().pop() || null;
  const count = (s) => rows.filter((r) => r.status === s).length;
  return {
    mode: process.env.META_ACCESS_TOKEN ? 'live' : 'mock', tokenPresent: !!process.env.META_ACCESS_TOKEN, checking,
    lastCheckedAt: lastCheck, perms: perms ? { at: perms.at, error: perms.error, count: perms.granted ? perms.granted.length : null } : null,
    tiktokMode: tiktok.mode(), tiktokConfigured: tiktok.configured(), youtubeConfigured: youtube.configured(),
    summary: { connected: count('connected'), limited: count('limited'), error: count('error'), unchecked: count('unchecked'), manual: count('manual'), unsupported: count('unsupported'), notConnected: count('not_connected') },
    rows,
  };
}

// ---------- Thêm / gỡ Page ----------
async function addPage(brandId, pageId) {
  const brands = planner.brands();
  if (!brands[brandId]) throw bad('Thương hiệu không tồn tại', 404);
  pageId = String(pageId || '').trim();
  if (!/^\d{5,25}$/.test(pageId)) throw bad('Page ID chỉ gồm chữ số (5–25 ký tự)');
  for (const b of Object.values(brands)) {
    if (b.pageIds.includes(pageId)) throw bad(b.id === brandId ? 'Page này đã có trong thương hiệu' : `Page này đang thuộc thương hiệu ${b.name} — gỡ ở đó trước (tránh đăng trùng)`);
  }
  if (brands[brandId].pageIds.length >= 10) throw bad('Tối đa 10 Page cho mỗi thương hiệu');
  if (!process.env.META_ACCESS_TOKEN) throw bad('Chưa có META_ACCESS_TOKEN — chưa kiểm tra được Page');
  const now = Date.now();
  const res = await verifyPage(brandId, pageId, now); // đọc thật: Page phải đã gán cho người dùng hệ thống
  if (!res.ok) {
    delete checks()[keyOf(brandId, 'facebook_page', pageId)];
    throw bad(`Không thêm được Page ${pageId}: ${res.error}`);
  }
  planner.updateBrand(brandId, { pageIds: [...brands[brandId].pageIds, pageId] });
  engine.log('system', `Sếp thêm Page "${res.name}" (${pageId}) cho ${brands[brandId].name}`, { by: 'Sếp', brand: brandId, field: 'pageIds', before: brands[brandId].pageIds.length, after: brands[brandId].pageIds.length + 1 });
  save();
  return { name: res.name };
}
function removePage(brandId, pageId) {
  const brands = planner.brands();
  if (!brands[brandId]) throw bad('Thương hiệu không tồn tại', 404);
  pageId = String(pageId || '').trim();
  if (!brands[brandId].pageIds.includes(pageId)) throw bad('Page này không thuộc thương hiệu', 404);
  planner.updateBrand(brandId, { pageIds: brands[brandId].pageIds.filter((p) => p !== pageId) });
  delete checks()[keyOf(brandId, 'facebook_page', pageId)];
  engine.log('system', `Sếp gỡ Page ${pageId} khỏi ${brands[brandId].name} (bài đăng sau này sẽ không lên Page này)`, { by: 'Sếp', brand: brandId, field: 'pageIds', before: brands[brandId].pageIds.length, after: brands[brandId].pageIds.length - 1 });
  save();
}

async function handleApi(req, res, url, { readBody, send }) {
  const p = url.pathname;
  if (!p.startsWith('/api/channels')) return false;
  try {
    if (req.method === 'GET' && p === '/api/channels') return send(res, 200, list()), true;
    if (req.method === 'POST' && p === '/api/channels/check') { await verify({ brand: (await readBody(req)).brand }); return send(res, 200, list()), true; }
    if (req.method === 'POST' && p === '/api/channels/facebook/add') { const b = await readBody(req); const r = await addPage(b.brand, b.pageId); return send(res, 200, { ...list(), added: r }), true; }
    if (req.method === 'POST' && p === '/api/channels/facebook/remove') { const b = await readBody(req); removePage(b.brand, b.pageId); return send(res, 200, list()), true; }
  } catch (e) { send(res, e.status || 500, { error: e.message }); return true; }
  return false;
}

// Tên Page đã kiểm tra (để giao diện hiện tên thay vì mã): { pageId: tên }
function pageNames() {
  const out = {};
  for (const [k, c] of Object.entries(checks())) { const [, ch, id] = k.split(':'); if (ch === 'facebook_page' && c && c.name) out[id] = c.name; }
  return out;
}

// Tài khoản Instagram liên kết với từng Page đã kiểm tra: { pageId: { id, username } }
function igOfPages() {
  const out = {};
  for (const [k, c] of Object.entries(checks())) { const [, ch, id] = k.split(':'); if (ch === 'facebook_page' && c && c.instagram) out[id] = c.instagram; }
  return out;
}

module.exports = { list, verify, addPage, removePage, handleApi, pageNames, igOfPages };
