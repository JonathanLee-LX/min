# `@min-agent/render`

Shared **Markdown → `RenderBlock`** pipeline for TUI and Web UI.

Parse with `markdown-it` (+ GFM tables). Hosts paint the blocks themselves
(Ink in the TUI, React in Web). Mermaid ASCII stays in the TUI.

```ts
import { renderContent } from "@min-agent/render";

const blocks = renderContent({
  role: "assistant",
  text: "| A | B |\n| --- | --- |\n| 1 | 2 |",
  streaming: false,
});
```

Plugins can wrap `renderContent` the same way as before.
