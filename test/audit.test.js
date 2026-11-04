const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-audit-'));
process.env.DB_FILE = path.join(tmp, 'db.json');
process.env.MEDIA_DIR = path.join(tmp, 'media');
delete process.env.AUDIT_FILE;
delete process.env.AUDIT_MAX_BYTES;
delete process.env.APP_PASSWORD;
delete process.env.META_ACCESS_TOKEN;
delete process.env.ANTHROPIC_API_KEY;

const { load } = require('../src/db');
// Dòng nhật ký có sẵn TRƯỚC khi file audit được tạo → phải được nhập làm lịch sử
load().actions.push(
  { id: 'old2', at: '2026-10-02T03:00:00.000Z', kind: 'pause', text: 'Tắt Chiến dịch cũ — giá cao', rule: 'highCpl', campaignId: 'c9', dry: true },
  { id: 'old1', at: '2026-10-01T03:00:00.000Z', kind: 'system', text: 'Khởi động' },
);
const audit = require('../src/audit');
const engine = require('../src/engine');
const usage = require('../src/usage');
const { server } = require('../src/server');
test.after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

let base;
const get = (p) => fetch(base + p);
const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });

test('khởi động server thử', async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

test('lần đầu: nhập các dòng db.actions có sẵn làm lịch sử (giữ giờ gốc, đánh dấu imported), thứ tự mới → cũ', () => {
  const r = audit.query({});
  const imported = r.rows.filter((e) => e.imported);
  assert.deepStrictEqual(imported.map((e) => e.at), ['2026-10-02T03:00:00.000Z', '2026-10-01T03:00:00.000Z']);
  assert.strictEqual(imported[0].status, 'dry');
  assert.deepStrictEqual(imported[0].object, { type: 'Chiến dịch', id: 'c9' });
});

test('chuẩn hoá: người thực hiện (Sếp / agent / hệ thống), đối tượng, trạng thái, trước/sau', async () => {
  engine.log('ads_change', 'Sếp đổi ngân sách X', { by: 'Sếp', campaignId: 'c1', field: 'budget', before: 300000, after: 360000 });
  engine.log('system', 'Việc hệ thống');
  await usage.withAgent('ads', async () => { engine.log('pause', 'Tắt Y', { rule: 'highCpl', campaignId: 'c2', dry: false }); engine.log('propose', 'Đề xuất Z', { rule: 'scaleUp' }); engine.log('error', 'Meta lỗi'); });
  const rows = audit.query({ from: new Date(Date.now() - 60e3).toISOString() }).rows;
  const by = (t) => rows.find((e) => e.action.includes(t));
  assert.deepStrictEqual(by('Sếp đổi ngân sách').actor, { type: 'user', name: 'Sếp' });
  assert.deepStrictEqual([by('Sếp đổi ngân sách').before, by('Sếp đổi ngân sách').after, by('Sếp đổi ngân sách').field], ['300000', '360000', 'budget']);
  assert.deepStrictEqual(by('Việc hệ thống').actor, { type: 'system', name: 'Hệ thống' });
  assert.deepStrictEqual(by('Tắt Y').actor, { type: 'agent', name: 'Agent Quảng cáo' });
  assert.strictEqual(by('Tắt Y').status, 'ok');
  assert.strictEqual(by('Đề xuất Z').status, 'proposed');
  assert.strictEqual(by('Meta lỗi').status, 'error');
  assert.strictEqual(by('Meta lỗi').error, 'Meta lỗi');
  assert.strictEqual(by('Tắt Y').rule, 'highCpl');
  assert.strictEqual(by('Tắt Y').kindLabel, 'Tắt chiến dịch');
});

test('che token/khoá trong nhật ký; cắt độ dài', () => {
  const tok = 'EAABsbCS1iHgBO' + 'x'.repeat(40);
  engine.log('error', `Gọi Meta lỗi access_token=${tok} và sk-ant-abcdefghijklmnop12345 ${tok}`, { by: 'Sếp', before: `password=hunter2` });
  const e = audit.query({ q: 'gọi meta lỗi' }).rows[0];
  const dump = JSON.stringify(e);
  assert.ok(!dump.includes(tok) && !dump.includes('sk-ant-abc') && !dump.includes('hunter2'), dump);
  assert.match(e.action, /\[đã che\]/);
  engine.log('system', 'x'.repeat(5000));
  assert.ok(audit.query({}).rows[0].action.length <= 500);
  assert.ok(!fs.readFileSync(audit.file(), 'utf8').includes(tok), 'không có token trong file');
});

test('bộ lọc: thời gian, người thực hiện (tên hoặc loại), loại, trạng thái, đối tượng, từ khoá; kèm thống kê', () => {
  const all = audit.query({}).total;
  assert.ok(all >= 8);
  assert.ok(audit.query({ actor: 'user' }).rows.every((e) => e.actor.type === 'user'));
  assert.ok(audit.query({ actor: 'Agent Quảng cáo' }).total >= 3);
  assert.ok(audit.query({ kind: 'error' }).rows.every((e) => e.kind === 'error'));
  assert.ok(audit.query({ status: 'dry' }).rows.every((e) => e.status === 'dry'));
  assert.ok(audit.query({ object: 'Chiến dịch' }).rows.every((e) => e.object.type === 'Chiến dịch'));
  assert.strictEqual(audit.query({ q: 'c9' }).total, 1, 'tìm theo mã đối tượng');
  assert.strictEqual(audit.query({ q: '360000' }).total, 1, 'tìm theo giá trị sau');
  assert.strictEqual(audit.query({ from: '2026-10-02T00:00:00Z', to: '2026-10-02T23:59:59Z' }).total, 1);
  assert.strictEqual(audit.query({ to: '2026-10-01T23:59:59Z' }).total, 1);
  const r = audit.query({});
  assert.ok(r.facets.kinds.error >= 2 && r.facets.actors['Sếp'] >= 2 && r.facets.status.proposed >= 1 && r.facets.objects['Chiến dịch'] >= 2);
  assert.throws(() => audit.query({ from: 'không phải ngày' }), /không hợp lệ/);
});

test('API: phân trang, lọc, từ chối tham số sai', async () => {
  let j = await (await get('/api/audit?limit=5')).json();
  assert.strictEqual(j.rows.length, 5);
  assert.ok(j.total > 5 && j.all >= j.total);
  const j2 = await (await get('/api/audit?limit=5&offset=5')).json();
  assert.notStrictEqual(j2.rows[0].id, j.rows[0].id);
  j = await (await get('/api/audit?kind=error&limit=100')).json();
  assert.ok(j.rows.length >= 2 && j.rows.every((e) => e.kind === 'error'));
  assert.strictEqual((await get('/api/audit?to=abc')).status, 400);
  j = await (await get('/api/audit?limit=99999')).json();
  assert.ok(j.rows.length <= 100);
});

test('xuất CSV: BOM, tiêu đề tiếng Việt, escape dấu nháy, chặn công thức Excel, theo bộ lọc', async () => {
  engine.log('system', '=HYPERLINK("http://x")', { by: 'Sếp' });
  engine.log('system', 'Có "dấu nháy", và dấu phẩy');
  const r = await get('/api/audit/export');
  assert.strictEqual(r.status, 200);
  assert.match(r.headers.get('content-type'), /text\/csv/);
  assert.match(r.headers.get('content-disposition'), /nhat-ky-\d{4}-\d{2}-\d{2}\.csv/);
  const buf = Buffer.from(await r.arrayBuffer());
  assert.deepStrictEqual([...buf.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'có BOM UTF-8 để Excel đọc đúng tiếng Việt');
  const txt = buf.toString('utf8').replace(/^﻿/, '');
  assert.match(txt.split('\r\n')[0], /"Thời gian","Người thực hiện"/);
  assert.ok(txt.includes('"\'=HYPERLINK(""http://x"")"'), 'công thức bị vô hiệu bằng dấu nháy đơn');
  assert.ok(txt.includes('"Có ""dấu nháy"", và dấu phẩy"'));
  const only = await (await get('/api/audit/export?kind=error')).text();
  const lines = only.trim().split('\r\n');
  assert.ok(lines.length >= 3 && lines.slice(1).every((l) => l.includes('"Lỗi"')));
  assert.strictEqual((await get('/api/audit/export?from=sai')).status, 400);
});

test('thay đổi cài đặt / hồ sơ thương hiệu / bài học được ghi "trước → sau", không lộ token', async () => {
  const before = audit.query({}).total;
  await post('/api/settings', { dryRun: false, monthlyCap: 20000000, rules: { highCpl: { maxCostPerMsg: 123000 } } });
  const rows = audit.query({ kind: 'settings' }).rows;
  const dry = rows.find((e) => e.field === 'dryRun');
  assert.deepStrictEqual([dry.before, dry.after, dry.actor.name], ['true', 'false', 'Sếp']);
  assert.ok(rows.some((e) => e.field === 'rules.highCpl.maxCostPerMsg' && e.after === '123000'));
  assert.ok(rows.some((e) => e.field === 'monthlyCap' && e.before === '0'));
  await post('/api/settings', { dryRun: true });
  const n = audit.query({ kind: 'settings' }).total;
  await post('/api/settings', { dryRun: true }); // không đổi gì → không ghi
  assert.strictEqual(audit.query({ kind: 'settings' }).total, n);
  await post('/api/brands', { id: 'the_one', hotline: '0900 000 000' });
  assert.ok(audit.query({ kind: 'brand' }).rows.some((e) => e.actor.name === 'Sếp' && /hotline/.test(e.action)));
  await post('/api/lessons', { text: 'Luôn mời nhắn tin', scope: 'all' });
  assert.ok(audit.query({ kind: 'lesson' }).total >= 1);
  assert.ok(audit.query({}).total > before);
});

test('xoay file khi quá lớn: giữ tối đa 3 bản cũ và vẫn đọc được cả các bản cũ', () => {
  process.env.AUDIT_MAX_BYTES = '4000';
  const f = audit.file();
  const base = f.replace(/\.jsonl$/, '');
  for (let i = 0; i < 80; i++) engine.log('system', `Dòng xoay file số ${i} ` + 'y'.repeat(60));
  delete process.env.AUDIT_MAX_BYTES;
  assert.ok(fs.existsSync(`${base}.1.jsonl`), 'có bản cũ .1');
  assert.ok(!fs.existsSync(`${base}.4.jsonl`), 'không quá 3 bản cũ');
  assert.ok(fs.statSync(f).size < 4000 + 400, 'file hiện tại nhỏ');
  const rows = audit.query({ q: 'dòng xoay file số' }).rows;
  assert.ok(rows.length > 10 && rows.length <= 80, 'đọc được nhiều bản');
  assert.strictEqual(rows[0].action.includes('số 79'), true, 'mới nhất đứng đầu');
});

test('nhật ký kiểm toán lỗi ghi file không làm hỏng việc chính', () => {
  const dir = path.join(tmp, 'khong-co-quyen');
  fs.mkdirSync(dir);
  process.env.AUDIT_FILE = path.join(dir, 'x', '..', '..', 'khong-ton-tai-thu-muc', 'a.jsonl'); // thư mục cha sẽ được tạo; thử đường dẫn là thư mục để ép lỗi ghi
  process.env.AUDIT_FILE = dir; // đường dẫn là một THƯ MỤC → appendFile lỗi
  assert.doesNotThrow(() => engine.log('system', 'vẫn chạy được'));
  assert.strictEqual(load().actions[0].text, 'vẫn chạy được');
  delete process.env.AUDIT_FILE;
});
