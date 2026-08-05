"""Dev server with graceful shutdown and stale-port cleanup (Windows-friendly).

Usage (from backend/):
    python run_dev.py
    python run_dev.py --port 8000
    python run_dev.py --no-reload
"""

from __future__ import annotations

import argparse
import os
import signal
import subprocess
import sys
import time


def _listening_pids(port: int) -> list[int]:
    """PIDs with a LISTENING socket on ``port`` (Windows + Unix best-effort)."""
    pids: set[int] = set()
    if sys.platform == "win32":
        try:
            out = subprocess.check_output(
                ["netstat", "-ano", "-p", "tcp"],
                text=True,
                errors="replace",
            )
        except (OSError, subprocess.CalledProcessError):
            return []
        needle = f":{port}"
        for line in out.splitlines():
            if "LISTENING" not in line.upper() and "LISTEN" not in line.upper():
                continue
            if needle not in line:
                continue
            parts = line.split()
            if not parts:
                continue
            try:
                pids.add(int(parts[-1]))
            except ValueError:
                continue
        return sorted(pids)

    for cmd in (
        ["lsof", f"-tiTCP:{port}", "-sTCP:LISTEN"],
        ["fuser", f"{port}/tcp"],
    ):
        try:
            out = subprocess.check_output(cmd, text=True, errors="replace")
        except (OSError, subprocess.CalledProcessError):
            continue
        for token in out.replace(":", " ").split():
            try:
                pids.add(int(token))
            except ValueError:
                continue
        if pids:
            break
    return sorted(pids)


def _is_our_uvicorn(pid: int) -> bool:
    """Only kill processes that look like this project's uvicorn."""
    if sys.platform == "win32":
        try:
            out = subprocess.check_output(
                [
                    "powershell",
                    "-NoProfile",
                    "-Command",
                    f"(Get-CimInstance Win32_Process -Filter \"ProcessId={pid}\")"
                    ".CommandLine",
                ],
                text=True,
                errors="replace",
            ).strip()
        except (OSError, subprocess.CalledProcessError):
            return False
        lower = out.lower()
        return "uvicorn" in lower and (
            "app.main:app" in lower or "repka" in lower.replace("\\", "/")
        )

    try:
        with open(f"/proc/{pid}/cmdline", "rb") as fh:
            raw = fh.read().replace(b"\x00", b" ").decode("utf-8", errors="replace")
    except OSError:
        return False
    lower = raw.lower()
    return "uvicorn" in lower and "app.main:app" in lower


def free_port(port: int, *, force: bool = False) -> None:
    """Terminate stale uvicorn listeners on ``port`` so a new server can bind."""
    pids = _listening_pids(port)
    if not pids:
        return

    mine = os.getpid()
    targets = [pid for pid in pids if pid != mine and (force or _is_our_uvicorn(pid))]
    if not targets:
        print(
            f"Port {port} is busy (pids={pids}) but not by Repka uvicorn; "
            "not killing. Pass --force-free-port to override.",
            file=sys.stderr,
        )
        return

    for pid in targets:
        print(f"Freeing port {port}: stopping stale process pid={pid}", flush=True)
        if sys.platform == "win32":
            subprocess.run(
                ["taskkill", "/PID", str(pid), "/T", "/F"],
                check=False,
                capture_output=True,
            )
        else:
            try:
                os.kill(pid, 15)  # SIGTERM
            except OSError:
                pass

    deadline = time.time() + 5
    while time.time() < deadline:
        left = [p for p in targets if p in _listening_pids(port)]
        if not left:
            break
        time.sleep(0.2)
    else:
        print(f"Warning: port {port} still has listeners after cleanup", file=sys.stderr)


def _graceful_stop(proc: subprocess.Popen[bytes], timeout_s: float) -> None:
    """Ask uvicorn to shut down; escalate to kill if it ignores us."""
    if proc.poll() is not None:
        return

    if sys.platform == "win32":
        try:
            # Requires CREATE_NEW_PROCESS_GROUP on start.
            proc.send_signal(signal.CTRL_BREAK_EVENT)
        except OSError:
            proc.terminate()
    else:
        proc.send_signal(signal.SIGTERM)

    try:
        proc.wait(timeout=timeout_s)
        return
    except subprocess.TimeoutExpired:
        print(
            f"Graceful shutdown timed out after {timeout_s}s — force killing pid={proc.pid}",
            file=sys.stderr,
        )

    if sys.platform == "win32":
        subprocess.run(
            ["taskkill", "/PID", str(proc.pid), "/T", "/F"],
            check=False,
            capture_output=True,
        )
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            pass
    else:
        proc.kill()
        try:
            proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            pass


def _uvicorn_cmd(host: str, port: int, graceful_s: float) -> list[str]:
    return [
        sys.executable,
        "-m",
        "uvicorn",
        "app.main:app",
        "--host",
        host,
        "--port",
        str(port),
        "--timeout-graceful-shutdown",
        str(int(graceful_s)),
        "--timeout-keep-alive",
        "5",
    ]


