'use strict';

const { Lexer } = require('./lexer');
const { Parser } = require('./parser');
const { Interpreter, DaCodeRuntimeError, VOID } = require('./interpreter');

function parse(source, spec = null) {
  return new Parser(new Lexer(source, spec).tokenize(), spec).parse();
}

async function execute(source, host, baseDir, spec = null) {
  const interpreter = new Interpreter(host, baseDir, spec);
  return interpreter.run(parse(source, spec));
}

module.exports = { Lexer, Parser, Interpreter, DaCodeRuntimeError, VOID, parse, execute };
