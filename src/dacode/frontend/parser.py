from __future__ import annotations
from .tokens import Token
from dacode.ast.nodes import *


TYPE_STARTS = {"text", "numb", "bool", "list", "dict", "compound", "error"}


class ParseError(Exception):
    pass


class Parser:
    def __init__(self, tokens: list[Token]):
        self.t = tokens
        self.i = 0

    def cur(self) -> Token:
        return self.t[self.i]

    def peek(self, n=1) -> Token:
        return self.t[min(self.i+n, len(self.t)-1)]

    def at(self, value=None, kind=None) -> bool:
        tok = self.cur()
        return (value is None or tok.value == value) and (kind is None or tok.kind == kind)

    def match(self, value=None, kind=None):
        if self.at(value, kind):
            tok = self.cur(); self.i += 1; return tok
        return None

    def expect(self, value=None, kind=None) -> Token:
        tok = self.cur()
        if not self.at(value, kind):
            want = value or kind
            raise ParseError(f"Expected {want}, got {tok.kind}:{tok.value!r} at {tok.line}:{tok.col}")
        self.i += 1
        return tok

    def skip_newlines(self):
        while self.match(kind="NEWLINE"): pass

    def parse(self) -> Program:
        out = []
        self.skip_newlines()
        while not self.at(kind="EOF"):
            out.append(self.statement())
            self.skip_newlines()
        return Program(out)

    def statement(self) -> Stmt:
        if self.at("if"): return self.parse_if()
        if self.at("while"): return self.parse_while()
        if self.at("for"): return self.parse_for()
        if self.at("remem") or self.at("remember"): return self.parse_remem()
        if self.at("from"): return self.parse_from_import()
        if self.at("import"): return self.parse_file_import()
        if self.at("return") and self.peek().value == "." and self.peek(2).value == "back": return self.parse_return_back()
        if self.at("exit"): return self.parse_exit()
        if self.at("error"): return self.parse_error_stmt()
        if self.at("straight"): return self.parse_straight()
        if self.at("open"): return self.parse_simple_call_stmt(OpenStmt)
        if self.at("close"): return self.parse_simple_call_stmt(CloseStmt)
        if self.at("block") or self._looks_like_typed_assignment(): return self.parse_assignment()

        # attribute assignment, e.g. first.name = "Иван" or user.name = "Иван"
        if self.at(kind="IDENT") and self.peek().value == "." and self.peek(2).kind == "IDENT" and self.peek(3).value == "=":
            obj = self.expect(kind="IDENT").value
            self.expect(".")
            attr = self.expect(kind="IDENT").value
            self.expect("=")
            expr = self.expression()
            self.endline()
            return AttributeAssignment(obj, attr, expr)

        # assignment to straight(error)
        if self.at(kind="IDENT") and self.peek().value == "=" and self.peek(2).value == "straight":
            name = self.expect(kind="IDENT").value
            self.expect("=")
            st = self.parse_straight()
            st.assign_to = name
            return st

        # normal assignment
        if self.at(kind="IDENT") and self.peek().value == "=":
            name = self.expect(kind="IDENT").value
            self.expect("=")
            expr = self.expression()
            expr = self.maybe_read_transform(expr)
            self.endline()
            return Assignment(name, expr)

        expr = self.expression()
        self.endline()
        # special console call for colored args is parsed as Call only if no colors
        return ExprStmt(expr)

    def _looks_like_typed_assignment(self):
        # type can be numb.float, numb/text, etc. followed by IDENT =
        j = self.i
        if self.t[j].value == "block":
            return True
        if self.t[j].kind not in {"IDENT", "KW"}:
            return False
        if self.t[j].value not in TYPE_STARTS:
            return False
        j += 1
        while j < len(self.t) and self.t[j].value in {".", "/", "+"}:
            j += 1
            if j < len(self.t) and self.t[j].kind in {"IDENT", "KW"}: j += 1
        return j + 1 < len(self.t) and self.t[j].kind == "IDENT" and self.t[j+1].value == "="

    def parse_assignment(self):
        blocked = False
        if self.match("block"):
            blocked = True
            self.match("+")
        type_spec = None
        if self.cur().value in TYPE_STARTS:
            parts = [self.expect().value]
            while self.at(".") or self.at("/"):
                parts.append(self.expect().value)
                parts.append(self.expect().value)
            type_spec = "".join(parts)
        name = self.expect(kind="IDENT").value
        self.expect("=")
        expr = self.expression()
        expr = self.maybe_read_transform(expr)
        self.endline()
        return Assignment(name, expr, type_spec, blocked)

    def parse_if(self):
        branches = []
        self.expect("if")
        cond = self.expression(); self.expect(":"); self.endline()
        branches.append((cond, self.block()))
        while self.at("elif"):
            self.expect("elif"); c = self.expression(); self.expect(":"); self.endline(); branches.append((c, self.block()))
        else_body = []
        if self.at("else"):
            self.expect("else"); self.expect(":"); self.endline(); else_body = self.block()
        return IfStmt(branches, else_body)

    def parse_while(self):
        self.expect("while"); cond = self.expression(); self.expect(":"); self.endline(); return WhileStmt(cond, self.block())

    def parse_for(self):
        self.expect("for"); name = self.expect(kind="IDENT").value; self.expect("in"); it = self.expression(); self.expect(":"); self.endline(); return ForStmt(name, it, self.block())

    def parse_remem(self):
        self.expect()
        if self.match("class"):
            name = self.expect(kind="IDENT").value
            self.expect(":"); self.endline()
            return ClassDef(name, self.block(), remembered=True)
        self.expect("func")
        name = self.expect(kind="IDENT").value
        self.expect("(")
        params = []
        if not self.at(")"):
            while True:
                params.append(self.parse_param())
                if not self.match(","): break
        self.expect(")"); self.expect(":"); self.endline()
        return FuncDef(name, params, self.block(), remembered=True)

    def parse_return_back(self):
        self.expect("return")
        self.expect(".")
        self.expect("back")
        self.expect("(")
        expr = self.expression() if not self.at(")") else Literal(VoidLiteral)
        self.expect(")")
        type_spec = None
        if self.cur().value in TYPE_STARTS:
            parts = [self.expect().value]
            if self.match("."):
                parts += [".", self.expect().value]
            while self.match("/"):
                parts += ["/", self.expect().value]
            type_spec = "".join(parts)
        self.endline()
        return ReturnBackStmt(expr, type_spec)

    def parse_file_import(self):
        self.expect("import")
        parts = []
        while not self.at("=") and not self.at(kind="NEWLINE"):
            parts.append(self.expect().value)
        self.expect("=")
        alias = self.expect(kind="IDENT").value
        self.endline()
        return ImportFileStmt("".join(parts), alias)

    def maybe_read_transform(self, expr):
        if self.match(":"):
            # DaCode DB syntax: read(db): split("-")
            if not (isinstance(expr, Call) and isinstance(expr.func, Name) and expr.func.name == "read"):
                tok = self.cur()
                raise ParseError(f"':' transform is currently valid only after read(...) at {tok.line}:{tok.col}")
            self.expect("split")
            self.expect("(")
            sep = self.expression()
            self.expect(")")
            return ReadTransform(expr, sep)
        return expr

    def parse_from_import(self):
        self.expect("from")
        source = self.expect().value
        self.expect("import")
        parts = [self.expect().value]
        while self.match("."):
            parts.append(self.expect().value)
        alias = None
        if self.match("="):
            alias = self.expect(kind="IDENT").value
        self.endline()
        return FromImportStmt(source, ".".join(parts), alias)

    def parse_param(self):
        # DaCode: text=name [and name="Дак"]
        if self.cur().value in TYPE_STARTS:
            type_spec = self.expect().value
            if self.match("."):
                type_spec += "." + self.expect().value
            self.expect("=")
            name = self.expect(kind="IDENT").value
            default = None
            if self.match("and") or self.match("&"):
                repeated = self.expect(kind="IDENT").value
                if repeated != name:
                    raise ParseError(f"Default binding must repeat parameter name {name!r}")
                self.expect("=")
                default = self.expression()
            return Param(name, type_spec, default)
        return Param(self.expect(kind="IDENT").value)

    def parse_exit(self):
        self.expect("exit"); self.expect("(")
        expr = None if self.at(")") else self.expression()
        self.expect(")"); self.endline(); return ExitStmt(expr)

    def parse_error_stmt(self):
        self.expect("error"); self.expect("("); expr = self.expression(); self.expect(")"); self.endline(); return ErrorStmt(expr)

    def parse_straight(self):
        self.expect("straight"); self.expect("(")
        mode = False
        if not self.at(")"):
            self.expect("error"); mode = True
        self.expect(")"); self.endline(); return StraightStmt(error_mode=mode)

    def parse_simple_call_stmt(self, cls):
        self.expect(); self.expect("("); self.expect(")"); self.endline(); return cls()

    def block(self):
        self.expect(kind="INDENT")
        body = []
        self.skip_newlines()
        while not self.at(kind="DEDENT") and not self.at(kind="EOF"):
            body.append(self.statement())
            self.skip_newlines()
        self.expect(kind="DEDENT")
        return body

    def endline(self):
        self.expect(kind="NEWLINE")

    # Pratt parser
    PRECEDENCE = {
        "or": 1, "and": 2, "==": 3, "!=": 3, "<": 4, "<=": 4, ">": 4, ">=": 4,
        "+": 5, "-": 5, "*": 6, "/": 6, "//": 6, "%": 6, "**": 7,
    }

    def expression(self, min_prec=0):
        left = self.prefix()
        while True:
            tok = self.cur()
            op = tok.value
            if op not in self.PRECEDENCE or self.PRECEDENCE[op] < min_prec:
                break
            prec = self.PRECEDENCE[op]
            self.i += 1
            right = self.expression(prec + (0 if op == "**" else 1))
            left = Binary(left, op, right)
        return left

    def prefix(self):
        if self.match("-", kind="OP"): return Unary("-", self.expression(8))
        if self.match("+", kind="OP"): return Unary("+", self.expression(8))
        if self.match("not"): return Unary("not", self.expression(8))
        node = self.primary()
        while True:
            if self.match("."):
                node = Attribute(node, self.expect(kind="IDENT").value)
            elif self.match("["):
                idx = self.expression(); self.expect("]"); node = Index(node, idx)
            elif self.match("("):
                args = []
                if not self.at(")"):
                    while True:
                        # colored console args are represented as tiny dict-like literal
                        if self.cur().kind in {"IDENT", "KW"} and self.peek().value == ":":
                            color = self.expect().value; self.expect(":"); args.append(DictLiteral([(Literal("__color__"), Literal(color)), (Literal("value"), self.expression())]))
                        else:
                            args.append(self.expression())
                        if not self.match(","): break
                self.expect(")"); node = Call(node, args)
            else:
                break
        return node

    def primary(self):
        tok = self.cur()
        if self.match(kind="NUMBER"): return Literal(int(tok.value))
        if self.match(kind="FLOAT"): return Literal(float(tok.value))
        if self.match(kind="STRING"): return Literal(tok.value)
        if self.match(kind="SMART_STRING"): return SmartString(tok.value)
        if self.match("true"): return Literal(True)
        if self.match("false"): return Literal(False)
        if self.match("Void"): return Literal(VoidLiteral)
        if self.at("<") or self.at(">"):
            return Literal(self.expect().value)
        if self.match("["):
            items=[]
            if not self.at("]"):
                while True:
                    items.append(self.expression())
                    if not self.match(","): break
            self.expect("]"); return ListLiteral(items)
        if self.match("{"):
            items=[]
            if not self.at("}"):
                while True:
                    k=self.expression(); self.expect(":"); v=self.expression(); items.append((k,v))
                    if not self.match(","): break
            self.expect("}"); return DictLiteral(items)
        if self.match("("):
            e=self.expression(); self.expect(")"); return e
        if tok.kind in {"IDENT", "KW"}:
            self.i += 1
            return Name(tok.value)
        raise ParseError(f"Unexpected token {tok.kind}:{tok.value!r} at {tok.line}:{tok.col}")

