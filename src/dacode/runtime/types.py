from __future__ import annotations
from .errors import DaCodeRaisedError, DaCodeRuntimeError
from .values import VOID


def type_name(value) -> str:
    if value is VOID:
        return "compound"
    if isinstance(value, bool):
        return "bool"
    if isinstance(value, int) and not isinstance(value, bool):
        return "numb"
    if isinstance(value, float):
        return "numb.float"
    if isinstance(value, str):
        return "text"
    if isinstance(value, list):
        return "list"
    if isinstance(value, dict):
        return "dict"
    if isinstance(value, (DaCodeRaisedError, Exception)):
        return "error"
    return type(value).__name__


def check_type(value, spec: str | None) -> None:
    if not spec:
        return
    allowed = spec.split("/")
    actual = type_name(value)
    if actual not in allowed:
        raise DaCodeRuntimeError(f"Type error: expected {spec}, got {actual}")
