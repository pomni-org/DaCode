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
