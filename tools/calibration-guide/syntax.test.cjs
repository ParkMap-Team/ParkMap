const test = require('node:test');
const assert = require('node:assert/strict');
const { highlightCode } = require('./syntax.js');

test('Python keywords, function calls, strings and comments have separate colors', () => {
  const html = highlightCode('def width():\n    return float("0.08") # return unchanged', 'width.py').join('\n');
  for (const kind of ['keyword','function','builtin','string','comment']) assert.ok(html.includes(`syntax-${kind}`));
  assert.ok(html.includes('<span class="syntax-comment"># return unchanged</span>'));
});
test('multiline docstrings preserve line count and close spans on every line', () => {
  const lines = highlightCode('"""first\nsecond"""\nreturn None', 'width.py');
  assert.equal(lines.length, 3);
  for (const line of lines) assert.equal((line.match(/<span /g)||[]).length, (line.match(/<\/span>/g)||[]).length);
});
test('TSX source is escaped and displayed rather than becoming executable markup', () => {
  const html = highlightCode('const node = <img src="x" onerror="alert(1)" />;', 'view.tsx').join('');
  assert.ok(!html.includes('<img'));
  assert.ok(html.includes('&lt;img'));
  assert.ok(html.includes('syntax-tag'));
});
test('token colors preserve original text after decoding display entities', () => {
  const code = 'const scale = 16 / width;\n// a < b && c > d\nreturn "hello & world";';
  const html = highlightCode(code, 'demo.ts').join('\n');
  const restored = html.replace(/<\/?span[^>]*>/g, '').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&');
  assert.equal(restored, code);
});
