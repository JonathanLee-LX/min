#!/usr/bin/env python3
"""Drive min-tui under a PTY: Enter on /model and /resume opens a filterable list."""

from __future__ import annotations

import fcntl
import json
import os
import pty
import re
import select
import shutil
import struct
import sys
import tempfile
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


def write_keys(fd: int, data: bytes, pause: float = 0.08) -> None:
    os.write(fd, data)
    time.sleep(pause)


def last_frame(raw: str) -> list[str]:
    parts = re.split(r"\x1b\[2J|\x1b\[H\x1b\[2J|\x1b\[2J\x1b\[H|\x1b\[H", raw)
    screen = strip_ansi(parts[-1] if parts else raw)
    return screen.splitlines()


def screen_blob(lines: list[str]) -> str:
    return "\n".join(lines)


def find_composer(lines: list[str]) -> tuple[int, int, list[str]] | None:
    rule = re.compile(r"^─{20,}\s*$")
    idxs = [i for i, line in enumerate(lines) if rule.match(line.strip())]
    if len(idxs) < 2:
        return None
    top, bottom = idxs[-2], idxs[-1]
    return top, bottom, lines[top + 1 : bottom]


def tsx_bin() -> Path:
    local = TUI / "node_modules" / ".bin" / "tsx"
    if local.exists():
        return local
    return ROOT / "node_modules" / ".bin" / "tsx"


