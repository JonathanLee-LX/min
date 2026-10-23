import { createRuntime, resolveProvider, type Runtime } from "@min/runtime";
import { Box, Text, useApp, useInput } from "ink";
import React, { useCallback, useEffect, useRef, useState } from "react";
import type { TuiArgs } from "./args.js";

type LogLine = {
  id: number;
  kind: "user" | "assistant" | "tool" | "sys";
  text: string;
};

export function App({ args }: { args: TuiArgs }) {
  const { exit } = useApp();
  const [runtime, setRuntime] = useState<Runtime | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [stream, setStream] = useState("");
  const seq = useRef(0);
  const runtimeRef = useRef<Runtime | null>(null);

  const push = useCallback((kind: LogLine["kind"], text: string) => {
    seq.current += 1;
    const id = seq.current;
    setLogs((prev) => [...prev.slice(-80), { id, kind, text }]);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rt = await createRuntime({
          cwd: args.cwd,
          provider: resolveProvider({
            provider: args.provider,
            model: args.model,
          }),
          sessionId: args.sessionId,
          noTools: args.noTools,
          allowBash: args.yes,
          askWrite: false,
        });
        if (cancelled) {
          await rt.session.dispose();
          await rt.agent.dispose();
          return;
        }
        runtimeRef.current = rt;
        setRuntime(rt);
        push(
          "sys",
          `provider=${rt.agent.provider.id}  session=${rt.session.id}  cwd=${args.cwd}`,
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [args.cwd, args.provider, args.model, args.sessionId, args.noTools, args.yes, push]);

  useEffect(() => {
    return () => {
      const rt = runtimeRef.current;
      if (!rt) return;
      void rt.session.dispose();
      void rt.agent.dispose();
    };
  }, []);

  const send = useCallback(
    async (text: string) => {
      if (!runtime || busy || !text.trim()) return;
      const prompt = text.trim();
      setBusy(true);
      setStream("");
      push("user", prompt);
      try {
        let buf = "";
        const result = await runtime.session.run(prompt, {
          onEvent(e) {
            if (e.type === "text_delta") {
              buf += e.text;
              setStream(buf);
            } else if (e.type === "tool_call") {
              push(
                "tool",
                `→ ${e.toolCall.name}(${JSON.stringify(e.toolCall.arguments).slice(0, 80)})`,
              );
            } else if (e.type === "tool_result") {
              const body = e.content.replace(/\s+/g, " ").trim();
              push(
                "tool",
                `← ${e.isError ? "ERR " : ""}${body.slice(0, 120)}`,
              );
            }
          },
          onPermissionAsk: async () => (args.yes ? "allow" : "deny"),
        });
        setStream("");
        if (result.text) push("assistant", result.text);
      } catch (err) {
        push("sys", err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
    },
    [runtime, busy, push, args.yes],
  );

  useInput((ch, key) => {
    if (key.ctrl && ch === "c") {
      exit();
      return;
    }
    if (busy) return;
    if (key.return) {
      const line = input;
      setInput("");
      if (line === "/exit" || line === "/quit") {
        exit();
        return;
      }
      if (line === "/session" && runtime) {
        push(
          "sys",
          `session ${runtime.session.id}  msgs=${runtime.session.messages.length}  queue=${runtime.session.inputQueue?.size ?? 0}`,
        );
        return;
      }
      if (line === "/reset" && runtime) {
        runtime.session.reset();
        push("sys", "history cleared");
        return;
      }
      void send(line);
      return;
    }
    if (key.backspace || key.delete) {
      setInput((s) => s.slice(0, -1));
      return;
    }
    if (ch && !key.ctrl && !key.meta) {
      setInput((s) => s + ch);
    }
  });

  if (error) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color="red">error: {error}</Text>
      </Box>
    );
  }

  if (!runtime) {
    return (
      <Box padding={1}>
        <Text dimColor>starting min-tui…</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box borderStyle="single" borderColor="cyan" paddingX={1}>
        <Text bold color="cyan">
          min-tui
        </Text>
        <Text dimColor>
          {" "}
          · {runtime.agent.provider.id} · {runtime.session.id}
          {busy ? " · running…" : ""}
        </Text>
      </Box>

      <Box flexDirection="column" marginTop={1} height={16}>
        {logs.slice(-12).map((l) => (
          <Text
            key={l.id}
            color={
              l.kind === "user"
                ? "green"
                : l.kind === "tool"
                  ? "yellow"
                  : l.kind === "sys"
                    ? "gray"
                    : undefined
            }
            wrap="truncate"
          >
            {l.kind === "user" ? `you> ${l.text}` : l.text}
          </Text>
        ))}
        {stream ? (
          <Text>
            {stream}
            <Text dimColor>▌</Text>
          </Text>
        ) : null}
      </Box>

      <Box marginTop={1} borderStyle="single" borderColor="gray" paddingX={1}>
        <Text color="cyan">{"> </Text>
        <Text>{input}</Text>
        <Text dimColor>{busy ? " (wait)" : "█"}</Text>
      </Box>
      <Text dimColor>Enter send · /session /reset /exit · Ctrl+C quit</Text>
    </Box>
  );
}
