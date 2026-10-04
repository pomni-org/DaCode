'use strict';

const { DaCodeRuntimeError, VOID_LITERAL } = require('./values');

const node = (kind, fields = {}) => ({ kind, ...fields });

class Parser {
  constructor(tokens, spec = null) {
    this.t = tokens; this.i = 0;
    const fallback = ['text','numb','bool','list','dict','compound','error'];
    this.typeStarts = new Set(spec ? [...(spec.types?.direct || []), ...(spec.types?.compound || [])] : fallback);
  }
  cur() { return this.t[this.i]; }
  peek(n = 1) { return this.t[Math.min(this.i + n, this.t.length - 1)]; }
  at(value = null, kind = null) {
    const t = this.cur();
    return (value === null || t.value === value) && (kind === null || t.kind === kind);
  }
  match(value = null, kind = null) {
    if (!this.at(value, kind)) return null;
    return this.t[this.i++];
  }
  expect(value = null, kind = null) {
    const t = this.cur();
    if (!this.at(value, kind)) {
      throw new DaCodeRuntimeError(`Expected ${value ?? kind}, got ${t.kind}:${JSON.stringify(t.value)}`, t.line, t.col);
    }
    this.i++;
    return t;
  }
  skipNewlines() { while (this.match(null, 'NEWLINE')) {} }
  endline() { this.expect(null, 'NEWLINE'); }

  parse() {
    const statements = [];
    this.skipNewlines();
    while (!this.at(null, 'EOF')) {
      statements.push(this.statement());
      this.skipNewlines();
    }
    this.validateOutputControls(statements, true);
    return node('Program', { statements });
  }

  validateOutputControls(statements, topLevel) {
    for (let index = 0; index < statements.length; index++) {
      const stmt = statements[index];
      if (stmt.kind === 'StraightStmt' && stmt.controlMode) {
        if (!topLevel) {
          throw this.error(`straight(${stmt.controlMode}) is only allowed at the top level`, {line:stmt.line, col:1});
        }
        if (stmt.controlMode === 'start' && index !== 0) {
          throw this.error('straight(start) must be the first program statement', {line:stmt.line, col:1});
        }
        if (stmt.controlMode === 'finish' && index !== statements.length - 1) {
          throw this.error('straight(finish) must be the last program statement', {line:stmt.line, col:1});
        }
      }
      const nested = [];
      if (stmt.kind === 'IfStmt') {
        for (const branch of stmt.branches) nested.push(branch.body);
        nested.push(stmt.elseBody);
      } else if (['WhileStmt','ForStmt','FuncDef','ClassDef'].includes(stmt.kind)) {
        nested.push(stmt.body);
      }
      for (const body of nested) this.validateOutputControls(body, false);
    }
  }

  statement() {
    if (this.cur().kind === 'KW' && this.peek().value === '=') {
      const t = this.cur();
      throw this.error(
        `'${t.value}' is a reserved DaCode word and cannot be used as a variable name. Choose another name, for example input_error.`,
        t
      );
    }
    if (this.at('if')) return this.parseIf();
    if (this.at('while')) return this.parseWhile();
    if (this.at('for')) return this.parseFor();
    if (this.at('remem') || this.at('remember')) return this.parseRemem();
    if (this.at('from')) return this.parseFromImport();
    if (this.at('import')) return this.parseFileImport();
    if (this.at('return') && this.peek().value === '.' && this.peek(2).value === 'back') return this.parseReturnBack();
    if (this.at('exit')) return this.parseExit();
    if (this.at('error')) return this.parseError();
    if (this.at('straight')) return this.parseStraight();
    if (this.at('open')) return this.parseSimple('OpenStmt');
    if (this.at('close')) return this.parseSimple('CloseStmt');
    if (this.at('block') || this.looksLikeTypedAssignment()) return this.parseAssignment();

    if (this.at(null, 'IDENT') && this.peek().value === '.' && this.peek(2).kind === 'IDENT' && this.peek(3).value === '=') {
      const start = this.cur();
      const objName = this.expect(null, 'IDENT').value;
      this.expect('.');
      const attrName = this.expect(null, 'IDENT').value;
      this.expect('=');
      const expr = this.expression();
      this.endline();
      return node('AttributeAssignment', { objName, attrName, expr, line: start.line });
    }

    if (this.at(null, 'IDENT') && this.peek().value === '=' && this.peek(2).value === 'straight') {
      const assignTo = this.expect(null, 'IDENT').value;
      this.expect('=');
      const stmt = this.parseStraight();
      if (!stmt.errorMode) throw this.error('Only straight(error) can be assigned to a variable');
      stmt.assignTo = assignTo;
      return stmt;
    }

    if (this.at(null, 'IDENT') && this.peek().value === '=') {
      const start = this.cur();
      const name = this.expect(null, 'IDENT').value;
      this.expect('=');
      let expr = this.expression();
      expr = this.maybeReadTransform(expr);
      this.endline();
      return node('Assignment', { name, expr, typeSpec: null, blocked: false, line: start.line });
    }

    const start = this.cur();
    const expr = this.expression();
    this.endline();
    return node('ExprStmt', { expr, line: start.line });
  }

