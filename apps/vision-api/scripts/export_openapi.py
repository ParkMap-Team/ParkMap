"""Write the API contract to openapi.json. The LIFF app generates its TypeScript types from it.

    python scripts/export_openapi.py          # rewrite openapi.json
    python scripts/export_openapi.py --check  # fail when openapi.json is out of date
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.main import app  # noqa: E402

OUTPUT = ROOT / "openapi.json"


def render() -> str:
    return json.dumps(app.openapi(), indent=2, sort_keys=True) + "\n"


def main() -> int:
    content = render()
    if "--check" in sys.argv[1:]:
        if not OUTPUT.exists() or OUTPUT.read_text() != content:
            print("openapi.json is out of date; run: python scripts/export_openapi.py", file=sys.stderr)
            return 1
        return 0
    OUTPUT.write_text(content)
    return 0


if __name__ == "__main__":
    sys.exit(main())
