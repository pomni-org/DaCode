'use strict';

const vscode = require('vscode');
const path = require('path');
const {RepositorySync} = require('./repository-sync');

let contextRef;
let syncer;
let client;
let activeRevision;
let syncPromise = null;
let lastSyncAttempt = 0;
let timer;

async function activate(context) {
  contextRef = context;
  syncer = new RepositorySync(context.globalStorageUri.fsPath);

  context.subscriptions.push(
    vscode.commands.registerCommand('dacode.runFile', resource => dispatchRun(resource)),
    vscode.commands.registerCommand('dacode.interrupt', () => client?.interrupt?.('ctrl+c')),
    vscode.commands.registerCommand('dacode.syncLanguage', () => syncNow(true)),
    vscode.workspace.onDidOpenTextDocument(document => {
      if (
        document.languageId === 'dacode' &&
        vscode.workspace.getConfiguration('dacode').get('syncOnOpen', true)
      ) {
        syncNow(false);
      }
    })
  );

  const cached = await syncer.loadCached().catch(() => null);
  if (cached) await installRevision(cached);

  await syncNow(false);
  scheduleSync();
}

async function dispatchRun(resource) {
  if (!client) await syncNow(false);
  if (!client?.runFile) {
    vscode.window.showErrorMessage(
      'DaCode client is unavailable. Check the GitHub connection or run DaCode: Sync DaCode from GitHub.'
    );
    return;
  }
  return client.runFile(resource);
}

async function syncNow(notify) {
  const now = Date.now();
  if (!notify && now - lastSyncAttempt < 60000 && activeRevision) return activeRevision;
  if (syncPromise) return syncPromise;
  lastSyncAttempt = now;

  syncPromise = (async () => {
    try {
      const revision = await syncer.sync();
      if (!activeRevision || activeRevision.fingerprint !== revision.fingerprint || !client) {
        await installRevision(revision);
      } else {
        activeRevision = revision;
      }

      if (notify) {
        const state = revision.changed ? 'DaCode полностью обновлён из GitHub (' : 'DaCode уже актуален (';
        vscode.window.showInformationMessage(state + revision.commitSha.slice(0, 7) + ')');
      }
      return revision;
    } catch (error) {
      const cached = await syncer.loadCached().catch(() => null);
      if (cached) {
        if (!client || activeRevision?.fingerprint !== cached.fingerprint) {
          await installRevision(cached);
        }
        if (notify) {
          vscode.window.showWarningMessage(
            'GitHub недоступен; DaCode использует последнюю кэшированную ревизию: ' + error.message
          );
        }
        return cached;
      }

      vscode.window.showErrorMessage(
        'DaCode не может загрузить клиент из GitHub: ' + error.message
      );
      return null;
    } finally {
      syncPromise = null;
    }
  })();

  return syncPromise;
}

async function installRevision(revision) {
  if (client?.dispose) {
    try { await client.dispose(); } catch {}
  }

  const clientPath = path.join(
    revision.root,
    'editors/vscode/remote/client.js'
  );

  let remote;
  try {
    delete require.cache[require.resolve(clientPath)];
    remote = require(clientPath);
  } catch (error) {
    throw new Error('GitHub client could not be loaded: ' + error.message);
  }

  if (typeof remote.createClient !== 'function') {
    throw new Error('GitHub client does not export createClient()');
  }

  activeRevision = revision;
  client = await remote.createClient({
    vscode,
    context: contextRef,
    revision,
    bridge: {
      sync: syncNow,
      getRevision: () => activeRevision,
    },
  });
}

function scheduleSync() {
  if (timer) clearInterval(timer);
  const configured = Number(
    vscode.workspace.getConfiguration('dacode').get('syncIntervalMinutes', 15)
  ) || 15;
  const minutes = Math.max(5, configured);
  timer = setInterval(() => syncNow(false), minutes * 60 * 1000);
}

async function deactivate() {
  if (timer) clearInterval(timer);
  if (client?.dispose) await client.dispose();
  client = null;
}

module.exports = {activate, deactivate};
