const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-xhs-'));
process.env.DB_FILE = path.join(tmp, 'db.json');
process.env.MEDIA_DIR = path.join(tmp, 'media');
delete process.env.ANTHROPIC_API_KEY;
delete process.env.META_ACCESS_TOKEN;
delete process.env.GEMINI_API_KEY;

const { lint } = require('../src/compliance');
const mp4info = require('../src/mp4info');
const xhs = require('../src/xhs');
const media = require('../src/media');
const planner = require('../src/planner');
const engine = require('../src/engine');
const videoIntel = require('../src/video-intel');
const { load } = require('../src/db');
const { server } = require('../src/server');

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

// ---- mp4 giả để thử đọc thông số ----
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };
const box = (type, ...parts) => { const p = Buffer.concat(parts); return Buffer.concat([u32(8 + p.length), Buffer.from(type), p]); };
function tkhd(w, h, rotate) {
  const p = Buffer.alloc(84);
  const m = 40;
  p.writeInt32BE(rotate ? 0 : 0x10000, m); p.writeInt32BE(rotate ? 0x10000 : 0, m + 4);
  p.writeInt32BE(rotate ? -0x10000 : 0, m + 12); p.writeInt32BE(rotate ? 0 : 0x10000, m + 16);
  p.writeUInt32BE(w * 65536, 76); p.writeUInt32BE(h * 65536, 80);
  return box('tkhd', p);
}
function mvhd(timescale, duration) { const p = Buffer.alloc(100); p.writeUInt32BE(timescale, 12); p.writeUInt32BE(duration, 16); return box('mvhd', p); }
function fakeMp4(file, { w = 720, h = 1280, seconds = 20, rotate = false, pad = 1000 } = {}) {
  const moov = box('moov', mvhd(1000, seconds * 1000), box('trak', tkhd(0, 0, false)), box('trak', tkhd(w, h, rotate)));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([box('ftyp', Buffer.from('isom0000')), box('mdat', Buffer.alloc(pad)), moov]));
}
const mediaDir = (b) => path.join(process.env.MEDIA_DIR, b);
const month = new Date(Date.now() + 40 * 864e5).toISOString().slice(0, 7);

test('mp4info: đọc độ phân giải, thời lượng, bitrate; bỏ track âm thanh; hiểu video xoay 90°', () => {
  const f = path.join(tmp, 'a.mp4');
  fakeMp4(f, { w: 720, h: 1280, seconds: 20, pad: 50000 });
  const i = mp4info.read(f);
  assert.deepStrictEqual([i.width, i.height, Math.round(i.durationSec)], [720, 1280, 20]);
  assert.ok(i.kbps > 15 && i.kbps < 40);
  fakeMp4(f, { w: 1920, h: 1080, seconds: 5, rotate: true });
  const r = mp4info.read(f);
  assert.deepStrictEqual([r.width, r.height], [1080, 1920]);
});

test('tuân thủ: bắt liên hệ ngoài, từ cực đoan, tiêu đề dài; cho qua "最近/最终"', () => {
  const ok = { title: '栗棕色+松弛卷发', body: '最近很火的发色，最终效果自然。\n📩 私信「预约」，发头发照片给我们～\n\n#越南做头发 #胡志明市做头发' };
  const r0 = lint(ok);
  assert.strictEqual(r0.blocked, false);
  assert.strictEqual(r0.warns, 0);
  const codes = (post) => lint(post).issues.filter((i) => i.level === 'block').map((i) => i.code);
  assert.ok(codes({ ...ok, body: ok.body + '\n加微信 abc123' }).includes('contact'));
  assert.ok(codes({ ...ok, body: ok.body + '\n电话 0398 638 656' }).includes('contact'));
  assert.ok(codes({ ...ok, body: ok.body + '\nhttps://example.com' }).includes('contact'));
  assert.ok(codes({ ...ok, body: '越南最好的沙龙，私信「预约」\n#越南做头发' }).includes('extreme'));
  assert.ok(codes({ ...ok, title: '一二三四五六七八九十一二三四五六七八九十一' }).includes('title_long'));
  assert.ok(!codes({ ...ok, body: '适合第一次染发的姐妹，第一步先评估发质。\n私信「预约」\n#越南做头发' }).includes('extreme'), '"第一次/第一步" không phải từ cực đoan');
  assert.ok(codes({ ...ok, body: '越南第一沙龙，私信「预约」\n#越南做头发' }).includes('extreme'), '"第一" đứng riêng vẫn bị chặn');
  assert.ok(codes({ ...ok, title: '' }).includes('title_empty'));
  assert.ok(codes({ ...ok, body: '字'.repeat(1001) }).includes('body_long'));
});

