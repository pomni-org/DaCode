from __future__ import annotations
import importlib


class PythonBridge:
    language = "python"

    def resolve(self, import_path: str):
        parts = import_path.split(".")
        module = importlib.import_module(parts[0])
        obj = module
        for part in parts[1:]:
            obj = getattr(obj, part)
        return obj
