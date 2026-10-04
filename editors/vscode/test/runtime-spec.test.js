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
