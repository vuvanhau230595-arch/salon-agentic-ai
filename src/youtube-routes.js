// Đường dẫn liên quan YouTube: đăng nhập OAuth Google (start / callback), trạng thái, ngắt kết nối, nhập khoá OAuth client.
// Quyền: kết nối / ngắt kênh = quyền sửa thương hiệu (như TikTok, đúng thương hiệu được giao); nhập khoá client = cài đặt hệ thống (chủ).
const youtube = require('./connectors/youtube');
const planner = require('./planner');
const engine = require('./engine');
const authz = require('./authz');
const { load, save } = require('./db');
const { page, esc } = require('./tiktok-routes');

const isAuth = (p) => p === '/api/youtube/start' || p === '/api/youtube/callback';
const back = '<p><a href="/#kenh">← Quay lại trang Kênh</a></p>';
const deny = (user, brand) => authz.check(user, 'POST', '/api/youtube/connect', { brand });

// ---- Đăng nhập Google (trình duyệt mở trực tiếp, cần đã đăng nhập app: cookie phiên SameSite=Lax đi kèm khi Google chuyển về) ----
async function handleAuth(req, res, url) {
  if (req.method !== 'GET') return page(res, 405, 'Lỗi', '<h1>405</h1>');

  if (url.pathname === '/api/youtube/start') {
    const brand = url.searchParams.get('brand');
    if (!planner.brands()[brand]) return page(res, 400, 'Lỗi', `<h1>Thương hiệu không hợp lệ</h1>${back}`);
    const d = deny(req.user, brand);
    if (d) return page(res, d.status, 'Không có quyền', `<h1>Không có quyền</h1><p>${esc(d.error)}</p>${back}`);
    if (!youtube.configured()) {
      return page(res, 400, 'Chưa cấu hình YouTube', `<h1>Chưa cấu hình YouTube</h1><p>Cần nhập <b>Client ID</b> và <b>Client secret</b> ở <a href="/#caidat">Cài đặt → Kết nối API → YouTube</a> (hoặc đặt <code>YOUTUBE_CLIENT_ID</code>, <code>YOUTUBE_CLIENT_SECRET</code> trong <code>.env</code>), và <code>PUBLIC_BASE_URL</code> là địa chỉ https của app. Xem HUONG-DAN-YOUTUBE.md.</p>${back}`);
    }
    res.writeHead(302, { location: youtube.authUrl(youtube.newState(brand)), 'cache-control': 'no-store' });
    return res.end();
  }

  // callback: Google trả ?code=…&state=… (hoặc ?error=access_denied khi Sếp bấm Huỷ)
  const err = url.searchParams.get('error');
  if (err) return page(res, 400, 'Google từ chối', `<h1>Google không cho phép kết nối</h1><p>${esc(err === 'access_denied' ? 'Đã huỷ ở bước cấp quyền (hoặc tài khoản Google chưa được thêm vào danh sách người thử của ứng dụng).' : err)}</p>${back}`);
  const brand = youtube.consumeState(url.searchParams.get('state') || '');
  const code = url.searchParams.get('code');
  if (!brand || !code) return page(res, 400, 'Phiên không hợp lệ', `<h1>Phiên đăng nhập không hợp lệ hoặc đã hết hạn</h1><p>Hãy bấm lại "Kết nối YouTube" trong app.</p>${back}`);
  const d = deny(req.user, brand);
  if (d) return page(res, d.status, 'Không có quyền', `<h1>Không có quyền</h1><p>${esc(d.error)}</p>${back}`);
  try {
    const ch = await youtube.connect(brand, code);
    engine.log('system', `Đã kết nối kênh YouTube "${ch.title}" cho ${planner.brands()[brand].name}`, { by: req.user ? req.user.name : 'Sếp', brand });
    save();
  } catch (e) {
    return page(res, 400, 'Kết nối thất bại', `<h1>Không kết nối được YouTube</h1><p>${esc(e.message)}</p>${back}`);
  }
  res.writeHead(302, { location: '/#kenh' });
  return res.end();
}

// ---- API ----
// ctx: { readBody, send, stateView }. Trả về true nếu đã xử lý.
async function handleApi(req, res, url, ctx) {
  const p = url.pathname;
  if (!p.startsWith('/api/youtube/')) return false;
  if (req.method === 'GET' && p === '/api/youtube/status') { ctx.send(res, 200, stateSlice()); return true; }
  if (req.method === 'POST' && p === '/api/youtube/disconnect') {
    const b = await ctx.readBody(req);
    if (!planner.brands()[b.brand]) { ctx.send(res, 400, { error: 'Thương hiệu không tồn tại' }); return true; }
    const was = youtube.summary(b.brand);
    if (await youtube.disconnect(b.brand)) {
      engine.log('system', `Đã ngắt kết nối kênh YouTube${was.title ? ` "${was.title}"` : ''} của ${planner.brands()[b.brand].name}`, { brand: b.brand });
      save();
    }
    ctx.send(res, 200, ctx.stateView());
    return true;
  }
  if (req.method === 'POST' && p === '/api/youtube/keys') {
    const b = await ctx.readBody(req);
    if (youtube.keySource() === 'env') { ctx.send(res, 400, { error: 'Khoá YouTube đang lấy từ YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET trong .env — bỏ 2 dòng đó mới nhập qua web được' }); return true; }
    try { youtube.setClient(b.remove ? '' : b.clientId, b.remove ? '' : b.clientSecret); }
    catch (e) { ctx.send(res, 400, { error: e.message }); return true; }
    // Không ghi giá trị khoá vào nhật ký
    engine.log('system', b.remove ? 'Sếp gỡ khoá OAuth client YouTube' : 'Sếp lưu khoá OAuth client YouTube (Client ID + secret)', { field: 'youtubeKeys', after: b.remove ? 'đã gỡ' : 'đã lưu' });
    save();
    ctx.send(res, 200, ctx.stateView());
    return true;
  }
  return false;
}

// Phần trạng thái gửi cho giao diện — KHÔNG chứa token hay client secret
function stateSlice() {
  const channels = {};
  for (const id of Object.keys(planner.brands())) channels[id] = youtube.summary(id);
  return {
    configured: youtube.configured(),
    keySet: !!youtube.clientId(),
    keySource: youtube.keySource(),
    redirectUri: youtube.redirectUri(),
    privacy: load().settings.youtubePrivacy || 'public',
    channels,
  };
}

function validateSettings(b, d) {
  if (b.youtubePrivacy !== undefined) {
    if (!youtube.PRIVACY.includes(b.youtubePrivacy)) return 'Chế độ hiển thị YouTube không hợp lệ';
    d.settings.youtubePrivacy = b.youtubePrivacy;
  }
  return null;
}

module.exports = { isAuth, handleAuth, handleApi, stateSlice, validateSettings };
