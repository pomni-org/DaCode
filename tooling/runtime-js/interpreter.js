'use strict';

const path = require('path');
const os = require('os');
const {
  DaCodeRuntimeError, DaCodeRaisedError, FunctionReturn, StraightSkip, ProgramExit,
  VOID, VOID_LITERAL, TypeMarker, FileRef, checkType,
} = require('./values');
const { Environment } = require('./environment');
const { Lexer } = require('./lexer');
const { Parser } = require('./parser');

const KNOWN_FOREIGN = new Set(['python','javascript','java','csharp','cpp','rust','go','kotlin','swift']);

class DaObject {
  constructor(attrs = {}) { Object.assign(this, attrs); }
}

class UserClass {
  constructor(name, attrs) { this.name = name; this.attrs = { ...attrs }; }
  async call() { return new DaObject({ ...this.attrs }); }
}

class UserFunction {
  constructor(node, closure, interpreter) { this.node = node; this.closure = closure; this.interpreter = interpreter; }
  async call(args) {
    const env = new Environment(this.closure);
    for (let i = 0; i < this.node.params.length; i++) {
      const param = this.node.params[i];
      let value;
      if (i < args.length) value = args[i];
      else if (param.defaultExpr) value = await this.interpreter.evalExpr(param.defaultExpr, this.closure);
      else throw new DaCodeRuntimeError(`Missing parameter ${param.name}`, this.node.line, 1);
      checkType(value, param.typeSpec);
      env.define(param.name, value, param.typeSpec);
    }
    if (args.length > this.node.params.length) throw new DaCodeRuntimeError('Too many parameters', this.node.line, 1);
    try {
      await this.interpreter.execBlock(this.node.body, env, true);
    } catch (signal) {
      if (signal instanceof FunctionReturn) return signal.value;
      if (signal instanceof StraightSkip) return VOID;
      throw signal;
    }
    return VOID;
  }
}

class Interpreter {
  constructor(host, baseDir = process.cwd(), spec = null) {
    this.host = host;
    this.spec = spec;
    this.baseDir = baseDir;
    this.lastError = null;
    this.firstRegistry = new Map();
    this.globalEnv = new Environment();
    this.builtinNames = new Set();
    this.installBuiltins();
  }

  registerBuiltin(name, value, blocked = true) {
    this.globalEnv.define(name, value, null, blocked);
    this.builtinNames.add(name);
  }

  installBuiltins() {
    const random = async range => {
      if (!range || !range.__dacodeRange) throw new DaCodeRuntimeError('random() expects a range like 1-10');
      const min = Math.ceil(range.a), max = Math.floor(range.b);
      return Math.floor(Math.random() * (max - min + 1)) + min;
    };
    random.choice = async seq => {
      if (!Array.isArray(seq) && typeof seq !== 'string') throw new DaCodeRuntimeError('random.choice() expects list or text');
      return seq[Math.floor(Math.random() * seq.length)];
    };

    const osNamespace = {
      get: async level => {
        if (level === '<') return process.platform === 'darwin' ? 'Apple' : process.platform === 'win32' ? 'Microsoft' : 'Linux';
        if (level === '>') return `${os.type()} ${os.release()}`;
        return process.platform === 'darwin' ? 'MacOS' : process.platform === 'win32' ? 'Windows' : 'Linux';
      }
    };

    const log = async (...args) => this.host.write(args.map(v => this.display(v)).join(' '));
    log.file = async file => { this.host.logFile = String(file); };
    log.console = async () => { this.host.logFile = null; };
    log.all = async () => { this.host.logAll = true; };

    this.registerBuiltin('console', async (...args) => this.host.write(args.map(v => this.display(v)).join('')));
    this.registerBuiltin('input', async (prompt = '', expected = null) => this.inputValue(prompt, expected));
    this.registerBuiltin('range', async (a, b = null) => {
      const start = b === null ? 1 : Number(a);
      const end = b === null ? Number(a) : Number(b);
      const result = [];
      for (let i = start; i < end; i++) result.push(i);
      return result;
    });
    this.registerBuiltin('return', async (...args) => args.length === 1 ? args[0] : args);
    this.registerBuiltin('random', random);
    this.registerBuiltin('os', osNamespace);
    this.registerBuiltin('clear', async () => this.host.clear());
    this.registerBuiltin('log', log);

    this.registerBuiltin('read', async ref => this.readFile(ref));
    this.registerBuiltin('write', async (ref, line, value) => this.writeFile(ref, line, value));
    this.registerBuiltin('delete', async (ref, line, value = undefined) => this.deleteFile(ref, line, value));
    this.registerBuiltin('replace', async (ref, line, oldValue, newValue) => this.replaceFile(ref, line, oldValue, newValue));
    this.registerBuiltin('find', async (ref, value) => this.findFile(ref, value));

    for (const name of ['numb','text','bool','list','dict','compound','error']) {
      const marker = new TypeMarker(name);
      if (name === 'numb') marker.float = new TypeMarker('numb.float');
      this.registerBuiltin(name, marker);
    }
  }

