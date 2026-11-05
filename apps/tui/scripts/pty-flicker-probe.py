#!/usr/bin/env python3
"""Boot min-tui under a PTY and prove content paints do not emit ED2."""

from __future__ import annotations

import fcntl
import os
import pty
import select
import struct
import sys
import termios
import time
from pathlib import Path

from pty_screen import last_frame, strip_ansi

ROOT = Path(__file__).resolve().parents[3]
TUI = ROOT / "apps" / "tui"
ROWS = 36
COLS = 80
ED2 = b"\x1b[2J"


def read_available(fd: int, timeout: float = 0.3) -> bytes:
    out = b""
    end = time.time() + timeout
    while time.time() < end:
        ready, _, _ = select.select([fd], [], [], max(0.0, end - time.time()))
        if not ready:
            if out:
                break
            continue
        try:
            chunk = os.read(fd, 65536)
        except OSError:
            break
        if not chunk:
            break
        out += chunk
        end = max(end, time.time() + 0.08)
    return out


def set_winsize(fd: int) -> None:
    winsize = struct.pack("HHHH", ROWS, COLS, 0, 0)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, winsize)


def write_keys(fd: int, data: bytes, pause: float = 0.05) -> None:
    os.write(fd, data)
    time.sleep(pause)


def find_composer(lines: list[str]) -> bool:
    import re

    rule = re.compile(r"^─{20,}\s*$")
    idxs = [i for i, line in enumerate(lines) if rule.match(line.strip())]
    return len(idxs) >= 2


def main() -> int:
    env = dict(os.environ)
    env["TERM"] = "xterm-256color"
    env["COLORTERM"] = "truecolor"
    env["FORCE_COLOR"] = "1"
    env.pop("CI", None)
    env.pop("NO_COLOR", None)
    for key in list(env):
        if key.startswith("GITHUB_") or key in {"TF_BUILD", "BUILDKITE", "CIRCLECI"}:
            env.pop(key, None)

    tsx = TUI / "node_modules" / ".bin" / "tsx"
    cmd = [
        "/bin/sh",
        "-c",
        f'exec "{tsx}" src/tui.tsx --provider mock --no-tools --cwd "{ROOT}"',
    ]

    pid, fd = pty.fork()
    if pid == 0:
        os.environ.clear()
        os.environ.update(env)
        set_winsize(sys.stdout.fileno())
        os.chdir(TUI)
        os.execv(cmd[0], cmd)

    set_winsize(fd)
    buf = b""
    deadline = time.time() + 10
    while time.time() < deadline:
        buf += read_available(fd, 0.4)
        if find_composer(last_frame(buf.decode("utf-8", "replace"))):
            break
    else:
        print("BOOT FAILED; raw tail:")
        print(strip_ansi(buf.decode("utf-8", "replace"))[-2000:])
        return 2

    boot_ed2 = buf.count(ED2)
    alt = b"\x1b[?1049h" in buf
    sync = b"\x1b[?2026h" in buf
    print(f"boot_ed2={boot_ed2} alt_screen={alt} sync_2026={sync}")

    mark = len(buf)
    write_keys(fd, b"hello world")
    buf += read_available(fd, 1.2)
    typed = buf[mark:]
    type_ed2 = typed.count(ED2)
    lines = last_frame(buf.decode("utf-8", "replace"))
    visible = any("hello world" in line for line in lines)
    print(f"type_ed2={type_ed2} visible={visible} type_bytes={len(typed)}")

    mark = len(buf)
    write_keys(fd, b"\r")
    buf += read_available(fd, 1.5)
    submit = buf[mark:]
    submit_ed2 = submit.count(ED2)
    print(f"submit_ed2={submit_ed2} submit_bytes={len(submit)}")

    write_keys(fd, b"\x03")
    time.sleep(0.2)
    try:
        os.close(fd)
    except OSError:
        pass
    try:
        os.waitpid(pid, 0)
    except ChildProcessError:
        pass

    checks = {
        "alt_screen": alt,
        "sync_2026": sync,
        "typed_visible": visible,
        "type_no_ed2": type_ed2 == 0,
        "submit_no_ed2": submit_ed2 == 0,
    }
    print("\n=== SUMMARY ===")
    for name, ok in checks.items():
        print(f"{name}={ok}")
    if not all(checks.values()):
        print("PROBE FAILED", file=sys.stderr)
        return 1
    print("PROBE OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
