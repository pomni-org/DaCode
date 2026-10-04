'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {LanguageModel} = require('../remote/language-service');

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

test('multiline triple-quote comments are highlighted as comments', () => {
  const model = new LanguageModel({
    keywords:['remem'], literals:[],
    types:{direct:[],compound:[],subtypes:[]}, builtins:[], specialIdentifiers:[],
    operators:[], comments:{line:'#',block:['"""','"""']},
  });
  const tokens = model.tokens('"""\nhello\n"""\nremem test():');
  assert.equal(tokens.filter(x => x.type === 'comment').length, 3);
  assert.ok(tokens.some(x => x.type === 'function'));
});