test('tuân thủ: cảnh báo giọng khách tự kể, lời hứa kết quả, hình ảnh', () => {
  const warn = (post) => lint(post).issues.filter((i) => i.level === 'warn').map((i) => i.code);
  const base = { title: '标题', body: '内容\n私信「预约」\n#越南做头发' };
  assert.ok(warn({ ...base, body: '旅行顺便在越南染了头发🥹\n私信「预约」\n#越南做头发' }).includes('fake_voice'));
  assert.ok(warn({ ...base, body: '黑发能染成奶茶金吗？当然可以！\n私信「预约」\n#越南做头发' }).includes('promise'));
  assert.ok(!warn({ ...base, body: '不一定能一步到位，要先评估。\n私信「预约」\n#越南做头发' }).includes('promise'), '"不一定能" là phủ định, không phải lời hứa');
  assert.ok(warn({ ...base, body: '放心，一定能做到。\n私信「预约」\n#越南做头发' }).includes('promise'));
  assert.ok(!warn({ ...base, body: '客人在店里把头发漂成铂金色。\n私信「预约」\n#越南做头发' }).includes('fake_voice'), 'giọng salon "客人…把头发漂成" không phải khách tự kể');
  assert.ok(warn({ ...base, body: '我把头发漂成铂金色了。\n私信「预约」\n#越南做头发' }).includes('fake_voice'));
  assert.ok(!warn({ ...base, body: '浅色会有一定损伤，需要先评估发质。\n私信「预约」\n#越南做头发' }).includes('promise'), '"有一定损伤" không phải lời hứa');
  const w = warn({ ...base, media: [
    { name: 'v.mp4', type: 'video', info: { width: 720, height: 1280, kbps: 2100 }, meta: { faces: 2, watermark: 'TikTok @abc' }, consent: false, note: '' },
  ] });
  assert.ok(['resolution', 'consent', 'watermark'].every((c) => w.includes(c)), w.join());
  const ok = warn({ ...base, media: [{ name: 'v.mp4', type: 'video', info: { width: 1080, height: 1920, kbps: 9000 }, meta: { faces: 2 }, consent: true, note: '' }] });
  assert.deepStrictEqual(ok, []);
});

