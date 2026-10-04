# Как расширять DaCode

Архитектура специально сделана так, чтобы большинство расширений не требовали лезть во все слои сразу. Люди всё равно рано или поздно полезут, но хотя бы не обязаны.

## Добавить встроенную функцию

Создай installer:

```python
from dacode.builtins import default_builtin_registry
from dacode.runtime import Interpreter

registry = default_builtin_registry()

def install_math_extra(runtime):
    runtime.register_builtin("double", lambda value: value * 2)

registry.add(install_math_extra)
runtime = Interpreter(builtins=registry)
```

DaCode после этого понимает:

```dc
console(double(21))
```

Interpreter и parser менять не нужно.

## Добавить bridge нового языка

Adapter должен иметь поле `language` и метод `resolve(import_path)`:

```python
class DemoBridge:
    language = "demo"

    def resolve(self, import_path):
        if import_path == "answer":
            return 42
        raise LookupError(import_path)
```

Регистрация:

```python
from dacode.bridges import default_bridge_registry
from dacode.runtime import Interpreter

bridges = default_bridge_registry()
bridges.register(DemoBridge())
runtime = Interpreter(bridges=bridges)
```

DaCode:

```dc
from demo import answer
console(answer)
```

Чтобы реализовать настоящий Java/Rust/JS bridge, `resolve()` может поднимать subprocess, FFI, RPC или embedding runtime. Синтаксический слой от этого не меняется.

## Добавить новый statement

Если появляется новая конструкция языка, изменение идёт по цепочке:

1. Добавить AST-node в `ast/nodes.py`.
2. Научить `frontend/parser.py` строить этот node.
3. Добавить семантику выполнения в `runtime/interpreter.py`.
4. Добавить тесты.

Lexer трогается только если появляются новые токены/ключевые слова.

## Добавить новый builtin namespace

Например `net.*` или `web.*` лучше реализовывать отдельным объектом namespace и устанавливать через новый installer в `builtins/`, а не складывать ещё двадцать методов в interpreter.

## Тест расширяемости

`tests/test_extensions.py` специально проверяет, что пользовательский builtin и пользовательский bridge подключаются без правок parser/interpreter.
