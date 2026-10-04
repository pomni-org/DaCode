'use strict';

const vscode = require('vscode');
const fs = require('fs/promises');
const path = require('path');
const {RepositorySync} = require('./repository-sync');
const {LanguageModel, TOKEN_TYPES} = require('./language-service');

let output;
let diagnostics;
let syncer;
let activeRevision;
let model;
let languageConfigurationDisposable;
let timer;
let semanticEmitter;
let syncPromise = null;
let lastSyncAttempt = 0;

async function activate(context) {
  output = vscode.window.createOutputChannel('DaCode');
  diagnostics = vscode.languages.createDiagnosticCollection('dacode');
  syncer = new RepositorySync(context.globalStorageUri.fsPath);
  semanticEmitter = new vscode.EventEmitter();
  context.subscriptions.push(output, diagnostics, semanticEmitter);

  const cached = await syncer.loadCached().catch(() => null);
  if (cached) applyRevision(cached);

  context.subscriptions.push(
    vscode.commands.registerCommand('dacode.runFile', uri => runFile(uri)),
    vscode.commands.registerCommand('dacode.syncLanguage', () => syncNow(true)),
    vscode.languages.registerDocumentSemanticTokensProvider(
      {language: 'dacode'},
      {
        onDidChangeSemanticTokens: semanticEmitter.event,
        provideDocumentSemanticTokens(document) {
          const legend = new vscode.SemanticTokensLegend(TOKEN_TYPES);
          const builder = new vscode.SemanticTokensBuilder(legend);
          if (!model) return builder.build();
          for (const token of model.tokens(document.getText())) {
            builder.push(token.line, token.start, token.length, TOKEN_TYPES.indexOf(token.type), 0);
          }
          return builder.build();
        },
      },
      new vscode.SemanticTokensLegend(TOKEN_TYPES)
    ),
    vscode.languages.registerCompletionItemProvider('dacode', {
      provideCompletionItems() {
        if (!model) return [];
        return model.completionItems().map(item => {
          const result = new vscode.CompletionItem(item.label, completionKind(item.kind));
          result.insertText = new vscode.SnippetString(item.insertText || item.label);
          result.detail = 'DaCode · synced from GitHub';
          return result;
        });
      },
    }, '.', ' '),
    vscode.languages.registerHoverProvider('dacode', {
      provideHover(document, position) {
        if (!model) return null;
        const range = document.getWordRangeAtPosition(position, /[\p{L}\p{N}_.]+/u);
        if (!range) return null;
        const text = model.hover(document.getText(range));
        return text ? new vscode.Hover(new vscode.MarkdownString(text), range) : null;
      },
    }),
    vscode.workspace.onDidOpenTextDocument(doc => {
      if (doc.languageId === 'dacode' && vscode.workspace.getConfiguration('dacode').get('syncOnOpen', true)) {
        syncNow(false);
      }
    })
  );

  await syncNow(false);
  scheduleSync();
}

async function syncNow(notify) {
  const now = Date.now();
  if (!notify && now - lastSyncAttempt < 60000) return activeRevision;
  if (syncPromise) return syncPromise;
  lastSyncAttempt = now;
  syncPromise = (async () => {
    try {
      const revision = await syncer.sync();
      applyRevision(revision);
      if (notify) {
        const status = revision.changed ? 'DaCode updated from GitHub (' : 'DaCode is current (';
        vscode.window.showInformationMessage(status + revision.commitSha.slice(0, 7) + ')');
      }
      return revision;
    } catch (error) {
      const cached = await syncer.loadCached().catch(() => null);
      if (cached) {
        applyRevision(cached);
        if (notify) vscode.window.showWarningMessage('DaCode sync failed; using cached revision: ' + error.message);
        return cached;
      }
      vscode.window.showErrorMessage('DaCode cannot load its language definition: ' + error.message);
      return null;
    } finally {
      syncPromise = null;
    }
  })();
  return syncPromise;
}

