from .registry import BridgeRegistry
from .python import PythonBridge


def default_bridge_registry() -> BridgeRegistry:
    registry = BridgeRegistry()
    registry.register(PythonBridge())
    return registry


__all__ = ["BridgeRegistry", "PythonBridge", "default_bridge_registry"]
