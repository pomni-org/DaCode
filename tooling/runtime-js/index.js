'use strict';

const { Lexer } = require('./lexer');
const { Parser } = require('./parser');
const { Interpreter, DaCodeRuntimeError, VOID } = require('./interpreter');

function parse(source, spec = null) {
  return new Parser(new Lexer(source, spec).tokenize(), spec).parse();
}

function outputControls(program) {
  const statements = program?.statements || [];
  return {
    hideStart: statements[0]?.kind === 'StraightStmt' && statements[0]?.controlMode === 'start',
    hideFinish: statements[statements.length - 1]?.kind === 'StraightStmt' && statements[statements.length - 1]?.controlMode === 'finish',
  };
}

async function executeProgram(program, host, baseDir, spec = null) {
  const interpreter = new Interpreter(host, baseDir, spec);
  return interpreter.run(program);
}

async function execute(source, host, baseDir, spec = null) {
  return executeProgram(parse(source, spec), host, baseDir, spec);
}

module.exports = {
  Lexer, Parser, Interpreter, DaCodeRuntimeError, VOID,
  parse, outputControls, executeProgram, execute,
};
