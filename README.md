# DaCode

DaCode 1.0 bootstrap: лексер, AST, парсер и настоящий интерпретатор для файлов `.dc`.

Интерпретатор написан на Python 3.11+ как bootstrap-реализация. Результат программы вычисляется из содержимого `.dc` через цепочку `Lexer → Parser → AST → Interpreter`. Никаких захардкоженных ответов и обязательного имени `main.dc` нет.

## Быстрый старт

```bash
python -m pip install -e .
dacode examples/hello.dc
```

Можно передать каталог:

```bash
dacode examples
```

В этом случае runner выбирает файлы **по расширению `.dc`**, а не по конкретному имени файла. Файлы с другими расширениями не исполняются.

Отладка frontend:

```bash
dacode --tokens examples/functions.dc
dacode --ast examples/functions.dc
```

Тесты:

```bash
python -m unittest discover -s tests -v
```

## Структура

```text
DaCode/
├── src/dacode/
│   ├── ast/             # модели AST, без runtime-зависимостей
│   ├── frontend/        # токены, lexer, parser
│   ├── runtime/         # контейнеры, типы, значения, interpreter
│   ├── builtins/        # расширяемая стандартная библиотека
│   ├── bridges/         # адаптеры внешних языков/runtime
│   ├── loader/          # поиск .dc и запуск файлов
│   ├── api.py           # программный API
│   └── cli.py           # CLI
├── tests/
├── examples/
├── docs/
└── .github/workflows/
```

Подробности: [архитектура](docs/ARCHITECTURE.md) и [как расширять DaCode](docs/EXTENDING.md).

## Уже поддерживается

- `INDENT/DEDENT`, переносы внутри `()[]{}`.
- Переменные, `block`, строгие и составные `/` типы.
- `numb`, `numb.float`, `text`, `bool`, `list`, `dict`, `compound`, `error`, `Void`.
- 1-based индексация.
- Арифметика, сравнения, `if/elif/else`, `while`, `for`, `range`.
- `remem func`, параметры вида `text=name`, значения по умолчанию через `and`/`&`.
- `return(...)`, `return.back(...) type`.
- `straight()`, постфиксный `straight(error)`, `error()`, `exit()`.
- `console`, `w"..."`, цветные сегменты.
- `random(1-10)`, `random.choice(...)`.
- `clear()`, `os.get(<|>)`, `log`.
- Операции списков и строк.
- Контейнеры `open()/close()`.
- Классы, `first/twice`, конструктор `User()`.
- Простые файловые DB: `read/write/delete/replace/find`.
- DaCode-модули `from loading import loading = load`.
- Настоящий Python bridge.

## Bridges

Python подключён реально через `importlib`:

```dc
from python import math.sqrt = root
console(root(144))
```

Для JavaScript, Java, C#, C++, Rust, Go, Kotlin и Swift parser менять не нужно: добавляется adapter в `BridgeRegistry`. Пока конкретного adapter/runtime нет, интерпретатор выдаёт честную ошибку, а не делает вид, будто JVM появилась из святого духа.

## Статус

Это bootstrap, а не финальная VM/компилятор. Архитектура специально разделена так, чтобы синтаксис, runtime, builtins и bridges можно было развивать независимо.
