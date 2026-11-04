// Kiểm tra kết nối Meta — CHỈ ĐỌC (không đổi gì trên tài khoản). Không trả về token.
// Kiểm tra theo từng thương hiệu: các Page ID và tài khoản quảng cáo đã gán cho thương hiệu đó.
const meta = require('./meta');
const social = require('./connectors/social');
const planner = require('./planner');

const NEED_ADS = ['ads_read', 'ads_management'];
const NEED_PAGE = ['pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'pages_manage_engagement'];

async function step(name, fn) {
  try { const r = await fn(); return { name, ok: r.ok !== false, warn: !!r.warn, detail: r.detail }; }
  catch (e) { return { name, ok: false, detail: e.message }; }
}

async function runChecks() {
  const out = [];
  out.push({ name: 'Phiên bản API', ok: true, detail: meta.version() + ' (đổi bằng META_API_VERSION trong .env nếu Meta ngừng hỗ trợ)' });

  if (!process.env.META_ACCESS_TOKEN) {
    out.push({ name: 'Token', ok: false, detail: 'Chưa có META_ACCESS_TOKEN trong file .env' });
    return out;
  }

  out.push(await step('Token hợp lệ', async () => {
    const r = await meta.call('/me', { params: { fields: 'id,name' } });
    return { detail: `Đăng nhập là "${r.name || r.id}"` };
  }));

  const perms = await step('Quyền của token', async () => {
    const r = await meta.call('/me/permissions');
    const granted = (r.data || []).filter((p) => p.status === 'granted').map((p) => p.permission);
    const missing = [...NEED_ADS, ...NEED_PAGE].filter((p) => !granted.includes(p));
    return missing.length ? { warn: true, detail: `Thiếu: ${missing.join(', ')}` } : { detail: 'Đủ quyền quảng cáo và Page' };
  });
  out.push(perms.ok ? perms : { ...perms, ok: true, warn: true, detail: 'Không đọc được danh sách quyền (token hệ thống thường như vậy) — kiểm tra bằng các bước dưới.' });

  const brands = Object.values(planner.brands());
  const doneAccounts = new Set();
  const donePages = new Set();
  let anything = false;

  for (const b of brands) {
    // Tài khoản quảng cáo của thương hiệu
    if (b.adAccountId && !doneAccounts.has(b.adAccountId)) {
      doneAccounts.add(b.adAccountId);
      anything = true;
      out.push(await step(`${b.name} — tài khoản quảng cáo`, async () => {
        const r = await meta.call(`/${meta.adAccount(b.adAccountId)}`, { params: { fields: 'name,account_status,currency,timezone_name' } });
        const c = await meta.call(`/${meta.adAccount(b.adAccountId)}/campaigns`, { params: { fields: 'id', effective_status: ['ACTIVE', 'PAUSED'], limit: 100 } });
        const notes = [];
        if (r.currency !== 'VND') notes.push(`đơn vị tiền là ${r.currency}, các luật đang tính bằng VND — cần chỉnh lại số`);
        if (r.account_status !== 1) notes.push(`trạng thái tài khoản = ${r.account_status} (1 là bình thường)`);
        return { warn: notes.length > 0, detail: `"${r.name}" · ${r.currency} · ${r.timezone_name} · ${(c.data || []).length} chiến dịch${notes.length ? ' · ⚠ ' + notes.join('; ') : ''}` };
      }));
    }
    // Các Page của thương hiệu: tên Page + lấy được Page token + đọc được bài viết
    for (const pageId of b.pageIds) {
      if (donePages.has(pageId)) continue;
      donePages.add(pageId);
      anything = true;
      out.push(await step(`${b.name} — Page ${pageId}`, async () => {
        const r = await meta.call(`/${pageId}`, { params: { fields: 'name' } });
        const posts = await meta.call(`/${pageId}/posts`, { params: { fields: 'id', limit: 1 }, token: await social.pageToken(pageId) });
        return { detail: `"${r.name}" · lấy được Page token · đọc được bài viết (${(posts.data || []).length ? 'có bài' : 'chưa có bài'})` };
      }));
      // Quyền của người dùng hệ thống trên Page: đăng bài cần Tạo nội dung, trả lời bình luận cần Kiểm duyệt,
      // chạy quảng cáo từ bài của Page (quảng cáo thử / video đang lên view) cần Tạo quảng cáo
      out.push(await step(`${b.name} — quyền trên Page ${pageId}`, async () => {
        let tasks;
        try { tasks = await social.pageTasks(pageId); }
        catch (e) { return { warn: true, detail: `Không đọc được danh sách Page của người dùng hệ thống (${e.message}) — chưa biết Page này được cấp quyền gì` }; }
        const need = ['CREATE_CONTENT', 'MODERATE', ...(require('./db').load().settings.adTest.on ? ['ADVERTISE'] : [])];
        const problem = social.pageTaskProblem(tasks, need);
        const have = (tasks || []).map((t) => social.TASK_LABEL[t] || t).join(', ') || 'không có';
        return problem ? { warn: true, detail: `Theo token hiện tại đang có: ${have} · ⚠ ${problem}. Nếu đã bật quyền trong Cài đặt doanh nghiệp mà vẫn thấy thiếu: tạo token mới cho người dùng hệ thống rồi cập nhật bằng set-token.ps1.` } : { detail: `Đang có: ${have}` };
      }));
      // Instagram liên kết với Page (cần để đăng Instagram qua API: phải là tài khoản Business/Creator)
      out.push(await step(`${b.name} — Instagram của Page ${pageId}`, async () => {
        const r = await meta.call(`/${pageId}`, { params: { fields: 'instagram_business_account{id,username}' }, token: await social.pageToken(pageId) });
        const ig = r.instagram_business_account;
        if (!ig) return { warn: true, detail: 'Page này chưa liên kết tài khoản Instagram Business/Creator' };
        return { detail: `@${ig.username} (ID ${ig.id}) đã liên kết với Page` };
      }));
    }
    if (!b.pageIds.length && !b.adAccountId) {
      out.push({ name: b.name, ok: true, warn: true, detail: 'Chưa gán Page hay tài khoản quảng cáo nào (nhập ở Thương hiệu & Kênh)' });
    }
  }
  if (!anything) out.push({ name: 'Page / tài khoản quảng cáo', ok: false, detail: 'Chưa thương hiệu nào có Page ID hay ID tài khoản quảng cáo — nhập ở trang Thương hiệu & Kênh' });
  return out;
}

module.exports = { runChecks };