def write_session(path: Path, session_id: str, title: str, prompt: str) -> None:
    path.write_text(
        json.dumps(
            {
                "meta": {
                    "id": session_id,
                    "title": title,
                    "createdAt": "2026-11-05T00:00:00.000Z",
                    "updatedAt": "2026-11-05T00:00:00.000Z",
                },
                "messages": [
                    {"role": "user", "content": [{"type": "text", "text": prompt}]},
                ],
            },
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


def boot_env(home: Path) -> dict[str, str]:
    env = dict(os.environ)
    env["TERM"] = "xterm-256color"
    env["COLORTERM"] = "truecolor"
    env["FORCE_COLOR"] = "1"
    env["HOME"] = str(home)
    env["USERPROFILE"] = str(home)
    env.pop("CI", None)
    env.pop("NO_COLOR", None)
    env.pop("MIN_THEME", None)
    env.pop("MIN_MODEL", None)
    env.pop("PROVIDER", None)
    for key in list(env):
        if key.startswith("GITHUB_") or key in {"TF_BUILD", "BUILDKITE", "CIRCLECI"}:
            env.pop(key, None)
    return env


def wait_boot(fd: int) -> bytes:
    buf = b""
    deadline = time.time() + 12
    while time.time() < deadline:
        buf += read_available(fd, 0.4)
        if find_composer(last_frame(buf.decode("utf-8", "replace"))):
            return buf
    raise RuntimeError(
        "BOOT FAILED; raw tail:\n" + strip_ansi(buf.decode("utf-8", "replace"))[-2000:]
    )


def wait_screen(fd: int, buf: bytes, pred, timeout: float = 3.0) -> tuple[bytes, list[str]]:
    deadline = time.time() + timeout
    lines = last_frame(buf.decode("utf-8", "replace"))
    if pred(lines):
        return buf, lines
    while time.time() < deadline:
        buf += read_available(fd, 0.25)
        lines = last_frame(buf.decode("utf-8", "replace"))
        if pred(lines):
            return buf, lines
    raise RuntimeError("WAIT FAILED; last frame:\n" + screen_blob(lines)[-2500:])


def composer_text(lines: list[str]) -> str:
    found = find_composer(lines)
    if not found:
        return ""
    return "\n".join(found[2])


def main() -> int:
    home = Path(tempfile.mkdtemp(prefix="min-picker-home-"))
    cwd = Path(tempfile.mkdtemp(prefix="min-picker-cwd-"))
    checks: dict[str, bool] = {}
    pid = None
    fd = None
    try:
        min_dir = home / ".min"
        min_dir.mkdir(parents=True)
        (min_dir / "providers.json").write_text(
            json.dumps(
                {
                    "version": 1,
                    "providers": {
                        "acme": {"kind": "mock", "model": "mock-flash"},
                        "other": {"kind": "mock", "model": "mock-other"},
                    },
                },
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        sessions = cwd / ".min" / "sessions"
        sessions.mkdir(parents=True)
        write_session(sessions / "ses_alpha.json", "ses_alpha", "Plan the launch", "ship it friday")
        write_session(sessions / "ses_beta.json", "ses_beta", "Fix the picker", "type to search")

        env = boot_env(home)
        tsx = tsx_bin()
        cmd = [
            "/bin/sh",
            "-c",
            f'exec "{tsx}" src/tui.tsx --provider mock --model mock-1 --no-tools --cwd "{cwd}"',
        ]

        pid, fd = pty.fork()
        if pid == 0:
            os.environ.clear()
            os.environ.update(env)
            set_winsize(sys.stdout.fileno())
            os.chdir(TUI)
            os.execv(cmd[0], cmd)

        set_winsize(fd)
        buf = wait_boot(fd)
        print("booted")

        write_keys(fd, b"/model")
        buf, lines = wait_screen(
            fd,
            buf,
            lambda rows: "/model" in composer_text(rows) and "pick a model" in screen_blob(rows),
        )
        write_keys(fd, b"\r")
        buf, lines = wait_screen(
            fd,
            buf,
            lambda rows: "filter" in screen_blob(rows) and "mock-1" in screen_blob(rows),
        )
        blob = screen_blob(lines)
        composer = composer_text(lines)
        model_opens = (
            "type to filter" in blob
            and "mock-1" in blob
            and "acme" in blob
            and "other" in blob
            and "/model " not in composer
        )
        checks["model_enter_opens_list"] = model_opens
        print(f"model_enter_opens_list={model_opens}")
        if not model_opens:
            print(blob[-2000:])

        write_keys(fd, b"acme")
        buf, lines = wait_screen(fd, buf, lambda rows: "acme" in screen_blob(rows) and "filter acme" in screen_blob(rows))
        blob = screen_blob(lines)
        model_filter = "acme" in blob and "mock-1" not in blob and "other" not in blob
        checks["model_filter_keeps_acme"] = model_filter
        print(f"model_filter_keeps_acme={model_filter}")

        write_keys(fd, b"zzz")
        buf, lines = wait_screen(fd, buf, lambda rows: "(no matches)" in screen_blob(rows))
        checks["model_filter_no_matches"] = "(no matches)" in screen_blob(lines)
        print(f"model_filter_no_matches={checks['model_filter_no_matches']}")

        write_keys(fd, b"\x1b")
        buf, lines = wait_screen(
            fd,
            buf,
            lambda rows: "filter" not in screen_blob(rows) and find_composer(rows) is not None,
            timeout=2.0,
        )
        checks["model_esc_closes"] = "filter" not in screen_blob(lines)
        print(f"model_esc_closes={checks['model_esc_closes']}")

        write_keys(fd, b"/resume")
        buf, lines = wait_screen(
            fd,
            buf,
            lambda rows: "/resume" in composer_text(rows),
        )
        write_keys(fd, b"\r")
        buf, lines = wait_screen(
            fd,
            buf,
            lambda rows: "Plan the launch" in screen_blob(rows) and "filter" in screen_blob(rows),
        )
        blob = screen_blob(lines)
        resume_opens = (
            "type to filter" in blob
            and "Plan the launch" in blob
            and "Fix the picker" in blob
            and "/resume " not in composer_text(lines)
        )
        checks["resume_enter_opens_list"] = resume_opens
        print(f"resume_enter_opens_list={resume_opens}")
        if not resume_opens:
            print(blob[-2000:])

        write_keys(fd, b"picker")
        buf, lines = wait_screen(fd, buf, lambda rows: "filter picker" in screen_blob(rows))
        blob = screen_blob(lines)
        resume_filter = "Fix the picker" in blob and "Plan the launch" not in blob
        checks["resume_filter_keeps_picker"] = resume_filter
        print(f"resume_filter_keeps_picker={resume_filter}")

        write_keys(fd, b"\x1b")
        buf, lines = wait_screen(
            fd,
            buf,
            lambda rows: "filter" not in screen_blob(rows),
            timeout=2.0,
        )
        write_keys(fd, b"/mod")
        buf, lines = wait_screen(fd, buf, lambda rows: "/mod" in composer_text(rows))
        write_keys(fd, b"\t")
        buf, lines = wait_screen(fd, buf, lambda rows: "/model " in composer_text(rows))
        checks["tab_still_fills_model_arg"] = "/model " in composer_text(lines)
        print(f"tab_still_fills_model_arg={checks['tab_still_fills_model_arg']}")

        write_keys(fd, b"\x03")
        time.sleep(0.2)
    except Exception as err:
        print(f"PROBE ERROR: {err}", file=sys.stderr)
        return 2
    finally:
        if fd is not None:
            try:
                os.close(fd)
            except OSError:
                pass
        if pid is not None:
            try:
                os.waitpid(pid, 0)
            except ChildProcessError:
                pass
        shutil.rmtree(home, ignore_errors=True)
        shutil.rmtree(cwd, ignore_errors=True)

    print("\n=== SUMMARY ===")
    for name, ok in checks.items():
        print(f"{name}={ok}")
    if not checks or not all(checks.values()):
        print("PROBE FAILED", file=sys.stderr)
        return 1
    print("PROBE OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