function applyRevision(revision) {
  activeRevision = revision;
  if (!model) model = new LanguageModel(revision.spec);
  else model.update(revision.spec);

  if (languageConfigurationDisposable) languageConfigurationDisposable.dispose();
  const spec = revision.spec;
  languageConfigurationDisposable = vscode.languages.setLanguageConfiguration('dacode', {
    comments: {lineComment: spec.comments?.line || '#'},
    brackets: spec.brackets || [['(', ')'], ['[', ']'], ['{', '}']],
    autoClosingPairs: (spec.autoClosingPairs || []).map(([open, close]) => ({open, close})),
    surroundingPairs: (spec.autoClosingPairs || []).map(([open, close]) => ({open, close})),
    indentationRules: buildIndentationRules(spec),
  });
  semanticEmitter.fire();
}

function scheduleSync() {
  if (timer) clearInterval(timer);
  const configured = Number(vscode.workspace.getConfiguration('dacode').get('syncIntervalMinutes', 15)) || 15;
  const minutes = Math.max(5, configured);
  timer = setInterval(() => syncNow(false), minutes * 60 * 1000);
}

async function runFile(resource) {
  let document;
  if (resource instanceof vscode.Uri) document = await vscode.workspace.openTextDocument(resource);
  else document = vscode.window.activeTextEditor?.document;
  if (!document || document.languageId !== 'dacode') {
    vscode.window.showErrorMessage('Open a .dc file to run DaCode.');
    return;
  }

  if (!activeRevision) await syncNow(false);
  if (!activeRevision) return;

  const runtimePath = path.join(activeRevision.root, 'tooling/runtime-js/index.js');
  let runtime;
  try { runtime = require(runtimePath); }
  catch (error) {
    vscode.window.showErrorMessage('DaCode runtime could not be loaded: ' + error.message);
    return;
  }

  if (vscode.workspace.getConfiguration('dacode').get('clearOutputBeforeRun', true)) output.clear();
  output.show(true);
  diagnostics.delete(document.uri);
  output.appendLine('▶ ' + path.basename(document.fileName) + ' · DaCode ' + activeRevision.commitSha.slice(0, 7));

  const baseDir = document.isUntitled
    ? (vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd())
    : path.dirname(document.uri.fsPath);

  const host = {
    write: value => output.appendLine(String(value)),
    clear: () => output.clear(),
    input: prompt => vscode.window.showInputBox({prompt: String(prompt), title: 'DaCode input'}),
    readText: filePath => fs.readFile(filePath, 'utf8'),
    writeText: (filePath, text) => fs.writeFile(filePath, text, 'utf8'),
    logFile: null,
    logAll: false,
  };

  try {
    await runtime.execute(document.getText(), host, baseDir, activeRevision.spec);
    output.appendLine('✓ DaCode finished');
  } catch (error) {
    output.appendLine('✗ ' + (error?.message ?? error));
    vscode.window.showErrorMessage('DaCode: ' + (error?.message ?? error));
  }
}

function buildIndentationRules(spec) {
  const suffix = escapeRegex(spec.indentation?.blockSuffix || ':');
  const comment = escapeRegex(spec.comments?.line || '#');
  const dedent = (spec.indentation?.dedentKeywords || ['elif', 'else']).map(escapeRegex).join('|');
  return {
    increaseIndentPattern: new RegExp('^.*' + suffix + '\\s*(?:' + comment + '.*)?$'),
    decreaseIndentPattern: new RegExp('^\\s*(?:' + dedent + ')\\b'),
  };
}

function escapeRegex(value) {
  return String(value).replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

function completionKind(kind) {
  return {
    keyword: vscode.CompletionItemKind.Keyword,
    function: vscode.CompletionItemKind.Function,
    class: vscode.CompletionItemKind.Class,
    type: vscode.CompletionItemKind.TypeParameter,
    constant: vscode.CompletionItemKind.Constant,
  }[kind] || vscode.CompletionItemKind.Text;
}

function deactivate() {
  if (timer) clearInterval(timer);
  if (languageConfigurationDisposable) languageConfigurationDisposable.dispose();
}

module.exports = {activate, deactivate};
