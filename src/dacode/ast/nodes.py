from __future__ import annotations
from dataclasses import dataclass, field
from typing import Any, Optional


class Node: ...
class Expr(Node): ...
class Stmt(Node): ...


class _VoidLiteral:
    def __repr__(self) -> str:
        return "VoidLiteral"


VoidLiteral = _VoidLiteral()


@dataclass
class Program(Node):
    statements: list[Stmt]


@dataclass
class Literal(Expr):
    value: Any


@dataclass
class Name(Expr):
    name: str


@dataclass
class ListLiteral(Expr):
    items: list[Expr]


@dataclass
class DictLiteral(Expr):
    items: list[tuple[Expr, Expr]]


@dataclass
class Unary(Expr):
    op: str
    expr: Expr


@dataclass
class Binary(Expr):
    left: Expr
    op: str
    right: Expr


@dataclass
class Attribute(Expr):
    obj: Expr
    name: str


@dataclass
class Index(Expr):
    obj: Expr
    index: Expr


@dataclass
class Call(Expr):
    func: Expr
    args: list[Expr]


@dataclass
class ReadTransform(Expr):
    source: Expr
    separator: Expr


@dataclass
class SmartString(Expr):
    template: str


@dataclass
class Assignment(Stmt):
    name: str
    expr: Expr
    type_spec: Optional[str] = None
    blocked: bool = False


@dataclass
class AttributeAssignment(Stmt):
    obj_name: str
    attr_name: str
    expr: Expr


@dataclass
class ImportFileStmt(Stmt):
    path: str
    alias: str


@dataclass
class FromImportStmt(Stmt):
    source: str
    import_path: str
    alias: Optional[str] = None


@dataclass
class ExprStmt(Stmt):
    expr: Expr


@dataclass
class IfStmt(Stmt):
    branches: list[tuple[Expr, list[Stmt]]]
    else_body: list[Stmt] = field(default_factory=list)


@dataclass
class WhileStmt(Stmt):
    condition: Expr
    body: list[Stmt]


@dataclass
class ForStmt(Stmt):
    var_name: str
    iterable: Expr
    body: list[Stmt]


@dataclass
class Param(Node):
    name: str
    type_spec: Optional[str] = None
    default: Optional[Expr] = None


@dataclass
class ClassDef(Stmt):
    name: str
    body: list[Stmt]
    remembered: bool = False


@dataclass
class FuncDef(Stmt):
    name: str
    params: list[Param]
    body: list[Stmt]
    remembered: bool = False


@dataclass
class ReturnBackStmt(Stmt):
    expr: Expr
    type_spec: Optional[str] = None


@dataclass
class StraightStmt(Stmt):
    error_mode: bool = False
    control_mode: Optional[str] = None
    assign_to: Optional[str] = None
    line: Optional[int] = None


@dataclass
class ExitStmt(Stmt):
    expr: Optional[Expr] = None


@dataclass
class ErrorStmt(Stmt):
    expr: Expr


@dataclass
class OpenStmt(Stmt): ...


@dataclass
class CloseStmt(Stmt): ...
