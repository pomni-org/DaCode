from __future__ import annotations
from typing import TYPE_CHECKING
from dacode.ast.nodes import FuncDef
from .control import FunctionReturn, StraightSkip
from .environment import Environment
from .errors import DaCodeRuntimeError
from .types import check_type
from .values import VOID

if TYPE_CHECKING:
    from .interpreter import Interpreter


class UserFunction:
    def __init__(self, node: FuncDef, closure: Environment, interpreter: "Interpreter"):
        self.node = node
        self.closure = closure
        self.interpreter = interpreter

    def __call__(self, *args):
        env = Environment(self.closure)
        for index, param in enumerate(self.node.params):
            if index < len(args):
                value = args[index]
            elif param.default is not None:
                value = self.interpreter.eval_expr(param.default, self.closure)
            else:
                raise DaCodeRuntimeError(f"Missing parameter {param.name}")
            check_type(value, param.type_spec)
            env.define(param.name, value, param.type_spec)

        if len(args) > len(self.node.params):
            raise DaCodeRuntimeError("Too many parameters")

        try:
            self.interpreter.exec_block(self.node.body, env, inside_function=True)
        except FunctionReturn as returned:
            return returned.value
        except StraightSkip:
            return VOID
        return VOID
