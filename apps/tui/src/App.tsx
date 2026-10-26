import {
  createAutoPermissionApprover,
  createClient,
  type ClientEvent,
  type MinClient,
} from "@min/client";
import { loadProviderExtensions, resolveProvider } from "@min/runtime";
import { Box, Text, useApp, useInput } from "ink";
import React, { useCallback, useEffect, useRef, useState } from "react";
import type { TuiArgs } from "./args.js";

/** Chat-style lines — aligned with Web (user right/green, assistant default, tools muted). */
type LogLine = {
  id: number;
  kind: "user" | "assistant" | "tool" | "sys";
  text: string;
};

export function App({ args }: { args: TuiArgs }) {
  const { exit } = useApp();
  const [client, setClient] = useState<MinClient | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [statusLabel, setStatusLabel] = useState("idle");
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [stream, setStream] = useState("");
  const [pendingPerm, setPendingPerm] = useState<{
    id: string;
    reason: string;
  } | null>(null);
  const seq = useRef(0);
  const clientRef = useRef<MinClient | null>(null);
  const streamBuf = useRef("");

  const push = useCallback((kind: LogLine["kind"], text: string) => {
    seq.current += 1;
    const id = seq.current;
    setLogs((prev) => [...prev.slice(-80), { id, kind, text }]);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unsub: (() => void) | undefined;
    (async () => {
      try {
        await loadProviderExtensions();
        const autoMode = args.auto ? "auto" : args.yes ? "yes" : undefined;
        const c = await createClient({
          cwd: args.cwd,
          provider: resolveProvider({
            provider: args.provider,
            model: args.model,
          }),
          sessionId: args.sessionId,
          noTools: args.noTools,
          allowBash: args.yes || args.auto,
          askWrite: false,
          applyRootGrant: args.auto,
          autoApprovePermission: autoMode
            ? createAutoPermissionApprover({
                mode: autoMode,
                allowRootGrant: args.auto,
              })
            : undefined,
        });
        if (cancelled) {
          await c.dispose();
          return;
        }
        clientRef.current = c;
        setClient(c);
        const st = c.getStatus();
        push(
          "sys",
          `provider=${st.provider}  session=${st.sessionId}  cwd=${st.cwd}`,
        );

        unsub = c.subscribe((e: ClientEvent) => {
          if (e.type === "status") {
            setStatusLabel(e.status);
            setBusy(e.status !== "idle");
            return;
          }
          if (e.type === "assistant_delta") {
            streamBuf.current += e.text;
            setStream(streamBuf.current);
            return;
          }
          if (e.type === "assistant_done") {
            streamBuf.current = "";
            setStream("");
            if (e.text) push("assistant", e.text);
            return;
          }
          if (e.type === "tool_start") {
            push(
              "tool",
              `→ ${e.name}(${JSON.stringify(e.args).slice(0, 80)})`,
            );
            return;
          }
          if (e.type === "tool_end") {
            push(
              "tool",
              `← ${e.ok ? "" : "ERR "}${e.preview.slice(0, 120)}`,
            );
            return;
          }
          if (e.type === "queued") {
            push("sys", `queued (${e.queueSize})`);
            return;
          }
          if (e.type === "follow_up") {
            push("sys", `follow-up: ${e.texts.join(" | ").slice(0, 100)}`);
            return;
          }
          if (e.type === "error") {
            push("sys", e.aborted ? "aborted" : e.message);
            return;
          }
          if (e.type === "permission") {
            setPendingPerm({ id: e.id, reason: e.reason });
          }
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
      unsub?.();
    };
  }, [
    args.cwd,
    args.provider,
    args.model,
    args.sessionId,
    args.noTools,
    args.yes,
    push,
  ]);

  useEffect(() => {
    return () => {
      const c = clientRef.current;
      if (!c) return;
      void c.dispose();
    };
  }, []);

  const send = useCallback(
    async (text: string) => {
      if (!client || !text.trim()) return;
      if (pendingPerm) return;
      const prompt = text.trim();
      streamBuf.current = "";
      setStream("");
      push("user", prompt);
      await client.send(prompt);
    },
    [client, pendingPerm, push],
  );

  useInput((ch, key) => {
    if (pendingPerm && client) {
      if (ch === "y" || ch === "Y") {
        client.respondPermission(pendingPerm.id, "allow");
        setPendingPerm(null);
        return;
      }
      if (ch === "n" || ch === "N") {
        client.respondPermission(pendingPerm.id, "deny");
        setPendingPerm(null);
        return;
      }
      if (ch === "a" || ch === "A") {
        client.respondPermission(pendingPerm.id, "allow_session");
        setPendingPerm(null);
        return;
      }
      return;
    }

    if (key.ctrl && ch === "c") {
      if (busy && client) {
        client.abort();
        return;
      }
      exit();
      return;
    }
    if (busy) {
      if (key.return && input.trim() && client) {
        const line = input.trim();
        setInput("");
        try {
          client.queue.push(line);
        } catch {
          /* ignore */
        }
      }
      return;
    }
    if (key.return) {
      const line = input;
      setInput("");
      if (line === "/exit" || line === "/quit") {
        exit();
        return;
      }
      if (line === "/session" && client) {
        const s = client.getSession();
        push(
          "sys",
          `session ${s.id}  msgs=${s.messageCount}  queue=${client.queue.size}`,
        );
        return;
      }
      if (line === "/reset" && client) {
        client.reset();
        setLogs([]);
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

  if (!client) {
    return (
      <Box padding={1}>
        <Text dimColor>starting min…</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingX={1} height="100%">
      <Box paddingX={1} paddingY={0}>
        <Text bold>min</Text>
        <Text dimColor>
          {" "}
          · {client.getStatus().provider} · {statusLabel}
          {busy ? " · running" : ""}
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
                  ? "gray"
                  : l.kind === "sys"
                    ? "magenta"
                    : undefined
            }
            wrap="truncate"
          >
            {l.kind === "user"
              ? `you  ${l.text}`
              : l.kind === "assistant"
                ? `min  ${l.text}`
                : l.text}
          </Text>
        ))}
        {stream ? (
          <Text>
            min  {stream}
            <Text dimColor>▍</Text>
          </Text>
        ) : null}
      </Box>

      {pendingPerm ? (
        <Box marginTop={1} paddingX={1}>
          <Text color="yellow">
            permission: {pendingPerm.reason}  [y/n/a]
          </Text>
        </Box>
      ) : (
        <Box marginTop={1} paddingX={1}>
          <Text color="green">you </Text>
          <Text>{input}</Text>
          <Text dimColor>{busy ? " · enter queues" : "▊"}</Text>
        </Box>
      )}
      <Text dimColor>
        Enter send · busy: Enter queues · /session /reset /exit · Ctrl+C
        abort/quit
      </Text>
    </Box>
  );
}
