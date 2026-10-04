from __future__ import annotations
from dataclasses import dataclass


class TypeMarker:
    def __init__(self, name: str):
        self.name = name

    def __getattr__(self, part: str):
        return TypeMarker(f"{self.name}.{part}")

    def __str__(self) -> str:
        return self.name

    def __repr__(self) -> str:
        return self.name


@dataclass(frozen=True)
class FileRef:
    path: str


class VoidValue:
    def __repr__(self) -> str:
        return "Void"


VOID = VoidValue()


@dataclass(frozen=True)
class RangeSpec:
    a: int
    b: int
