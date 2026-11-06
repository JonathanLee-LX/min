#!/usr/bin/env bash
# Live hybrid fold + recall check against DeepSeek.
# Requires DEEPSEEK_API_KEY. Does not print the key.
#
# Fat reads fold even at the 256k product default. Needles sit past the
# 120-char fold head. The fold marker names TOKEN_* keys; recall_context
# need={kind:key, query:TOKEN_*} returns that line. offset/limit still pages.
#
# 256k product-default comparison: set
#   HYBRID_LIVE_EVAL_MAX_CONTEXT_TOKENS=256000
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${HYBRID_LIVE_EVAL_OUT:-/opt/cursor/artifacts}"
WORKDIR="${HYBRID_LIVE_EVAL_WORKDIR:-$(mktemp -d /tmp/min-hybrid-eval.XXXXXX)}"
LOG="${OUT_DIR}/hybrid-live-eval.log"
SUMMARY="${OUT_DIR}/hybrid-live-eval-summary.json"
MAX_CONTEXT="${HYBRID_LIVE_EVAL_MAX_CONTEXT_TOKENS:-16384}"

mkdir -p "$OUT_DIR" "$WORKDIR"

TOKEN_SKILL="min-eval-skill-7f3c"
TOKEN_SCRIPT="min-eval-script-9a2b"

python3 - "$WORKDIR" "$TOKEN_SKILL" "$TOKEN_SCRIPT" <<'PY'
import pathlib, sys
root = pathlib.Path(sys.argv[1])
token_skill, token_script = sys.argv[2], sys.argv[3]
# Past the 120-char fold head, inside the default 12k recall page.
needle_at_skill = 5_000
needle_at_script = 5_000

def grow_then_plant(header: str, needle: str, size: int, pad: str, at: int) -> str:
    body = header
    while len(body) < size:
        body += pad
    nl = body.find("\n", at)
    if nl < 0:
        nl = at
    planted = body[: nl + 1] + needle + body[nl + 1 :]
    while len(planted) < size:
        planted += pad
    return planted

skill_header = """# Disk cleaner (live hybrid eval fixture)

## Procedure
1. Read this file with read_file.
2. Read clean_disk.py with read_file.
3. Run `python3 clean_disk.py --dry-run` via bash.
4. Run `ls -la` via bash.
5. Run `pwd` via bash.
6. Each of SKILL.md and clean_disk.py hides a token in the *middle* of the
   file (not in the first or last few hundred characters). Quote those
   exact values in the final answer.

Do not delete files. Dry-run only.
"""
skill = grow_then_plant(
    skill_header,
    f"TOKEN_SKILL={token_skill}\n",
    45_252,
    "padding-line for a fat skill body so hybrid folds it.\n",
    needle_at_skill,
)
(root / "SKILL.md").write_text(skill)
script_header = """#!/usr/bin/env python3
import json, sys
print(json.dumps({"dry_run": True, "would_delete": []}))
"""
script = grow_then_plant(
    script_header,
    f"# TOKEN_SCRIPT={token_script}\n",
    24_861,
    "# padding comment so this file is large like the original clean_disk.py\n",
    needle_at_script,
)
(root / "clean_disk.py").write_text(script)
assert token_skill not in skill[:120] and token_skill not in skill[-120:]
assert token_script not in script[:120] and token_script not in script[-120:]
assert token_skill in skill[:12_000]
assert token_script in script[:12_000]
print(f"wrote {len(skill)} {len(script)} needle_skill={needle_at_skill} needle_script={needle_at_script}")
PY

PROMPT="Read SKILL.md with read_file, then read clean_disk.py with read_file, then run python3 clean_disk.py --dry-run, then ls -la, then pwd. Do not cat, sed, head, or tail those two files via bash. TOKEN_SKILL and TOKEN_SCRIPT are NOT in the first or last 120 characters of either file. If a tool result contains [hidden:<id> · recall_context], call recall_context for that id to recover the token. Quote both token values in the final answer. Do not write or delete files."

export MIN_REASONING_EFFORT="${MIN_REASONING_EFFORT:-none}"
export MIN_AUTO=1

{
  echo "workdir=$WORKDIR"
  echo "provider=deepseek"
  echo "effort=${MIN_REASONING_EFFORT}"
  echo "maxContextTokens=${MAX_CONTEXT}"
  echo "---"
} | tee "$LOG"

cd "$ROOT"
set +e
pnpm min -- \
  --provider deepseek \
  --auto \
  --no-session-store \
  --max-turns 25 \
  --max-context-tokens "$MAX_CONTEXT" \
  --cwd "$WORKDIR" \
  -p "$PROMPT" \
  2>&1 | tee -a "$LOG"
status=${PIPESTATUS[0]}
set -e

python3 - "$LOG" "$SUMMARY" "$TOKEN_SKILL" "$TOKEN_SCRIPT" "$status" "$MAX_CONTEXT" <<'PY'
import json, re, sys
from collections import Counter
from pathlib import Path
log, summary, token_skill, token_script, status, max_context_s = sys.argv[1:]
max_context = int(max_context_s)
text = Path(log).read_text(errors="replace")
tools = re.findall(r"^→ (\S+)\(", text, re.M)
counts = Counter(tools)
folded = [int(x) for x in re.findall(r"foldedParts=(\d+)", text)]
trimmed = len(re.findall(r"context\[assemble/trimmed\]", text))
hidden = len(re.findall(r"\[hidden:", text))
# Tokens must appear in the assistant's streamed answer, not only in the
# prompt. The prompt never includes the raw values.
has_skill = token_skill in text
has_script = token_script in text
recall_ids = re.findall(
    r"^→ recall_context\((.*)\)\s*$", text, re.M
)
id_hits = []
recall_offsets = []
for raw in recall_ids:
    found = re.findall(r"tool_[A-Za-z0-9_]+", raw)
    id_hits.extend(found or [raw[:80]])
    off = re.search(r"offset[=:\s]+(\d+)", raw)
    recall_offsets.append(int(off.group(1)) if off else 0)
id_counts = Counter(id_hits)
max_id_repeats = max(id_counts.values()) if id_counts else 0
recall_n = counts.get("recall_context", 0)
quoted = has_skill and has_script and counts.get("read_file", 0) >= 2
paged = any(off != 0 for off in recall_offsets)
# Fold hid the needle. One selective recall (or one raw page) per id recovers it.
ok_path = (
    (max(folded, default=0) > 0 or hidden > 0)
    and recall_n >= 1
    and max_id_repeats <= 2
    and not paged
)
payload = {
    "maxContextTokens": max_context,
    "exitCode": int(status),
    "toolCalls": dict(counts),
    "toolCallTotal": len(tools),
    "recallContextCount": recall_n,
    "recallOffsets": recall_offsets,
    "recallIdRepeats": dict(id_counts),
    "maxSameRecallId": max_id_repeats,
    "readFileCount": counts.get("read_file", 0),
    "bashCount": counts.get("bash", 0),
    "maxFoldedParts": max(folded) if folded else 0,
    "trimmedAssembles": trimmed,
    "hiddenMarkersInLog": hidden,
    "quotedSkillToken": has_skill,
    "quotedScriptToken": has_script,
    "ok": int(status) == 0 and quoted and ok_path,
}
Path(summary).write_text(json.dumps(payload, indent=2) + "\n")
print(json.dumps(payload, indent=2))
PY
exit "$status"
