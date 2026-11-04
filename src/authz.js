// Phân quyền ở MÁY CHỦ (giao diện chỉ gợi ý, không phải lớp bảo vệ): mỗi yêu cầu ghi (POST/PUT/DELETE) được phân loại thành
// 1 quyền cần có + (nếu xác định được) thương hiệu bị tác động. Đọc (GET) cho mọi người đã đăng nhập, trừ vài mục nhạy cảm.
// MẶC ĐỊNH TỪ CHỐI: yêu cầu ghi nào chưa được liệt kê thì chỉ vai trò chủ làm được.
// Giới hạn đã biết: số liệu đọc (GET /api/state...) vẫn chứa cả 3 thương hiệu — tài khoản "giới hạn thương hiệu" chỉ bị chặn GHI ngoài phạm vi.
const { load } = require('./db');
const { approvalBrand } = require('./approval-brand');

const PERMS = {
  view: 'Xem dữ liệu',
  approve: 'Duyệt / từ chối (bài đăng, ngân sách, bình luận, kế hoạch)',
  content_write: 'Soạn và sửa nội dung (bài đăng, lịch, kế hoạch tháng, media)',
  knowledge_write: 'Quản lý bài học của AI',
  ads_write: 'Thao tác quảng cáo (bật/tắt chiến dịch, đổi ngân sách, quảng cáo thử)',
  brand_write: 'Sửa hồ sơ thương hiệu, thêm/gỡ Page, kênh',
  agents_run: 'Chạy agent, quét, báo cáo, kiểm tra kết nối',
  emergency: 'Dừng khẩn cấp / bật lại agent',
  settings_write: 'Đổi cài đặt hệ thống (chạy thử/chạy thật, luật tự động, AI, cảnh báo)',
  users_admin: 'Quản lý tài khoản và phân quyền',
  data_admin: 'Sao lưu, khôi phục, xuất dữ liệu',
};
const ROLES = {
  owner: { label: 'Chủ', desc: 'Toàn quyền, kể cả tài khoản, cài đặt và khôi phục dữ liệu.', perms: Object.keys(PERMS) },
  manager: { label: 'Quản lý', desc: 'Vận hành hằng ngày: duyệt, quảng cáo, nội dung, thương hiệu, chạy agent, dừng khẩn cấp. Không đổi cài đặt hệ thống hay tài khoản.', perms: ['view', 'approve', 'content_write', 'knowledge_write', 'ads_write', 'brand_write', 'agents_run', 'emergency'] },
  editor: { label: 'Biên tập nội dung', desc: 'Soạn bài, lịch đăng, kế hoạch, media, bài học. Không duyệt, không đụng tới quảng cáo hay cài đặt.', perms: ['view', 'content_write', 'knowledge_write'] },
  viewer: { label: 'Chỉ xem', desc: 'Chỉ xem, không sửa gì.', perms: ['view'] },
};

const can = (user, perm) => !!user && (ROLES[user.role] || { perms: [] }).perms.includes(perm);
const inScope = (user, brand) => !user.brands || !user.brands.length || (!!brand && user.brands.includes(brand));
const isScoped = (user) => !!(user && user.brands && user.brands.length);

// ----- Tra thương hiệu từ đối tượng bị tác động -----
const db = () => load();
const brandOfPost = (id) => (db().posts.find((p) => p.id === id) || {}).brand || null;
const brandOfPlan = (id) => (db().plans.find((p) => p.id === id) || {}).brand || null;
const brandOfCampaign = (id) => { const c = db().campaigns.find((x) => x.id === id); return c ? require('./engine').brandOf(c) : null; };
const brandOfApproval = (id) => { const a = db().approvals.find((x) => x.id === id); return a ? approvalBrand(db(), a) : null; };
const brandOfLesson = (id) => { const l = db().lessons.find((x) => x.id === id); return l ? l.scope : null; };

