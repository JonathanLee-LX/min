---
name: readme-brief
description: Summarize or quote the repo README using read-only tools.
allowed-tools: read_file glob
---

# readme-brief

When the user asks about this repository's README or project overview:

1. Use `glob` / `read_file` to open `README.md` (repo root).
2. Answer briefly from the file contents.
3. Do not use `bash` or `write_file` — they are outside this skill's allowed-tools.
