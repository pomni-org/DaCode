# Contributing

## Локальная проверка

```bash
python -m pip install -e .
python -m unittest discover -s tests -v
```

Перед изменением синтаксиса добавляй тест, который показывает ожидаемое поведение `.dc` программы.

## Куда класть изменения

- grammar/tokenization → `src/dacode/frontend/`
- AST → `src/dacode/ast/`
- runtime semantics → `src/dacode/runtime/`
- стандартные команды → `src/dacode/builtins/`
- foreign runtimes → `src/dacode/bridges/`
- file discovery/loading → `src/dacode/loader/`

Не добавляй результаты конкретных `.dc` программ в CLI/runner. Результат должен всегда вычисляться из AST.

## Изменение синтаксиса

`src/dacode/language/spec.json` — машинный источник истины для редакторов и простых лексических категорий. Если добавляется keyword/type/literal/operator или меняются editor-facing правила, обнови spec вместе с frontend/runtime. VS Code сам увидит новый blob SHA.

Если меняется семантика исполнения, синхронно обновляй `tooling/runtime-js/`, потому что этот runtime скачивается VS Code-клиентом.
