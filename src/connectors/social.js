// Kênh mạng xã hội: đăng bài + bình luận.
// Facebook Page chạy thật qua Graph API khi có META_ACCESS_TOKEN VÀ thương hiệu có Page ID;
// các kênh còn lại ở chế độ mẫu (ghi nhật ký, chưa gọi API) cho đến khi nối tài khoản.
// Mỗi Page có Page access token riêng, đổi từ token chính (cần quyền pages_show_list).
const fs = require('node:fs');
const path = require('node:path');
const meta = require('../meta');
const tiktok = require('./tiktok');
const instagram = require('./instagram');
const youtube = require('./youtube');

// live() = đã có token Meta. Việc Page nào do thương hiệu quyết định (pageId truyền vào từng hàm).
// manual: true = kênh không có API đăng bài. Agent soạn + kiểm tra tuân thủ + tạo "gói đăng" (xem src/xhs.js);
// người (hoặc trợ lý trình duyệt) đăng trên trang creator rồi đánh dấu lại trạng thái.
const CHANNELS = {
  facebook_page: { label: 'Facebook Page', live: () => !!process.env.META_ACCESS_TOKEN },
  // Instagram: đăng qua tài khoản Business liên kết với Page; cần token Meta + PUBLIC_BASE_URL (Meta kéo ảnh/video từ link công khai)
  instagram:     { label: 'Instagram',     live: () => !!process.env.META_ACCESS_TOKEN && !!instagram.baseUrl() },
  // TikTok: mặc định "gói đăng thủ công" (manual); chuyển sang 'api' ở Cài đặt khi ứng dụng TikTok đã được duyệt
  tiktok:        { label: 'TikTok', get manual() { return tiktok.mode() !== 'api'; }, live: () => tiktok.mode() === 'api' && tiktok.configured() },
  // YouTube: tải video Shorts lên kênh của thương hiệu khi đã có khoá OAuth client + PUBLIC_BASE_URL (live(brand): thêm điều kiện thương hiệu đã nối kênh)
  youtube:       { label: 'YouTube', live: (brand) => youtube.configured() && (!brand || youtube.connected(brand)) },
  xiaohongshu:   { label: '小红书 Xiaohongshu', live: () => false, manual: true },
  google_ads:    { label: 'Google Ads',    live: () => false },
  zalo_oa:       { label: 'Zalo OA',       live: () => false },
};

const isLive = (channel, pageId) => channel === 'facebook_page' && CHANNELS.facebook_page.live() && !!pageId;

const pageTokens = new Map(); // pageId → Page access token
async function pageToken(pageId) {
  if (!pageId) throw new Error('Thiếu Page ID');
  if (pageTokens.has(pageId)) return pageTokens.get(pageId);
  const r = await meta.call(`/${pageId}`, { params: { fields: 'access_token' } });
  if (!r.access_token) throw new Error('Không lấy được Page access token — tài khoản của token cần là quản trị Page (hoặc Page đã được gán cho người dùng hệ thống) và token có quyền pages_show_list.');
  pageTokens.set(pageId, r.access_token);
  return r.access_token;
}
const resetPageToken = () => { pageTokens.clear(); pageTaskCache = null; instagram.resetCache(); };

// Tài khoản Instagram Business/Creator liên kết với Page (null = chưa liên kết)
async function igAccount(pageId) {
  return instagram.accountOf(pageId, await pageToken(pageId));
}

// Quyền (task) mà người dùng hệ thống được cấp trên từng Page — Meta gọi là tasks:
// CREATE_CONTENT (đăng bài), MODERATE (bình luận), ADVERTISE (tạo quảng cáo từ bài của Page), ANALYZE, MANAGE.
// Đọc 1 lần từ /me/accounts rồi giữ 10 phút. Trả về null khi không biết (chưa nối Meta, Page không thuộc người dùng này).
const TASK_LABEL = { CREATE_CONTENT: 'Tạo nội dung', MODERATE: 'Kiểm duyệt', ADVERTISE: 'Tạo quảng cáo', ANALYZE: 'Xem thông tin chi tiết', MANAGE: 'Quản lý', MESSAGING: 'Nhắn tin' };
let pageTaskCache = null; // { at, map: pageId → [task] }
async function pageTasks(pageId) {
  if (!isLive('facebook_page', pageId)) return null;
  if (!pageTaskCache || Date.now() - pageTaskCache.at > 10 * 60e3) {
    const rows = await meta.all('/me/accounts', { params: { fields: 'id,tasks', limit: 100 } });
    pageTaskCache = { at: Date.now(), map: Object.fromEntries(rows.map((p) => [String(p.id), p.tasks || []])) };
  }
  return pageTaskCache.map[String(pageId)] || null;
}
// Câu báo thiếu quyền trên Page (rỗng = đủ). Dùng chung cho đề xuất, duyệt và trang Kênh.
function pageTaskProblem(tasks, need = ['ADVERTISE']) {
  if (!tasks) return `Page chưa được gán cho người dùng hệ thống (Cài đặt doanh nghiệp → Tài khoản → Trang → Thêm → chọn người dùng hệ thống của app)`;
  const missing = need.filter((t) => !tasks.includes(t));
  if (!missing.length) return '';
  return `Page chưa cấp quyền "${missing.map((t) => TASK_LABEL[t] || t).join('", "')}" cho người dùng hệ thống của app (Cài đặt doanh nghiệp → Tài khoản → Trang → chọn Page → người dùng hệ thống → bật quyền đó)`;
}

