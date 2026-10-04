class FunctionReturn(Exception):
    def __init__(self, value):
        self.value = value


class StraightSkip(Exception):
    pass


class ProgramExit(Exception):
    def __init__(self, value=None):
        self.value = value
