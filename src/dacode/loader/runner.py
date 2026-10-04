from __future__ import annotations
from pathlib import Path
from dacode.frontend import Lexer, Parser
from dacode.runtime import Interpreter
from .discovery import discover_dc


def run_file(path: str | Path, interpreter: Interpreter | None = None):
    source_path = Path(path)
    source = source_path.read_text(encoding="utf-8")
    program = Parser(Lexer(source).tokenize()).parse()
    runtime = interpreter or Interpreter(base_dir=source_path.parent)
    return runtime.run(program)


__all__ = ["discover_dc", "run_file"]
