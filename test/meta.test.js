const test = require('node:test');
process.env.META_RETRY_MS = '0,0'; // không chờ khi thử lại trong kiểm thử
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
process.env.DB_FILE = path.join(os.tmpdir(), `agent-meta-test-${process.pid}.json`);
require('node:fs').rmSync(process.env.DB_FILE, { force: true });
process.env.META_ACCESS_TOKEN = 'TOKEN_SECRET_123';
delete process.env.META_API_VERSION;

const calls = [];
let routes = [];
const realFetch = global.fetch;
global.fetch = async (url, init = {}) => {
  const u = new URL(String(url));
  const body = init.body ? Object.fromEntries(new URLSearchParams(init.body)) : null;
  const rec = { method: init.method || 'GET', path: u.pathname, q: Object.fromEntries(u.searchParams), body };
  calls.push(rec);
  for (const r of routes) {
    if (r.test(rec)) {
      const out = typeof r.reply === 'function' ? r.reply(rec) : r.reply;
      return { status: 200, json: async () => out };
    }
  }
  return { status: 404, json: async () => ({ error: { code: 803, message: `chưa giả lập ${rec.method} ${rec.path}` } }) };
};
test.after(() => { global.fetch = realFetch; });
const reset = (r) => { calls.length = 0; routes = r; };
const at = (p, m = 'GET') => (rec) => rec.path.endsWith(p) && rec.method === m;

const ads = require('../src/connectors/ads-meta');
const social = require('../src/connectors/social');
const meta = require('../src/meta');
const { runChecks } = require('../src/meta-check');
const { load } = require('../src/db');
const engine = require('../src/engine');

test('dùng phiên bản API mới (v26.0), đổi được bằng biến môi trường', () => {
  assert.strictEqual(meta.version(), 'v26.0');
  process.env.META_API_VERSION = 'v27.0';
  assert.strictEqual(meta.version(), 'v27.0');
  delete process.env.META_API_VERSION;
});

test('đọc chiến dịch: chỉ 5 lượt gọi cho cả tài khoản (chiến dịch + nhóm quảng cáo + 3 khoảng số liệu), gộp tin nhắn đúng', async () => {
  const insightRow = (id, spend, n) => ({ campaign_id: id, spend: String(spend), actions: [{ action_type: 'link_click', value: '99' }, { action_type: 'onsite_conversion.messaging_conversation_started_7d', value: String(n) }] });
  reset([
    { test: at('/act_99999/campaigns'), reply: { data: [{ id: 'c1', name: 'Nhuộm', effective_status: 'ACTIVE', daily_budget: '500000' }, { id: 'c2', name: 'Uốn', effective_status: 'PAUSED' }] } },
    { test: at('/act_99999/adsets'), reply: { data: [{ campaign_id: 'c2', daily_budget: '300000', effective_status: 'ACTIVE' }, { campaign_id: 'c2', daily_budget: '200000', effective_status: 'ACTIVE' }] } },
    { test: (r) => r.path.endsWith('/act_99999/insights') && r.q.date_preset === 'today', reply: { data: [insightRow('c1', '400000.00', 5)] } },
    { test: (r) => r.path.endsWith('/act_99999/insights') && r.q.date_preset === 'last_7d', reply: { data: [insightRow('c1', '1000000', 40), insightRow('c1', '200000', 10)] } },
    { test: (r) => r.path.endsWith('/act_99999/insights') && r.q.date_preset === 'this_month', reply: { data: [] } },
  ]);
  const list = await ads.list('99999');
  assert.strictEqual(calls.length, 5);
  assert.ok(calls.every((c) => c.q.access_token === 'TOKEN_SECRET_123'));
  const [c1, c2] = list;
  assert.deepStrictEqual({ id: c1.id, status: c1.status, budget: c1.budget }, { id: 'c1', status: 'ACTIVE', budget: 500000 });
  assert.deepStrictEqual(c1.today, { spend: 400000, msgs: 5 });
  assert.deepStrictEqual(c1.d7, { spend: 1200000, msgs: 50 });
  assert.deepStrictEqual(c1.month, { spend: 0, msgs: 0 });
  assert.strictEqual(c2.status, 'PAUSED');
  assert.strictEqual(c2.budget, 0);
  assert.deepStrictEqual({ level: c1.budgetLevel, total: c1.budgetTotal }, { level: 'campaign', total: 500000 });
  assert.deepStrictEqual({ level: c2.budgetLevel, total: c2.budgetTotal }, { level: 'adset', total: 500000 }); // cộng các nhóm đang chạy
  assert.deepStrictEqual(c2.today, { spend: 0, msgs: 0 });
});

