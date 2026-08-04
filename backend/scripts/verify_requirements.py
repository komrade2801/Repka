"""Verify backend requirements install and import on the current platform."""

from __future__ import annotations

import sys
from importlib.metadata import PackageNotFoundError, version


REQUIRED = [
    "fastapi",
    "uvicorn",
    "sqlalchemy",
    "pydantic",
    "pydantic-settings",
    "openai",
    "mcp",
    "mcp-types",
    "httpx",
    "sse-starlette",
    "tzdata",
    "python-multipart",
    "greenlet",
    "cryptography",
]


def main() -> int:
    missing: list[str] = []
    for name in REQUIRED:
        try:
            print(f"{name}=={version(name)}")
        except PackageNotFoundError:
            missing.append(name)

    pywin32_present = True
    try:
        print(f"pywin32=={version('pywin32')}")
    except PackageNotFoundError:
        pywin32_present = False
        print("pywin32: not installed")

    if sys.platform == "win32" and not pywin32_present:
        print("FAIL: pywin32 should install on Windows (mcp marker)")
        return 1
    if sys.platform != "win32" and pywin32_present:
        print("FAIL: pywin32 should not install on non-Windows")
        return 1

    import fastapi  # noqa: F401
    import mcp  # noqa: F401
    import openai  # noqa: F401
    import sqlalchemy  # noqa: F401
    import tzdata  # noqa: F401
    import uvicorn  # noqa: F401
    from zoneinfo import ZoneInfo

    ZoneInfo("Europe/Moscow")

    if missing:
        print("missing:", ", ".join(missing))
        return 1

    print(f"platform={sys.platform}")
    print("LINUX_REQUIREMENTS_OK" if sys.platform != "win32" else "WINDOWS_REQUIREMENTS_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
