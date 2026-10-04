from __future__ import annotations
import platform
import random as _random
from dacode.runtime.errors import DaCodeRuntimeError
from dacode.runtime.values import RangeSpec


class RandomNamespace:
    def __call__(self, range_value):
        if isinstance(range_value, RangeSpec):
            return _random.randint(range_value.a, range_value.b)
        raise DaCodeRuntimeError("random() expects DaCode range like 1-10")

    def choice(self, seq):
        return _random.choice(seq)


class OSNamespace:
    def get(self, level=None):
        system = platform.system()
        if level == "<":
            return {"Darwin": "Apple", "Windows": "Microsoft", "Linux": "Linux"}.get(system, system)
        if level == ">":
            return f"{platform.system()} {platform.release()}"
        return "MacOS" if system == "Darwin" else system


class LogNamespace:
    def __init__(self, writer=print):
        self.mode = "console"
        self.path = None
        self.writer = writer

    def __call__(self, *args, **kwargs):
        chunks = []
        for item in args:
            if isinstance(item, dict) and item.get("__color__"):
                chunks.append(f"[{str(item['__color__']).upper()}] {item.get('value', '')}")
            else:
                chunks.append(str(item))
        self._write(" ".join(chunks))

    def file(self, path):
        self.mode = "file"
        self.path = path

    def console(self):
        self.mode = "console"

    def all(self):
        self.mode = "all"

    def _write(self, text):
        if self.mode in {"console", "all"}:
            self.writer(text)
        if self.mode in {"file", "all"}:
            if not self.path:
                raise DaCodeRuntimeError("log.file(path) must be set first")
            with open(self.path, "a", encoding="utf-8") as handle:
                handle.write(text + "\n")
