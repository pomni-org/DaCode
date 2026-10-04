import json
import unittest
from pathlib import Path

from dacode.frontend.lexer import KEYWORDS
from dacode.frontend.parser import TYPE_STARTS


class LanguageSpecTests(unittest.TestCase):
    def test_language_metadata_matches_python_frontend(self):
        spec_path = Path(__file__).parents[1] / "src" / "dacode" / "language" / "spec.json"
        spec = json.loads(spec_path.read_text(encoding="utf-8"))

        self.assertEqual(KEYWORDS, set(spec["keywords"]) | set(spec["literals"]))
        self.assertEqual(
            TYPE_STARTS,
            set(spec["types"]["direct"]) | set(spec["types"]["compound"]),
        )


if __name__ == "__main__":
    unittest.main()
