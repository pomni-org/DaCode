from __future__ import annotations
import os
from typing import Any
from dacode.ast.nodes import Program
from dacode.bridges import BridgeRegistry, default_bridge_registry
from dacode.builtins import BuiltinRegistry, default_builtin_registry
from .control import ProgramExit
from .environment import Environment
from .evaluator import EvaluatorMixin
from .statements import StatementExecutorMixin
from .values import VOID


class Interpreter(EvaluatorMixin, StatementExecutorMixin):
    """DaCode AST interpreter with injectable builtins and language bridges."""

    ANSI = {
        "red": "\033[31m",
        "green": "\033[32m",
        "blue": "\033[34m",
        "standard": "\033[0m",
    }

    def __init__(
        self,
        stdin=input,
        stdout=print,
        base_dir: str | os.PathLike[str] | None = None,
        *,
        builtins: BuiltinRegistry | None = None,
        bridges: BridgeRegistry | None = None,
    ):
        self.stdin = stdin
        self.stdout = stdout
        self.last_error = None
        self.base_dir = os.path.abspath(base_dir or os.getcwd())
        self.first_registry: dict[str, list[tuple[str, Any]]] = {}
        self.builtin_names: set[str] = set()
        self.global_env = Environment()
        self.bridges = bridges or default_bridge_registry()
        self.builtins = builtins or default_builtin_registry()
        self.builtins.install_into(self)

    def register_builtin(self, name: str, value, *, blocked: bool = True) -> None:
        self.global_env.define(name, value, blocked=blocked)
        self.builtin_names.add(name)

    def register_bridge(self, bridge) -> None:
        self.bridges.register(bridge)

    def run(self, program: Program):
        try:
            self.exec_block(program.statements, self.global_env)
        except ProgramExit as exited:
            if exited.value is not None and exited.value is not VOID:
                self.stdout(exited.value)
            return exited.value
        return VOID

    def console(self, *args):
        output = []
        for arg in args:
            if arg is VOID:
                output.append("")
            elif isinstance(arg, dict) and arg.get("__color__"):
                color = arg["__color__"]
                value = arg.get("value", "")
                output.append(self.ANSI.get(color, "") + str(value) + self.ANSI["standard"])
            else:
                output.append(str(arg))
        self.stdout("".join(output))

    def input_value(self, prompt="", expected=None):
        from .errors import DaCodeRuntimeError

        raw = self.stdin(str(prompt))
        if expected is None:
            return raw

        expected = str(expected)
        if expected == "numb":
            try:
                return int(raw)
            except (TypeError, ValueError) as exc:
                raise DaCodeRuntimeError("Input type error: expected numb") from exc
        if expected == "numb.float":
            try:
                return float(raw)
            except (TypeError, ValueError) as exc:
                raise DaCodeRuntimeError("Input type error: expected numb.float") from exc
        if expected == "bool":
            low = raw.strip().lower()
            if low in {"true", "1"}: return True
            if low in {"false", "0"}: return False
            raise DaCodeRuntimeError("Input type error: expected bool")
        if expected == "text":
            return raw
        raise DaCodeRuntimeError(
            f"input() does not accept direct keyboard conversion to {expected}"
        )

    @staticmethod
    def compute_return(*args):
        if len(args) == 1:
            return args[0]
        return args
