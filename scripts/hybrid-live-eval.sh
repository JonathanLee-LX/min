#!/usr/bin/env bash
# Live hybrid-efficiency check against DeepSeek.
# Requires DEEPSEEK_API_KEY. Does not print the key.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="${HYBRID_LIVE_EVAL_OUT:-/opt/cursor/artifacts}"
WORKDIR="${HYBRID_LIVE_EVAL_WORKDIR:-$(mktemp -d /tmp/min-hybrid-eval.XXXXXX)}"
LOG="${OUT_DIR}/hybrid-live-eval.log"
SUMMARY="${OUT_DIR}/hybrid-live-eval-summary.json"

mkdir -p "$OUT_DIR" "$WORKDIR"

TOKEN_SKILL="min-eval-skill-7f3c"
TOKEN_SCRIPT="min-eval-script-9a2b"

python3 - "$WORKDIR" "$TOKEN_SKILL" "$TOKEN_SCRIPT" <<'PY'
import pathlib, sys
root = pathlib.Path(sys.argv[1])
token_skill, token_script = sys.argv[2], sys.argv[3]
skill = f"""# Disk cleaner (live hybrid eval fixture)

TOKEN_SKILL={token_skill}

## Procedure
1. Read this file with read_file.
2. Read clean_disk.py with read_file.
3. Run `python3 clean_disk.py --dry-run` via bash.
4. Run `ls -la` via bash.
5. Run `pwd` via bash.
6. Only after those five tools, quote TOKEN_SKILL and TOKEN_SCRIPT exactly.

The extra ls/pwd steps exist so older tool results would fall out of a
protect-last-2 window. Do not skip them. Do not use recall_context.
Do not delete files. Dry-run only.
"""
pad = "padding-line for a fat skill body so hybrid used to fold it.\n"
while len(skill) < 45_252:
    skill += pad
(root / "SKILL.md").write_text(skill)
script = f'''#!/usr/bin/env python3
# TOKEN_SCRIPT={token_script}
import json, sys
print(json.dumps({{"dry_run": True, "would_delete": [], "token": "{token_script}"}}))
'''
pad_py = "# padding comment so this file is large like the original clean_disk.py\n"
while len(script) < 24_861:
    script += pad_py
(root / "clean_disk.py").write_text(script)
print(f"wrote {(root / 'SKILL.md').stat().st_size} {(root / 'clean_disk.py').stat().st_size}")
PY

PROMPT="Follow SKILL.md in this workspace exactly. Use read_file to read SKILL.md, then follow every procedure step in order, including ls and pwd after the dry-run. Quote TOKEN_SKILL and TOKEN_SCRIPT only in the final answer after those tools. Do not write or delete files. Do not call recall_context."

export MIN_REASONING_EFFORT="${MIN_REASONING_EFFORT:-none}"
export MIN_AUTO=1

{
  echo "workdir=$WORKDIR"
  echo "provider=deepseek"
  echo "effort=${MIN_REASONING_EFFORT}"
  echo "---"
} | tee "$LOG"

cd "$ROOT"
set +e
pnpm min -- \
  --provider deepseek \
  --auto \
  --no-session-store \
  --max-turns 20 \
  --cwd "$WORKDIR" \
  -p "$PROMPT" \
  2>&1 | tee -a "$LOG"
status=${PIPESTATUS[0]}
set -e

python3 - "$LOG" "$SUMMARY" "$TOKEN_SKILL" "$TOKEN_SCRIPT" "$status" <<'PY'
import json, re, sys
from pathlib import Path
log, summary, token_skill, token_script, status = sys.argv[1:]
text = Path(log).read_text(errors="replace")
tools = re.findall(r"^→ (\S+)\(", text, re.M)
from collections import Counter
counts = Counter(tools)
folded = [int(x) for x in re.findall(r"foldedParts=(\d+)", text)]
trimmed = len(re.findall(r"context\[assemble/trimmed\]", text))
hidden = len(re.findall(r"\[hidden:", text))
has_skill = token_skill in text
has_script = token_script in text
payload = {
    "exitCode": int(status),
    "toolCalls": dict(counts),
    "toolCallTotal": len(tools),
    "recallContextCount": counts.get("recall_context", 0),
    "readFileCount": counts.get("read_file", 0),
    "bashCount": counts.get("bash", 0),
    "maxFoldedParts": max(folded) if folded else 0,
    "trimmedAssembles": trimmed,
    "hiddenMarkersInLog": hidden,
    "quotedSkillToken": has_skill,
    "quotedScriptToken": has_script,
    "ok": int(status) == 0
    and counts.get("recall_context", 0) == 0
    and counts.get("read_file", 0) >= 2
    and counts.get("bash", 0) >= 3
    and has_skill
    and has_script
    and max(folded, default=0) == 0,
}
Path(summary).write_text(json.dumps(payload, indent=2) + "\n")
print(json.dumps(payload, indent=2))
PY
exit "$status"
