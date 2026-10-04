class DaCodeRuntimeError(Exception):
    """Runtime error produced by DaCode semantics."""


class DaCodeRaisedError(Exception):
    """Value created by DaCode's error(...)."""

    def __init__(self, value):
        self.value = value
        super().__init__(str(value))
