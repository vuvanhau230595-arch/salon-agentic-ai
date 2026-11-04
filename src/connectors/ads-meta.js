// Quảng cáo Facebook — Meta Marketing API (thật).
// Cần META_ACCESS_TOKEN; tài khoản quảng cáo theo thương hiệu. "Tin nhắn" = hành động
// onsite_conversion.messaging_conversation_started_7d trong insights.
// Chỉ 1 + 3 lượt gọi cho cả tài khoản (insights cấp chiến dịch), không gọi từng chiến dịch.
const meta = require('../meta');

const MSG = 'onsite_conversion.messaging_conversation_started_7d';

// Đối tượng nhắm sao chép từ nhóm quảng cáo cũ có thể chứa trường Meta đã gỡ (targeting_optimization — Meta từ chối "Trường ... đã bị gỡ")
// → bỏ trường đó; nhóm mới chưa khai báo Advantage+ audience thì tắt (giữ đúng đối tượng đã học, Meta yêu cầu khai báo rõ).
const DROPPED_TARGETING = ['targeting_optimization', 'targeting_relaxation_types'];
// Nút kêu gọi "Gửi tin nhắn" cho quảng cáo tin nhắn dựng từ bài có sẵn (click-to-Messenger).
// Đã thử thật ngày 15/10/2026: object_story_id + call_to_action được Meta nhận; asset_feed_spec thì đòi thêm video/ảnh nên không dùng.
const MESSAGE_CTA = { type: 'MESSAGE_PAGE', value: { app_destination: 'MESSENGER' } };
function cleanTargeting(t) {
  const out = { ...(t || {}) };
  for (const k of DROPPED_TARGETING) delete out[k];
  if (!out.targeting_automation) out.targeting_automation = { advantage_audience: 0 };
  // age_range (độ tuổi "gợi ý" của Advantage+) chỉ hợp lệ khi bật Advantage+ audience; tắt thì đổi sang age_min/age_max
  // (Meta từ chối "targeting_automation must be enabled to use the field age_range" — gặp thật 18/10/2026)
  if (Number(out.targeting_automation.advantage_audience) !== 1 && out.age_range) {
    const [lo, hi] = Array.isArray(out.age_range) ? out.age_range : [];
    if (out.age_min === undefined && lo) out.age_min = lo;
    if (out.age_max === undefined && hi) out.age_max = hi;
    delete out.age_range;
  }
  return out;
}

function msgsOf(actions) {
  return (actions || []).filter((a) => a.action_type === MSG).reduce((s, a) => s + Number(a.value || 0), 0);
}

// Trả về Map campaign_id → { spend, msgs } cho 1 khoảng thời gian
async function insights(accountId, preset) {
  const rows = await meta.all(`/${meta.adAccount(accountId)}/insights`, {
    params: { level: 'campaign', date_preset: preset, fields: 'campaign_id,spend,actions', limit: 500 },
  });
  const map = new Map();
  for (const r of rows) {
    const cur = map.get(r.campaign_id) || { spend: 0, msgs: 0 };
    cur.spend += Math.round(Number(r.spend || 0));
    cur.msgs += msgsOf(r.actions);
    map.set(r.campaign_id, cur);
  }
  return map;
}