test('mẫu bài có sẵn: bài nào cũng sạch (không bị chặn/cảnh báo), tiêu đề ≤ 20 chữ, có địa chỉ tiếng Trung', () => {
  const brand = planner.brands().the_one;
  assert.match(brand.addressZh, /436\/29/);
  for (let i = 0; i < xhs.FALLBACKS.length; i++) {
    const it = xhs.fallbackItem(i, brand);
    const r = lint({ title: it.title, body: it.text });
    assert.deepStrictEqual(r.issues.filter((x) => x.level !== 'info'), [], `mẫu ${i}: ${it.title}`);
    assert.ok(it.text.includes(brand.addressZh));
    assert.ok(/#越南做头发/.test(it.text));
  }
});

test('giờ hẹn: đổi đúng sang giờ Bắc Kinh và giờ Việt Nam; tách hashtag cuối bài', () => {
  assert.strictEqual(xhs.beijing('2026-10-17T05:30:00Z'), '2026-10-17 13:30');
  assert.strictEqual(xhs.vietnam('2026-10-17T05:30:00Z'), '2026-10-17 12:30');
  assert.strictEqual(xhs.beijing('2026-10-16T16:30:00Z'), '2026-10-17 00:30');
  const s = xhs.splitCaption('正文第一行\n正文第二行\n\n#越南做头发 #胡志明市做头发');
  assert.strictEqual(s.body, '正文第一行\n正文第二行');
  assert.deepStrictEqual(s.hashtags, ['#越南做头发', '#胡志明市做头发']);
});

test('kênh 小红书 là kênh thủ công, tắt sẵn; bật rồi AI (mẫu) soạn kế hoạch tiếng Trung có tiêu đề', async () => {
  const social = require('../src/connectors/social');
  assert.strictEqual(social.CHANNELS.xiaohongshu.manual, true);
  assert.strictEqual(social.CHANNELS.xiaohongshu.live(), false);
  assert.strictEqual(planner.channelEnabled('the_one', 'xiaohongshu'), false);
  fakeMp4(path.join(mediaDir('the_one'), 'clip.mp4'), { w: 720, h: 1280 });
  const base = { brand: 'the_one', channel: 'xiaohongshu', type: 'reel', time: '12:30', days: [1, 2, 3, 4, 5, 6, 7], month };
  await assert.rejects(planner.create(base), /đang tắt/);
  planner.updateBrand('the_one', { channels: { xiaohongshu: { on: true } } });
  const plan = await planner.create(base);
  assert.strictEqual(plan.items.length, xhs.FALLBACKS.length, 'không có AI: chỉ soạn số bài mẫu khác nhau, không lặp');
  assert.strictEqual(new Set(plan.items.map((i) => i.title)).size, plan.items.length, 'tiêu đề không trùng');
  for (const it of plan.items) {
    assert.ok(it.title && [...it.title].length <= 20, it.title);
    assert.ok(/[一-鿿]/.test(it.text));
    assert.deepStrictEqual(it.media.map((m) => m.name), ['clip.mp4']);
  }
  // kênh khác không bị thêm tiêu đề
  const fb = await planner.create({ ...base, channel: 'facebook_page', type: 'post' });
  assert.strictEqual(fb.items[0].title, undefined);
});

test('duyệt kế hoạch 小红书: bài vi phạm nặng bị chặn, sửa xong mới duyệt được; bài lên lịch giữ tiêu đề', async () => {
  const db = load();
  const plan = db.plans.find((p) => p.channel === 'xiaohongshu');
  const it0 = plan.items[0];
  const clean = it0.text;
  planner.editItem(plan.id, it0.id, { text: clean + '\n加微信 abc123' });
  assert.throws(() => planner.approve(plan.id), /vi phạm nặng[\s\S]*Dẫn khách ra ngoài/);
  assert.strictEqual(plan.status, 'pending', 'chưa duyệt gì');
  planner.editItem(plan.id, it0.id, { title: '一二三四五六七八九十一二三四五六七八九十一', text: clean });
  assert.throws(() => planner.approve(plan.id), /Tiêu đề dài/);
  planner.editItem(plan.id, it0.id, { title: '到店预约3步搞定' });
  const n = planner.approve(plan.id);
  assert.strictEqual(n, xhs.FALLBACKS.length);
  const post = db.posts.find((p) => p.planId === plan.id && p.scheduledAt === it0.at); // mẫu lặp chủ đề nên tìm theo giờ
  assert.strictEqual(post.title, '到店预约3步搞定');
  assert.strictEqual(post.status, 'scheduled');
});

test('đến giờ: bài 小红书 không tự đăng giả mà chuyển sang chờ đăng tay (cả khi đang chạy thử); đánh dấu đã hẹn/đã đăng', async () => {
  const db = load();
  const post = db.posts.find((p) => p.channel === 'xiaohongshu');
  post.scheduledAt = new Date(Date.now() - 1000).toISOString();
  assert.strictEqual(db.settings.dryRun, true);
  await engine.runAgent('content', 'manual');
  assert.strictEqual(post.status, 'awaiting_manual');
  assert.ok(db.actions.some((a) => /Đến giờ đăng .*Xiaohongshu/.test(a.text)));
  await engine.runAgent('content', 'manual');
  assert.strictEqual(db.actions.filter((a) => /Đến giờ đăng .*Xiaohongshu/.test(a.text)).length, 1, 'chỉ nhắc 1 lần');
  assert.throws(() => xhs.markPost(post.id, 'bay_len_troi'), /không hợp lệ/);
  xhs.markPost(post.id, 'external_scheduled');
  assert.strictEqual(post.status, 'external_scheduled');
  xhs.markPost(post.id, 'published', 'https://www.xiaohongshu.com/explore/abc');
  assert.deepStrictEqual([post.status, post.manual, post.live, post.url], ['published', true, false, 'https://www.xiaohongshu.com/explore/abc']);
  assert.throws(() => xhs.markPost(post.id, 'external_scheduled'), /đã đăng rồi/);
  xhs.markPost(post.id, 'reset');
  assert.strictEqual(post.status, 'scheduled');
  const fbPost = { id: 'fb1', channel: 'facebook_page', brand: 'the_one', topic: 'x', text: 'y', scheduledAt: new Date().toISOString(), status: 'scheduled' };
  db.posts.push(fbPost);
  assert.throws(() => xhs.markPost('fb1', 'published'), /Chỉ dùng cho bài/);
  // file đang dùng cho bài chờ đăng tay vẫn được tính là đã dùng
  post.status = 'awaiting_manual';
  assert.ok(media.list('the_one').find((f) => f.name === 'clip.mp4').uses >= 1);
});

test('gói đăng: tiêu đề, nội dung, hashtag, file + thông số video, giờ Bắc Kinh, cảnh báo độ phân giải', () => {
  const db = load();
  const post = db.posts.find((p) => p.channel === 'xiaohongshu');
  post.scheduledAt = '2026-10-17T04:30:00.000Z';
  const pkg = xhs.buildPackage(post);
  assert.strictEqual(pkg.title, post.title);
  assert.strictEqual(pkg.scheduledBeijing, '2026-10-17 12:30');
  assert.strictEqual(pkg.scheduledVietnam, '2026-10-17 11:30');
  assert.ok(pkg.body && !pkg.body.includes('#越南做头发'), 'hashtag tách riêng');
  assert.ok(pkg.hashtags.includes('#越南做头发'));
  assert.strictEqual(pkg.address, planner.brands().the_one.addressZh);
  assert.strictEqual(pkg.media[0].info.width, 720);
  assert.strictEqual(pkg.media[0].missing, false);
  assert.ok(pkg.lint.issues.some((i) => i.code === 'resolution'));
  assert.ok(pkg.steps.some((s) => /定时发布/.test(s)));
  assert.throws(() => xhs.buildPackage({ ...post, channel: 'facebook_page' }), /Chỉ tạo gói đăng/);
  // file bị xóa → báo thiếu, không ném lỗi
  const gone = xhs.buildPackage({ ...post, media: [{ name: 'khong-co.mp4', type: 'video' }] });
  assert.strictEqual(gone.media[0].missing, true);
});

test('Gemini: xem video → lưu kết quả, AI dùng làm gợi ý, cảnh báo quyền hình ảnh/watermark', async () => {
  await assert.rejects(videoIntel.analyze('the_one', 'clip.mp4'), /GEMINI_API_KEY/);
  process.env.GEMINI_API_KEY = 'KEY';
  const real = global.fetch;
  const seen = [];
  global.fetch = async (url, init) => {
    seen.push({ url: String(url), key: init.headers['x-goog-api-key'], body: init.body });
    const text = JSON.stringify({ summary: 'Khách nhuộm nâu hạt dẻ, có cảnh trước', kind: 'nhuom', beforeAfter: true, colorBefore: 'nâu đen', colorAfter: 'nâu hạt dẻ', faces: 2, watermark: 'TikTok @abc', concerns: ['2 người hiện mặt'] });
    return { ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }) };
  };
  try {
    const meta = await videoIntel.analyze('the_one', 'clip.mp4');
    assert.strictEqual(meta.kind, 'nhuom');
    assert.strictEqual(meta.faces, 2);
    assert.strictEqual(seen.length, 1);
    assert.strictEqual(seen[0].key, 'KEY', 'khóa gửi qua header, không nằm trên URL');
    assert.ok(!seen[0].url.includes('KEY'));
    assert.ok(JSON.parse(seen[0].body).contents[0].parts[0].inline_data, 'file nhỏ gửi inline');
  } finally { global.fetch = real; }
  assert.strictEqual(media.hint('the_one', { name: 'clip.mp4' }), 'Khách nhuộm nâu hạt dẻ, có cảnh trước');
  const list = media.list('the_one').find((f) => f.name === 'clip.mp4');
  assert.strictEqual(list.meta.kind, 'nhuom');
  assert.strictEqual(list.consent, false);
  const codes = (set) => xhs.lintParts('the_one', 'T', '内容\n私信「预约」\n#越南做头发', set).issues.map((i) => i.code);
  const set = [{ name: 'clip.mp4', type: 'video' }];
  assert.ok(codes(set).includes('consent') && codes(set).includes('watermark'));
  media.setConsent('the_one', 'clip.mp4', true);
  assert.ok(!codes(set).includes('consent'), 'có xác nhận thì hết cảnh báo');
});

