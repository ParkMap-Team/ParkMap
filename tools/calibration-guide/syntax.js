/* Small local lexer for the Python / TypeScript excerpts in this guide. */
(function (root) {
  'use strict';
  const escape = value => value.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const keywords = new Set(('async await def class return if elif else for while in is not and or from import as with try except finally raise pass None True False lambda yield global nonlocal assert del break continue export default function const let var new typeof instanceof throw catch switch case null undefined true false interface type extends implements readonly public private static void get set of').split(' '));
  const builtins = new Set(('self super print len range enumerate zip isinstance float int str bool list dict tuple set any all min max abs sum sorted map filter Object Array String Number Boolean Promise Math JSON Response Request Set Map Error console window document').split(' '));
  function highlightCode(code, file = '') {
    const python = file.endsWith('.py');
    const comment = python ? '#[^\\n]*' : '//[^\\n]*|/\\*[\\s\\S]*?(?:\\*/|$)';
    const pattern = new RegExp(`(?<comment>${comment})|(?<string>"""[\\s\\S]*?(?:"""|$)|'''[\\s\\S]*?(?:'''|$)|"(?:\\\\[\\s\\S]|[^"\\\\\\n])*"|'(?:\\\\[\\s\\S]|[^'\\\\\\n])*'|\x60(?:\\\\[\\s\\S]|[^\x60\\\\])*\x60)|(?<number>\\b(?:0[xX][\\da-fA-F]+|\\d+(?:\\.\\d*)?(?:[eE][+-]?\\d+)?)\\b)|(?<tag><\\/?[A-Za-z][\\w.-]*)|(?<word>[A-Za-z_$][\\w$]*)|(?<operator>=>|===|!==|==|!=|<=|>=|\\*\\*|&&|\\|\\||[+*/%=<>!&|?:~-])`, 'g');
    let result = '', offset = 0;
    for (const match of code.matchAll(pattern)) {
      result += escape(code.slice(offset, match.index));
      const groups = match.groups;
      let kind = Object.keys(groups).find(key => groups[key] !== undefined);
      if (kind === 'word') {
        if (keywords.has(match[0])) kind = 'keyword';
        else if (builtins.has(match[0])) kind = 'builtin';
        else if (/^\s*\(/.test(code.slice(match.index + match[0].length))) kind = 'function';
        else if (/^[A-Z][A-Za-z0-9_]+$/.test(match[0])) kind = 'type';
        else kind = '';
      }
      // Wrap each line separately so multiline strings do not break line numbering.
      result += match[0].split('\n').map(part => kind && part ? `<span class="syntax-${kind}">${escape(part)}</span>` : escape(part)).join('\n');
      offset = match.index + match[0].length;
    }
    result += escape(code.slice(offset));
    return result.split('\n');
  }
  root.ParkMapSyntax = { highlightCode };
  if (typeof module !== 'undefined' && module.exports) module.exports = { highlightCode };
})(globalThis);