module.exports = {
  mode: 'live',
  label: 'Facebook Ads (Meta API)',
  // accountId: tài khoản quảng cáo của 1 thương hiệu
  async list(accountId) {
    const campaigns = await meta.all(`/${meta.adAccount(accountId)}/campaigns`, {
      params: { fields: 'id,name,effective_status,daily_budget,objective', effective_status: ['ACTIVE', 'PAUSED'], limit: 200 },
    });
    // Ngân sách đặt ở cấp nhóm quảng cáo (phần lớn tài khoản thật): cộng ngân sách các nhóm đang chạy. Lỗi thì bỏ qua, không làm hỏng việc đọc chiến dịch.
    const setBudget = new Map();
    try {
      const sets = await meta.all(`/${meta.adAccount(accountId)}/adsets`, { params: { fields: 'campaign_id,daily_budget,effective_status', effective_status: ['ACTIVE'], limit: 500 } });
      for (const a of sets) setBudget.set(a.campaign_id, (setBudget.get(a.campaign_id) || 0) + Number(a.daily_budget || 0));
    } catch { /* giữ ngân sách cấp chiến dịch */ }
    const [today, d7, month] = await Promise.all([insights(accountId, 'today'), insights(accountId, 'last_7d'), insights(accountId, 'this_month')]);
    const zero = { spend: 0, msgs: 0 };
    return campaigns.map((c) => ({
      accountId: String(accountId),
      id: c.id,
      name: c.name,
      status: c.effective_status,
      objective: c.objective || '',
      // daily_budget chỉ có khi đặt ngân sách ở cấp chiến dịch (CBO); VND không có số lẻ
      budget: Number(c.daily_budget || 0),
      budgetLevel: Number(c.daily_budget || 0) ? 'campaign' : (setBudget.get(c.id) ? 'adset' : 'unknown'),
      budgetTotal: Number(c.daily_budget || 0) || setBudget.get(c.id) || 0,
      today: today.get(c.id) || { ...zero },
      d7: d7.get(c.id) || { ...zero },
      month: month.get(c.id) || { ...zero },
    }));
  },
  // Mọi nhóm quảng cáo có chi tiêu 30 ngày qua của 1 tài khoản, kèm đối tượng nhắm và kết quả (để học đối tượng hiệu quả)
  async audiences(accountId) {
    const acc = meta.adAccount(accountId);
    const sets = await meta.all(`/${acc}/adsets`, { params: { fields: 'id,name,effective_status,optimization_goal,destination_type,targeting,campaign{name}', limit: 200 } });
    const rows = await meta.all(`/${acc}/insights`, { params: { level: 'adset', date_preset: 'last_30d', fields: 'adset_id,spend,actions', limit: 500 } });
    const stat = new Map(rows.map((r) => [r.adset_id, { spend: Math.round(Number(r.spend || 0)), msgs: msgsOf(r.actions) }]));
    return sets.map((a) => ({
      adsetId: a.id, name: a.name, campaign: (a.campaign && a.campaign.name) || '', status: a.effective_status,
      goal: a.optimization_goal, destination: a.destination_type, targeting: a.targeting || {}, ...(stat.get(a.id) || { spend: 0, msgs: 0 }),
    })).filter((a) => a.spend > 0);
  },
  // Mã bài viết (pageId_postId) đã từng được dùng làm quảng cáo trong tài khoản — để không đề xuất lại bài đã chạy
  async promotedStories(accountId) {
    const rows = await meta.all(`/${meta.adAccount(accountId)}/ads`, { params: { fields: 'creative{effective_object_story_id}', limit: 200 } });
    return [...new Set(rows.map((a) => a.creative && a.creative.effective_object_story_id).filter(Boolean))];
  },
  // Các nhóm quảng cáo đang chạy của 1 chiến dịch, kèm ngân sách ngày (chiến dịch đặt ngân sách ở cấp nhóm)
  async activeAdsets(campaignId) {
    const rows = await meta.all(`/${campaignId}/adsets`, { params: { fields: 'id,name,effective_status,daily_budget', limit: 50 } });
    return rows.filter((a) => a.effective_status === 'ACTIVE' && Number(a.daily_budget) > 0)
      .map((a) => ({ id: a.id, name: a.name, budget: Number(a.daily_budget) }));
  },
  // Mẫu nhắm đối tượng lấy từ nhóm quảng cáo đang chạy của chiến dịch tốt nhất
  cleanTargeting,
  async adsetTemplate(campaignId) {
    const rows = await meta.all(`/${campaignId}/adsets`, { params: { fields: 'id,effective_status,targeting', limit: 20 } });
    const a = rows.find((x) => x.effective_status === 'ACTIVE' && x.targeting);
    return a ? { targeting: a.targeting } : null;
  },
  // Dựng quảng cáo thử từ 1 bài đã đăng: chiến dịch → nhóm → mẫu quảng cáo → quảng cáo, TẤT CẢ ở trạng thái tạm dừng,
  // rồi mới bật lần lượt (chiến dịch bật sau cùng). Lỗi giữa chừng thì xóa phần đã tạo, không để rác trong tài khoản.
  async createTest({ accountId, name, pageId, objectStoryId, budget, days, targeting }) {
    const acc = meta.adAccount(accountId);
    targeting = cleanTargeting(targeting);
    const made = [];
    const mk = async (path, params) => { const r = await meta.call(path, { method: 'POST', params }); made.push(r.id); return r.id; };
    try {
      const end = new Date(Date.now() + days * 864e5).toISOString();
      const campaign = await mk(`/${acc}/campaigns`, { name, objective: 'OUTCOME_ENGAGEMENT', status: 'PAUSED', special_ad_categories: [], is_adset_budget_sharing_enabled: false });
      const adset = await mk(`/${acc}/adsets`, {
        name, campaign_id: campaign, daily_budget: Math.round(budget), billing_event: 'IMPRESSIONS',
        optimization_goal: 'CONVERSATIONS', destination_type: 'MESSENGER', bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
        promoted_object: { page_id: pageId }, targeting, end_time: end, status: 'PAUSED',
      });
      // Quảng cáo tin nhắn từ bài có sẵn: phải gắn nút "Gửi tin nhắn" (MESSAGE_PAGE → Messenger) vào bài, nếu không Meta từ chối
      // "Nội dung quảng cáo không tương thích với mục tiêu". Cấu trúc này lấy đúng theo các quảng cáo tin nhắn đang chạy trong tài khoản.
      const creative = await mk(`/${acc}/adcreatives`, { name, object_story_id: objectStoryId, call_to_action: MESSAGE_CTA });
      const ad = await mk(`/${acc}/ads`, { name, adset_id: adset, creative: { creative_id: creative }, status: 'PAUSED' });
      await meta.call(`/${ad}`, { method: 'POST', params: { status: 'ACTIVE' } });
      await meta.call(`/${adset}`, { method: 'POST', params: { status: 'ACTIVE' } });
      await meta.call(`/${campaign}`, { method: 'POST', params: { status: 'ACTIVE' } });
      return { campaignId: campaign, adsetId: adset, adId: ad };
    } catch (e) {
      for (const id of made.reverse()) { try { await meta.call(`/${id}`, { method: 'DELETE' }); } catch {} }
      throw e;
    }
  },
  // Chi tiêu + tin nhắn theo ngày. campaignId: chỉ 1 chiến dịch; không có thì cả tài khoản (gộp theo ngày, chỉ chiến dịch có chi tiêu).
  async daily(accountId, { days = 30, campaignId } = {}) {
    const path = campaignId ? `/${campaignId}/insights` : `/${meta.adAccount(accountId)}/insights`;
    const until = new Date();
    const since = new Date(until.getTime() - (days - 1) * 864e5);
    const f = (d) => d.toISOString().slice(0, 10);
    const rows = await meta.all(path, { params: { time_range: { since: f(since), until: f(until) }, time_increment: 1, fields: 'spend,actions,date_start', limit: 100 } });
    return rows.map((r) => ({ date: r.date_start, spend: Math.round(Number(r.spend || 0)), msgs: msgsOf(r.actions) })).sort((a, b) => a.date.localeCompare(b.date));
  },
  // Danh sách nhóm quảng cáo của 1 chiến dịch (cả tắt/bật) để xem chi tiết
  async adsets(campaignId) {
    const rows = await meta.all(`/${campaignId}/adsets`, { params: { fields: 'id,name,effective_status,daily_budget,optimization_goal', limit: 100 } });
    return rows.map((a) => ({ id: a.id, name: a.name, status: a.effective_status, budget: Number(a.daily_budget || 0), goal: a.optimization_goal || '' }));
  },
  // Chi tiết 1 chiến dịch để Sếp xem: thông tin chiến dịch + từng quảng cáo (ảnh/thumbnail video, nội dung bài, link xem, nhóm, số liệu 7 ngày)
  async creatives(campaignId) {
    const campaign = await meta.call(`/${campaignId}`, { params: { fields: 'id,name,objective,effective_status,created_time,start_time,stop_time,daily_budget,lifetime_budget' } });
    const rows = await meta.all(`/${campaignId}/ads`, { params: { fields: 'id,name,effective_status,created_time,adset{id,name,daily_budget,optimization_goal,destination_type},creative{id,effective_object_story_id,thumbnail_url,image_url,body,title,object_type,video_id,instagram_permalink_url},preview_shareable_link', limit: 50 } });
    let stat = new Map();
    try {
      const ins = await meta.all(`/${campaignId}/insights`, { params: { level: 'ad', date_preset: 'last_7d', fields: 'ad_id,spend,impressions,reach,clicks,actions', limit: 200 } });
      stat = new Map(ins.map((r) => [r.ad_id, { spend: Math.round(Number(r.spend || 0)), msgs: msgsOf(r.actions), impressions: Number(r.impressions || 0), reach: Number(r.reach || 0), clicks: Number(r.clicks || 0) }]));
    } catch { /* không có số liệu thì vẫn hiện bài */ }
    // Bài gốc trên Page (ảnh to, nội dung, link): đọc bằng Page token; không đọc được thì dùng thumbnail của mẫu quảng cáo
    const social = require('./social');
    const posts = new Map();
    for (const a of rows) {
      const sid = a.creative && a.creative.effective_object_story_id;
      if (!sid || posts.has(sid)) continue;
      const pageId = String(sid).split('_')[0];
      try {
        const p = await meta.call(`/${sid}`, { token: await social.pageToken(pageId), params: { fields: 'full_picture,message,permalink_url,created_time,attachments{media_type,media{image{src}},url}' } });
        const att = (((p.attachments || {}).data) || [])[0] || {};
        posts.set(sid, { image: p.full_picture || (att.media && att.media.image && att.media.image.src) || '', text: p.message || '', link: p.permalink_url || '', createdAt: p.created_time || '', mediaType: att.media_type || '' });
      } catch { posts.set(sid, null); }
    }
    const zero = { spend: 0, msgs: 0, impressions: 0, reach: 0, clicks: 0 };
    return {
      campaign: { id: campaign.id, name: campaign.name, objective: campaign.objective || '', status: campaign.effective_status, createdAt: campaign.created_time || '', startAt: campaign.start_time || '', stopAt: campaign.stop_time || '', budget: Number(campaign.daily_budget || 0), lifetimeBudget: Number(campaign.lifetime_budget || 0) },
      ads: rows.map((a) => {
        const cr = a.creative || {};
        const post = posts.get(cr.effective_object_story_id) || null;
        const s = stat.get(a.id) || zero;
        return {
          id: a.id, name: a.name, status: a.effective_status, createdAt: a.created_time || '',
          adset: a.adset ? { id: a.adset.id, name: a.adset.name, budget: Number(a.adset.daily_budget || 0), goal: a.adset.optimization_goal || '', destination: a.adset.destination_type || '' } : null,
          image: (post && post.image) || cr.image_url || cr.thumbnail_url || '',
          thumb: cr.thumbnail_url || cr.image_url || (post && post.image) || '',
          video: cr.object_type === 'VIDEO' || !!cr.video_id || (post && post.mediaType === 'video'),
          text: (post && post.text) || cr.body || '', title: cr.title || '',
          link: (post && post.link) || a.preview_shareable_link || '', preview: a.preview_shareable_link || '', instagram: cr.instagram_permalink_url || '',
          postId: cr.effective_object_story_id || '', postedAt: (post && post.createdAt) || '',
          spend: s.spend, msgs: s.msgs, impressions: s.impressions, reach: s.reach, clicks: s.clicks, cpl: s.msgs ? Math.round(s.spend / s.msgs) : null,
        };
      }),
    };
  },
  async setStatus(id, status) {
    if (!['ACTIVE', 'PAUSED'].includes(status)) throw new Error('Trạng thái không hợp lệ');
    await meta.call(`/${id}`, { method: 'POST', params: { status } });
  },
  async pause(id) { await meta.call(`/${id}`, { method: 'POST', params: { status: 'PAUSED' } }); },
  async setBudget(id, amount) { await meta.call(`/${id}`, { method: 'POST', params: { daily_budget: Math.round(amount) } }); },
};
