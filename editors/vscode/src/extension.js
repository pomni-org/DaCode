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
    comments: {
      lineComment: spec.comments?.line || '#',
      blockComment: spec.comments?.block || ['"""', '"""'],
    },
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

  const startedAt = Date.now();
  try {
    const program = runtime.parse(document.getText(), activeRevision.spec);
    const controls = runtime.outputControls(program);
    if (!controls.hideStart) {
      output.appendLine(
        'DaCode: запуск ' + path.basename(document.fileName) +
        ' · ревизия ' + activeRevision.commitSha.slice(0, 7)
      );
    }
    await runtime.executeProgram(program, host, baseDir, activeRevision.spec);
    if (!controls.hideFinish) {
      output.appendLine(
        'DaCode: программа завершена. Код выхода: 0. Время: ' +
        (Date.now() - startedAt) + ' мс.'
      );
    }
  } catch (error) {
    reportExecutionError(document, error);
  }
}

function reportExecutionError(document, error) {
  const line = Math.max(1, Number(error?.line) || 1);
  const column = Math.max(1, Number(error?.column ?? error?.col) || 1);
  const reason = String(error?.message ?? error);
  const lineIndex = Math.min(document.lineCount - 1, line - 1);
  const lineText = document.lineAt(lineIndex).text;
  const startColumn = Math.min(Math.max(0, column - 1), lineText.length);
  const endColumn = Math.min(lineText.length, Math.max(startColumn + 1, lineText.length));
  const range = new vscode.Range(lineIndex, startColumn, lineIndex, endColumn);
  const diagnostic = new vscode.Diagnostic(
    range,
    'DaCode: ' + reason,
    vscode.DiagnosticSeverity.Error
  );
  diagnostic.source = 'DaCode';
  diagnostics.set(document.uri, [diagnostic]);

  output.appendLine('');
  output.appendLine('ОШИБКА DaCode');
  output.appendLine('Файл: ' + path.basename(document.fileName));
  output.appendLine('Строка: ' + line + ', столбец: ' + column);
  output.appendLine('Причина: ' + reason);
  const hint = errorHint(reason);
  if (hint) output.appendLine('Подсказка: ' + hint);
  output.appendLine('Программа остановлена. Код выхода: 1.');

  const editor = vscode.window.visibleTextEditors.find(
    item => item.document.uri.toString() === document.uri.toString()
  );
  if (editor) {
    editor.selection = new vscode.Selection(range.start, range.start);
    editor.revealRange(range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  }
  vscode.window.showErrorMessage('DaCode: ' + reason);
}

function errorHint(reason) {
  if (reason.includes('reserved DaCode word')) {
    return 'Зарезервированное слово нельзя использовать как имя переменной. Переименуй переменную, например в input_error.';
  }
  if (reason.includes('Input type error: expected')) {
    return 'Введённое значение не соответствует типу, который указан вторым параметром input().';
  }
  if (reason.includes('Type error: expected')) {
    return 'Значение не соответствует строгому типу переменной или return.back().';
  }
  if (reason.includes('is not defined in this container')) {
    return 'Переменная недоступна в этом контейнере или ещё не была объявлена.';
  }
  if (reason.includes('require remem or remember')) {
    return 'Функции и классы в DaCode объявляются только через remem/remember.';
  }
  if (reason.includes('straight(start)')) {
    return 'straight(start) должен быть самым первым оператором программы.';
  }
  if (reason.includes('straight(finish)')) {
    return 'straight(finish) должен быть самым последним оператором программы.';
  }
  return null;
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
