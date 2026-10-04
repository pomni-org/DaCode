from __future__ import annotations
import os
from .namespaces import LogNamespace, OSNamespace, RandomNamespace
from dacode.runtime.errors import DaCodeRuntimeError
from dacode.runtime.values import TypeMarker


TYPE_MARKERS = ("numb", "text", "bool", "list", "dict", "compound", "error")


def install_core_builtins(interpreter) -> None:
    interpreter.register_builtin("random", RandomNamespace())
    interpreter.register_builtin("os", OSNamespace())
    interpreter.register_builtin("log", LogNamespace(interpreter.stdout))
    interpreter.register_builtin("range", lambda a, b=None: list(range(a, b)) if b is not None else list(range(1, a)))
    interpreter.register_builtin("console", interpreter.console)
    interpreter.register_builtin("input", interpreter.input_value)
    interpreter.register_builtin("clear", lambda: os.system("cls" if os.name == "nt" else "clear"))
    interpreter.register_builtin("return", interpreter.compute_return)

    for type_name in TYPE_MARKERS:
        interpreter.register_builtin(type_name, TypeMarker(type_name))
