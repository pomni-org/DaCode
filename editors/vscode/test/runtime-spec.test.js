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
    keywords: ['remem', 'remember', 'func', 'class', 'straight', 'error'],
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
