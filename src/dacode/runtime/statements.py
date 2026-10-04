from __future__ import annotations
import os
from dacode.ast.nodes import (
    Assignment, Attribute, AttributeAssignment, ClassDef, ErrorStmt, ExitStmt,
    ExprStmt, ForStmt, FromImportStmt, FuncDef, IfStmt, ImportFileStmt, Name,
    OpenStmt, CloseStmt, ReturnBackStmt, StraightStmt, WhileStmt,
)
from dacode.frontend import Lexer, Parser
from .control import FunctionReturn, ProgramExit, StraightSkip
from .errors import DaCodeRaisedError, DaCodeRuntimeError
from .functions import UserFunction
from .objects import UserClass
from .types import check_type
from .values import FileRef


KNOWN_FOREIGN_RUNTIMES = {
    "python", "javascript", "java", "csharp", "cpp", "rust", "go", "kotlin", "swift"
}


class StatementExecutorMixin:
    def exec_block(self, statements, env, inside_function: bool = False):
        index = 0
        while index < len(statements):
            statement = statements[index]
            try:
                self.exec_stmt(statement, env, inside_function)
            except (ProgramExit, FunctionReturn, StraightSkip):
                raise
            except Exception as error:
                if (
                    index + 1 < len(statements)
                    and isinstance(statements[index + 1], StraightStmt)
                    and statements[index + 1].error_mode
                ):
                    self.last_error = error
                    self.exec_stmt(statements[index + 1], env, inside_function)
                    index += 2
                    continue
                raise
            index += 1

    def exec_stmt(self, statement, env, inside_function: bool = False):
        if isinstance(statement, Assignment):
            value = self.eval_expr(statement.expr, env)
            check_type(value, statement.type_spec)
            if env.has_local(statement.name):
                env.set(statement.name, value)
            else:
                env.define(statement.name, value, statement.type_spec, statement.blocked)
            return

        if isinstance(statement, AttributeAssignment):
            obj = env.get(statement.obj_name)
            setattr(obj, statement.attr_name, self.eval_expr(statement.expr, env))
            return

        if isinstance(statement, ExprStmt):
            self._eval_with_error_capture(statement.expr, env)
            return

        if isinstance(statement, IfStmt):
            return self._exec_if(statement, env, inside_function)

        if isinstance(statement, WhileStmt):
            while self.truth(self.eval_expr(statement.condition, env)):
                try:
                    self.exec_block(statement.body, env, inside_function)
                except StraightSkip:
                    if inside_function:
                        raise
                    break
            return

        if isinstance(statement, ForStmt):
            for item in self.eval_expr(statement.iterable, env):
                env.set(statement.var_name, item)
                try:
                    self.exec_block(statement.body, env, inside_function)
                except StraightSkip:
                    if inside_function:
                        raise
                    break
            return

        if isinstance(statement, ClassDef):
            self._define_class(statement, env)
            return

        if isinstance(statement, FuncDef):
            env.define(
                statement.name,
                UserFunction(statement, env, self),
                blocked=statement.remembered,
            )
            return

        if isinstance(statement, ImportFileStmt):
            full_path = os.path.abspath(os.path.join(self.base_dir, statement.path))
            env.define(statement.alias, FileRef(full_path), blocked=True)
            return

        if isinstance(statement, FromImportStmt):
            self._execute_import(statement, env)
            return

        if isinstance(statement, ReturnBackStmt):
            value = self.eval_expr(statement.expr, env)
            check_type(value, statement.type_spec)
            raise FunctionReturn(value)

        if isinstance(statement, StraightStmt):
            if statement.error_mode:
                value = self.last_error
                self.last_error = None
                if statement.assign_to:
                    env.set(statement.assign_to, value if value else False)
                return
            raise StraightSkip()

        if isinstance(statement, ExitStmt):
            raise ProgramExit(self.eval_expr(statement.expr, env) if statement.expr else None)

        if isinstance(statement, ErrorStmt):
            raise DaCodeRaisedError(self.eval_expr(statement.expr, env))

        if isinstance(statement, OpenStmt):
            env.opened = True
            return

        if isinstance(statement, CloseStmt):
            env.opened = False
            return

        raise DaCodeRuntimeError(f"Unsupported statement {type(statement).__name__}")

    def _exec_if(self, statement, env, inside_function):
        for condition, body in statement.branches:
            if self.truth(self.eval_expr(condition, env)):
                try:
                    self.exec_block(body, env, inside_function)
                except StraightSkip:
                    if inside_function:
                        raise
                return
        if statement.else_body:
            try:
                self.exec_block(statement.else_body, env, inside_function)
            except StraightSkip:
                if inside_function:
                    raise

    def _define_class(self, statement: ClassDef, env) -> None:
        attrs = {}
        saw_first = False
        saw_twice = False

        for item in statement.body:
            if isinstance(item, AttributeAssignment) and item.obj_name in {"first", "twice"}:
                if item.obj_name == "first":
                    saw_first = True
                    value = self.eval_expr(item.expr, env)
                    attrs[item.attr_name] = value
                    self.first_registry.setdefault(item.attr_name, []).append((statement.name, value))
                else:
                    saw_twice = True
                    attrs[item.attr_name] = self.eval_expr(item.expr, env)
                continue

            if (
                isinstance(item, ExprStmt)
                and isinstance(item.expr, Attribute)
                and isinstance(item.expr.obj, Name)
                and item.expr.obj.name == "twice"
            ):
                saw_twice = True
                field = item.expr.name
                matches = self.first_registry.get(field, [])
                if not matches:
                    raise DaCodeRuntimeError(
                        f"twice.{field} cannot find first.{field} in another container"
                    )
                if len(matches) > 1:
                    raise DaCodeRuntimeError(
                        f"twice.{field} is ambiguous: found {len(matches)} first.{field} values"
                    )
                attrs[field] = matches[0][1]
                continue

            if isinstance(item, Assignment):
                attrs[item.name] = self.eval_expr(item.expr, env)
                continue

            raise DaCodeRuntimeError(
                f"Unsupported class-body statement {type(item).__name__}"
            )

        if saw_first and saw_twice:
            raise DaCodeRuntimeError("first and twice cannot live in the same class container")

        env.define(statement.name, UserClass(statement.name, attrs), blocked=statement.remembered)

    def _execute_import(self, statement: FromImportStmt, env) -> None:
        if self.bridges.has(statement.source) or statement.source in KNOWN_FOREIGN_RUNTIMES:
            obj = self.bridges.resolve(statement.source, statement.import_path)
        else:
            obj = self._load_dacode_import(statement.source, statement.import_path)

        original = statement.import_path.split(".")[-1]
        env.define(original, obj)
        if statement.alias and statement.alias != original:
            env.define(statement.alias, obj)

    def _load_dacode_import(self, source_name: str, import_path: str):
        module_path = os.path.join(
            self.base_dir,
            source_name if source_name.endswith(".dc") else source_name + ".dc",
        )
        if not os.path.isfile(module_path):
            raise DaCodeRuntimeError(f"DaCode module not found: {module_path}")

        with open(module_path, "r", encoding="utf-8") as handle:
            source = handle.read()

        sub = type(self)(
            stdin=self.stdin,
            stdout=self.stdout,
            base_dir=os.path.dirname(module_path),
            builtins=self.builtins,
            bridges=self.bridges,
        )
        sub.run(Parser(Lexer(source).tokenize()).parse())

        parts = import_path.split(".")
        obj = sub.global_env.get(parts[0])
        for part in parts[1:]:
            obj = getattr(obj, part)
        return obj

    def _eval_with_error_capture(self, expr, env):
        try:
            return self.eval_expr(expr, env)
        except Exception as error:
            if isinstance(error, (ProgramExit, FunctionReturn, StraightSkip)):
                raise
            self.last_error = error
            raise