  async run(program) {
    try {
      await this.execBlock(program.statements, this.globalEnv, false);
    } catch (signal) {
      if (signal instanceof ProgramExit) {
        if (signal.value !== null && signal.value !== VOID) this.host.write(this.display(signal.value));
        return signal.value;
      }
      throw signal;
    }
    return VOID;
  }

  async execBlock(statements, env, insideFunction = false) {
    let index = 0;
    while (index < statements.length) {
      const stmt = statements[index];
      try {
        await this.execStmt(stmt, env, insideFunction);
      } catch (error) {
        if (error instanceof ProgramExit || error instanceof FunctionReturn || error instanceof StraightSkip) throw error;
        const next = statements[index + 1];
        if (next && next.kind === 'StraightStmt' && next.errorMode) {
          this.lastError = error;
          await this.execStmt(next, env, insideFunction);
          index += 2;
          continue;
        }
        throw this.withLine(error, stmt.line);
      }
      index++;
    }
  }

  async execStmt(stmt, env, insideFunction) {
    switch (stmt.kind) {
      case 'Assignment': {
        const value = await this.evalExpr(stmt.expr, env);
        checkType(value, stmt.typeSpec);
        if (env.hasLocal(stmt.name)) env.set(stmt.name, value);
        else env.define(stmt.name, value, stmt.typeSpec, stmt.blocked);
        return;
      }
      case 'AttributeAssignment': {
        const obj = env.get(stmt.objName);
        obj[stmt.attrName] = await this.evalExpr(stmt.expr, env);
        return;
      }
      case 'ExprStmt':
        await this.evalExpr(stmt.expr, env);
        return;
      case 'IfStmt': {
        for (const branch of stmt.branches) {
          if (this.truth(await this.evalExpr(branch.condition, env))) {
            try { await this.execBlock(branch.body, env, insideFunction); }
            catch (s) { if (s instanceof StraightSkip && !insideFunction) return; throw s; }
            return;
          }
        }
        if (stmt.elseBody.length) {
          try { await this.execBlock(stmt.elseBody, env, insideFunction); }
          catch (s) { if (s instanceof StraightSkip && !insideFunction) return; throw s; }
        }
        return;
      }
      case 'WhileStmt': {
        while (this.truth(await this.evalExpr(stmt.condition, env))) {
          try { await this.execBlock(stmt.body, env, insideFunction); }
          catch (s) { if (s instanceof StraightSkip && !insideFunction) break; throw s; }
        }
        return;
      }
      case 'ForStmt': {
        const iterable = await this.evalExpr(stmt.iterable, env);
        for (const item of iterable) {
          env.set(stmt.varName, item);
          try { await this.execBlock(stmt.body, env, insideFunction); }
          catch (s) { if (s instanceof StraightSkip && !insideFunction) break; throw s; }
        }
        return;
      }
      case 'FuncDef':
        env.define(stmt.name, new UserFunction(stmt, env, this), null, stmt.remembered);
        return;
      case 'ClassDef':
        await this.defineClass(stmt, env);
        return;
      case 'ImportFileStmt':
        env.define(stmt.alias, new FileRef(path.resolve(this.baseDir, stmt.path)), null, true);
        return;
      case 'FromImportStmt':
        await this.executeImport(stmt, env);
        return;
      case 'ReturnBackStmt': {
        const value = await this.evalExpr(stmt.expr, env);
        checkType(value, stmt.typeSpec);
        throw new FunctionReturn(value);
      }
      case 'StraightStmt': {
        if (stmt.controlMode) return;
        if (stmt.errorMode) {
          const value = this.lastError;
          this.lastError = null;
          if (stmt.assignTo) env.set(stmt.assignTo, value || false);
          return;
        }
        throw new StraightSkip();
      }
      case 'ExitStmt':
        throw new ProgramExit(stmt.expr ? await this.evalExpr(stmt.expr, env) : null);
      case 'ErrorStmt':
        throw new DaCodeRaisedError(await this.evalExpr(stmt.expr, env));
      case 'OpenStmt': env.opened = true; return;
      case 'CloseStmt': env.opened = false; return;
      default: throw new DaCodeRuntimeError(`Unsupported statement ${stmt.kind}`, stmt.line, 1);
    }
  }

