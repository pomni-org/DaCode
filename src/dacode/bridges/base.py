from __future__ import annotations
from typing import Protocol


class Bridge(Protocol):
    language: str

    def resolve(self, import_path: str):
        """Resolve `from <language> import <import_path>` to a runtime object."""
