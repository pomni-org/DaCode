# DaCode 1.0: статус bootstrap

Этот файл фиксирует то, что bootstrap уже исполняет, и не выдаёт планы за готовый runtime.

## Реализовано

- базовые типы и строгая типизация;
- `numb.float` как подтип чисел;
- `Void`/`compound`;
- условия и циклы;
- функции, `return.back`, `straight`;
- классы и базовая модель `first/twice`;
- стандартные строковые/списочные операции;
- файловые операции;
- Python bridge;
- импорт DaCode-модулей;
- CLI и поиск `.dc` по расширению.

## Требует отдельных runtime-adapters

- JavaScript;
- Java;
- C#;
- C++;
- Rust;
- Go;
- Kotlin;
- Swift;
- полноценный Web DOM/server runtime.

Эти возможности не эмулируются фальшивыми значениями. Если adapter не подключён, runtime сообщает об этом.
