// Quảng cáo Facebook — chế độ mẫu (số liệu giống màn hình demo)
const { load, save } = require('../db');

const SEED = [
  { id: 'c1', name: 'Nhuộm 30% - đắt', budget: 500000, today: { spend: 400000, msgs: 5 }, d7: { spend: 400000, msgs: 5 }, month: { spend: 400000, msgs: 5 } },
  { id: 'c2', name: 'Uốn - không KQ',  budget: 300000, today: { spend: 250000, msgs: 0 }, d7: { spend: 250000, msgs: 0 }, month: { spend: 250000, msgs: 0 } },
  { id: 'c3', name: 'Nối mi - rẻ',     budget: 300000, today: { spend: 0, msgs: 0 },      d7: { spend: 600000, msgs: 40 }, month: { spend: 350000, msgs: 25 } },
];

module.exports = {
  mode: 'mock',
  label: 'Facebook Ads (mẫu)',
  async list() {
    const db = load();
    if (!db.seeded) {
      db.campaigns = SEED.map((c) => ({ ...c, status: 'ACTIVE' }));
      db.seeded = true;
      db.demo = true; // đánh dấu dữ liệu mẫu để dọn khi chuyển sang kết nối thật
      save();
    }
    return db.campaigns;
  },
  async pause(id) {
    const c = load().campaigns.find((x) => x.id === id);
    if (c) c.status = 'PAUSED';
    save();
  },
  async activeAdsets() { return []; },
  async promotedStories() { return []; },
  async daily() { return []; },        // chế độ mẫu không có số liệu theo ngày
  async adsets() { return []; },
  async creatives(id) { const c = load().campaigns.find((x) => x.id === id); return { campaign: c ? { id: c.id, name: c.name, objective: c.objective || '', status: c.status, createdAt: '', startAt: '', stopAt: '', budget: c.budget || 0, lifetimeBudget: 0 } : null, ads: [], demo: true }; },
  async setStatus(id, status) {
    const c = load().campaigns.find((x) => x.id === id);
    if (c) c.status = status;
    save();
  },
  async audiences() { return []; },
  async adsetTemplate() { return { targeting: { geo_locations: { countries: ['VN'] } } }; },
  async createTest({ name, budget }) {
    const db = load();
    const id = 'test_' + (db.campaigns.length + 1);
    db.campaigns.push({ id, name, status: 'ACTIVE', budget, objective: 'OUTCOME_ENGAGEMENT', today: { spend: 0, msgs: 0 }, d7: { spend: 0, msgs: 0 }, month: { spend: 0, msgs: 0 } });
    save();
    return { campaignId: id, adsetId: id + '_s', adId: id + '_a' };
  },
  async setBudget(id, amount) {
    const c = load().campaigns.find((x) => x.id === id);
    if (c) c.budget = amount;
    save();
  },
  async reset() {
    const db = load();
    db.campaigns = SEED.map((c) => ({ ...c, status: 'ACTIVE' }));
    save();
  },
};