  looksLikeTypedAssignment() {
    let j = this.i;
    if (this.t[j].value === 'block') return true;
    if (!['IDENT','KW'].includes(this.t[j].kind) || !this.typeStarts.has(this.t[j].value)) return false;
    j++;
    while (j < this.t.length && ['.','/','+'].includes(this.t[j].value)) {
      j++;
      if (j < this.t.length && ['IDENT','KW'].includes(this.t[j].kind)) j++;
    }
    return j + 1 < this.t.length && this.t[j].kind === 'IDENT' && this.t[j + 1].value === '=';
  }

  parseTypeSpec() {
    if (!this.typeStarts.has(this.cur().value)) return null;
    const parts = [this.expect().value];
    while (this.at('.') || this.at('/')) {
      parts.push(this.expect().value);
      parts.push(this.expect().value);
    }
    return parts.join('');
  }

  parseAssignment() {
    const start = this.cur();
    let blocked = false;
    if (this.match('block')) { blocked = true; this.match('+'); }
    const typeSpec = this.parseTypeSpec();
    const name = this.expect(null, 'IDENT').value;
    this.expect('=');
    let expr = this.expression();
    expr = this.maybeReadTransform(expr);
    this.endline();
    return node('Assignment', { name, expr, typeSpec, blocked, line: start.line });
  }

  parseIf() {
    const start = this.expect('if');
    const branches = [];
    let condition = this.expression(); this.expect(':'); this.endline();
    branches.push({ condition, body: this.block() });
    while (this.at('elif')) {
      this.expect('elif'); condition = this.expression(); this.expect(':'); this.endline();
      branches.push({ condition, body: this.block() });
    }
    let elseBody = [];
    if (this.at('else')) { this.expect('else'); this.expect(':'); this.endline(); elseBody = this.block(); }
    return node('IfStmt', { branches, elseBody, line: start.line });
  }

  parseWhile() {
    const start = this.expect('while');
    const condition = this.expression(); this.expect(':'); this.endline();
    return node('WhileStmt', { condition, body: this.block(), line: start.line });
  }

  parseFor() {
    const start = this.expect('for');
    const varName = this.expect(null, 'IDENT').value;
    this.expect('in');
    const iterable = this.expression(); this.expect(':'); this.endline();
    return node('ForStmt', { varName, iterable, body: this.block(), line: start.line });
  }

