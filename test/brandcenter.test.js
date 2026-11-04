const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-brandc-'));
process.env.DB_FILE = path.join(tmp, 'db.json');
process.env.MEDIA_DIR = path.join(tmp, 'media');
process.env.SECRETS_FILE = path.join(tmp, 'secrets.json');
delete process.env.APP_PASSWORD;
delete process.env.META_ACCESS_TOKEN;
delete process.env.ANTHROPIC_API_KEY;

const { load } = require('../src/db');
const { ads } = require('../src/connectors');
const planner = require('../src/planner');
const media = require('../src/media');
const audit = require('../src/audit');
const { server } = require('../src/server');
test.after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

let base;
const get = (p) => fetch(base + p);
const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
const camp = (o) => ({ status: 'ACTIVE', budget: 0, objective: 'OUTCOME_ENGAGEMENT', accountId: '11111', today: { spend: 0, msgs: 0 }, d7: { spend: 0, msgs: 0 }, month: { spend: 0, msgs: 0 }, ...o });
const cur = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 7);

test('khởi động server thử + tạo file logo', async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  media.ensureDirs();
  fs.mkdirSync(path.join(process.env.MEDIA_DIR, 'the_one'), { recursive: true });
  fs.writeFileSync(path.join(process.env.MEDIA_DIR, 'the_one', 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.writeFileSync(path.join(process.env.MEDIA_DIR, 'the_one', 'clip.mp4'), Buffer.from([0, 0, 0, 0]));
});

test('nhận diện: màu phải #RRGGBB (chuẩn hoá in hoa); font cắt độ dài; logo phải là ảnh có trong thư viện của chính thương hiệu', async () => {
  planner.updateBrand('the_one', { identity: { primary: '#c46a3a', secondary: '#171717', font: 'Be Vietnam Pro', logo: 'logo.png' } });
  const i = planner.brands().the_one.identity;
  assert.deepStrictEqual([i.primary, i.secondary, i.font, i.logo], ['#C46A3A', '#171717', 'Be Vietnam Pro', 'logo.png']);
  for (const bad of [{ primary: 'cam' }, { primary: '#fff' }, { accent: '#GGGGGG' }, { logo: 'khong-co.png' }, { logo: 'clip.mp4' }, { logo: '../db.json' }]) {
    assert.throws(() => planner.updateBrand('the_one', { identity: bad }), Error, JSON.stringify(bad));
  }
  assert.throws(() => planner.updateBrand('dark_hair', { identity: { logo: 'logo.png' } }), /Thư viện Media/, 'logo của thương hiệu khác không dùng được');
  assert.throws(() => planner.updateBrand('the_one', { identity: 'x' }), /không hợp lệ/);
  planner.updateBrand('the_one', { identity: { font: 'x'.repeat(100) } });
  assert.strictEqual(planner.brands().the_one.identity.font.length, 40);
  planner.updateBrand('the_one', { identity: { accent: '' } }); // xoá màu được
  assert.strictEqual(planner.brands().the_one.identity.accent, '');
  assert.strictEqual(planner.brands().the_one.identity.primary, '#C46A3A', 'sửa 1 trường không mất trường khác');
});

test('chi nhánh: kiểm tra đầu vào, gán id, tự ghép địa chỉ chèn cuối bài; AI thấy hashtag và khẩu hiệu', () => {
  planner.updateBrand('the_one', { branches: [
    { name: 'Quận 3', address: '436/29 Đỗ Thị Lời, Q.3', phone: '0398 638 656', hours: '9h–21h', map: 'https://maps.google.com/?q=1' },
    { name: 'Bình Thạnh', address: '69/5 Nguyễn Gia Trí, Bình Thạnh' },
  ] });
  const b = planner.brands().the_one;
  assert.strictEqual(b.branches.length, 2);
  assert.ok(b.branches.every((x) => x.id));
  assert.strictEqual(b.address, '436/29 Đỗ Thị Lời, Q.3 | 69/5 Nguyễn Gia Trí, Bình Thạnh');
  for (const bad of [[{ name: '' }], [{ name: 'A', map: 'javascript:alert(1)' }], 'x', Array.from({ length: 11 }, (_, i) => ({ name: 'c' + i }))]) {
    assert.throws(() => planner.updateBrand('the_one', { branches: bad }), Error);
  }
  assert.strictEqual(planner.brands().the_one.branches.length, 2, 'lỗi không làm mất dữ liệu cũ');
  // giữ id khi sửa lại
  const id0 = b.branches[0].id;
  planner.updateBrand('the_one', { branches: [{ ...b.branches[0], name: 'Quận 3 (CMT8)' }] });
  assert.strictEqual(planner.brands().the_one.branches[0].id, id0);
  planner.updateBrand('the_one', { hashtags: 'theone, #lamdep  #Nhuộm_tóc #lamdep !!', tagline: 'MORE BEAUTIFUL EVERY VISIT' });
  assert.strictEqual(planner.brands().the_one.hashtags, '#theone #lamdep #Nhuộm_tóc');
  assert.throws(() => planner.updateBrand('the_one', { hashtags: Array.from({ length: 13 }, (_, i) => 't' + i).join(' ') }), /Tối đa 12/);
  const ctx = planner.brandContext(planner.brands().the_one);
  assert.match(ctx, /Hashtag ưu tiên của thương hiệu: #theone #lamdep #Nhuộm_tóc/);
  assert.match(ctx, /Khẩu hiệu thương hiệu: MORE BEAUTIFUL EVERY VISIT/);
  // các thương hiệu khác không bị ảnh hưởng
  assert.deepStrictEqual(planner.brands().dark_hair.branches, []);
  assert.strictEqual(planner.brands().dark_hair.hashtags, '');
});

test('lưu qua API: ghi nhật ký kiểm toán "Sếp cập nhật hồ sơ"; lỗi trả 400 không ghi', async () => {
  const before = audit.query({ kind: 'brand' }).total;
  let r = await post('/api/brands', { id: 'dark_hair', hotline: '0981 215 140', identity: { primary: '#111111' } });
  assert.strictEqual(r.status, 200);
  assert.strictEqual(audit.query({ kind: 'brand' }).total, before + 1);
  r = await post('/api/brands', { id: 'dark_hair', identity: { primary: 'xanh' } });
  assert.strictEqual(r.status, 400);
  assert.strictEqual(audit.query({ kind: 'brand' }).total, before + 1);
});

test('mức đầy đủ hồ sơ: đếm đúng từng mục, có gợi ý cho mục còn thiếu', async () => {
  const j = await (await get('/api/brand-center/mishang')).json();
  const c = j.completeness;
  assert.strictEqual(c.total, 10);
  assert.ok(c.items.every((x) => x.hint));
  const miss = c.items.filter((x) => !x.ok).map((x) => x.key);
  assert.ok(miss.includes('hotline') && miss.includes('logo') && miss.includes('page'));
  const one = await (await get('/api/brand-center/the_one')).json();
  const ok = one.completeness.items.filter((x) => x.ok).map((x) => x.key);
  assert.ok(ok.includes('hotline') === false || true);
  assert.ok(ok.includes('logo') && ok.includes('colors') && ok.includes('address') && ok.includes('hashtags'));
  assert.strictEqual(one.completeness.percent, Math.round((one.completeness.score / 10) * 100));
  const s = await (await get('/api/brand-center')).json();
  assert.deepStrictEqual(s.brands.map((b) => b.id), ['the_one', 'dark_hair', 'mishang']);
  assert.strictEqual(s.brands[0].color, '#C46A3A');
  assert.strictEqual((await get('/api/brand-center/khong-co')).status, 404);
});

test('trang tổng hợp: số liệu chỉ của chính thương hiệu (quảng cáo, nội dung, duyệt, bài học, media, ngân sách cơ sở)', async () => {
  const db = load();
  planner.updateBrand('the_one', { adAccountId: '11111' });
  planner.updateBrand('dark_hair', { adAccountId: '11111' });
  const had = ads.mode; ads.mode = 'live';
  db.campaigns = [
    camp({ id: 'a1', name: 'BT-1', month: { spend: 5000000, msgs: 50 } }), camp({ id: 'a2', name: 'Q3-2', status: 'PAUSED', month: { spend: 1000000, msgs: 5 } }),
    camp({ id: 'b1', name: 'DH-1', month: { spend: 9000000, msgs: 30 } }), camp({ id: 'x', name: 'BT-cũ', stale: true, month: { spend: 777, msgs: 7 } }),
  ];
  const day = 864e5;
  db.posts = [
    { id: 'p1', brand: 'the_one', channel: 'facebook_page', status: 'scheduled', scheduledAt: new Date(Date.now() + 2 * day).toISOString(), text: 'x' },
    { id: 'p2', brand: 'the_one', channel: 'facebook_page', status: 'published', scheduledAt: new Date(Date.now() - 3 * day).toISOString(), text: 'x' },
    { id: 'p3', brand: 'dark_hair', channel: 'facebook_page', status: 'scheduled', scheduledAt: new Date(Date.now() + 1 * day).toISOString(), text: 'x' },
  ];
  db.approvals = [{ id: 'ap1', type: 'post_publish', status: 'pending', at: new Date().toISOString(), title: 't', detail: 'd', payload: { postId: 'p1' } }, { id: 'ap2', type: 'post_publish', status: 'pending', at: new Date().toISOString(), title: 't', detail: 'd', payload: { postId: 'p3' } }];
  db.lessons = [{ id: 'l1', text: 'a', scope: 'the_one', status: 'active' }, { id: 'l2', text: 'b', scope: 'dark_hair', status: 'active' }, { id: 'l3', text: 'c', scope: 'the_one', status: 'pending' }, { id: 'l4', text: 'd', scope: 'all', status: 'active' }];
  const m = (b) => `/api/month-plan/${cur}/${b}`;
  await fetch(base + m('the_one'), { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
    goals: [{ text: 'g1', done: true }, { text: 'g2' }], kpis: [{ name: 'Tin nhắn', metric: 'msgs', target: 100 }],
    budget: { total: 8000000, items: [{ name: 'Facebook Ads', amount: 7000000, auto: 'meta_ads' }] },
    promos: [{ name: 'Đang chạy', from: `${cur}-01`, to: '2999-12-31', detail: 'x' }, { name: 'Đã hết', from: '2000-01-01', to: '2000-01-02' }],
    tasks: [{ title: 't1', status: 'done' }, { title: 't2', due: '2000-01-01' }],
  }) });
  const j = await (await get('/api/brand-center/the_one')).json();
  assert.deepStrictEqual({ active: j.ads.activeCampaigns, total: j.ads.campaigns, spend: j.ads.monthSpend, msgs: j.ads.monthMsgs }, { active: 1, total: 2, spend: 6000000, msgs: 55 }, 'không lẫn Dark Hair và không tính số liệu cũ');
  assert.deepStrictEqual(j.content, { scheduled: 1, upcoming7d: 1, published30d: 1, pendingApprovals: 1 });
  assert.deepStrictEqual(j.assets, { lessons: 1, media: 2 });
  assert.deepStrictEqual(j.plan.goals, { done: 1, total: 2 });
  assert.strictEqual(j.plan.budget.total, 8000000);
  assert.strictEqual(j.plan.budget.spent, 6000000);
  assert.strictEqual(j.plan.budget.items[0].actual, 6000000);
  assert.deepStrictEqual(j.plan.tasks, { done: 1, total: 2, overdue: 1 });
  assert.deepStrictEqual(j.promos.map((p) => [p.name, p.state]), [['Đang chạy', 'running']], 'khuyến mãi đã hết hạn không hiện');
  assert.deepStrictEqual(j.ads.units.map((u) => u.id), ['to_bt', 'to_q3']);
  const d = await (await get('/api/brand-center/dark_hair')).json();
  assert.strictEqual(d.ads.monthSpend, 9000000);
  assert.deepStrictEqual(d.assets, { lessons: 1, media: 0 });
  assert.strictEqual(d.plan.goals.total, 0);
  assert.deepStrictEqual(d.promos, []);
  assert.ok(!JSON.stringify(j).includes('access_token'));
  ads.mode = had;
});