test('Gemini: hết hạn mức thì báo rõ và dừng hàng loạt; JSON hỏng thì báo lỗi; khóa không lộ ra giao diện', async () => {
  const real = global.fetch;
  let calls = 0;
  global.fetch = async () => { calls++; return { ok: false, status: 429, json: async () => ({ error: { message: 'quota' } }) }; };
  try {
    await assert.rejects(videoIntel.analyze('the_one', 'clip.mp4'), /hết hạn mức/);
    fakeMp4(path.join(mediaDir('the_one'), 'clip2.mp4'));
    fakeMp4(path.join(mediaDir('the_one'), 'clip3.mp4'));
    calls = 0;
    const r = await videoIntel.analyzeMissing('the_one');
    assert.strictEqual(calls, 1, 'dừng ngay sau lần đầu hết hạn mức');
    assert.match(r.stopped, /hết hạn mức/);
    global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'không phải json' }] } }] }) });
    await assert.rejects(videoIntel.analyze('the_one', 'clip2.mp4'), /không đọc được/);
  } finally { global.fetch = real; }
  assert.strictEqual(videoIntel.clean({ faces: 999, kind: 'la', concerns: 'x' }).faces, 50);
  assert.strictEqual(videoIntel.clean({ kind: 'la' }).kind, 'khac');
});