// files: [{ path, type: 'image'|'video' }] (đường dẫn tuyệt đối). Không có file = bài chỉ có chữ.
//  - 1 ảnh: đăng ảnh kèm chú thích; nhiều ảnh: tải lên chưa công khai rồi gộp vào 1 bài
//  - 1 video: tải video lên Page (máy chủ video của Meta)
// ctx.pageId: Page của thương hiệu.
async function publish(channel, message, files = [], ctx = {}) {
  if (isLive(channel, ctx.pageId)) {
    const page = ctx.pageId;
    const token = await pageToken(page);
    const blobOf = async (f) => ({ blob: await fs.openAsBlob(f.path), filename: path.basename(f.path) });

    if (!files.length) {
      const j = await meta.call(`/${page}/feed`, { method: 'POST', params: { message }, token });
      return { live: true, externalId: j.id };
    }
    if (files[0].type === 'video') {
      const j = await meta.call(`/${page}/videos`, { token, host: 'graph-video.facebook.com', params: { description: message }, files: { source: await blobOf(files[0]) } });
      return { live: true, externalId: j.id };
    }
    if (files.length === 1) {
      const j = await meta.call(`/${page}/photos`, { token, params: { caption: message, published: true }, files: { source: await blobOf(files[0]) } });
      return { live: true, externalId: j.post_id || j.id };
    }
    const attached = {};
    for (const [i, f] of files.entries()) {
      const up = await meta.call(`/${page}/photos`, { token, params: { published: false }, files: { source: await blobOf(f) } });
      attached[`attached_media[${i}]`] = { media_fbid: up.id };
    }
    const j = await meta.call(`/${page}/feed`, { method: 'POST', token, params: { message, ...attached } });
    return { live: true, externalId: j.id };
  }
  // Instagram: ctx.igId = tài khoản IG của Page, ctx.pending = container video đã tạo ở lần quét trước
  if (channel === 'instagram' && CHANNELS.instagram.live() && ctx.pageId && ctx.igId) {
    const problem = instagram.problemOf(message, files);
    if (problem) throw new Error(problem);
    // Ảnh PNG/WebP hoặc khung ngoài 4:5–1.91:1 → bản JPG chất lượng cao (file gốc giữ nguyên)
    const items = [];
    for (const f of files) {
      const conv = f.type === 'image' ? await require('../igimage').prepare(ctx.brand, f.path) : null;
      items.push({ type: f.type, name: f.name, url: conv ? instagram.signedUrl(ctx.brand, conv.name, Date.now(), true) : instagram.signedUrl(ctx.brand, f.name) });
    }
    const r = await instagram.publish(ctx.igId, await pageToken(ctx.pageId), message, items, { pending: ctx.pending });
    if (r.pending) return { live: true, pending: r.pending };
    return { live: true, externalId: r.externalId, note: r.permalink || '' };
  }
  // TikTok: chỉ video; chế độ hiển thị lấy từ cài đặt (mặc định riêng tư cho tới khi ứng dụng qua audit)
  if (channel === 'tiktok' && CHANNELS.tiktok.live() && ctx.brand && tiktok.connected(ctx.brand)) {
    const file = files[0];
    if (!file || file.type !== 'video') throw new Error('Bài TikTok cần đúng 1 video');
    const s = require('../db').load().settings;
    const r = await tiktok.publishVideo(ctx.brand, file.path, message, { openId: ctx.openId, privacy: s.tiktokPrivacy, aigc: !!s.tiktokAigc });
    return { live: true, externalId: r.publishId, note: `${r.status === 'PUBLISH_COMPLETE' ? 'đã đăng' : 'đang được TikTok xử lý'}, chế độ ${r.privacy}` };
  }
  // YouTube: đúng 1 video; tiêu đề lấy dòng đầu chú thích, mô tả = cả chú thích; chế độ hiển thị theo cài đặt (mặc định công khai)
  if (channel === 'youtube' && ctx.brand && CHANNELS.youtube.live(ctx.brand)) {
    if (files.length !== 1 || files[0].type !== 'video') throw new Error('Bài YouTube cần đúng 1 video');
    const s = require('../db').load().settings;
    const r = await youtube.publishVideo(ctx.brand, files[0].path, { title: message, description: message, privacy: s.youtubePrivacy || 'public', publishAt: ctx.publishAt, madeForKids: false });
    return { live: true, externalId: r.videoId, note: `${r.url}, chế độ ${r.privacy}` };
  }
  return { live: false, externalId: null };
}

async function reply(channel, commentId, message, ctx = {}) {
  if (isLive(channel, ctx.pageId) && !commentId.startsWith('demo_')) {
    await meta.call(`/${commentId}/comments`, { method: 'POST', params: { message }, token: await pageToken(ctx.pageId) });
    return { live: true };
  }
  return { live: false };
}

