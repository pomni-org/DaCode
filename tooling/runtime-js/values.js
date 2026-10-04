'use strict';

class DaCodeRuntimeError extends Error {
  constructor(message, line = null, column = null) {
    super(message);
    this.name = 'DaCodeRuntimeError';
    this.line = line;
    this.column = column;
  }
}

class DaCodeRaisedError extends Error {
  constructor(value) {
    super(String(value));
    this.name = 'DaCodeRaisedError';
    this.value = value;
  }
}

class FunctionReturn extends Error {
  constructor(value) {
    super('function return');
    this.value = value;
  }
}
class StraightSkip extends Error {}
class ProgramExit extends Error {
  constructor(value = null) {
    super('program exit');
    this.value = value;
  }
}

const VOID = Object.freeze({ __dacodeVoid: true, toString: () => '' });
const VOID_LITERAL = Object.freeze({ __dacodeVoidLiteral: true });

class TypeMarker {
  constructor(name) { this.name = name; }
  toString() { return this.name; }
}

class FileRef {
  constructor(path) { this.path = path; }
}

function typeName(value) {
  if (value === VOID) return 'compound';
  if (value instanceof Error) return 'error';
  if (typeof value === 'boolean') return 'bool';
  if (typeof value === 'number') return Number.isInteger(value) ? 'numb' : 'numb.float';
  if (typeof value === 'string') return 'text';
  if (Array.isArray(value)) return 'list';
  if (value && value.constructor === Object) return 'dict';
  return value?.constructor?.name || typeof value;
}

function checkType(value, spec) {
  if (!spec) return;
  const allowed = spec.split('/');
  const actual = typeName(value);
  if (!allowed.includes(actual)) {
    throw new DaCodeRuntimeError(`Type error: expected ${spec}, got ${actual}`);
  }
}

module.exports = {
  DaCodeRuntimeError, DaCodeRaisedError, FunctionReturn, StraightSkip, ProgramExit,
  VOID, VOID_LITERAL, TypeMarker, FileRef, typeName, checkType,
};
