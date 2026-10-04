import unittest

from dacode.bridges import default_bridge_registry
from dacode.builtins import default_builtin_registry
from dacode.frontend import Lexer, Parser
from dacode.runtime import Interpreter


class DemoBridge:
    language = "demo"

    def resolve(self, import_path: str):
        if import_path == "answer":
            return 42
        raise LookupError(import_path)


class ExtensionTests(unittest.TestCase):
    def run_source(self, source, runtime):
        output = []
        runtime.stdout = lambda value="": output.append(str(value))
        runtime.run(Parser(Lexer(source).tokenize()).parse())
        return output

    def test_custom_builtin_without_interpreter_edit(self):
        builtins = default_builtin_registry()

        def install_extra(runtime):
            runtime.register_builtin("double", lambda value: value * 2)

        builtins.add(install_extra)
        runtime = Interpreter(builtins=builtins)
        self.assertEqual(self.run_source('console(double(21))\n', runtime), ['42'])

    def test_custom_bridge_without_parser_edit(self):
        bridges = default_bridge_registry()
        bridges.register(DemoBridge())
        runtime = Interpreter(bridges=bridges)
        source = 'from demo import answer\nconsole(answer)\n'
        self.assertEqual(self.run_source(source, runtime), ['42'])


if __name__ == '__main__':
    unittest.main()