test('API: gói đăng, đánh dấu thủ công, kiểm tra tuân thủ, xác nhận người trong video, phân tích khi chưa có khóa', async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, p, body) => { const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json() }; };
  try {
    const db = load();
    db.settings.ai.enabled = false; // khóa Gemini trong test là khóa giả (chỉ cho phần xem video): không gọi AI viết bài
    const post = db.posts.find((p) => p.channel === 'xiaohongshu');
    post.status = 'scheduled';
    const pk = await call('GET', `/api/posts/${post.id}/package`);
    assert.strictEqual(pk.status, 200);
    assert.strictEqual(pk.json.title, post.title);
    assert.strictEqual((await call('GET', '/api/posts/khong_co/package')).status, 404);

    const mk = await call('POST', `/api/posts/${post.id}/manual`, { action: 'external_scheduled' });
    assert.strictEqual(mk.status, 200);
    assert.strictEqual(mk.json.posts.find((p) => p.id === post.id).status, 'external_scheduled');
    assert.strictEqual((await call('POST', `/api/posts/${post.id}/manual`, { action: 'xyz' })).status, 400);

    const l = await call('POST', '/api/xhs/lint', { brand: 'the_one', title: '', text: '加微信', media: ['clip.mp4'] });
    assert.strictEqual(l.status, 200);
    assert.strictEqual(l.json.blocked, true);
    assert.strictEqual((await call('POST', '/api/xhs/lint', { brand: 'the_one', title: 'a', text: 'b', media: ['khong-co.mp4'] })).status, 400);

    // bài lẻ 小红书: AI (mẫu) soạn tiếng Trung, gắn file, duyệt bị chặn khi vi phạm
    const np = await call('POST', '/api/posts', { brand: 'the_one', channel: 'xiaohongshu', topic: 'Nhuộm nâu', media: ['clip.mp4'], scheduledAt: new Date(Date.now() + 864e5).toISOString() });
    assert.strictEqual(np.status, 200);
    const created = np.json.posts[0];
    assert.ok(created.title && /[一-鿿]/.test(created.text));
    assert.deepStrictEqual(created.media.map((m) => m.name), ['clip.mp4']);
    assert.ok(created.lint, 'có kết quả kiểm tra kèm theo');
    const ap = np.json.approvals.find((a) => a.payload.postId === created.id);
    assert.ok(ap.lint && ap.postTitle);
    db.posts.find((p) => p.id === created.id).text += '\n微信 abc';
    const bad = await call('POST', `/api/approvals/${ap.id}/approve`);
    assert.strictEqual(bad.status, 400);
    assert.match(bad.json.error, /vi phạm nặng/);

    const an = await call('POST', '/api/media/analyze', { brand: 'the_one', name: 'clip.mp4' });
    assert.strictEqual(an.status, 400);
    assert.match(an.json.error, /GEMINI_API_KEY/);
    const cs = await call('POST', '/api/media/consent', { brand: 'the_one', name: 'clip.mp4', value: false });
    assert.strictEqual(cs.status, 200);
    assert.strictEqual(cs.json.env.gemini, true, 'env.gemini chỉ là true/false, không lộ khóa');
    assert.ok(!JSON.stringify(cs.json).includes('KEY'));
    assert.strictEqual((await call('POST', '/api/media/consent', { brand: 'the_one', name: 'khong-co.mp4', value: true })).status, 400);
    assert.strictEqual(cs.json.channels.find((c) => c.id === 'xiaohongshu').manual, true);
  } finally { server.close(); delete process.env.GEMINI_API_KEY; }
});

