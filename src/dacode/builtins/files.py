from __future__ import annotations
from dacode.runtime.errors import DaCodeRuntimeError
from dacode.runtime.values import FileRef


def _require_file(ref) -> str:
    if not isinstance(ref, FileRef):
        raise DaCodeRuntimeError("Expected imported file reference")
    return ref.path


def read_file(ref):
    path = _require_file(ref)
    with open(path, "r", encoding="utf-8") as handle:
        return handle.read().splitlines()


def write_file(ref, line_no, value):
    path = _require_file(ref)
    lines = read_file(ref)
    index = line_no - 1
    if index < 0 or index >= len(lines):
        raise DaCodeRuntimeError("File line index out of range")
    lines[index] += str(value)
    _save_lines(path, lines)
    return lines[index]


def delete_file(ref, line_no, value=None):
    path = _require_file(ref)
    lines = read_file(ref)
    index = line_no - 1
    if index < 0 or index >= len(lines):
        raise DaCodeRuntimeError("File line index out of range")
    if value is None:
        removed = lines.pop(index)
    else:
        removed = str(value)
        lines[index] = lines[index].replace(str(value), "", 1)
    _save_lines(path, lines)
    return removed


def replace_file(ref, line_no, old, new):
    path = _require_file(ref)
    lines = read_file(ref)
    index = line_no - 1
    if index < 0 or index >= len(lines):
        raise DaCodeRuntimeError("File line index out of range")
    lines[index] = lines[index].replace(str(old), str(new))
    _save_lines(path, lines)
    return lines[index]


def find_file(ref, value):
    needle = str(value)
    for index, line in enumerate(read_file(ref), start=1):
        if needle in line:
            return index
    return 0


def _save_lines(path: str, lines: list[str]) -> None:
    with open(path, "w", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + ("\n" if lines else ""))


def install_file_builtins(interpreter) -> None:
    interpreter.register_builtin("read", read_file)
    interpreter.register_builtin("write", write_file)
    interpreter.register_builtin("delete", delete_file)
    interpreter.register_builtin("replace", replace_file)
    interpreter.register_builtin("find", find_file)
