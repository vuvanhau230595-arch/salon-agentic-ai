const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
process.env.DB_FILE = path.join(os.tmpdir(), `ai-gemini-${process.pid}.json`);
delete process.env.ANTHROPIC_API_KEY;
process.env.GEMINI_API_KEY = 'test-key';
const ai = require('../src/ai');

test('không có khóa Claude: viết bài bằng Gemini; có khóa Claude thì ưu tiên Claude', async () => {
  const calls = [];
  const orig = global.fetch;
  global.fetch = async (url, init) => {
    calls.push(url);
    return { status: 200, json: async () => (/anthropic/.test(url) ? { content: [{ text: 'từ Claude' }], usage: {}, model: 'm' } : { candidates: [{ content: { parts: [{ text: 'từ Gemini' }] } }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 7 } }) };
  };
  try {
    assert.strictEqual(await ai.draftPost('Facebook Page', 'nhuộm balayage'), 'từ Gemini');
    assert.match(calls[0], /generativelanguage/);
    process.env.ANTHROPIC_API_KEY = 'k';
    assert.strictEqual(await ai.draftPost('Facebook Page', 'x'), 'từ Claude');
  } finally { global.fetch = orig; delete process.env.ANTHROPIC_API_KEY; }
});
test('không có khóa nào: dùng mẫu câu', async () => {
  delete process.env.GEMINI_API_KEY;
  assert.match(await ai.draftPost('Facebook Page', 'abc'), /abc/);
});
