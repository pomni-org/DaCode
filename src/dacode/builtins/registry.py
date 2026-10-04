from __future__ import annotations
from collections.abc import Callable
from typing import Any


BuiltinInstaller = Callable[[Any], None]


class BuiltinRegistry:
    """Ordered registry of builtin installers.

    Adding a new builtin family should require a new installer module, not edits to the
    interpreter's execution engine.
    """

    def __init__(self):
        self._installers: list[BuiltinInstaller] = []

    def add(self, installer: BuiltinInstaller) -> BuiltinInstaller:
        self._installers.append(installer)
        return installer

    def install_into(self, interpreter) -> None:
        for installer in self._installers:
            installer(interpreter)
