// Đường dẫn liên quan TikTok: đăng nhập OAuth, ngắt kết nối, trang Chính sách riêng tư / Điều khoản (công khai).
const tiktok = require('./connectors/tiktok');
const planner = require('./planner');
const engine = require('./engine');
const { load, save } = require('./db');

const PRIVACY = ['SELF_ONLY', 'MUTUAL_FOLLOW_FRIENDS', 'FOLLOWER_OF_CREATOR', 'PUBLIC_TO_EVERYONE'];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function page(res, code, title, bodyHtml) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' });
  res.end(`<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{font:16px/1.6 system-ui,"Segoe UI",sans-serif;max-width:760px;margin:32px auto;padding:0 18px;color:#1d1b19}h1{font-size:24px}h2{font-size:18px;margin-top:26px}a{color:#c8663a}.box{background:#faf8f5;border:1px solid #e8e3dc;border-radius:10px;padding:14px 18px}</style></head><body>${bodyHtml}</body></html>`);
}

// ---- Trang công khai (TikTok yêu cầu địa chỉ Điều khoản và Chính sách riêng tư truy cập được không cần đăng nhập) ----
const owner = () => process.env.BUSINESS_NAME || 'Hệ thống salon The One · Dark Hair · Mishang (TP.HCM)';
const contact = () => process.env.CONTACT_EMAIL || '';

function privacyHtml() {
  const c = contact();
  return `<h1>Chính sách riêng tư / Privacy Policy</h1>
<p class="box">Công cụ nội bộ của <b>${esc(owner())}</b> dùng để quản lý các tài khoản mạng xã hội <b>của chính chúng tôi</b> (soạn lịch, đăng video, theo dõi quảng cáo). Đây không phải dịch vụ dành cho công chúng.<br>An internal tool used by <b>${esc(owner())}</b> to manage <b>our own</b> social media accounts. It is not a public service.</p>
<h2>Dữ liệu chúng tôi thu thập / Data we collect</h2>
<ul><li>Khi quản trị viên đăng nhập TikTok để cấp quyền: mã định danh tài khoản (open_id), tên hiển thị, tên người dùng, và mã truy cập (access token / refresh token) do TikTok cấp.</li>
<li>Khi quản trị viên đăng nhập Google để kết nối kênh YouTube: mã kênh, tên kênh và token do Google cấp (quyền youtube.upload, youtube.readonly). / When an administrator connects a YouTube channel via Google: the channel ID, channel title and the tokens issued by Google.</li>
<li>Nội dung (video, chú thích) do chính chúng tôi soạn và duyệt để đăng.</li>
<li>When an administrator authorizes via TikTok Login: the account identifier (open_id), display name, username, and the access/refresh tokens issued by TikTok. Content (videos, captions) is created and approved by us.</li></ul>
<h2>Mục đích sử dụng / How we use it</h2>
<p>Chỉ để đăng video lên đúng tài khoản TikTok đã cấp quyền, theo lịch và nội dung do quản trị viên duyệt. Không dùng cho quảng cáo nhắm đối tượng, không phân tích hành vi người dùng khác.<br>Only to publish videos to the authorized TikTok account on content the administrator approved. We do not profile other users.</p>
<h2>Lưu trữ và chia sẻ / Storage and sharing</h2>
<p>Token được lưu trong tệp riêng, phân quyền chặt, trên máy chủ do chúng tôi quản lý. Chúng tôi <b>không bán, không chia sẻ</b> dữ liệu này cho bên thứ ba.<br>Tokens are stored in a restricted file on a server we control. We do <b>not sell or share</b> this data with third parties.</p>
<h2>Ngắt kết nối và xóa dữ liệu / Disconnecting and deletion</h2>
<p>Quản trị viên có thể bấm "Ngắt kết nối" trong công cụ (token bị thu hồi tại TikTok và xóa khỏi máy chủ) hoặc gỡ quyền trong cài đặt TikTok. Token còn hiệu lực tối đa 365 ngày nếu không bị thu hồi.<br>An administrator can click "Disconnect" in the tool (the token is revoked at TikTok and deleted from our server) or remove access in TikTok settings.</p>
<h2>Liên hệ / Contact</h2>
<p>${c ? `<a href="mailto:${esc(c)}">${esc(c)}</a>` : 'Liên hệ qua các Fanpage của salon. / Contact us through the salon Facebook pages.'}</p>
<p><a href="/terms">Điều khoản sử dụng / Terms of Service</a></p>`;
}