// Trả về { perm, brands?: [..] | null, global?: true } cho 1 yêu cầu ghi. brands = danh sách thương hiệu bị tác động (rỗng/null = không xác định).
// global: tác động toàn hệ thống (người bị giới hạn thương hiệu không làm được).
function classify(method, p, body, query) {
  const b = body || {};
  const q = query || new URLSearchParams();
  let m;
  const one = (perm, brand) => ({ perm, brands: brand ? [brand] : null });
  if (p === '/api/scan') return { perm: 'agents_run', global: true };
  if ((m = p.match(/^\/api\/agents\/[^/]+\/(run|toggle)$/))) return { perm: 'agents_run', global: true };
  if (/^\/api\/agent-center\/[^/]+\/simulate$/.test(p) || /^\/api\/automations\/[^/]+\/simulate$/.test(p)) return { perm: 'agents_run', global: true };
  if (/^\/api\/automations\/[^/]+$/.test(p) && method === 'PUT') return { perm: 'settings_write', global: true };
  if (p === '/api/reports' || /^\/api\/reports\/[^/]+\/ai$/.test(p)) return { perm: 'agents_run', global: true };
  if (p === '/api/analyze' || p === '/api/meta/check' || p === '/api/channels/check' || p === '/api/ads/sync') return { perm: 'agents_run', global: true };
  if (p === '/api/xhs/lint' || p === '/api/replies/draft') return { perm: 'content_write', global: false, brands: null };
  // Trợ lý cho Sếp: hỏi số liệu ai đã đăng nhập cũng được; từng LỆNH (quét, tắt chiến dịch, dừng khẩn cấp) tự kiểm tra quyền bên trong
  if (p === '/api/assistant/boss' || p === '/api/assistant/test') return { perm: 'view', global: false, brands: null };
  // duyệt
  if ((m = p.match(/^\/api\/approvals\/([^/]+)\/(approve|reject)$/))) return one('approve', brandOfApproval(m[1]));
  if (p === '/api/approvals/bulk') return { perm: 'approve', brands: (Array.isArray(b.ids) ? b.ids : []).map((id) => brandOfApproval(String(id))) , multi: true };
  if ((m = p.match(/^\/api\/plans\/([^/]+)\/approve$/))) return one('approve', brandOfPlan(m[1]));
  // nội dung
  if (p === '/api/posts') return one('content_write', b.brand);
  // lên bài kèm kế hoạch chạy quảng cáo: cần quyền nội dung + quảng cáo (+ duyệt nếu duyệt luôn)
  if (p === '/api/posts/with-ads') return { ...one('content_write', b.brand), also: [...(b.runAds !== false ? ['ads_write'] : []), ...(b.approveNow === true ? ['approve'] : [])] };
  if ((m = p.match(/^\/api\/posts\/([^/]+)(\/reschedule|\/manual|\/qc|\/rewrite)?$/))) return one('content_write', brandOfPost(m[1]));
  if (p === '/api/plans') return one('content_write', b.brand);
  if ((m = p.match(/^\/api\/plans\/([^/]+)\/items\/[^/]+(\/rewrite|\/qc)?$/))) return one('content_write', brandOfPlan(m[1]));
  if ((m = p.match(/^\/api\/brands\/([^/]+)\/facts\/[^/]+$/))) return one('brand_write', m[1]);
  if ((m = p.match(/^\/api\/month-plan\/[^/]+\/([^/]+)(\/copy|\/tasks\/[^/]+)?$/))) return one('content_write', m[1]);
  if (p === '/api/media/upload') return one('content_write', q.get('brand'));
  if (p.startsWith('/api/media/')) return one('content_write', b.brand);
  if (p === '/api/media-lib/folders' || p === '/api/media-lib/organize' || p === '/api/media-lib/trash' || p === '/api/media-lib/restore' || p === '/api/media-lib/transcode') return one('content_write', b.brand);
  // Google Drive: đặt thư mục / nạp ngay theo thương hiệu; kiểm tra kết nối (không ghi gì) cần agents_run; tải/gỡ khoá service account = cài đặt hệ thống
  if (p === '/api/drive/settings' || p === '/api/drive/sync') return one('content_write', b.brand);
  if (p === '/api/drive/test') return b.brand ? one('agents_run', b.brand) : { perm: 'agents_run', global: true };
  if (p === '/api/drive/key') return { perm: 'settings_write', global: true };
  if (p === '/api/media-lib/purge') return { perm: 'data_admin', global: true }; // xoá hẳn khỏi máy chủ: chỉ người quản trị dữ liệu
  if (p === '/api/autopilot' || p === '/api/autopilot/profiles' || /^\/api\/autopilot\/profiles\/[^/]+$/.test(p)) {
    return p === '/api/autopilot/profiles' ? one('content_write', b.brand) : { perm: 'settings_write', global: true };
  }
  // bài học
  if (p === '/api/lessons' && method === 'POST') return one('knowledge_write', b.scope && b.scope !== 'all' ? b.scope : null);
  if (p === '/api/lessons/suggest') return { perm: 'knowledge_write', global: true };
  if ((m = p.match(/^\/api\/lessons\/([^/]+)$/))) return one('knowledge_write', brandOfLesson(m[1]) === 'all' ? null : brandOfLesson(m[1]));
  if (p === '/api/knowledge/bulk') return { perm: 'knowledge_write', global: true };
  // thương hiệu / kênh
  if (p === '/api/brands') return one('brand_write', b.id);
  if (p === '/api/channels/facebook/add' || p === '/api/channels/facebook/remove') return one('brand_write', b.brand);
  if (p === '/api/tiktok/disconnect') return one('brand_write', b.brand);
  // YouTube: kết nối (start/callback, xem youtube-routes) và ngắt kênh như TikTok; khoá OAuth client = cài đặt hệ thống
  if (p === '/api/youtube/connect' || p === '/api/youtube/disconnect') return one('brand_write', b.brand);
  if (p === '/api/youtube/keys') return { perm: 'settings_write', global: true };
  // quảng cáo
  if ((m = p.match(/^\/api\/ads\/campaigns\/([^/]+)\/(status|budget)$/))) return one('ads_write', brandOfCampaign(m[1]));
  // tạo + (tuỳ chọn) duyệt luôn quảng cáo thử cho 1 bài: cần cả quyền quảng cáo lẫn duyệt
  if (p === '/api/adtests/manual') return { ...one(b.approveNow === true ? 'approve' : 'ads_write', brandOfPost(String(b.postId || ''))), ...(b.approveNow === true ? { also: 'ads_write' } : {}) };
  // cài đặt
  if (p === '/api/settings') {
    const keys = Object.keys(b);
    if (keys.length && keys.every((k) => k === 'paused')) return { perm: 'emergency', global: true };
    if (keys.length && keys.every((k) => k === 'adTest')) return { perm: 'ads_write', global: true };
    return { perm: 'settings_write', global: true };
  }
  if (p === '/api/prefs' || p === '/api/reset-demo') return { perm: 'settings_write', global: true };
  // tài khoản, dữ liệu
  if (p.startsWith('/api/users') || p === '/api/security') return { perm: 'users_admin', global: true };
  if (p.startsWith('/api/backups')) return { perm: 'data_admin', global: true };
  if (p === '/api/me/password') return { perm: 'view', brands: null, self: true };
  return { perm: 'owner_only', global: true }; // chưa liệt kê = chỉ chủ
}

