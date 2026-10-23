# `@min/client`

中间体验层：抹平 CLI / TUI / WebUI 的使用方式，隐藏 Session / Core 细节，让界面与引擎解耦。

对外只暴露：

`send` · `abort` · `subscribe(ClientEvent)` · `queue` · `respondPermission` · session helpers.

## 实现目标

| 目标 | 含义 |
|------|------|
| **抹平上层体验** | 三端同一套语义（发消息、流式、权限、插话、中断、会话）；换端只换渲染 |
| **隐藏底层实现** | UI 不碰 `session.run` / `RunEvent` / Assembler / Store / Extension setup |
| **层间解耦** | L4 只依赖本包；L1 不为某个 UI 开口；L2 Runtime 只组装、不背体验契约 |

Client 翻译与编排，**不是**第二套引擎，也不做 Ink/DOM。

## Layering

```text
CLI · TUI · WebUI     ← 渲染 / 输入 only
        ↓
@min/client           ← 体验契约（本包）
        ↓
@min/runtime          ← 组合根（怎么装起来）
        ↓
@min/core · session · tools · skills
```

## 解耦验收

- 同一 `send` 在各端产生**同序** `ClientEvent`
- `apps/*` 常规路径不 `import` Session / RunEvent / `createAgent`
- 换 Store / Provider / Assembler 不改 UI
- 用 mock provider 即可测门面，无需真实终端或浏览器

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

`client.advanced.runtime` exposes the composed Runtime for hosts that need Store / permissions directly. Prefer not to use it from ordinary UI code — the more it is used, the weaker the decoupling.
