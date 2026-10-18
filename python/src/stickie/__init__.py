"""stickie from pip: runs the npm package of this same version through npx.

stickie is a Node program; this package only finds Node and hands over, so the
`stickie` and `stickie-mcp` commands behave exactly as the npm ones do.
"""

import os
import re
import shutil
import subprocess
import sys
from importlib.metadata import version as _installed


def version(name: str) -> str:
    """This package's version as npm spells it.

    Both come from one package.json version, but PyPI normalises a
    pre-release to `0.1.0rc1` where npm keeps `0.1.0-rc1`, and npx asking for
    the PyPI spelling would ask npm for a version it has never had.
    """
    return re.sub(r"^(\d+\.\d+\.\d+)(a|b|rc)(\d+)$", r"\1-\2\3", _installed(name))


def _run(binary: str) -> None:
    # npx falls back to PATH for a binary the package lacks, and on PATH is
    # this launcher: so a launcher started by a launcher stops instead of looping
    if os.environ.get("STICKIE_PIP_LAUNCHER"):
        sys.exit(
            f"npx found no `{binary}` command in stickie@{version('stickie')}: "
            "that version is not on npm, or does not have it."
        )
    os.environ["STICKIE_PIP_LAUNCHER"] = "1"
    npx = shutil.which("npx")
    if npx is None:
        sys.exit(
            "stickie runs on Node.js 22 or later, and npx was not found on "
            "PATH. Install Node from https://nodejs.org and run it again."
        )
    command = [npx, "--yes", f"--package=stickie@{version('stickie')}", "--", binary, *sys.argv[1:]]
    if os.name == "nt":
        # Windows has no exec that keeps the console; wait and pass the code on
        sys.exit(subprocess.call(command))
    os.execv(npx, command)


def main() -> None:
    _run("stickie")


def mcp() -> None:
    _run("stickie-mcp")