// Đọc nhạy cảm: chỉ vai trò có quyền tương ứng
function readPerm(p) {
  if (p === '/api/export' || p.startsWith('/api/backups')) return 'data_admin';
  if (p.startsWith('/api/users')) return 'users_admin';
  return 'view';
}

// Trả về null nếu được phép, hoặc { status: 403, error }
function check(user, method, p, body, query) {
  if (!user) return { status: 401, error: 'Cần đăng nhập' };
  const writes = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method);
  const perm = writes ? null : readPerm(p);
  if (!writes) return can(user, perm) ? null : { status: 403, error: `Bạn không có quyền xem mục này (cần quyền: ${PERMS[perm]})` };
  const c = classify(method, p, body, query);
  if (c.perm === 'owner_only') return user.role === 'owner' ? null : { status: 403, error: 'Thao tác này chỉ dành cho chủ hệ thống' };
  for (const perm of [c.perm, ...[].concat(c.also || [])]) {
    if (!can(user, perm)) return { status: 403, error: `Bạn không có quyền thực hiện thao tác này (vai trò ${(ROLES[user.role] || {}).label || user.role}; cần quyền: ${PERMS[perm]})` };
  }
  if (isScoped(user)) {
    if (c.global) return { status: 403, error: 'Thao tác này ảnh hưởng toàn hệ thống — tài khoản giới hạn theo thương hiệu không được làm' };
    const list = c.multi ? c.brands : (c.brands || [null]);
    if (!list.length) return { status: 403, error: 'Không xác định được thương hiệu của thao tác này' };
    const out = list.find((br) => !inScope(user, br));
    if (out !== undefined) return { status: 403, error: out ? `Bạn chỉ được thao tác với thương hiệu được giao (không có quyền với "${out}")` : 'Không xác định được thương hiệu của thao tác này — tài khoản giới hạn thương hiệu không được làm' };
  }
  return null;
}

module.exports = { PERMS, ROLES, can, check, classify, isScoped, inScope };