test('phân trang theo cursor', async () => {
  let n = 0;
  reset([{ test: at('/act_99999/campaigns'), reply: (rec) => {
    n++;
    return rec.q.after
      ? { data: [{ id: 'b', name: 'B', effective_status: 'ACTIVE' }] }
      : { data: [{ id: 'a', name: 'A', effective_status: 'ACTIVE' }], paging: { cursors: { after: 'CUR' }, next: 'https://x' } };
  } }, { test: (r) => r.path.endsWith('/insights'), reply: { data: [] } }]);
  const list = await ads.list('99999');
  assert.deepStrictEqual(list.map((c) => c.id), ['a', 'b']);
  assert.strictEqual(n, 2);
});

test('tắt chiến dịch và đổi ngân sách gửi đúng tham số', async () => {
  reset([{ test: (r) => r.method === 'POST', reply: { success: true } }]);
  await ads.pause('c1');
  await ads.setBudget('c1', 360000.4);
  assert.strictEqual(calls[0].path.endsWith('/c1'), true);
  assert.strictEqual(calls[0].body.status, 'PAUSED');
  assert.strictEqual(calls[1].body.daily_budget, '360000');
});

test('lỗi Meta thành câu tiếng Việt, không lộ token', async () => {
  reset([{ test: () => true, reply: { error: { code: 190, message: 'Error validating access token: TOKEN_SECRET_123 expired' } } }]);
  await assert.rejects(ads.list('99999'), (e) => /hết hạn/.test(e.message) && !e.message.includes('TOKEN_SECRET_123'));
  reset([{ test: () => true, reply: { error: { code: 17, message: 'rate' } } }]);
  await assert.rejects(ads.list('99999'), /giới hạn/);
});

test('đăng bài dùng Page token (đổi từ token chính), có lưu tạm', async () => {
  social.resetPageToken();
  reset([
    { test: (r) => r.path.endsWith('/11111111') && r.method === 'GET', reply: { access_token: 'PAGE_TOKEN_ABC' } },
    { test: at('/11111111/feed', 'POST'), reply: { id: '11111111_777' } },
  ]);
  const r1 = await social.publish('facebook_page', 'Xin chào', [], { pageId: '11111111' });
  const r2 = await social.publish('facebook_page', 'Bài 2', [], { pageId: '11111111' });
  assert.deepStrictEqual(r1, { live: true, externalId: '11111111_777' });
  const posts = calls.filter((c) => c.method === 'POST');
  assert.ok(posts.every((c) => c.body.access_token === 'PAGE_TOKEN_ABC'), 'đăng bằng Page token, không dùng token chính');
  assert.strictEqual(calls.filter((c) => c.method === 'GET').length, 1, 'chỉ đổi token 1 lần');
  assert.strictEqual(r2.live, true);
});