  async evalExpr(expr, env) {
    switch (expr.kind) {
      case 'Literal': return expr.value === VOID_LITERAL ? VOID : expr.value;
      case 'Name': {
        try { return env.get(expr.name); }
        catch (error) {
          if (this.builtinNames.has(expr.name)) return this.globalEnv.get(expr.name);
          throw error;
        }
      }
      case 'ListLiteral': {
        const result = [];
        for (const item of expr.items) result.push(await this.evalExpr(item, env));
        return result;
      }
      case 'DictLiteral': {
        const out = {};
        for (const [keyNode, valueNode] of expr.items) out[String(await this.evalExpr(keyNode, env))] = await this.evalExpr(valueNode, env);
        return out;
      }
      case 'SmartString': return this.smartString(expr.template, env);
      case 'ReadTransform': {
        const data = await this.evalExpr(expr.source, env);
        const separator = await this.evalExpr(expr.separator, env);
        return data.map(line => String(line).split(separator));
      }
      case 'Unary': {
        const value = await this.evalExpr(expr.expr, env);
        if (value === VOID) throw new DaCodeRuntimeError('Void cannot be used in an operation');
        if (expr.op === '-') return -value;
        if (expr.op === '+') return +value;
        if (expr.op === 'not') return !this.truth(value);
        break;
      }
      case 'Binary': return this.evalBinary(expr, env);
      case 'Attribute': {
        const obj = await this.evalExpr(expr.obj, env);
        const native = this.nativeAttribute(obj, expr.name);
        if (native !== undefined) return native;
        if (obj == null || !(expr.name in obj)) throw new DaCodeRuntimeError(`Object has no attribute '${expr.name}'`);
        return obj[expr.name];
      }
      case 'Index': {
        const obj = await this.evalExpr(expr.obj, env);
        let index = await this.evalExpr(expr.index, env);
        if ((Array.isArray(obj) || typeof obj === 'string') && Number.isInteger(index)) index -= 1;
        return obj[index];
      }
      case 'Call': return this.evalCall(expr, env);
      default: throw new DaCodeRuntimeError(`Unsupported expression ${expr.kind}`);
    }
  }

  async evalBinary(expr, env) {
    const left = await this.evalExpr(expr.left, env);
    const right = await this.evalExpr(expr.right, env);
    if (left === VOID || right === VOID) {
      if (expr.op === '==') return left === right;
      if (expr.op === '!=') return left !== right;
      throw new DaCodeRuntimeError('Void cannot be used in an operation');
    }
    switch (expr.op) {
      case '+': return left + right;
      case '-': return left - right;
      case '*': return left * right;
      case '/': return left / right;
      case '//': return Math.trunc(left / right);
      case '%': return left % right;
      case '**': return left ** right;
      case '==': return left === right;
      case '!=': return left !== right;
      case '<': return left < right;
      case '<=': return left <= right;
      case '>': return left > right;
      case '>=': return left >= right;
      case 'and': return this.truth(left) && this.truth(right);
      case 'or': return this.truth(left) || this.truth(right);
      default: throw new DaCodeRuntimeError(`Unknown operator ${expr.op}`);
    }
  }

