import tempfile
import unittest
from pathlib import Path

from dacode.frontend import Lexer, Parser
from dacode.loader import discover_dc
from dacode.runtime import DaCodeRuntimeError, Interpreter
from dacode.builtins.namespaces import KeyboardNamespace


def execute(source, inputs=None, interpreter=None):
    output = []
    values = iter(inputs or [])
    runtime = interpreter or Interpreter(
        stdin=lambda prompt="": next(values),
        stdout=lambda value="": output.append(str(value)),
    )
    if interpreter is not None:
        runtime.stdout = lambda value="": output.append(str(value))
    runtime.run(Parser(Lexer(source).tokenize()).parse())
    return output


class RuntimeTests(unittest.TestCase):
    def test_keyboard_capture_and_pulse(self):
        keyboard = KeyboardNamespace()
        self.assertTrue(keyboard.capture("Ctrl+C"))
        self.assertTrue(keyboard.is_captured("ctrl+c"))
        keyboard.pulse("CTRL+C")
        self.assertTrue(keyboard.pressed("ctrl+c"))
        self.assertFalse(keyboard.pressed("ctrl+c"))

    def test_remem_is_allowed_for_variables(self):
        self.assertEqual(execute('remem name="Дак"\nconsole(name)\n'), ['Дак'])
        self.assertEqual(execute('remember numb age=20\nconsole(age)\n'), ['20'])

    def test_log_is_allowed_as_an_input_variable(self):
        self.assertEqual(
            execute('log = input("Enter log message: ", text)\nconsole(log)\n', ['saved']),
            ['saved'],
        )

    def test_straight_start_finish_are_control_markers(self):
        self.assertEqual(
            execute('straight(start)\nconsole("ok")\nstraight(finish)\n'),
            ['ok'],
        )

    def test_reserved_keyword_assignment_has_clear_error(self):
        with self.assertRaisesRegex(Exception, "reserved DaCode word"):
            Parser(Lexer('error = straight(error)\n').tokenize()).parse()

    def test_new_remem_syntax_for_function_and_class(self):
        self.assertEqual(
            execute('remem add(numb=a, numb=b):\n    return.back(a+b) numb\nconsole(add(2,3))\n'),
            ['5'],
        )
        self.assertEqual(
            execute('remem User:\n    first.name="Дак"\nu=User()\nconsole(u.name)\n'),
            ['Дак'],
        )

    def test_block_comments_are_ignored(self):
        source = (
            'console("before")\n'
            '"""\n'
            'это большой комментарий\n'
            'console("НЕ ВЫПОЛНЯТЬ")\n'
            '"""\n'
            '# обычный комментарий\n'
            'console("after")\n'
        )
        self.assertEqual(execute(source), ['before', 'after'])

    def test_result_depends_on_source(self):
        self.assertEqual(execute('console(2+3)\n'), ['5'])
        self.assertEqual(execute('console(7*6)\n'), ['42'])
        self.assertEqual(
            execute('name="Дак"\nconsole(w"Привет, {name}")\n'),
            ['Привет, Дак'],
        )

    def test_one_based_index(self):
        self.assertEqual(execute('a=["x","y"]\nconsole(a[1])\n'), ['x'])

    def test_void_cannot_be_condition(self):
        with self.assertRaises(DaCodeRuntimeError):
            execute('a=Void\nif a:\n    console("x")\n')

    def test_void_can_be_replaced_untyped(self):
        self.assertEqual(execute('a=Void\na=2\nconsole(a)\n'), ['2'])

    def test_straight_error_is_postfix(self):
        source = (
            'age=input("", numb)\n'
            'err=straight(error)\n'
            'if err:\n'
            '    console("bad")\n'
            'else:\n'
            '    console(age)\n'
        )
        self.assertEqual(execute(source, ['кот']), ['bad'])
        self.assertEqual(execute(source, ['18']), ['18'])

    def test_return_back_typed(self):
        source = (
            'remem add(numb=a, numb=b):\n'
            '    return.back(a+b) numb\n'
            'console(add(2,3))\n'
        )
        self.assertEqual(execute(source), ['5'])

    def test_type_error(self):
        with self.assertRaises(DaCodeRuntimeError):
            execute('numb a=2\na="cat"\n')

    def test_dc_discovery_uses_extension_not_fixed_filename(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'reactor.dc').write_text('console(1)\n', encoding='utf-8')
            (root / 'cat.dc').write_text('console(2)\n', encoding='utf-8')
            (root / 'main.txt').write_text('console(999)\n', encoding='utf-8')
            self.assertEqual(
                [path.name for path in discover_dc(root)],
                ['cat.dc', 'reactor.dc'],
            )

    def test_multiline_call(self):
        source = 'a = return(\n    10+20\n)\nconsole(a)\n'
        self.assertEqual(execute(source), ['30'])

    def test_straight_skips_function(self):
        source = (
            'remem f():\n'
            '    console("before")\n'
            '    straight()\n'
            '    console("after")\n'
            'f()\n'
            'console("done")\n'
        )
        self.assertEqual(execute(source), ['before', 'done'])

    def test_first_twice_copy_is_independent(self):
        source = (
            'remem P:\n'
            '    first.name="Иван"\n'
            'remem C:\n'
            '    twice.name\n'
            'p=P()\n'
            'c=C()\n'
            'c.name="Пётр"\n'
            'console(p.name)\n'
            'console(c.name)\n'
        )
        self.assertEqual(execute(source), ['Иван', 'Пётр'])


if __name__ == '__main__':
    unittest.main()