test('trả lời bình bình luận thật; bình luận mẫu thì không gọi API', async () => {
  reset([
    { test: (r) => r.method === 'GET', reply: { access_token: 'PAGE_TOKEN_ABC' } },
    { test: at('/C9/comments', 'POST'), reply: { id: 'C9_1' } },
  ]);
  social.resetPageToken();
  assert.deepStrictEqual(await social.reply('facebook_page', 'C9', 'Dạ cảm ơn', { pageId: '11111111' }), { live: true });
  assert.strictEqual(calls.find((c) => c.method === 'POST').body.message, 'Dạ cảm ơn');
  calls.length = 0;
  assert.deepStrictEqual(await social.reply('facebook_page', 'demo_1', 'x', { pageId: '11111111' }), { live: false });
  assert.strictEqual(calls.length, 0);
});

test('kéo bình luận: bỏ bình luận của chính Page và bình luận quá 7 ngày', async () => {
  const now = new Date().toISOString();
  const old = new Date(Date.now() - 10 * 864e5).toISOString();
  social.resetPageToken();
  reset([
    { test: (r) => r.path.endsWith('/11111111') && !r.path.includes('posts'), reply: { access_token: 'PT' } },
    { test: at('/11111111/posts'), reply: { data: [{ id: 'P1', comments: { data: [
      { id: 'k1', message: 'Giá nhuộm bao nhiêu?', from: { id: 'U1', name: 'Lan' }, created_time: now },
      { id: 'k2', message: 'Cảm ơn bạn', from: { id: '11111111', name: 'Salon' }, created_time: now },
      { id: 'k3', message: 'Bình luận cũ', from: { id: 'U2', name: 'Mai' }, created_time: old },
      { id: 'k4', from: { id: 'U3' }, created_time: now },
    ] } }, { id: 'P2' }] } },
  ]);
  const cs = await social.fetchComments('11111111');
  assert.deepStrictEqual(cs.map((c) => [c.id, c.author, c.text]), [['k1', 'Lan', 'Giá nhuộm bao nhiêu?']]);
});

test('kiểm tra kết nối: báo OK, và cảnh báo khi tiền tệ không phải VND', async () => {
  social.resetPageToken();
  const planner = require('../src/planner');
  planner.updateBrand('the_one', { adAccountId: '99999', pageIds: ['11111111'] });
  reset([
    { test: (r) => r.path.endsWith('/me/permissions'), reply: { data: ['ads_read', 'ads_management', 'pages_show_list', 'pages_read_engagement', 'pages_manage_posts', 'pages_manage_engagement'].map((p) => ({ permission: p, status: 'granted' })) } },
    { test: (r) => r.path.endsWith('/me'), reply: { id: '1', name: 'Hậu' } },
    { test: (r) => r.path.endsWith('/act_99999'), reply: { name: 'The One Ads', account_status: 1, currency: 'USD', timezone_name: 'Asia/Ho_Chi_Minh' } },
    { test: at('/act_99999/campaigns'), reply: { data: [{ id: 'c1' }] } },
    { test: (r) => r.path.endsWith('/11111111') && !r.path.includes('posts'), reply: { name: 'The One', access_token: 'PT' } },
    { test: at('/11111111/posts'), reply: { data: [] } },
    { test: at('/me/accounts'), reply: { data: [{ id: '11111111', tasks: ['MODERATE', 'CREATE_CONTENT'] }] } },
  ]);
  load().settings.adTest.on = true;
  const out = await runChecks();
  assert.ok(out.every((s) => s.ok), JSON.stringify(out.filter((s) => !s.ok)));
  const acct = out.find((s) => /tài khoản quảng cáo/.test(s.name));
  assert.ok(acct.warn && /USD/.test(acct.detail));
  // Quyền trên Page: có Tạo nội dung + Kiểm duyệt nhưng thiếu Tạo quảng cáo (đang bật quảng cáo thử) → cảnh báo kèm cách cấp
  const pt = out.find((s) => /quyền trên Page 11111111/.test(s.name));
  assert.ok(pt && pt.warn && /Tạo quảng cáo/.test(pt.detail) && /Kiểm duyệt/.test(pt.detail), JSON.stringify(pt));
  assert.ok(!JSON.stringify(out).includes('TOKEN_SECRET_123') && !JSON.stringify(out).includes('PT"'), 'không lộ token');
});

