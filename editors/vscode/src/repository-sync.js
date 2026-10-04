'use strict';

const fs = require('fs/promises');
const path = require('path');
const https = require('https');
const crypto = require('crypto');

const OWNER = 'pomni-org';
const REPO = 'DaCode';
const BRANCH = 'main';
const SPEC_PATH = 'src/dacode/language/spec.json';
const RUNTIME_PREFIX = 'tooling/runtime-js/';
const CLIENT_PREFIX = 'editors/vscode/remote/';

function requestText(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'DaCode-VSCode',
        'Accept': 'application/vnd.github+json',
        ...headers,
      },
    }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        requestText(res.headers.location, headers).then(resolve, reject);
        return;
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error('GitHub HTTP ' + res.statusCode + ': ' + body.slice(0, 300)));
          return;
        }
        resolve(body);
      });
    });
    req.setTimeout(15000, () => req.destroy(new Error('GitHub request timed out')));
    req.on('error', reject);
  });
}

class GitHubSource {
  async json(url) { return JSON.parse(await requestText(url)); }
  async text(url) { return requestText(url, {'Accept': 'text/plain'}); }
}

class RepositorySync {
  constructor(storageDir, source = new GitHubSource()) {
    this.storageDir = storageDir;
    this.source = source;
    this.activeFile = path.join(storageDir, 'active.json');
  }

  async remoteRevision() {
    const commit = await this.source.json(
      'https://api.github.com/repos/' + OWNER + '/' + REPO + '/commits/' + BRANCH
    );
    const commitSha = commit.sha;
    const tree = await this.source.json(
      'https://api.github.com/repos/' + OWNER + '/' + REPO + '/git/trees/' + commitSha + '?recursive=1'
    );
    const tracked = (tree.tree || [])
      .filter(item => item.type === 'blob' && (
        item.path === SPEC_PATH ||
        item.path.startsWith(RUNTIME_PREFIX) ||
        item.path.startsWith(CLIENT_PREFIX)
      ))
      .filter(item => item.path === SPEC_PATH || item.path.endsWith('.js'))
      .sort((a, b) => a.path.localeCompare(b.path));

    if (!tracked.some(item => item.path === SPEC_PATH)) {
      throw new Error('DaCode repository is missing ' + SPEC_PATH);
    }
    if (!tracked.some(item => item.path === RUNTIME_PREFIX + 'index.js')) {
      throw new Error('DaCode repository is missing ' + RUNTIME_PREFIX + 'index.js');
    }
    if (!tracked.some(item => item.path === CLIENT_PREFIX + 'client.js')) {
      throw new Error('DaCode repository is missing ' + CLIENT_PREFIX + 'client.js');
    }
    if (!tracked.some(item => item.path === CLIENT_PREFIX + 'language-service.js')) {
      throw new Error('DaCode repository is missing ' + CLIENT_PREFIX + 'language-service.js');
    }

    const fingerprint = crypto
      .createHash('sha256')
      .update(tracked.map(item => item.path + ':' + item.sha).join('\n'))
      .digest('hex')
      .slice(0, 24);

    return {commitSha, fingerprint, files: tracked.map(({path, sha}) => ({path, sha}))};
  }

  async readActive() {
    try { return JSON.parse(await fs.readFile(this.activeFile, 'utf8')); }
    catch { return null; }
  }

  async loadCached() {
    const active = await this.readActive();
    if (!active) return null;
    const root = path.join(this.storageDir, 'revisions', active.fingerprint);
    const spec = JSON.parse(await fs.readFile(path.join(root, SPEC_PATH), 'utf8'));
    return {...active, root, spec};
  }

  async sync() {
    await fs.mkdir(this.storageDir, {recursive: true});
    const remote = await this.remoteRevision();
    const current = await this.readActive();

    if (current?.fingerprint === remote.fingerprint) {
      return {...await this.loadCached(), changed: false};
    }

    const root = path.join(this.storageDir, 'revisions', remote.fingerprint);
    await fs.mkdir(root, {recursive: true});

    for (const file of remote.files) {
      const target = path.join(root, file.path);
      await fs.mkdir(path.dirname(target), {recursive: true});
      const raw = 'https://raw.githubusercontent.com/' + OWNER + '/' + REPO + '/' + remote.commitSha + '/' + file.path;
      const content = await this.source.text(raw);
      await fs.writeFile(target, content, 'utf8');
    }

    const spec = JSON.parse(await fs.readFile(path.join(root, SPEC_PATH), 'utf8'));
    validateSpec(spec);
    const active = {
      commitSha: remote.commitSha,
      fingerprint: remote.fingerprint,
      files: remote.files,
      syncedAt: new Date().toISOString(),
    };
    await fs.writeFile(this.activeFile, JSON.stringify(active, null, 2), 'utf8');
    return {...active, root, spec, changed: true};
  }
}

function validateSpec(spec) {
  if (!spec || spec.schemaVersion !== 1) throw new Error('Unsupported DaCode language spec schema');
  if (spec.language?.id !== 'dacode') throw new Error('Invalid DaCode language spec');
  if (!Array.isArray(spec.keywords) || !spec.types) throw new Error('Incomplete DaCode language spec');
}

module.exports = {
  RepositorySync,
  GitHubSource,
  validateSpec,
  constants: {OWNER, REPO, BRANCH, SPEC_PATH, RUNTIME_PREFIX, CLIENT_PREFIX},
};
