from __future__ import annotations
from .base import Bridge
from dacode.runtime.errors import DaCodeRuntimeError


class BridgeRegistry:
    """Language bridge registry.

    External runtimes can be added with `registry.register(MyBridge())` without changing
    the parser or interpreter dispatch table.
    """

    def __init__(self):
        self._bridges: dict[str, Bridge] = {}

    def register(self, bridge: Bridge) -> None:
        self._bridges[bridge.language] = bridge

    def has(self, language: str) -> bool:
        return language in self._bridges

    def resolve(self, language: str, import_path: str):
        try:
            bridge = self._bridges[language]
        except KeyError as exc:
            raise DaCodeRuntimeError(
                f"{language} bridge is not installed. Register a bridge adapter for this runtime."
            ) from exc
        return bridge.resolve(import_path)
