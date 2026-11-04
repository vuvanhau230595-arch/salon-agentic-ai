// Thương hiệu của 1 mục duyệt (để lọc/tổng hợp theo thương hiệu). Dùng chung cho giao diện duyệt và trang Thương hiệu.
const engine = require('./engine');

function approvalBrand(d, a) {
  const pl = a.payload || {};
  if (pl.brand) return pl.brand;
  if (a.type === 'post_publish') return (d.posts.find((x) => x.id === pl.postId) || {}).brand || null;
  if (a.type === 'comment_reply') return (d.comments.find((x) => x.id === pl.commentId) || {}).brand || null;
  if (a.type === 'budget_increase') { const c = d.campaigns.find((x) => x.id === pl.campaignId); return c ? engine.brandOf(c) : null; }
  if (a.type === 'message_reply' || a.type === 'lead') return pl.brand || null;
  if (a.type === 'unit_budget') return ((d.settings.adTest.units || []).find((u) => u.id === pl.unitId) || {}).brand || null;
  return null;
}
module.exports = { approvalBrand };
