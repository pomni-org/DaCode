from .registry import BuiltinRegistry
from .core import install_core_builtins
from .files import install_file_builtins


def default_builtin_registry() -> BuiltinRegistry:
    registry = BuiltinRegistry()
    registry.add(install_core_builtins)
    registry.add(install_file_builtins)
    return registry


__all__ = ["BuiltinRegistry", "default_builtin_registry"]
