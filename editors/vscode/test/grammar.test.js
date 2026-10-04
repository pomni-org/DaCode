'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('package contributes an always-available DaCode grammar', () => {
  const root = path.join(__dirname, '..');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const grammar = manifest.contributes.grammars.find(item => item.language === 'dacode');
  assert.ok(grammar, 'DaCode grammar contribution is missing');
  assert.equal(grammar.scopeName, 'source.dacode');

  const grammarPath = path.resolve(root, grammar.path);
  const definition = JSON.parse(fs.readFileSync(grammarPath, 'utf8'));
  assert.equal(definition.scopeName, 'source.dacode');
  assert.ok(definition.repository.keywords);
  assert.ok(definition.repository.strings);
  assert.ok(definition.repository['line-comments']);
});