test('kiểm tra kết nối: token hỏng thì báo lỗi rõ, không ném ngoại lệ', async () => {
  reset([{ test: () => true, reply: { error: { code: 190, message: 'bad' } } }]);
  const out = await runChecks();
  assert.ok(out.some((s) => !s.ok && /hết hạn/.test(s.detail)));
});

test('chuyển sang kết nối thật: dọn dữ liệu mẫu, giữ kế hoạch/bài đăng', () => {
  const db = load();
  db.demo = true;
  db.campaigns = [{ id: 'c1' }];
  db.approvals = [{ id: 'a', type: 'budget_increase', key: 'c3' }, { id: 'b', type: 'comment_reply', key: 'demo_1' }, { id: 'c', type: 'post_publish', key: 'post1' }];
  db.comments = [{ id: 'demo_1' }, { id: 'k1' }];
  db.posts = [{ id: 'post1' }];
  assert.strictEqual(engine.cleanupDemo(), true);
  assert.deepStrictEqual(db.approvals.map((a) => a.id), ['c']);
  assert.deepStrictEqual(db.comments.map((c) => c.id), ['k1']);
  assert.strictEqual(db.posts.length, 1);
  assert.strictEqual(engine.cleanupDemo(), false, 'chỉ dọn 1 lần');
});

test('tạo quảng cáo thử từ bài có sẵn: gắn nút Gửi tin nhắn vào mẫu quảng cáo, bỏ trường nhắm đối tượng đã gỡ, bật theo thứ tự quảng cáo → nhóm → chiến dịch', async () => {
  let n = 0;
  reset([
    { test: (r) => r.method === 'POST' && /\/(campaigns|adsets|adcreatives|ads)$/.test(r.path), reply: () => ({ id: 'obj' + (++n) }) },
    { test: (r) => r.method === 'POST' && /\/obj\d+$/.test(r.path), reply: { success: true } },
  ]);
  const r = await ads.createTest({ accountId: '99999', name: 'TEST-dh', pageId: '459628564196388', objectStoryId: '459628564196388_2013663866691896', budget: 150000, days: 7, targeting: { geo_locations: { countries: ['VN'] }, targeting_optimization: 'none' } });
  assert.deepStrictEqual(r, { campaignId: 'obj1', adsetId: 'obj2', adId: 'obj4' });
  const creative = calls.find((c) => c.path.endsWith('/adcreatives'));
  assert.strictEqual(creative.body.object_story_id, '459628564196388_2013663866691896');
  const cta = JSON.parse(creative.body.call_to_action);
  assert.strictEqual(cta.type, 'MESSAGE_PAGE');
  assert.strictEqual(cta.value.app_destination, 'MESSENGER');
  assert.strictEqual(creative.body.asset_feed_spec, undefined);
  const adset = calls.find((c) => c.path.endsWith('/adsets'));
  const t = JSON.parse(adset.body.targeting);
  assert.strictEqual(t.targeting_optimization, undefined);
  assert.deepStrictEqual(t.targeting_automation, { advantage_audience: 0 });
  assert.strictEqual(JSON.parse(adset.body.promoted_object).page_id, '459628564196388');
  const activations = calls.filter((c) => c.method === 'POST' && /\/obj\d+$/.test(c.path)).map((c) => c.path.slice(-4));
  assert.deepStrictEqual(activations, ['obj4', 'obj2', 'obj1']);
});

