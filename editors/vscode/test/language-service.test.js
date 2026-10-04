'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {LanguageModel} = require('../src/language-service');

const spec = {
  keywords: ['if', 'func'], literals: ['Void'],
  types: {direct: ['text', 'numb'], compound: ['compound'], subtypes: ['numb.float']},
  builtins: ['console'], specialIdentifiers: ['first', 'twice'],
  operators: ['==', '=', '+'], completion: [], hover: {Void: 'empty'},
};

test('highlighting comes from spec, not hardcoded DaCode keywords', () => {
  const model = new LanguageModel(spec);
  const tokens = model.tokens('if console text Void custom');
  assert.deepEqual(tokens.map(x => x.type), ['keyword', 'function', 'type', 'keyword', 'variable']);
  model.update({...spec, keywords: ['custom']});
  const next = model.tokens('if custom');
  assert.deepEqual(next.map(x => x.type), ['variable', 'keyword']);
});
