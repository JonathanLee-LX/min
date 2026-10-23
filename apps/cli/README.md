# @min/cli

Minimal CLI for the min agent harness.

```bash
pnpm min -- "list files in this workspace"
pnpm min -- -i
pnpm min -- -y "…"
pnpm min -- --session ses_demo -i
pnpm min -- --max-context-tokens 16000 -i
pnpm min -- --list-sessions
```

Conversation state lives in `@min/session` (default store: `<cwd>/.min/sessions`).  
Model calls use a **budgeted view** of history so context window / prompt cost stay bounded.