  async evalCall(expr, env) {
    if (expr.func.kind === 'Attribute' && expr.func.obj.kind === 'Name' && expr.func.obj.name === 'return' && expr.func.name === 'back') {
      const value = expr.args.length ? await this.evalExpr(expr.args[0], env) : VOID;
      throw new FunctionReturn(value);
    }

    if (expr.func.kind === 'Name' && expr.func.name === 'random' && expr.args.length === 1 && expr.args[0].kind === 'Binary' && expr.args[0].op === '-') {
      const a = await this.evalExpr(expr.args[0].left, env);
      const b = await this.evalExpr(expr.args[0].right, env);
      const fn = this.globalEnv.get('random');
      return fn({ __dacodeRange:true, a, b });
    }

    const fn = await this.evalExpr(expr.func, env);
    const args = [];
    for (const arg of expr.args) args.push(await this.evalExpr(arg, env));
    try {
      if (fn instanceof UserFunction || fn instanceof UserClass) return await fn.call(args);
      if (typeof fn === 'function') return await fn(...args);
      throw new DaCodeRuntimeError('Value is not callable');
    } catch (error) {
      this.lastError = error;
      throw error;
    }
  }

  nativeAttribute(obj, name) {
    if (Array.isArray(obj)) {
      if (name === 'find') return async value => { const i = obj.indexOf(value); return i < 0 ? 0 : i + 1; };
      if (name === 'add') return async value => { obj.push(value); return obj; };
      if (name === 'delete') return async value => {
        if (Number.isInteger(value)) return obj.splice(value - 1, 1)[0];
        const i = obj.indexOf(value); if (i >= 0) obj.splice(i, 1); return obj;
      };
      if (name === 'replace') return async (oldValue, newValue) => { for (let i=0;i<obj.length;i++) if (obj[i] === oldValue) obj[i] = newValue; return obj; };
      if (name === 'sort') return async () => { obj.sort(); return obj; };
      if (name === 'reverse') return async () => { obj.reverse(); return obj; };
    }
    if (typeof obj === 'string') {
      if (name === 'find') return async value => { const i = obj.indexOf(value); return i < 0 ? 0 : i + 1; };
      if (name === 'replace') return async (a,b) => obj.split(a).join(b);
      if (name === 'split') return async sep => obj.split(sep);
      if (name === 'join') return async values => values.join(obj);
      if (name === 'upper') return async () => obj.toUpperCase();
      if (name === 'lower') return async () => obj.toLowerCase();
    }
    if (obj instanceof TypeMarker && name === 'float' && obj.name === 'numb') return new TypeMarker('numb.float');
    return undefined;
  }

  async defineClass(stmt, env) {
    const attrs = {};
    let sawFirst = false, sawTwice = false;
    for (const item of stmt.body) {
      if (item.kind === 'AttributeAssignment' && ['first','twice'].includes(item.objName)) {
        if (item.objName === 'first') {
          sawFirst = true;
          const value = await this.evalExpr(item.expr, env);
          attrs[item.attrName] = value;
          if (!this.firstRegistry.has(item.attrName)) this.firstRegistry.set(item.attrName, []);
          this.firstRegistry.get(item.attrName).push([stmt.name, value]);
        } else {
          sawTwice = true;
          attrs[item.attrName] = await this.evalExpr(item.expr, env);
        }
        continue;
      }
      if (item.kind === 'ExprStmt' && item.expr.kind === 'Attribute' && item.expr.obj.kind === 'Name' && item.expr.obj.name === 'twice') {
        sawTwice = true;
        const field = item.expr.name;
        const matches = this.firstRegistry.get(field) || [];
        if (!matches.length) throw new DaCodeRuntimeError(`twice.${field} cannot find first.${field} in another container`, item.line, 1);
        if (matches.length > 1) throw new DaCodeRuntimeError(`twice.${field} is ambiguous: found ${matches.length} first.${field} values`, item.line, 1);
        attrs[field] = matches[0][1];
        continue;
      }
      if (item.kind === 'Assignment') { attrs[item.name] = await this.evalExpr(item.expr, env); continue; }
      throw new DaCodeRuntimeError(`Unsupported class-body statement ${item.kind}`, item.line, 1);
    }
    if (sawFirst && sawTwice) throw new DaCodeRuntimeError('first and twice cannot live in the same class container', stmt.line, 1);
    env.define(stmt.name, new UserClass(stmt.name, attrs), null, stmt.remembered);
  }