function termsHtml() {
  const c = contact();
  return `<h1>Điều khoản sử dụng / Terms of Service</h1>
<p class="box">Công cụ này là hệ thống nội bộ của <b>${esc(owner())}</b>. Chỉ quản trị viên được chúng tôi chỉ định mới được sử dụng.<br>This tool is an internal system of <b>${esc(owner())}</b>. Only administrators designated by us may use it.</p>
<h2>1. Phạm vi / Scope</h2>
<p>Công cụ chỉ dùng để đăng và quản lý nội dung trên các tài khoản mạng xã hội thuộc sở hữu hoặc được ủy quyền hợp pháp cho chúng tôi. / The tool is used solely to publish and manage content on social accounts we own or are legitimately authorized to manage.</p>
<h2>2. Trách nhiệm nội dung / Content responsibility</h2>
<p>Mọi nội dung đăng đều do chúng tôi soạn và duyệt trước khi đăng, và phải tuân thủ điều khoản, nguyên tắc cộng đồng của TikTok và pháp luật Việt Nam. / All posted content is created and approved by us before publishing and must comply with TikTok's terms, community guidelines and applicable law.</p>
<h2>3. Quyền truy cập TikTok / TikTok access</h2>
<p>Việc đăng nhập TikTok chỉ cấp quyền đăng video cho tài khoản được chọn. Quyền có thể bị thu hồi bất cứ lúc nào. / TikTok login only grants permission to publish videos for the selected account and can be revoked at any time.</p>
<h2>4. Miễn trừ / Disclaimer</h2>
<p>Công cụ được cung cấp "nguyên trạng", không bảo đảm hoạt động liên tục. Chúng tôi không chịu trách nhiệm khi nền tảng thay đổi hoặc từ chối dịch vụ. / The tool is provided "as is" without warranty of uninterrupted operation.</p>
<h2>Liên hệ / Contact</h2>
<p>${c ? `<a href="mailto:${esc(c)}">${esc(c)}</a>` : 'Liên hệ qua các Fanpage của salon. / Contact us through the salon Facebook pages.'}</p>
<p><a href="/privacy">Chính sách riêng tư / Privacy Policy</a></p>`;
}

const isPublic = (p) => p === '/privacy' || p === '/terms';
function servePublic(p, res) {
  return p === '/privacy' ? page(res, 200, 'Chính sách riêng tư', privacyHtml()) : page(res, 200, 'Điều khoản sử dụng', termsHtml());
}

