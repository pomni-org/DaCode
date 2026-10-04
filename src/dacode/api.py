from __future__ import annotations
from pathlib import Path
from .frontend import Lexer, Parser
from .runtime import Interpreter


def tokenize(source: str):
    return Lexer(source).tokenize()


def parse(source: str):
    return Parser(tokenize(source)).parse()


def execute(source: str, *, interpreter: Interpreter | None = None, base_dir=None):
    runtime = interpreter or Interpreter(base_dir=base_dir)
    return runtime.run(parse(source))


def execute_file(path: str | Path, *, interpreter: Interpreter | None = None):
    source_path = Path(path)
    return execute(
        source_path.read_text(encoding="utf-8"),
        interpreter=interpreter,
        base_dir=source_path.parent,
    )
