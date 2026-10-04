from __future__ import annotations
from .tokens import Token


KEYWORDS = {
    "if", "elif", "else", "while", "for", "in", "remem", "remember",
    "true", "false", "Void", "and", "or", "not", "block", "exit", "error",
    "straight", "open", "close", "from", "import",
}


class LexerError(Exception):
    pass


def _strip_block_comments(source: str) -> str:
    out: list[str] = []
    i = 0
    in_comment = False
    while i < len(source):
        if source.startswith('"""', i):
            in_comment = not in_comment
            out.extend("   ")
            i += 3
            continue
        char = source[i]
        out.append("\n" if in_comment and char == "\n" else (" " if in_comment else char))
        i += 1
    if in_comment:
        raise LexerError('Unclosed block comment: expected closing """')
    return "".join(out)


class Lexer:
    def __init__(self, source: str):
        normalized = source.replace("\r\n", "\n").replace("\r", "\n")
        self.source = _strip_block_comments(normalized)

    def tokenize(self) -> list[Token]:
        tokens: list[Token] = []
        indent_stack = [0]
        bracket_depth = 0
        lines = self.source.split("\n")

        for lineno, raw in enumerate(lines, start=1):
            stripped = raw.strip()
            if (not stripped or raw.lstrip().startswith("#")) and bracket_depth == 0:
                continue

            indent_prefix = raw[: len(raw) - len(raw.lstrip(" \t"))]
            if "\t" in indent_prefix:
                raise LexerError(f"Tabs are not allowed for indentation at line {lineno}")
            indent = len(indent_prefix)

            if bracket_depth == 0:
                if indent > indent_stack[-1]:
                    indent_stack.append(indent)
                    tokens.append(Token("INDENT", "", lineno, 1))
                else:
                    while indent < indent_stack[-1]:
                        indent_stack.pop()
                        tokens.append(Token("DEDENT", "", lineno, 1))
                    if indent != indent_stack[-1]:
                        raise LexerError(f"Invalid indentation at line {lineno}")

            i = indent
            while i < len(raw):
                ch = raw[i]
                col = i + 1
                if ch.isspace():
                    i += 1
                    continue
                if ch == "#":
                    break

                if ch == "w" and i + 1 < len(raw) and raw[i + 1] in ('"', "'"):
                    quote = raw[i + 1]
                    j = i + 2
                    buf: list[str] = []
                    escaped = False
                    while j < len(raw):
                        c = raw[j]
                        if escaped:
                            buf.append(c); escaped = False
                        elif c == "\\": escaped = True
                        elif c == quote: break
                        else: buf.append(c)
                        j += 1
                    if j >= len(raw):
                        raise LexerError(f"Unterminated smart string at line {lineno}")
                    tokens.append(Token("SMART_STRING", "".join(buf), lineno, col))
                    i = j + 1
                    continue

                if ch in ('"', "'"):
                    quote = ch; j = i + 1; buf = []; escaped = False
                    while j < len(raw):
                        c = raw[j]
                        if escaped:
                            escapes = {"n": "\n", "t": "\t", "r": "\r"}
                            buf.append(escapes.get(c, c)); escaped = False
                        elif c == "\\": escaped = True
                        elif c == quote: break
                        else: buf.append(c)
                        j += 1
                    if j >= len(raw):
                        raise LexerError(f"Unterminated string at line {lineno}")
                    tokens.append(Token("STRING", "".join(buf), lineno, col))
                    i = j + 1
                    continue

                if ch.isdigit():
                    j = i; dot = False
                    while j < len(raw) and (raw[j].isdigit() or (raw[j] == "." and not dot)):
                        if raw[j] == ".": dot = True
                        j += 1
                    val = raw[i:j]
                    tokens.append(Token("FLOAT" if dot else "NUMBER", val, lineno, col))
                    i = j
                    continue

                if ch.isalpha() or ch == "_" or ord(ch) > 127:
                    j = i + 1
                    while j < len(raw) and (raw[j].isalnum() or raw[j] == "_" or ord(raw[j]) > 127):
                        j += 1
                    val = raw[i:j]
                    tokens.append(Token("KW" if val in KEYWORDS else "IDENT", val, lineno, col))
                    i = j
                    continue

                two = raw[i:i+2]
                if two in {"==", "!=", "<=", ">=", "//", "**", "->"}:
                    tokens.append(Token("OP", two, lineno, col)); i += 2; continue

                if ch in "+-*/%=<>.,:()[]{}&":
                    kind = "PUNC" if ch in ".,:()[]{}" else "OP"
                    tokens.append(Token(kind, ch, lineno, col))
                    if ch in "([{": bracket_depth += 1
                    elif ch in ")]}" :
                        bracket_depth -= 1
                        if bracket_depth < 0:
                            raise LexerError(f"Unexpected closing bracket at {lineno}:{col}")
                    i += 1
                    continue

                raise LexerError(f"Unexpected character {ch!r} at {lineno}:{col}")

            if bracket_depth == 0:
                tokens.append(Token("NEWLINE", "", lineno, len(raw)+1))

        if bracket_depth != 0:
            raise LexerError("Unclosed bracket at end of file")
        while len(indent_stack) > 1:
            indent_stack.pop()
            tokens.append(Token("DEDENT", "", len(lines), 1))
        tokens.append(Token("EOF", "", len(lines)+1, 1))
        return tokens
