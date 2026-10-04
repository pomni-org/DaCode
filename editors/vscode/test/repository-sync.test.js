'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const {RepositorySync, constants} = require('../src/repository-sync');

class FakeSource {
  constructor() { this.rev = 1; }
  async json(url) {
    if (url.includes('/commits/')) return {sha: 'commit-' + this.rev};
    return {tree: [
      {type:'blob', path:constants.SPEC_PATH, sha:'spec-' + this.rev},
      {type:'blob', path:constants.RUNTIME_PREFIX + 'index.js', sha:'run-' + this.rev},
      {type:'blob', path:constants.CLIENT_PREFIX + 'client.js', sha:'client-' + this.rev},
      {type:'blob', path:constants.CLIENT_PREFIX + 'language-service.js', sha:'lang-' + this.rev},
    ]};
  }
  async text(url) {
    if (url.endsWith(constants.SPEC_PATH)) {
      return JSON.stringify({schemaVersion:1, language:{id:'dacode'}, keywords:['if'], types:{direct:['numb'], compound:[], subtypes:[]}});
    }
    if (url.endsWith(constants.CLIENT_PREFIX + 'client.js')) {
      return 'module.exports={createClient:async()=>({runFile:async()=>{},dispose:async()=>{}})};';
    }
    if (url.endsWith(constants.CLIENT_PREFIX + 'language-service.js')) {
      return 'module.exports={LanguageModel:class{},TOKEN_TYPES:[]};';
    }
    return 'module.exports={execute:async()=>{}};';
  }
}

test('sync changes when tracked GitHub blob SHA changes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dacode-sync-'));
  const source = new FakeSource();
  const sync = new RepositorySync(root, source);
  const a = await sync.sync();
  assert.equal(a.changed, true);
  const b = await sync.sync();
  assert.equal(b.changed, false);
  source.rev = 2;
  const c = await sync.sync();
  assert.equal(c.changed, true);
  assert.notEqual(c.fingerprint, a.fingerprint);
  await fs.access(path.join(c.root, constants.CLIENT_PREFIX, 'client.js'));
  await fs.access(path.join(c.root, constants.CLIENT_PREFIX, 'language-service.js'));
});
