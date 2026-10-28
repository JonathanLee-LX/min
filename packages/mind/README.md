# `@min-agent/mind`

Machine-wide supervisor for interactive sessions.

```text
TUI / Web
  │ lease, create / lookup / destroy / list
  ▼
mind  (~/.min/mind/mind.sock)
  │ spawn, return address
  ▼
client process  (one session)
```

Mind does not embed `MinClient` and does not forward `send`, events, or
permissions. Frontends connect to the client socket after a lease.

One-shot `min -p` never talks to mind.
