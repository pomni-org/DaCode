from __future__ import annotations
import argparse
import sys
from pprint import pprint
from .frontend import Lexer, Parser
from .loader import discover_dc, run_file


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="dacode",
        description="DaCode 1.0 bootstrap interpreter",
    )
    parser.add_argument(
        "path",
        nargs="?",
        default=".",
        help=".dc file or directory containing .dc files",
    )
    parser.add_argument("--tokens", action="store_true", help="print lexer tokens instead of executing")
    parser.add_argument("--ast", action="store_true", help="print parsed AST instead of executing")
    return parser


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    try:
        files = discover_dc(args.path)
        for source_path in files:
            if len(files) > 1:
                print(f"== {source_path.name} ==")
            if args.tokens or args.ast:
                source = source_path.read_text(encoding="utf-8")
                tokens = Lexer(source).tokenize()
                if args.tokens:
                    for token in tokens:
                        print(token)
                if args.ast:
                    pprint(Parser(tokens).parse(), width=110, sort_dicts=False)
            else:
                run_file(source_path)
    except Exception as error:
        print(f"DaCode error: {error}", file=sys.stderr)
        return 1
    return 0