test('chi tiết chiến dịch để xem bài: ảnh bài gốc từ Page, nội dung, link, nhóm quảng cáo, số liệu 7 ngày từng quảng cáo; video dùng thumbnail khi không đọc được bài', async () => {
  social.resetPageToken();
  reset([
    { test: at('/c9'), reply: { id: 'c9', name: 'TEST-dh', objective: 'OUTCOME_ENGAGEMENT', effective_status: 'ACTIVE', created_time: '2026-10-15T07:00:00+0000', start_time: '2026-10-15T07:05:00+0000', daily_budget: '0' } },
    { test: at('/c9/ads'), reply: { data: [
      { id: 'ad1', name: 'QC 1', effective_status: 'ACTIVE', created_time: '2026-10-15T07:05:00+0000', adset: { id: 's1', name: 'Nhóm 1', daily_budget: '150000', optimization_goal: 'CONVERSATIONS', destination_type: 'MESSENGER' }, creative: { id: 'cr1', effective_object_story_id: '459628564196388_111', thumbnail_url: 'https://cdn/thumb1.jpg', object_type: 'VIDEO', video_id: 'v1', body: 'thân bài mẫu' }, preview_shareable_link: 'https://fb.com/preview1' },
      { id: 'ad2', name: 'QC 2', effective_status: 'PAUSED', created_time: '2026-10-15T07:06:00+0000', adset: { id: 's1', name: 'Nhóm 1', daily_budget: '150000' }, creative: { id: 'cr2', effective_object_story_id: '459628564196388_222', image_url: 'https://cdn/img2.jpg', object_type: 'SHARE', title: 'Tiêu đề 2' } },
    ] } },
    { test: at('/c9/insights'), reply: { data: [{ ad_id: 'ad1', spend: '310000', impressions: '12000', reach: '9000', clicks: '140', actions: [{ action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '2' }] }] } },
    { test: (r) => r.path.endsWith('/459628564196388') && r.q.fields === 'access_token', reply: { access_token: 'PT' } },
    { test: at('/459628564196388_111'), reply: { full_picture: 'https://cdn/full1.jpg', message: 'Tím than – không quá nổi', permalink_url: 'https://facebook.com/post/111', created_time: '2026-10-10T10:00:00+0000', attachments: { data: [{ media_type: 'video' }] } } },
    { test: at('/459628564196388_222'), reply: { error: { code: 100, message: 'Unsupported get request' } } },
  ]);
  const d = await ads.creatives('c9');
  assert.strictEqual(d.campaign.name, 'TEST-dh'); assert.strictEqual(d.campaign.createdAt, '2026-10-15T07:00:00+0000');
  assert.strictEqual(d.ads.length, 2);
  const [a1, a2] = d.ads;
  assert.strictEqual(a1.image, 'https://cdn/full1.jpg', 'ưu tiên ảnh to của bài gốc');
  assert.strictEqual(a1.text, 'Tím than – không quá nổi'); assert.strictEqual(a1.link, 'https://facebook.com/post/111');
  assert.strictEqual(a1.video, true); assert.strictEqual(a1.adset.name, 'Nhóm 1'); assert.strictEqual(a1.adset.budget, 150000);
  assert.deepStrictEqual([a1.spend, a1.msgs, a1.cpl, a1.impressions, a1.reach, a1.clicks], [310000, 2, 155000, 12000, 9000, 140]);
  assert.strictEqual(a2.image, 'https://cdn/img2.jpg', 'không đọc được bài gốc thì dùng ảnh của mẫu quảng cáo'); assert.strictEqual(a2.title, 'Tiêu đề 2');
  assert.strictEqual(a2.spend, 0); assert.strictEqual(a2.cpl, null); assert.strictEqual(a2.link, '', 'không có link nào thì để trống');
  assert.ok(!JSON.stringify(d).includes('TOKEN_SECRET_123') && !JSON.stringify(d).includes('"PT"'), 'không lộ token');
  const postCalls = calls.filter((c) => c.path.endsWith('/459628564196388_111'));
  assert.strictEqual(postCalls.length, 1, 'mỗi bài gốc chỉ đọc 1 lần'); assert.strictEqual(postCalls[0].q.access_token, 'PT', 'đọc bài bằng Page token');
});
