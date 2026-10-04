'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const runtime = require(path.resolve(__dirname, '../../../tooling/runtime-js'));

test('downloaded runtime consumes the downloaded language spec', async () => {
  const spec = {
    keywords: ['if', 'customkw'], literals: ['true', 'false', 'Void'],
    types: {direct:['numb','text','bool','list','dict','error'], compound:['compound'], subtypes:['numb.float']},
  };
  const tokens = new runtime.Lexer('customkw\n', spec).tokenize();
  assert.equal(tokens[0].kind, 'KW');
});

test('remem works for variables and output controls are parsed', async () => {
  const spec = {
    keywords: ['remem', 'remember', 'straight', 'error'],
    literals: ['true', 'false', 'Void'],
    types: {direct:['numb','text','bool','list','dict','error'], compound:['compound'], subtypes:['numb.float']},
  };
  const program = runtime.parse(
    'straight(start)\nremem name="Дак"\nstraight(finish)\n',
    spec
  );
  assert.deepEqual(runtime.outputControls(program), {hideStart:true, hideFinish:true});
  assert.equal(program.statements[1].kind, 'Assignment');
});

test('reserved keyword variable name produces a useful error', () => {
  const spec = {
    keywords: ['error', 'straight'],
    literals: [],
    types: {direct:['error'], compound:[], subtypes:[]},
  };
  assert.throws(
    () => runtime.parse('error = straight(error)\n', spec),
    /reserved DaCode word/
  );
});

test('new remem syntax distinguishes function class and variable', () => {
  const spec = {
    keywords:['remem','remember','straight','error'], literals:['true','false','Void'],
    types:{direct:['numb','text','bool','list','dict','error'],compound:['compound'],subtypes:['numb.float']},
  };
  const program = runtime.parse(
    'remem add(numb=a, numb=b):\n    return.back(a+b) numb\nremem User:\n    first.name="Дак"\nremem x = 2\n',
    spec
  );
  assert.equal(program.statements[0].kind, 'FuncDef');
  assert.equal(program.statements[1].kind, 'ClassDef');
  assert.equal(program.statements[2].kind, 'Assignment');
});

test('triple quote comments are ignored by runtime lexer', () => {
  const spec = {
    keywords:['remem'], literals:['true','false','Void'],
    types:{direct:['numb','text','bool','list','dict','error'],compound:['compound'],subtypes:['numb.float']},
  };
  const program = runtime.parse(
    'console("before")\n"""\nnot code at all !!!\n"""\nconsole("after")\n',
    spec
  );
  assert.equal(program.statements.length, 2);
});

test('GitHub client module loads and exports createClient', () => {
  const client = require('../remote/client');
  assert.equal(typeof client.createClient, 'function');
});
