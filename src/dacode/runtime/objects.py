from __future__ import annotations
from .errors import DaCodeRuntimeError


class DaObject:
    def __init__(self, attrs=None):
        object.__setattr__(self, "_attrs", dict(attrs or {}))

    def __getattr__(self, name):
        try:
            return self._attrs[name]
        except KeyError as exc:
            raise DaCodeRuntimeError(f"Object has no attribute {name!r}") from exc

    def __setattr__(self, name, value):
        self._attrs[name] = value

    def __repr__(self):
        return f"<DaObject {self._attrs}>"


class UserClass:
    def __init__(self, name: str, attrs):
        self.name = name
        self.attrs = dict(attrs)

    def __call__(self):
        return DaObject(self.attrs)

    def __repr__(self):
        return f"<DaClass {self.name}>"