  async executeImport(stmt, env) {
    if (KNOWN_FOREIGN.has(stmt.source)) {
      throw new DaCodeRuntimeError(`${stmt.source} bridge is not embedded in the VS Code runtime yet`, stmt.line, 1);
    }
    const modulePath = path.resolve(this.baseDir, stmt.source.endsWith('.dc') ? stmt.source : stmt.source + '.dc');
    const source = await this.host.readText(modulePath);
    const sub = new Interpreter(this.host, path.dirname(modulePath), this.spec);
    const program = new Parser(new Lexer(source, this.spec).tokenize(), this.spec).parse();
    await sub.run(program);
    const parts = stmt.importPath.split('.');
    let obj = sub.globalEnv.get(parts[0]);
    for (const part of parts.slice(1)) obj = obj[part];
    const original = parts[parts.length - 1];
    env.define(original, obj);
    if (stmt.alias && stmt.alias !== original) env.define(stmt.alias, obj);
  }

  async inputValue(prompt, expected) {
    const raw = await this.host.input(String(prompt));
    if (raw === undefined) throw new DaCodeRuntimeError('Input cancelled');
    if (!expected) return raw;
    const type = String(expected);
    if (type === 'text') return raw;
    if (type === 'numb') {
      if (!/^[+-]?\d+$/.test(raw.trim())) throw new DaCodeRuntimeError('Input type error: expected numb');
      return Number.parseInt(raw, 10);
    }
    if (type === 'numb.float') {
      const n = Number(raw); if (!Number.isFinite(n)) throw new DaCodeRuntimeError('Input type error: expected numb.float'); return n;
    }
    if (type === 'bool') {
      const low = raw.trim().toLowerCase();
      if (['true','1'].includes(low)) return true;
      if (['false','0'].includes(low)) return false;
      throw new DaCodeRuntimeError('Input type error: expected bool');
    }
    throw new DaCodeRuntimeError(`input() cannot convert keyboard text to ${type}`);
  }

  async readFile(ref) {
    this.requireFileRef(ref);
    const text = await this.host.readText(ref.path);
    return text.replace(/\r\n?/g,'\n').split('\n').filter((_, i, arr) => i < arr.length - 1 || arr[i] !== '');
  }
  async writeFile(ref, lineNo, value) {
    const lines = await this.readFile(ref); const i = Number(lineNo)-1;
    if (i < 0 || i >= lines.length) throw new DaCodeRuntimeError('File line index out of range');
    lines[i] += String(value); await this.host.writeText(ref.path, lines.join('\n') + '\n'); return lines[i];
  }
  async deleteFile(ref, lineNo, value) {
    const lines = await this.readFile(ref); const i = Number(lineNo)-1;
    if (i < 0 || i >= lines.length) throw new DaCodeRuntimeError('File line index out of range');
    let removed;
    if (value === undefined) removed = lines.splice(i,1)[0];
    else { removed = String(value); lines[i] = lines[i].replace(String(value), ''); }
    await this.host.writeText(ref.path, lines.join('\n') + (lines.length ? '\n' : '')); return removed;
  }
  async replaceFile(ref, lineNo, oldValue, newValue) {
    const lines = await this.readFile(ref); const i = Number(lineNo)-1;
    if (i < 0 || i >= lines.length) throw new DaCodeRuntimeError('File line index out of range');
    lines[i] = lines[i].split(String(oldValue)).join(String(newValue));
    await this.host.writeText(ref.path, lines.join('\n') + '\n'); return lines[i];
  }
  async findFile(ref, value) {
    const lines = await this.readFile(ref); const needle = String(value);
    const i = lines.findIndex(line => line.includes(needle)); return i < 0 ? 0 : i + 1;
  }
  requireFileRef(ref) { if (!(ref instanceof FileRef)) throw new DaCodeRuntimeError('Expected imported file reference'); }

  truth(value) {
    if (value === VOID) throw new DaCodeRuntimeError('Void is not a direct value and cannot be used as a condition');
    return Boolean(value);
  }

  smartString(template, env) {
    return template.replace(/\{([^{}]+)\}/g, (_, raw) => this.display(env.get(raw.trim())));
  }

  display(value) {
    if (value === VOID) return '';
    if (value && value.__color__) return this.display(value.value);
    if (value instanceof Error) return `${value.name}: ${value.message}`;
    if (Array.isArray(value)) return `[${value.map(v => this.display(v)).join(', ')}]`;
    if (value && value.constructor === Object) return JSON.stringify(value);
    return String(value);
  }

  withLine(error, line) {
    if (error instanceof DaCodeRuntimeError && error.line == null) error.line = line ?? null;
    return error;
  }
}

module.exports = { Interpreter, DaCodeRuntimeError, VOID };