  parseRemem() {
    const start = this.expect();

    if (this.at('block') || this.looksLikeTypedAssignment()) {
      return this.parseAssignment();
    }

    if (!this.at(null, 'IDENT')) {
      throw this.error(`${start.value} must be followed by a name`);
    }

    const name = this.expect(null, 'IDENT').value;

    if (this.match('(')) {
      const params = [];
      if (!this.at(')')) {
        while (true) {
          params.push(this.parseParam());
          if (!this.match(',')) break;
        }
      }
      this.expect(')'); this.expect(':'); this.endline();
      return node('FuncDef', { name, params, body: this.block(), remembered: true, line: start.line });
    }

    if (this.match(':')) {
      this.endline();
      return node('ClassDef', { name, body: this.block(), remembered: true, line: start.line });
    }

    if (this.match('=')) {
      let expr = this.expression();
      expr = this.maybeReadTransform(expr);
      this.endline();
      return node('Assignment', { name, expr, typeSpec:null, blocked:false, line:start.line });
    }

    throw this.error(
      `After ${start.value} ${name}, expected '(', ':' or '='. Use ${start.value} name(): for a function, ${start.value} Name: for a class, or ${start.value} name = value for a variable.`
    );
  }

  parseParam() {
    if (this.typeStarts.has(this.cur().value)) {
      let typeSpec = this.expect().value;
      if (this.match('.')) typeSpec += '.' + this.expect().value;
      this.expect('=');
      const name = this.expect(null, 'IDENT').value;
      let defaultExpr = null;
      if (this.match('and') || this.match('&')) {
        const repeated = this.expect(null, 'IDENT').value;
        if (repeated !== name) throw this.error(`Default binding must repeat parameter name '${name}'`);
        this.expect('=');
        defaultExpr = this.expression();
      }
      return { name, typeSpec, defaultExpr };
    }
    return { name: this.expect(null, 'IDENT').value, typeSpec: null, defaultExpr: null };
  }

  parseReturnBack() {
    const start = this.expect('return'); this.expect('.'); this.expect('back'); this.expect('(');
    const expr = this.at(')') ? node('Literal', { value: VOID_LITERAL }) : this.expression();
    this.expect(')');
    const typeSpec = this.parseTypeSpec();
    this.endline();
    return node('ReturnBackStmt', { expr, typeSpec, line: start.line });
  }

  parseFileImport() {
    const start = this.expect('import');
    const parts = [];
    while (!this.at('=') && !this.at(null, 'NEWLINE')) parts.push(this.expect().value);
    this.expect('=');
    const alias = this.expect(null, 'IDENT').value;
    this.endline();
    return node('ImportFileStmt', { path: parts.join(''), alias, line: start.line });
  }

  maybeReadTransform(expr) {
    if (!this.match(':')) return expr;
    if (!(expr.kind === 'Call' && expr.func.kind === 'Name' && expr.func.name === 'read')) {
      throw this.error("':' transform is currently valid only after read(...)");
    }
    this.expect('split'); this.expect('(');
    const separator = this.expression(); this.expect(')');
    return node('ReadTransform', { source: expr, separator });
  }

  parseFromImport() {
    const start = this.expect('from');
    const source = this.expect().value;
    this.expect('import');
    const parts = [this.expect().value];
    while (this.match('.')) parts.push(this.expect().value);
    let alias = null;
    if (this.match('=')) alias = this.expect(null, 'IDENT').value;
    this.endline();
    return node('FromImportStmt', { source, importPath: parts.join('.'), alias, line: start.line });
  }

  parseExit() {
    const start = this.expect('exit'); this.expect('(');
    const expr = this.at(')') ? null : this.expression();
    this.expect(')'); this.endline();
    return node('ExitStmt', { expr, line: start.line });
  }

  parseError() {
    const start = this.expect('error'); this.expect('(');
    const expr = this.expression(); this.expect(')'); this.endline();
    return node('ErrorStmt', { expr, line: start.line });
  }

  parseStraight() {
    const start = this.expect('straight'); this.expect('(');
    let errorMode = false;
    let controlMode = null;
    if (!this.at(')')) {
      const arg = this.expect().value;
      if (arg === 'error') errorMode = true;
      else if (arg === 'start' || arg === 'finish') controlMode = arg;
      else throw this.error(
        `straight() does not support '${arg}'; use error, start, finish, or no argument`,
        start
      );
    }
    this.expect(')'); this.endline();
    return node('StraightStmt', { errorMode, controlMode, assignTo: null, line: start.line });
  }