def _run_windows_clean_reload(
    *,
    host: str,
    port: int,
    graceful_s: float,
    app_dir: str,
    force_free: bool,
) -> None:
    """Avoid uvicorn+WatchFiles hang on Windows by restarting a child process.

    Built-in ``--reload`` often sticks on ``Reloading...`` under Win32 (socket
    owned by reloader, worker never replaced → zombie Accept/CloseWait).
    """
    try:
        from watchfiles import Change, DefaultFilter, watch
    except ImportError:
        print(
            "watchfiles not installed; falling back to uvicorn --reload",
            file=sys.stderr,
        )
        _run_uvicorn_builtin(
            host=host,
            port=port,
            graceful_s=graceful_s,
            reload=True,
            app_dir=app_dir,
        )
        return

    class _PyFilter(DefaultFilter):
        def __call__(self, change: Change, path: str) -> bool:
            if not super().__call__(change, path):
                return False
            return path.endswith(".py")

    backend_root = os.path.dirname(os.path.abspath(__file__))
    print(
        f"Windows clean-reload: watching {app_dir} (*.py only). "
        f"Ctrl+C to stop.",
        flush=True,
    )

    while True:
        free_port(port, force=force_free)
        cmd = _uvicorn_cmd(host, port, graceful_s)
        print(f"Starting: {' '.join(cmd)}", flush=True)
        proc = subprocess.Popen(
            cmd,
            cwd=backend_root,
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP,
        )
        restart = False
        try:
            for _changes in watch(app_dir, watch_filter=_PyFilter(), debounce=800):
                print("Change detected — graceful restart...", flush=True)
                restart = True
                break
        except KeyboardInterrupt:
            print("\nInterrupted — shutting down...", flush=True)
            restart = False
        finally:
            _graceful_stop(proc, graceful_s)
            free_port(port, force=True)

        if not restart:
            break


def _run_uvicorn_builtin(
    *,
    host: str,
    port: int,
    graceful_s: float,
    reload: bool,
    app_dir: str,
) -> None:
    import uvicorn

    uvicorn.run(
        "app.main:app",
        host=host,
        port=port,
        reload=reload,
        reload_dirs=[app_dir] if reload else None,
        reload_excludes=[
            "*.db",
            "*.db-*",
            "*.db-wal",
            "*.db-shm",
            "**/__pycache__/**",
            "*.pyc",
        ]
        if reload
        else None,
        timeout_graceful_shutdown=int(graceful_s),
        timeout_keep_alive=5,
    )


def _maybe_reexec_in_venv() -> None:
    """If a local venv exists and we are not in it, re-run with that interpreter.

    Prevents ``python run_dev.py`` (system Python) from missing project deps
    like pydantic_settings / watchfiles while ``backend/venv`` has them.
    """
    if os.environ.get("REPKA_SKIP_VENV_REEXEC") == "1":
        return

    backend_root = os.path.dirname(os.path.abspath(__file__))
    if sys.platform == "win32":
        venv_python = os.path.join(backend_root, "venv", "Scripts", "python.exe")
    else:
        venv_python = os.path.join(backend_root, "venv", "bin", "python")

    if not os.path.isfile(venv_python):
        return

    try:
        current = os.path.normcase(os.path.realpath(sys.executable))
        target = os.path.normcase(os.path.realpath(venv_python))
    except OSError:
        return

    if current == target:
        return

    print(f"Re-executing with project venv: {venv_python}", flush=True)
    env = os.environ.copy()
    env["REPKA_SKIP_VENV_REEXEC"] = "1"
    script = os.path.abspath(__file__)
    cmd = [venv_python, script, *sys.argv[1:]]
    # os.execve is unreliable on Windows (can AV); replace this process via exit.
    raise SystemExit(subprocess.call(cmd, env=env, cwd=backend_root))


def main() -> None:
    _maybe_reexec_in_venv()

    parser = argparse.ArgumentParser(description="Run Repka API (dev)")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--no-reload", action="store_true")
    parser.add_argument(
        "--timeout-graceful-shutdown",
        type=float,
        default=5.0,
        help="Seconds to wait for in-flight requests before force-kill (default 5)",
    )
    parser.add_argument(
        "--force-free-port",
        action="store_true",
        help="Kill any listener on the port, not only Repka uvicorn",
    )
    parser.add_argument(
        "--skip-free-port",
        action="store_true",
        help="Do not attempt to free a busy port before start",
    )
    parser.add_argument(
        "--uvicorn-reload",
        action="store_true",
        help="Use uvicorn built-in --reload (can hang on Windows)",
    )
    args = parser.parse_args()

    backend_root = os.path.dirname(os.path.abspath(__file__))
    app_dir = os.path.join(backend_root, "app")
    graceful = args.timeout_graceful_shutdown

    if not args.skip_free_port:
        free_port(args.port, force=args.force_free_port)

    want_reload = not args.no_reload
    if want_reload and sys.platform == "win32" and not args.uvicorn_reload:
        _run_windows_clean_reload(
            host=args.host,
            port=args.port,
            graceful_s=graceful,
            app_dir=app_dir,
            force_free=args.force_free_port,
        )
        return

    _run_uvicorn_builtin(
        host=args.host,
        port=args.port,
        graceful_s=graceful,
        reload=want_reload,
        app_dir=app_dir,
    )


if __name__ == "__main__":
    main()
