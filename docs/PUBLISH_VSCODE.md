# Публикация DaCode для VS Code

Расширение уже собирается и публикуется в GitHub Releases автоматически. Marketplace не обязателен.

## Без Marketplace

Готовый VSIX находится в GitHub Releases:

- release tag: `vscode-v0.2.0`;
- asset: `dacode-language-0.2.0.vsix`.

Установка в VS Code:

1. Скачать `.vsix`.
2. Открыть Extensions.
3. Открыть меню `...`.
4. Выбрать `Install from VSIX...`.
5. Выбрать скачанный файл.
6. Открыть любой `.dc`.

Через CLI:

```bash
code --install-extension dacode-language-0.2.0.vsix
```

Установка через VSIX не включает обычное Marketplace auto-update самого расширения. При этом синтаксис и runtime DaCode всё равно обновляются из `pomni-org/DaCode`, потому что это отдельный механизм DaCode Sync.

## Бесплатная публикация в VS Code Marketplace

В `package.json` уже указано:

```json
"publisher": "pomni-org",
"pricing": "Free"
```

Для публикации publisher ID в Marketplace должен совпадать с `publisher` в manifest. Если ID `pomni-org` уже занят кем-то другим, нужно создать доступный publisher ID и поменять поле `publisher`.

### Вариант A: ручная публикация

1. Войти в Visual Studio Marketplace под Microsoft account.
2. Создать Publisher.
3. До 1 декабря 2026 года можно создать Azure DevOps PAT с scope `Marketplace > Manage`.
4. Установить vsce:

```bash
npm install -g @vscode/vsce
```

5. Войти:

```bash
vsce login pomni-org
```

6. Из `editors/vscode` выполнить:

```bash
vsce publish
```

Либо можно взять уже собранный `.vsix` и загрузить его вручную через Marketplace Publisher Management.

### Вариант B: автоматическая публикация

Microsoft рекомендует переходить на Microsoft Entra ID / workload identity federation вместо долгоживущих PAT. Для будущей CI-публикации лучше использовать этот вариант.

## Релизы GitHub

Workflow `.github/workflows/release-vscode-extension.yml`:

- читает версию из `editors/vscode/package.json`;
- запускает тесты;
- собирает VSIX;
- создаёт GitHub Release `vscode-v<version>`;
- прикладывает `dacode-language-<version>.vsix`.

Для новой версии достаточно обновить `version` в `package.json` и запушить изменение расширения.
