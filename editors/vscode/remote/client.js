'use strict';

const fs = require('fs/promises');
const path = require('path');
const {LanguageModel, TOKEN_TYPES} = require('./language-service');

async function createClient({vscode, revision, bridge}) {
  let currentRevision = revision;
  const output = vscode.window.createOutputChannel('DaCode');
  const diagnostics = vscode.languages.createDiagnosticCollection('dacode');
  const semanticEmitter = new vscode.EventEmitter();
  const inputState = new InputState(vscode);
  const model = new LanguageModel(revision.spec);
  const disposables = [output, diagnostics, semanticEmitter, inputState];
  let runState = null;

  applyRevision(currentRevision);

  disposables.push(
    vscode.languages.registerDocumentSemanticTokensProvider(
      {language: 'dacode'},
      {
        onDidChangeSemanticTokens: semanticEmitter.event,
        provideDocumentSemanticTokens(document) {
          const legend = new vscode.SemanticTokensLegend(TOKEN_TYPES);
          const builder = new vscode.SemanticTokensBuilder(legend);
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
        return model.completionItems().map(item => {
          const result = new vscode.CompletionItem(item.label, completionKind(vscode, item.kind));
          result.insertText = new vscode.SnippetString(item.insertText || item.label);
          result.detail = 'DaCode · GitHub ' + currentRevision.commitSha.slice(0, 7);
          return result;
        });
      },
    }, '.', ' '),
    vscode.languages.registerHoverProvider('dacode', {
      provideHover(document, position) {
        const range = document.getWordRangeAtPosition(position, /[\p{L}\p{N}_.]+/u);
        if (!range) return null;
        const text = model.hover(document.getText(range));
        return text ? new vscode.Hover(new vscode.MarkdownString(text), range) : null;
      },
    })
  );

  function applyRevision(next) {
    currentRevision = next;
    model.update(next.spec);
    const spec = next.spec;

    if (applyRevision.languageDisposable) {
      applyRevision.languageDisposable.dispose();
    }
    applyRevision.languageDisposable = vscode.languages.setLanguageConfiguration('dacode', {
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

  async function runFile(resource) {
    if (runState) {
      vscode.window.showWarningMessage('DaCode уже выполняет программу. Нажми Ctrl+C для остановки.');
      return;
    }
    let document;
    if (resource instanceof vscode.Uri) document = await vscode.workspace.openTextDocument(resource);
    else document = vscode.window.activeTextEditor?.document;

    if (!document || document.languageId !== 'dacode') {
      vscode.window.showErrorMessage('Открой .dc файл, чтобы запустить DaCode.');
      return;
    }

    const latest = bridge.getRevision();
    if (latest && latest.fingerprint !== currentRevision.fingerprint) {
      currentRevision = latest;
      model.update(latest.spec);
    }

    const runtimePath = path.join(currentRevision.root, 'tooling/runtime-js/index.js');
    let runtime;
    try {
      delete require.cache[require.resolve(runtimePath)];
      runtime = require(runtimePath);
    } catch (error) {
      vscode.window.showErrorMessage('DaCode runtime из GitHub не загрузился: ' + error.message);
      return;
    }

    if (vscode.workspace.getConfiguration('dacode').get('clearOutputBeforeRun', true)) output.clear();
    output.show(true);
    diagnostics.delete(document.uri);

    const baseDir = document.isUntitled
      ? (vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd())
      : path.dirname(document.uri.fsPath);

    runState = {interrupted: false};
    await vscode.commands.executeCommand('setContext', 'dacode.running', true);
    const host = {
      write: value => output.appendLine(String(value)),
      clear: () => output.clear(),
      input: prompt => vscode.window.showInputBox({prompt: String(prompt), title: 'DaCode input'}),
      readText: filePath => fs.readFile(filePath, 'utf8'),
      writeText: (filePath, text) => fs.writeFile(filePath, text, 'utf8'),
      logFile: null,
      logAll: false,
      keyPressed: key => inputState.keyPressed(key),
      captureKey: key => inputState.capture(key),
      mousePressed: button => inputState.mousePressed(button),
      async yieldControl() {
        await new Promise(resolve => setImmediate(resolve));
        if (runState?.interrupted) {
          const error = new Error('Программа остановлена пользователем.');
          error.code = 'DACODE_INTERRUPTED';
          throw error;
        }
      },
    };

    const startedAt = Date.now();
    try {
      const program = runtime.parse(document.getText(), currentRevision.spec);
      const controls = runtime.outputControls(program);
      if (!controls.hideStart) {
        output.appendLine(
          'DaCode: запуск ' + path.basename(document.fileName) +
          ' · GitHub ' + currentRevision.commitSha.slice(0, 7)
        );
      }
      await runtime.executeProgram(program, host, baseDir, currentRevision.spec);
      if (!controls.hideFinish) {
        output.appendLine(
          'DaCode: программа завершена. Код выхода: 0. Время: ' +
          (Date.now() - startedAt) + ' мс.'
        );
      }
    } catch (error) {
      if (error?.code === 'DACODE_INTERRUPTED') {
        output.appendLine('DaCode: программа остановлена пользователем (Ctrl+C).');
      } else {
        reportExecutionError(vscode, diagnostics, output, document, error);
      }
    } finally {
      runState = null;
      await vscode.commands.executeCommand('setContext', 'dacode.running', false);
    }
  }

  function interrupt(chord = 'ctrl+c') {
    if (!runState) return false;
    if (inputState.isCaptured(chord)) inputState.pulse(chord);
    else runState.interrupted = true;
    return true;
  }

  async function dispose() {
    if (applyRevision.languageDisposable) applyRevision.languageDisposable.dispose();
    for (const item of disposables.reverse()) {
      try { item.dispose(); } catch {}
    }
  }

  return {runFile, interrupt, applyRevision, dispose};
}

class InputState {
  constructor(vscode) {
    this.vscode = vscode;
    this.keys = new Set();
    this.buttons = new Set();
    this.pulses = new Set();
    this.captured = new Set();
    this.panel = null;
    this.messageDisposable = null;
  }
  normalize(value) { return String(value).trim().toLowerCase(); }
  isCaptured(value) { return this.captured.has(this.normalize(value)); }
  capture(value) { this.ensurePanel(); this.captured.add(this.normalize(value)); return true; }
  pulse(value) { this.pulses.add(this.normalize(value)); }
  keyPressed(value) {
    this.ensurePanel();
    const key = this.normalize(value);
    if (this.pulses.delete(key)) return true;
    return this.keys.has(key);
  }
  mousePressed(value) { this.ensurePanel(); return this.buttons.has(this.normalize(value)); }
  ensurePanel() {
    if (this.panel) return;
    const panel = this.vscode.window.createWebviewPanel(
      'dacodeControls', 'DaCode Controls', this.vscode.ViewColumn.Beside,
      {enableScripts: true, retainContextWhenHidden: true}
    );
    panel.webview.html = controlsHtml();
    this.messageDisposable = panel.webview.onDidReceiveMessage(message => {
      const target = message.kind === 'mouse' ? this.buttons : this.keys;
      const value = this.normalize(message.value);
      if (message.down) target.add(value); else target.delete(value);
    });
    panel.onDidDispose(() => {
      this.messageDisposable?.dispose();
      this.messageDisposable = null;
      this.panel = null;
      this.keys.clear();
      this.buttons.clear();
    });
    this.panel = panel;
  }
  dispose() { this.messageDisposable?.dispose(); this.panel?.dispose(); }
}

function controlsHtml() {
  return `<!doctype html><html><body tabindex="0" style="font-family:sans-serif;padding:24px">
  <h2>DaCode Controls</h2><p>Держи эту панель в фокусе для keyboard.pressed() и mouse.pressed().</p>
  <script>const v=acquireVsCodeApi(),keys=new Set();
  const key=e=>[e.ctrlKey?'ctrl':null,e.shiftKey?'shift':null,e.altKey?'alt':null,e.key.toLowerCase()].filter(Boolean).join('+');
  addEventListener('keydown',e=>{e.preventDefault();v.postMessage({kind:'key',value:key(e),down:true})});
  addEventListener('keyup',e=>{e.preventDefault();v.postMessage({kind:'key',value:key(e),down:false})});
  addEventListener('mousedown',e=>v.postMessage({kind:'mouse',value:['left','middle','right'][e.button]||String(e.button),down:true}));
  addEventListener('mouseup',e=>v.postMessage({kind:'mouse',value:['left','middle','right'][e.button]||String(e.button),down:false}));
  addEventListener('blur',()=>{['left','middle','right'].forEach(value=>v.postMessage({kind:'mouse',value,down:false}))});
  document.body.focus();</script></body></html>`;
}

function reportExecutionError(vscode, diagnostics, output, document, error) {
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
    return 'Зарезервированное слово нельзя использовать как имя переменной.';
  }
  if (reason.includes('Input type error: expected')) {
    return 'Введённое значение не соответствует типу во втором параметре input().';
  }
  if (reason.includes('Type error: expected')) {
    return 'Значение не соответствует строгому типу.';
  }
  if (reason.includes('is not defined in this container')) {
    return 'Переменная недоступна в этом контейнере или ещё не объявлена.';
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

function completionKind(vscode, kind) {
  return {
    keyword: vscode.CompletionItemKind.Keyword,
    function: vscode.CompletionItemKind.Function,
    class: vscode.CompletionItemKind.Class,
    type: vscode.CompletionItemKind.TypeParameter,
    constant: vscode.CompletionItemKind.Constant,
  }[kind] || vscode.CompletionItemKind.Text;
}

module.exports = {createClient};
