from __future__ import annotations
import re
from dacode.ast.nodes import (
    Attribute, Binary, Call, DictLiteral, Index, ListLiteral, Literal, Name,
    ReadTransform, SmartString, Unary, VoidLiteral,
)
from .control import FunctionReturn
from .errors import DaCodeRuntimeError
from .values import RangeSpec, VOID


class EvaluatorMixin:
    def eval_expr(self, expr, env):
        if isinstance(expr, Literal):
            return VOID if expr.value is VoidLiteral else expr.value

        if isinstance(expr, Name):
            try:
                return env.get(expr.name)
            except DaCodeRuntimeError:
                if expr.name in self.builtin_names:
                    return self.global_env.get(expr.name)
                raise

        if isinstance(expr, ListLiteral):
            return [self.eval_expr(item, env) for item in expr.items]

        if isinstance(expr, DictLiteral):
            return {
                self.eval_expr(key, env): self.eval_expr(value, env)
                for key, value in expr.items
            }

        if isinstance(expr, SmartString):
            return self.smart_string(expr.template, env)

        if isinstance(expr, ReadTransform):
            data = self.eval_expr(expr.source, env)
            separator = self.eval_expr(expr.separator, env)
            return [line.split(separator) for line in data]

        if isinstance(expr, Unary):
            value = self.eval_expr(expr.expr, env)
            if value is VOID:
                raise DaCodeRuntimeError("Void cannot be used in an operation")
            return {
                "-": lambda: -value,
                "+": lambda: +value,
                "not": lambda: not self.truth(value),
            }[expr.op]()

        if isinstance(expr, Binary):
            return self._eval_binary(expr, env)

        if isinstance(expr, Attribute):
            obj = self.eval_expr(expr.obj, env)
            native = self._native_attribute(obj, expr.name)
            if native is not None:
                return native
            return getattr(obj, expr.name)

        if isinstance(expr, Index):
            obj = self.eval_expr(expr.obj, env)
            index = self.eval_expr(expr.index, env)
            if isinstance(obj, (list, str)) and isinstance(index, int):
                index -= 1
            return obj[index]

        if isinstance(expr, Call):
            return self._eval_call(expr, env)

        raise DaCodeRuntimeError(f"Unsupported expression {type(expr).__name__}")

    def _eval_binary(self, expr: Binary, env):
        left = self.eval_expr(expr.left, env)
        right = self.eval_expr(expr.right, env)
        if left is VOID or right is VOID:
            if expr.op in {"==", "!="}:
                return (left is right) if expr.op == "==" else (left is not right)
            raise DaCodeRuntimeError("Void cannot be used in an operation")

        operations = {
            "+": lambda: left + right,
            "-": lambda: left - right,
            "*": lambda: left * right,
            "/": lambda: left / right,
            "//": lambda: left // right,
            "%": lambda: left % right,
            "**": lambda: left ** right,
            "==": lambda: left == right,
            "!=": lambda: left != right,
            "<": lambda: left < right,
            "<=": lambda: left <= right,
            ">": lambda: left > right,
            ">=": lambda: left >= right,
            "and": lambda: self.truth(left) and self.truth(right),
            "or": lambda: self.truth(left) or self.truth(right),
        }
        return operations[expr.op]()

    def _eval_call(self, expr: Call, env):
        if (
            isinstance(expr.func, Attribute)
            and isinstance(expr.func.obj, Name)
            and expr.func.obj.name == "return"
            and expr.func.name == "back"
        ):
            raise FunctionReturn(self.eval_expr(expr.args[0], env) if expr.args else VOID)

        if (
            isinstance(expr.func, Name)
            and expr.func.name == "random"
            and len(expr.args) == 1
            and isinstance(expr.args[0], Binary)
            and expr.args[0].op == "-"
        ):
            start = self.eval_expr(expr.args[0].left, env)
            end = self.eval_expr(expr.args[0].right, env)
            return self.global_env.get("random")(RangeSpec(start, end))

        fn = self.eval_expr(expr.func, env)
        args = [self.eval_expr(arg, env) for arg in expr.args]
        try:
            return fn(*args)
        except Exception as error:
            self.last_error = error
            raise

    def _native_attribute(self, obj, name: str):
        if isinstance(obj, list):
            if name == "find":
                return lambda value: (obj.index(value) + 1) if value in obj else 0
            if name == "add":
                return lambda value: (obj.append(value) or obj)
            if name == "delete":
                return lambda value: (
                    obj.pop(value - 1) if isinstance(value, int) else obj.remove(value)
                )
            if name == "replace":
                def replace_list(old, new):
                    for index, value in enumerate(obj):
                        if value == old:
                            obj[index] = new
                    return obj
                return replace_list
            if name == "sort":
                return lambda: (obj.sort() or obj)
            if name == "reverse":
                return lambda: (obj.reverse() or obj)

        if isinstance(obj, str):
            if name == "find":
                return lambda value: (obj.find(value) + 1) if obj.find(value) >= 0 else 0
            if name == "replace": return obj.replace
            if name == "split": return obj.split
            if name == "join": return obj.join
            if name == "upper": return obj.upper
            if name == "lower": return obj.lower

        return None

    def truth(self, value) -> bool:
        if value is VOID:
            raise DaCodeRuntimeError(
                "Void is not a direct value and cannot be used as a condition"
            )
        return bool(value)

    def smart_string(self, template: str, env) -> str:
        def replace(match):
            name = match.group(1).strip()
            return str(env.get(name))

        return re.sub(r"\{([^{}]+)\}", replace, template)