test('nhận diện quán: bài tự có dòng "tên quán｜khu vực · khẩu hiệu" ở đầu và hashtag thương hiệu/khu vực; thiếu thì cảnh báo', () => {
  const brand = planner.brands().the_one;
  assert.strictEqual(brand.locationZh, '胡志明市三郡');
  assert.strictEqual(brand.taglineZh, 'MORE BEAUTIFUL EVERY VISIT');
  const text = xhs.compose('正文一行\n私信「预约」', ['#越南染发'], brand);
  const lines = text.split('\n');
  assert.strictEqual(lines[0], '🏠 The One Hair Salon｜胡志明市三郡 · MORE BEAUTIFUL EVERY VISIT');
  assert.ok(text.includes(brand.addressZh), 'địa chỉ vẫn ở cuối');
  const tags = lines[lines.length - 1].split(' ');
  assert.deepStrictEqual(tags, ['#越南染发', '#TheOneHairSalon', '#胡志明市美发', '#胡志明市三郡']);
  assert.ok(tags.length <= 10);
  // bài đã nói tên quán thì không chèn dòng nhận diện lần nữa
  const again = xhs.compose('The One Hair Salon 欢迎你\n私信「预约」', [], brand);
  assert.ok(!again.includes('MORE BEAUTIFUL'));
  // thương hiệu chưa khai báo khu vực: không chèn gì
  const dark = planner.brands().dark_hair;
  assert.strictEqual(xhs.compose('正文', ['#a'], dark).split('\n')[0], '正文');
  // mẫu có sẵn đều mở đầu bằng dòng nhận diện
  for (let i = 0; i < xhs.FALLBACKS.length; i++) assert.ok(xhs.fallbackItem(i, brand).text.startsWith('🏠 The One Hair Salon｜胡志明市三郡'));
  // thiếu tên quán / khu vực → cảnh báo; đủ thì hết
  const codes = (t) => xhs.lintParts('the_one', '标题', t, []).issues.map((i) => i.code);
  assert.ok(codes('内容\n私信「预约」\n#越南做头发').includes('no_brand'));
  assert.ok(codes('内容\n私信「预约」\n#越南做头发').includes('no_location'));
  assert.ok(!codes(text).includes('no_brand') && !codes(text).includes('no_location'));
  assert.ok(!codes('The One Hair Salon 在胡志明市\n私信「预约」\n#越南做头发').includes('no_brand'));
});
