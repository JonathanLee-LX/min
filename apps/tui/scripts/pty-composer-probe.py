#!/usr/bin/env python3
"""Drive min-tui under a PTY and accept composer height / Shift+Enter newline / Enter submit."""

from __future__ import annotations

import fcntl
import os
import pty
import re
import select
import struct
import sys
import termios
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
TUI = ROOT / "apps" / "tui"
ROWS = 36
COLS = 80


def strip_ansi(text: str) -> str:
    text = re.sub(r"\x1b\[[0-9;?]*[ -/]*[@-~]", "", text)
    text = re.sub(r"\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)", "", text)
    text = re.sub(r"\x1b[()><=].", "", text)
    text = text.replace("\r", "")
    return text


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


def find_composer(lines: list[str]) -> tuple[int, int, list[str]] | None:
    rule = re.compile(r"^─{20,}\s*$")
    idxs = [i for i, line in enumerate(lines) if rule.match(line.strip())]
    if len(idxs) < 2:
        return None
    top, bottom = idxs[-2], idxs[-1]
    return top, bottom, lines[top + 1 : bottom]


def last_frame(raw: str) -> list[str]:
    parts = re.split(r"\x1b\[2J|\x1b\[H\x1b\[2J|\x1b\[2J\x1b\[H|\x1b\[H", raw)
    screen = strip_ansi(parts[-1] if parts else raw)
    return screen.splitlines()


def dump_composer(label: str, between: list[str]) -> None:
    print(f"\n=== {label} ===")
    print(f"content_rows={len(between)}")
    for i, line in enumerate(between):
        print(f"  [{i}] {line!r}")


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

    lines = last_frame(buf.decode("utf-8", "replace"))
    comp = find_composer(lines)
    assert comp is not None
    _, _, between = comp
    dump_composer("EMPTY COMPOSER", between)
    empty_ok = len(between) >= 3
    # No keybinding hint text inside the empty composer.
    joined_empty = "\n".join(between)
    no_hint_ok = "换行" not in joined_empty and "发送" not in joined_empty and "Enter" not in joined_empty
    print(f"empty_min_height_ok={empty_ok}")
    print(f"no_hint_text_ok={no_hint_ok}")

    # Single-line draft is vertically centered (blank above and below).
    write_keys(fd, b"hello")
    buf += read_available(fd, 1.0)
    lines = last_frame(buf.decode("utf-8", "replace"))
    comp = find_composer(lines)
    assert comp is not None
    _, _, between = comp
    dump_composer("SINGLE LINE centered", between)
    hello_idxs = [i for i, x in enumerate(between) if "hello" in x]
    single_centered_ok = (
        len(between) >= 3
        and hello_idxs == [1]
        and not between[0].strip()
        and not between[2].strip()
    )
    print(f"single_line_centered_ok={single_centered_ok}")

    # Shift+Enter + world → two lines in composer (fills the min box, no pad)
    write_keys(fd, b"\x1b[27;2;13~")  # modifyOtherKeys Shift+Enter
    buf += read_available(fd, 0.8)
    write_keys(fd, b"world")
    buf += read_available(fd, 1.0)

    lines = last_frame(buf.decode("utf-8", "replace"))
    comp = find_composer(lines)
    assert comp is not None
    _, _, between = comp
    dump_composer("AFTER Shift+Enter newline", between)
    joined = "\n".join(between)
    shift_newline_ok = "hello" in joined and "world" in joined and (
        any("hello" in x and "world" not in x for x in between)
        and any("world" in x for x in between)
    )
    print(f"shift_enter_newline_ok={shift_newline_ok}")

    # Plain Enter submits
    write_keys(fd, b"\r")
    buf += read_available(fd, 1.5)
    lines = last_frame(buf.decode("utf-8", "replace"))
    comp = find_composer(lines)
    assert comp is not None
    _, _, between = comp
    dump_composer("AFTER Enter submit", between)
    cleared = "hello" not in "\n".join(between) and "world" not in "\n".join(between)
    full = "\n".join(lines)
    submitted = "hello" in full and "world" in full
    enter_submit_ok = cleared and submitted
    print(f"enter_submit_ok={enter_submit_ok}")

    # Soft wrap
    long_len = (COLS - 2) + 20
    write_keys(fd, b"A" * long_len, pause=0.02)
    buf += read_available(fd, 1.5)
    lines = last_frame(buf.decode("utf-8", "replace"))
    comp = find_composer(lines)
    assert comp is not None
    _, _, between = comp
    dump_composer("SOFT WRAP", between)
    a_count = sum(x.count("A") for x in between)
    a_rows = len([x for x in between if "A" in x])
    soft_wrap_ok = a_count >= long_len and a_rows >= 2
    print(f"soft_wrap_ok={soft_wrap_ok} a_count={a_count} a_rows={a_rows}")

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
        "empty_min_height_ok": empty_ok,
        "no_hint_text_ok": no_hint_ok,
        "single_line_centered_ok": single_centered_ok,
        "shift_enter_newline_ok": shift_newline_ok,
        "enter_submit_ok": enter_submit_ok,
        "soft_wrap_ok": soft_wrap_ok,
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