// Bình luận mới trên các bài gần đây của 1 Page (bỏ bình luận do chính Page viết, bình luận quá 7 ngày)
async function fetchComments(pageId) {
  if (!isLive('facebook_page', pageId)) return [];
  const posts = await meta.call(`/${pageId}/posts`, {
    token: await pageToken(pageId),
    params: { fields: 'id,comments.limit(25){id,message,from,created_time}', limit: 10 },
  });
  const cutoff = Date.now() - 7 * 864e5;
  const out = [];
  for (const p of posts.data || []) {
    for (const c of (p.comments && p.comments.data) || []) {
      if (!c.message || (c.from && c.from.id === pageId)) continue;
      if (new Date(c.created_time).getTime() < cutoff) continue;
      out.push({ id: c.id, channel: 'facebook_page', author: (c.from && c.from.name) || 'Khách', text: c.message.slice(0, 500), postId: p.id, pageId });
    }
  }
  return out;
}

// Video/Reel của Page kèm lượt xem tự nhiên (không cần quyền insights) và mã bài viết pageId_postId để chạy quảng cáo
async function organicVideos(pageId, days = 14) {
  if (!isLive('facebook_page', pageId)) return [];
  const token = await pageToken(pageId);
  const since = Date.now() - days * 864e5;
  const vids = await meta.call(`/${pageId}/videos`, { token, params: { fields: 'id,created_time,length,views,description', limit: 30 } });
  const posts = await meta.call(`/${pageId}/posts`, { token, params: { fields: 'id,attachments{media_type,target{id}}', limit: 50 } });
  const postOf = {};
  for (const p of posts.data || []) for (const a of ((p.attachments || {}).data || [])) if (a.target && a.target.id) postOf[a.target.id] = p.id;
  return (vids.data || []).filter((v) => new Date(v.created_time).getTime() >= since && postOf[v.id])
    .map((v) => ({ videoId: v.id, postId: postOf[v.id], pageId, views: Number(v.views || 0), length: Number(v.length || 0), createdAt: v.created_time, text: String(v.description || '') }));
}

// Video đăng qua app (/{page}/videos) chỉ trả mã VIDEO; quảng cáo cần mã BÀI VIẾT pageId_postId → tra trong các bài gần đây của Page.
// Facebook vừa nhận video có thể chưa tạo xong bài: trả null để thử lại sau.
async function videoPostId(pageId, videoId) {
  if (String(videoId).includes('_')) return String(videoId);
  if (!isLive('facebook_page', pageId)) return null;
  const posts = await meta.call(`/${pageId}/posts`, { token: await pageToken(pageId), params: { fields: 'id,attachments{target{id}}', limit: 50 } });
  for (const p of posts.data || []) for (const a of ((p.attachments || {}).data || [])) if (a.target && String(a.target.id) === String(videoId)) return p.id;
  return null;
}

// Hộp thư Messenger của Page: các cuộc trò chuyện có tin mới từ mốc `sinceMs`, mỗi cuộc kèm ~12 tin gần nhất (cũ → mới).
// Cần quyền pages_messaging trên token (xem HUONG-DAN-META.md). from = ID người gửi; bằng pageId nghĩa là salon đã trả lời.
async function fetchConversations(pageId, sinceMs = 0) {
  if (!isLive('facebook_page', pageId)) return [];
  const token = await pageToken(pageId);
  const r = await meta.call(`/${pageId}/conversations`, { token, params: { platform: 'messenger', fields: 'id,updated_time,participants,messages.limit(12){id,from,message,created_time,attachments{mime_type}}', limit: 50 } });
  return (r.data || []).filter((c) => new Date(c.updated_time).getTime() >= sinceMs).map((c) => ({
    id: c.id, updatedAt: c.updated_time,
    participants: ((c.participants || {}).data || []).map((p) => ({ id: p.id, name: p.name })),
    messages: (((c.messages || {}).data) || []).map((m) => ({ id: m.id, from: m.from && m.from.id, name: m.from && m.from.name, text: String(m.message || ''), at: m.created_time, media: (((m.attachments || {}).data) || []).length })).reverse(),
  }));
}
// Gửi tin nhắn trả lời khách (trong 24 giờ kể từ tin khách gửi — luật Messenger). psid = ID người nhận trong cuộc trò chuyện.
async function sendMessage(pageId, psid, text) {
  if (!isLive('facebook_page', pageId)) return { live: false };
  const r = await meta.call(`/${pageId}/messages`, { method: 'POST', token: await pageToken(pageId), params: { recipient: { id: psid }, messaging_type: 'RESPONSE', message: { text: String(text).slice(0, 2000) } } });
  return { live: true, messageId: r.message_id || null };
}

module.exports = { igAccount, organicVideos, videoPostId, CHANNELS, isLive, publish, reply, fetchComments, fetchConversations, sendMessage, pageToken, resetPageToken, pageTasks, pageTaskProblem, TASK_LABEL };
