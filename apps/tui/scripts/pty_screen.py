"""Rebuild a screen from raw TUI bytes (ED2 frames or CUP row diffs)."""

from __future__ import annotations

import re

CSI = re.compile(r"\x1b\[[0-9;:?<>=]*[A-Za-z@-~]")
OSC = re.compile(r"\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)")
OTHER_ESC = re.compile(r"\x1b.")


def strip_ansi(text: str) -> str:
    text = CSI.sub("", text)
    text = OSC.sub("", text)
    text = OTHER_ESC.sub("", text)
    return text.replace("\r", "")


def last_frame(raw: str) -> list[str]:
    """Apply CUP / EL / ED onto a cell grid so diff paints still yield lines."""
    raw = OSC.sub("", raw)
    rows: dict[int, list[str]] = {}
    row = 1
    col = 1
    i = 0
    n = len(raw)

    def line(at: int) -> list[str]:
        return rows.setdefault(at, [])

    def put(ch: str) -> None:
        nonlocal col
        cells = line(row)
        while len(cells) < col:
            cells.append(" ")
        cells[col - 1] = ch
        col += 1

    while i < n:
        ch = raw[i]
        if ch == "\x1b":
            csi = CSI.match(raw, i)
            if csi:
                seq = csi.group(0)
                i = csi.end()
                params_raw = seq[2:-1]
                cmd = seq[-1]
                private = params_raw.startswith("?") or params_raw.startswith(">") or params_raw.startswith("<")
                nums = [int(p) for p in re.findall(r"\d+", params_raw)]
                if cmd == "H" and not private:
                    row = nums[0] if nums else 1
                    col = nums[1] if len(nums) > 1 else 1
                elif cmd == "G" and not private:
                    col = nums[0] if nums else 1
                elif cmd == "A" and not private:
                    row = max(1, row - (nums[0] if nums else 1))
                elif cmd == "B" and not private:
                    row += nums[0] if nums else 1
                elif cmd == "K" and not private:
                    cells = line(row)
                    kind = nums[0] if nums else 0
                    if kind == 2:
                        rows[row] = []
                        col = 1
                    else:
                        rows[row] = cells[: max(0, col - 1)]
                elif cmd == "J" and not private:
                    kind = nums[0] if nums else 0
                    if kind in (2, 3):
                        rows.clear()
                        row, col = 1, 1
                elif cmd == "h" and "1049" in params_raw:
                    rows.clear()
                    row, col = 1, 1
                continue
            osc = OSC.match(raw, i)
            if osc:
                i = osc.end()
                continue
            i = min(n, i + 2)
            continue
        if ch == "\n":
            row += 1
            col = 1
            i += 1
            continue
        if ch == "\r":
            col = 1
            i += 1
            continue
        put(ch)
        i += 1

    if not rows:
        return []
    last = max(rows)
    return ["".join(rows.get(r, [])) for r in range(1, last + 1)]
