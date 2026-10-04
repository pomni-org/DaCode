from __future__ import annotations
from pathlib import Path


DACODE_SUFFIX = ".dc"


def discover_dc(path: str | Path) -> list[Path]:
    """Return runnable DaCode sources.

    A directory is discovered by extension only. There is deliberately no required
    filename such as main.dc or program.dc.
    """
    target = Path(path)
    if target.is_file():
        if target.suffix.lower() != DACODE_SUFFIX:
            raise ValueError(f"DaCode runner accepts only .dc files, got: {target.name}")
        return [target]
    if target.is_dir():
        files = sorted(
            item for item in target.iterdir()
            if item.is_file() and item.suffix.lower() == DACODE_SUFFIX
        )
        if not files:
            raise FileNotFoundError(f"No .dc files found in {target}")
        return files
    raise FileNotFoundError(path)
