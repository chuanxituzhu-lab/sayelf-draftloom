"""Local stdin bridge for Microsoft's open-source MarkItDown package.

The bridge deliberately uses convert_stream() so a document path or URL is
never handed to MarkItDown. Plugins and network-backed integrations stay off.
"""

from io import BytesIO
from os import environ
from pathlib import Path
import sys

from markitdown import MarkItDown


def main() -> int:
    payload = sys.stdin.buffer.read()
    filename = environ.get("DRAFTLOOM_MARKITDOWN_FILENAME", "document")
    extension = Path(filename).suffix or None
    result = MarkItDown(enable_plugins=False).convert_stream(
        BytesIO(payload), file_extension=extension
    )
    sys.stdout.write(result.markdown or "")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
