'use strict';

const { DaCodeRuntimeError } = require('./values');
const isLetter = ch => !!ch && /[\p{L}_]/u.test(ch);
const isWord = ch => !!ch && /[\p{L}\p{N}_]/u.test(ch);

function stripBlockComments(source) {
  let out = '';
  let i = 0;
  let inComment = false;
  while (i < source.length) {
    if (source.startsWith('"""', i)) {
      inComment = !inComment;
      out += '   ';
      i += 3;
      continue;
    }
    const ch = source[i++];
    out += inComment ? (ch === '\n' ? '\n' : ' ') : ch;
  }
  if (inComment) throw new DaCodeRuntimeError('Unclosed block comment: expected closing """');
  return out;
}

class Lexer {
  constructor(source, spec = null) {
    this.source = stripBlockComments(String(source).replace(/\r\n?/g, '\n'));
    const fallback = ['if','elif','else','while','for','in','remem','remember','true','false','Void','and','or','not','block','exit','error','straight','open','close','from','import'];
    this.keywords = new Set(spec ? [...(spec.keywords || []), ...(spec.literals || [])] : fallback);
  }

  tokenize() {
    const out = [], indents = [0], lines = this.source.split('\n');
    let depth = 0;
    for (let n = 0; n < lines.length; n++) {
      const raw = lines[n], line = n + 1, trimmed = raw.trim();
      if ((!trimmed || raw.trimStart().startsWith('#')) && depth === 0) continue;
      const prefix = raw.slice(0, raw.length - raw.trimStart().length);
      if (prefix.includes('\t')) throw this.err('Tabs are not allowed for indentation', line, 1);
      const indent = prefix.length;
      if (depth === 0) {
        if (indent > indents[indents.length - 1]) {
          indents.push(indent); out.push(this.tok('INDENT', '', line, 1));
        } else {
          while (indent < indents[indents.length - 1]) { indents.pop(); out.push(this.tok('DEDENT', '', line, 1)); }
          if (indent !== indents[indents.length - 1]) throw this.err('Invalid indentation', line, 1);
        }
      }
      let i = indent;
      while (i < raw.length) {
        const ch = raw[i], col = i + 1;
        if (/\s/.test(ch)) { i++; continue; }
        if (ch === '#') break;
        if (ch === 'w' && (raw[i + 1] === '"' || raw[i + 1] === "'")) {
          const read = this.readString(raw, i + 1, line, col, true);
          out.push(this.tok('SMART_STRING', read.value, line, col)); i = read.next; continue;
        }
        if (ch === '"' || ch === "'") {
          const read = this.readString(raw, i, line, col, false);
          out.push(this.tok('STRING', read.value, line, col)); i = read.next; continue;
        }
        if (/\d/.test(ch)) {
          let j = i, dot = false;
          while (j < raw.length) {
            if (/\d/.test(raw[j])) { j++; continue; }
            if (raw[j] === '.' && !dot && /\d/.test(raw[j + 1] || '')) { dot = true; j++; continue; }
            break;
          }
          const value = raw.slice(i, j);
          out.push(this.tok(dot ? 'FLOAT' : 'NUMBER', value, line, col)); i = j; continue;
        }
        if (isLetter(ch)) {
          let j = i + 1; while (j < raw.length && isWord(raw[j])) j++;
          const value = raw.slice(i, j);
          out.push(this.tok(this.keywords.has(value) ? 'KW' : 'IDENT', value, line, col)); i = j; continue;
        }
        const two = raw.slice(i, i + 2);
        if (['==','!=','<=','>=','//','**','->'].includes(two)) { out.push(this.tok('OP', two, line, col)); i += 2; continue; }
        if ('+-*/%=<>.,:()[]{}&'.includes(ch)) {
          out.push(this.tok('.,:()[]{}'.includes(ch) ? 'PUNC' : 'OP', ch, line, col));
          if ('([{'.includes(ch)) depth++;
          else if (')]}'.includes(ch) && --depth < 0) throw this.err('Unexpected closing bracket', line, col);
          i++; continue;
        }
        throw this.err('Unexpected character ' + JSON.stringify(ch), line, col);
      }
      if (depth === 0) out.push(this.tok('NEWLINE', '', line, raw.length + 1));
    }
    if (depth !== 0) throw this.err('Unclosed bracket at end of file', lines.length, 1);
    while (indents.length > 1) { indents.pop(); out.push(this.tok('DEDENT', '', lines.length, 1)); }
    out.push(this.tok('EOF', '', lines.length + 1, 1));
    return out;
  }

  readString(raw, quoteIndex, line, col, smart) {
    const quote = raw[quoteIndex];
    let value = '', escaped = false, j = quoteIndex + 1;
    for (; j < raw.length; j++) {
      const c = raw[j];
      if (escaped) { value += smart ? c : ({n:'\n',t:'\t',r:'\r'}[c] ?? c); escaped = false; }
      else if (c === '\\') escaped = true;
      else if (c === quote) return {value, next: j + 1};
      else value += c;
    }
    throw this.err('Unterminated ' + (smart ? 'smart ' : '') + 'string', line, col);
  }

  tok(kind, value, line, col) { return {kind, value, line, col}; }
  err(message, line, col) { return new DaCodeRuntimeError(message, line, col); }
}

module.exports = { Lexer };