  parseSimple(kind) {
    const start = this.expect(); this.expect('('); this.expect(')'); this.endline();
    return node(kind, { line: start.line });
  }

  block() {
    this.expect(null, 'INDENT');
    const body = [];
    this.skipNewlines();
    while (!this.at(null, 'DEDENT') && !this.at(null, 'EOF')) {
      body.push(this.statement());
      this.skipNewlines();
    }
    this.expect(null, 'DEDENT');
    return body;
  }

  expression(minPrec = 0) {
    let left = this.prefix();
    const precedence = { or:1, and:2, '==':3, '!=':3, '<':4, '<=':4, '>':4, '>=':4, '+':5, '-':5, '*':6, '/':6, '//':6, '%':6, '**':7 };
    while (true) {
      const op = this.cur().value;
      if (!(op in precedence) || precedence[op] < minPrec) break;
      const prec = precedence[op]; this.i++;
      const right = this.expression(prec + (op === '**' ? 0 : 1));
      left = node('Binary', { left, op, right });
    }
    return left;
  }

  prefix() {
    if (this.match('-', 'OP')) return node('Unary', { op:'-', expr:this.expression(8) });
    if (this.match('+', 'OP')) return node('Unary', { op:'+', expr:this.expression(8) });
    if (this.match('not')) return node('Unary', { op:'not', expr:this.expression(8) });
    let value = this.primary();
    while (true) {
      if (this.match('.')) {
        value = node('Attribute', { obj:value, name:this.expect(null, 'IDENT').value });
      } else if (this.match('[')) {
        const index = this.expression(); this.expect(']'); value = node('Index', { obj:value, index });
      } else if (this.match('(')) {
        const args = [];
        if (!this.at(')')) {
          while (true) {
            if (['IDENT','KW'].includes(this.cur().kind) && this.peek().value === ':') {
              const color = this.expect().value; this.expect(':');
              args.push(node('DictLiteral', { items:[
                [node('Literal',{value:'__color__'}), node('Literal',{value:color})],
                [node('Literal',{value:'value'}), this.expression()]
              ] }));
            } else args.push(this.expression());
            if (!this.match(',')) break;
          }
        }
        this.expect(')'); value = node('Call', { func:value, args });
      } else break;
    }
    return value;
  }

  primary() {
    const t = this.cur();
    if (this.match(null, 'NUMBER')) return node('Literal', { value:Number.parseInt(t.value, 10) });
    if (this.match(null, 'FLOAT')) return node('Literal', { value:Number.parseFloat(t.value) });
    if (this.match(null, 'STRING')) return node('Literal', { value:t.value });
    if (this.match(null, 'SMART_STRING')) return node('SmartString', { template:t.value });
    if (this.match('true')) return node('Literal', { value:true });
    if (this.match('false')) return node('Literal', { value:false });
    if (this.match('Void')) return node('Literal', { value:VOID_LITERAL });
    if (this.at('<') || this.at('>')) return node('Literal', { value:this.expect().value });
    if (this.match('[')) {
      const items = [];
      if (!this.at(']')) { while (true) { items.push(this.expression()); if (!this.match(',')) break; } }
      this.expect(']'); return node('ListLiteral', { items });
    }
    if (this.match('{')) {
      const items = [];
      if (!this.at('}')) {
        while (true) {
          const key = this.expression(); this.expect(':'); const value = this.expression(); items.push([key,value]);
          if (!this.match(',')) break;
        }
      }
      this.expect('}'); return node('DictLiteral', { items });
    }
    if (this.match('(')) { const expr = this.expression(); this.expect(')'); return expr; }
    if (['IDENT','KW'].includes(t.kind)) { this.i++; return node('Name', { name:t.value }); }
    throw this.error(`Unexpected token ${t.kind}:${JSON.stringify(t.value)}`, t);
  }

  error(message, token = this.cur()) { return new DaCodeRuntimeError(message, token.line, token.col); }
}

module.exports = { Parser };
