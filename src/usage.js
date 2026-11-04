// Theo dõi lượng AI (token Claude) mỗi agent dùng, để Sếp biết agent nào tốn nhất.
// Gắn vào đúng agent bằng AsyncLocalStorage: mọi lời gọi AI phát sinh trong 1 lần chạy agent đều tính cho agent đó;
// ngoài agent (Sếp bấm "AI viết nháp"...) tính vào "ui". Chỉ lưu SỐ LƯỢNG (lần gọi, token), không lưu nội dung câu hỏi/trả lời.
// Không quy ra tiền: giá phụ thuộc gói/model nên không đoán.
const { AsyncLocalStorage } = require('node:async_hooks');
const { load } = require('./db');

const als = new AsyncLocalStorage();
const withAgent = (id, fn) => als.run({ agent: id }, fn);
const currentAgent = () => (als.getStore() || {}).agent || 'ui';
const dayOf = (t) => new Date(t).toISOString().slice(0, 10);

function record(usage, model, now = Date.now()) {
  const db = load();
  db.aiUsage = db.aiUsage || {};
  const day = (db.aiUsage[dayOf(now)] = db.aiUsage[dayOf(now)] || {});
  const a = (day[currentAgent()] = day[currentAgent()] || { calls: 0, in: 0, out: 0, models: {} });
  a.calls++;
  a.in += Number((usage || {}).input_tokens) || 0;
  a.out += Number((usage || {}).output_tokens) || 0;
  a.models[model] = (a.models[model] || 0) + 1;
  for (const d of Object.keys(db.aiUsage)) if (d < dayOf(now - 120 * 864e5)) delete db.aiUsage[d]; // giữ 120 ngày
}

// Tổng theo agent trong n ngày gần nhất
function totals(days, now = Date.now()) {
  const db = load();
  const since = dayOf(now - (days - 1) * 864e5);
  const out = {};
  for (const [d, agents] of Object.entries(db.aiUsage || {})) {
    if (d < since) continue;
    for (const [id, u] of Object.entries(agents)) {
      const t = (out[id] = out[id] || { calls: 0, in: 0, out: 0 });
      t.calls += u.calls; t.in += u.in; t.out += u.out;
    }
  }
  return out;
}
function byDay(agent, days, now = Date.now()) {
  const db = load();
  return Array.from({ length: days }, (_, i) => {
    const d = dayOf(now - (days - 1 - i) * 864e5);
    const u = ((db.aiUsage || {})[d] || {})[agent] || { calls: 0, in: 0, out: 0 };
    return { date: d, calls: u.calls, in: u.in, out: u.out };
  });
}

module.exports = { withAgent, currentAgent, record, totals, byDay };