// ---- Đăng nhập TikTok (cần đã đăng nhập app: trình duyệt tự gửi thông tin Basic đã nhớ) ----
async function handleAuth(req, res, url) {
  const back = '<p><a href="/#thuonghieu">← Quay lại Thương hiệu &amp; Kênh</a></p>';

  if (req.method === 'GET' && url.pathname === '/auth/tiktok/start') {
    const brand = url.searchParams.get('brand');
    if (!planner.brands()[brand]) return page(res, 400, 'Lỗi', `<h1>Thương hiệu không hợp lệ</h1>${back}`);
    if (!tiktok.configured()) {
      return page(res, 400, 'Chưa cấu hình TikTok', `<h1>Chưa cấu hình TikTok</h1><p>Cần đặt <code>TIKTOK_CLIENT_KEY</code>, <code>TIKTOK_CLIENT_SECRET</code> và <code>PUBLIC_BASE_URL</code> (địa chỉ https của app) trong file <code>.env</code> trên VPS rồi chạy lại.</p>${back}`);
    }
    res.writeHead(302, { location: tiktok.authUrl(tiktok.newState(brand)), 'cache-control': 'no-store' });
    return res.end();
  }

  if (req.method === 'GET' && url.pathname === '/auth/tiktok/callback') {
    const err = url.searchParams.get('error');
    if (err) {
      return page(res, 400, 'TikTok từ chối', `<h1>TikTok không cho phép đăng nhập</h1><p>${esc(url.searchParams.get('error_description') || err)}</p>${back}`);
    }
    const brand = tiktok.consumeState(url.searchParams.get('state') || '');
    const code = url.searchParams.get('code');
    if (!brand || !code) return page(res, 400, 'Phiên không hợp lệ', `<h1>Phiên đăng nhập không hợp lệ hoặc đã hết hạn</h1><p>Hãy bấm lại "Kết nối TikTok" trong app.</p>${back}`);
    try {
      const acc = await tiktok.connect(brand, code);
      engine.log('system', `Đã kết nối TikTok${acc.username ? ' @' + acc.username : ''} cho ${planner.brands()[brand].name} (${tiktok.accounts(brand).length} tài khoản)`);
      save();
    } catch (e) {
      return page(res, 400, 'Kết nối thất bại', `<h1>Không kết nối được TikTok</h1><p>${esc(e.message)}</p>${back}`);
    }
    res.writeHead(302, { location: '/#thuonghieu' });
    return res.end();
  }
  return page(res, 404, 'Không tìm thấy', '<h1>404</h1>');
}

// ---- API ----
// ctx: { readBody, send, stateView }. Trả về true nếu đã xử lý.
async function handleApi(req, res, url, ctx) {
  if (req.method === 'POST' && url.pathname === '/api/tiktok/disconnect') {
    const b = await ctx.readBody(req);
    if (!planner.brands()[b.brand]) { ctx.send(res, 400, { error: 'Thương hiệu không tồn tại' }); return true; }
    // openId: ngắt đúng 1 tài khoản; bỏ trống = ngắt tất cả tài khoản TikTok của thương hiệu
    const openId = b.openId ? String(b.openId) : '';
    const who = openId ? tiktok.accounts(b.brand).find((a) => a.openId === openId) : null;
    if (await tiktok.disconnect(b.brand, openId || undefined)) {
      engine.log('system', `Đã ngắt kết nối TikTok${who && who.username ? ' @' + who.username : openId ? '' : ' (tất cả tài khoản)'} của ${planner.brands()[b.brand].name}`);
      save();
    }
    ctx.send(res, 200, ctx.stateView());
    return true;
  }
  return false;
}

// Phần trạng thái gửi cho giao diện — KHÔNG chứa token
function stateSlice() {
  const s = load().settings;
  const accounts = {};
  for (const id of Object.keys(planner.brands())) accounts[id] = tiktok.summary(id);
  return {
    configured: tiktok.configured(),
    keySet: !!process.env.TIKTOK_CLIENT_KEY,
    secretSet: !!process.env.TIKTOK_CLIENT_SECRET,
    redirectUri: tiktok.redirectUri(),
    mode: s.tiktokMode === 'api' ? 'api' : 'manual',
    privacy: s.tiktokPrivacy,
    aigc: !!s.tiktokAigc,
    accounts,
  };
}

function validateSettings(b, d) {
  if (b.tiktokMode !== undefined) {
    if (!['manual', 'api'].includes(b.tiktokMode)) return 'Cách đăng TikTok không hợp lệ';
    d.settings.tiktokMode = b.tiktokMode;
  }
  if (b.tiktokPrivacy !== undefined) {
    if (!PRIVACY.includes(b.tiktokPrivacy)) return 'Chế độ hiển thị TikTok không hợp lệ';
    d.settings.tiktokPrivacy = b.tiktokPrivacy;
  }
  if (b.tiktokAigc !== undefined) d.settings.tiktokAigc = !!b.tiktokAigc;
  return null;
}

module.exports = { isPublic, servePublic, handleAuth, handleApi, stateSlice, validateSettings, PRIVACY, page, esc };
