from __future__ import annotations
from dataclasses import dataclass
from typing import Any
from .errors import DaCodeRuntimeError
from .types import check_type


@dataclass
class Variable:
    value: Any
    type_spec: str | None = None
    blocked: bool = False


class Environment:
    """DaCode container.

    Parent access is intentionally blocked unless this container is opened with open().
    """

    def __init__(self, parent: "Environment | None" = None):
        self.parent = parent
        self.vars: dict[str, Variable] = {}
        self.opened = False

    def define(self, name: str, value, type_spec: str | None = None, blocked: bool = False) -> None:
        self.vars[name] = Variable(value, type_spec, blocked)

    def has_local(self, name: str) -> bool:
        return name in self.vars

    def get_var(self, name: str) -> Variable:
        if name in self.vars:
            return self.vars[name]
        if self.opened and self.parent:
            return self.parent.get_var(name)
        raise DaCodeRuntimeError(f"Name {name!r} is not defined in this container")

    def get(self, name: str):
        return self.get_var(name).value

    def set(self, name: str, value) -> None:
        if name in self.vars:
            variable = self.vars[name]
            if variable.blocked:
                raise DaCodeRuntimeError(f"{name} is block and cannot be changed")
            check_type(value, variable.type_spec)
            variable.value = value
            return
        self.define(name, value)
