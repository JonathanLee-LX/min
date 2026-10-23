# `@min/client`

UI-facing facade for min. CLI / TUI / WebUI share **one** experience contract:

`send` · `abort` · `subscribe(ClientEvent)` · `queue` · `respondPermission` · session helpers.

## Layering

```text
CLI · TUI · WebUI     ← render / input only
        ↓
@min/client           ← experience facade (this package)
        ↓
@min/runtime          ← composition root (agent/session/tools/skills)
        ↓
@min/core · session · tools · skills
```

- **Runtime** = how the stack is assembled  
- **Client** = how UIs drive a conversation  
- Ordinary UI code should not call `session.run` or parse `RunEvent`

## Quick use

```ts
import { createClient } from "@min/client";
import { resolveProvider } from "@min/runtime";

const client = await createClient({
  cwd: process.cwd(),
  provider: resolveProvider({ provider: "deepseek" }),
});

const unsub = client.subscribe((e) => {
  if (e.type === "assistant_delta") process.stdout.write(e.text);
  if (e.type === "permission") {
    client.respondPermission(e.id, "allow"); // or deny / allow_session
  }
});

await client.send("summarize README");
client.abort(); // Ctrl+C / Stop
unsub();
await client.dispose();
```

Busy `send` defaults to **queue** (session input queue). Pass `onBusySend: "reject"` to throw instead.

## ClientEvent (display model)

| type | purpose |
|------|---------|
| `status` | `idle` / `running` / `asking` |
| `assistant_delta` / `assistant_done` | streaming + final bubble |
| `tool_start` / `tool_end` | tool rows |
| `follow_up` | queue drain texts (owned Runtime only) |
| `permission` | ask UI; answer via `respondPermission` |
| `queued` | busy-send enqueued |
| `error` | failures / abort |
| `session` | id / title / counts |

## Escape hatch

`client.advanced.runtime` exposes the composed Runtime for hosts that need Store / permissions directly. Prefer not to use it from ordinary UI code.
