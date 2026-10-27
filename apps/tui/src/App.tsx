import {
  createAutoPermissionApprover,
  createClient,
  type ClientEvent,
  type ClientStatus,
  type MinClient,
} from "@min-agent/client";
import { loadProviderExtensions, resolveProvider } from "@min-agent/runtime";
import { Box, Text, useApp, useStdin, useStdout } from "ink";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TuiArgs } from "./args.js";
import {
  TUI_HELP,
  applyCommandCompletion,
  commandGhost,
  commandSuggestions,
  formatCompact,
  formatQueue,
  formatSession,
  formatSessionList,
  routeSubmit,
  type TuiCommand,
} from "./commands.js";
import {
  commitEditor,
  createEditor,
  editorCaret,
  inputAction,
  reduceEditor,
  type EditorState,
  type InputKey,
} from "./editor.js";
import { decodeInput } from "./keys.js";
import {
  activityFor,
  createPaintCache,
  frameChar,
  padToWidth,
  toneFor,
  type TranscriptSource,
} from "./paint.js";
import { createStreamPump, type StreamPump } from "./stream-pump.js";
import { permissionAnswer, permissionLines } from "./permission-view.js";
import { displayWidth, wrapText } from "./text.js";
import { resolveMinConfig } from "@min-agent/config";
import { themeFromConfig } from "./theme.js";
import {
  linesFromMessages,
  summarizeToolCall,
  sliceViewport,
  type LogKind,
  type LogLine,
  type TranscriptMessage,
} from "./transcript.js";

const LOG_CAP = 2000;

interface PendingPermission {
  id: string;
  reason: string;
  toolCall: { name: string; arguments: unknown };
  grantRoot?: string;
}

export function App({ args }: { args: TuiArgs }) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const { setRawMode, internal_eventEmitter } = useStdin();
  const theme = useMemo(() => {
    const { config } = resolveMinConfig(
      { cwd: args.cwd },
      {
        ...(args.theme ? { theme: args.theme } : {}),
        ...(args.provider ? { provider: args.provider } : {}),
        ...(args.model ? { model: args.model } : {}),
      },
    );
    return themeFromConfig(config.ui);
  }, [args.cwd, args.theme, args.provider, args.model]);
  const [client, setClient] = useState<MinClient | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState>(createEditor);
  const [busy, setBusy] = useState(false);
  const [statusLabel, setStatusLabel] = useState<ClientStatus>("idle");
  const [queueSize, setQueueSize] = useState(0);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [stream, setStream] = useState("");
  const [pendingPerm, setPendingPerm] = useState<PendingPermission | null>(null);
  const [toolName, setToolName] = useState<string | null>(null);
  const [continuing, setContinuing] = useState(false);
  const [spinnerFrame, setSpinnerFrame] = useState(0);
  const [scroll, setScroll] = useState(0);
  /** Tool results start collapsed; Ctrl+O toggles. */
  const [toolOutputExpanded, setToolOutputExpanded] = useState(false);
  const [completeIndex, setCompleteIndex] = useState(0);
  const [size, setSize] = useState(() => terminalSize(stdout));
  const [seenMeasure, setSeenMeasure] = useState({ rows: 0, columns: 0 });
  const seq = useRef(0);
  const clientRef = useRef<MinClient | null>(null);
  const pumpRef = useRef<StreamPump | null>(null);
  if (pumpRef.current === null) {
    pumpRef.current = createStreamPump((text) => {
      setContinuing(false);
      setStream(text);
    });
  }
  const paintCache = useRef(createPaintCache(theme));
  const paintThemeId = useRef(theme.id);
  if (paintThemeId.current !== theme.id) {
    paintThemeId.current = theme.id;
    paintCache.current = createPaintCache(theme);
  }
  const viewRef = useRef({ total: 0, height: 1 });
  const inflightTools = useRef(new Map<string, string>());
  const activityRef = useRef<ReturnType<typeof activityFor>>(null);

  const pushLine = useCallback((kind: LogKind, text: string) => {
    seq.current += 1;
    const id = seq.current;
    setLogs((prev) => {
      const next = [...prev, { id, kind, text }];
      return next.length > LOG_CAP ? next.slice(next.length - LOG_CAP) : next;
    });
  }, []);

  const replaceLogs = useCallback((messages: readonly TranscriptMessage[]) => {
    const seeded = linesFromMessages(messages);
    const capped = seeded.length > LOG_CAP ? seeded.slice(seeded.length - LOG_CAP) : seeded;
    setLogs(
      capped.map((line) => {
        seq.current += 1;
        return { id: seq.current, kind: line.kind, text: line.text };
      }),
    );
    setScroll(0);
    pumpRef.current?.reset();
    setStream("");
  }, []);

  useEffect(() => {
    const update = () => setSize(terminalSize(stdout));
    update();
    stdout.on("resize", update);
    return () => {
      stdout.off("resize", update);
    };
  }, [stdout]);

  useEffect(() => {
    let cancelled = false;
    let unsub: (() => void) | undefined;

    const syncQueue = () => {
      const live = clientRef.current;
      if (live) setQueueSize(live.queue.size);
    };

    (async () => {
      try {
        await loadProviderExtensions();
        const autoMode = args.auto ? "auto" : args.yes ? "yes" : undefined;
        const created = await createClient({
          cwd: args.cwd,
          provider: resolveProvider({
            provider: args.provider,
            model: args.model,
          }),
          sessionId: args.sessionId,
          noTools: args.noTools,
          allowBash: args.yes || args.auto,
          askWrite: false,
          applyRootGrant: true,
          persistPermissionGrants: !args.auto,
          autoApprovePermission: autoMode
            ? createAutoPermissionApprover({
                mode: autoMode,
                allowRootGrant: args.auto,
              })
            : undefined,
        });
        if (cancelled) {
          await created.dispose();
          return;
        }
        clientRef.current = created;
        unsub = created.subscribe((event: ClientEvent) => {
          if (event.type === "status") {
            setStatusLabel(event.status);
            setBusy(event.status !== "idle");
            if (event.status !== "asking") setPendingPerm(null);
            if (event.status === "idle") {
              inflightTools.current.clear();
              setToolName(null);
              setContinuing(false);
            }
            if (event.status === "asking") setContinuing(false);
            syncQueue();
            return;
          }
          if (event.type === "assistant_delta") {
            pumpRef.current?.push(event.text);
            return;
          }
          if (event.type === "assistant_done") {
            pumpRef.current?.reset();
            setContinuing(false);
            setStream("");
            if (event.text) pushLine("assistant", event.text);
            return;
          }
          if (event.type === "tool_start") {
            inflightTools.current.set(event.toolCallId, event.name);
            setToolName(event.name);
            setContinuing(false);
            pushLine("tool", summarizeToolCall(event.name, event.args));
            return;
          }
          if (event.type === "tool_end") {
            inflightTools.current.delete(event.toolCallId);
            const names = [...inflightTools.current.values()];
            setToolName(names.length > 0 ? names[names.length - 1]! : null);
            const body = event.content.trim();
            pushLine(
              event.ok ? "tool-result" : "tool-error",
              body || (event.ok ? "(no output)" : "(failed)"),
            );
            return;
          }
          if (event.type === "queued") {
            setQueueSize(event.queueSize);
            return;
          }
          if (event.type === "follow_up") {
            setContinuing(true);
            pushLine("notice", `follow-up: ${clip(event.texts.join(" | "), 160)}`);
            syncQueue();
            return;
          }
          if (event.type === "error") {
            pushLine("error", event.aborted ? "aborted" : event.message);
            return;
          }
          if (event.type === "permission") {
            setPendingPerm({
              id: event.id,
              reason: event.reason,
              toolCall: {
                name: event.toolCall.name,
                arguments: event.toolCall.arguments,
              },
              grantRoot: event.grantRoot,
            });
            return;
          }
          if (event.type === "session") {
            if (event.messages) replaceLogs(event.messages);
            syncQueue();
          }
        });
        const snapshot = created.getSession();
        replaceLogs(snapshot.messages);
        const status = created.getStatus();
        pushLine(
          "sys",
          `provider=${status.provider}  session=${status.sessionId}  cwd=${status.cwd}`,
        );
        setQueueSize(status.queueSize);
        setStatusLabel(status.status);
        setBusy(status.status !== "idle");
        setClient(created);
      } catch (err) {
        if (!cancelled) setError(messageOf(err));
      }
    })();

    return () => {
      cancelled = true;
      unsub?.();
      const live = clientRef.current;
      clientRef.current = null;
      if (live) void live.dispose();
    };
  }, [
    args.auto,
    args.cwd,
    args.model,
    args.noTools,
    args.provider,
    args.sessionId,
    args.yes,
    pushLine,
    replaceLogs,
  ]);

  const runCommand = useCallback(
    async (live: MinClient, command: TuiCommand) => {
      if (command.type === "exit") {
        exit();
        return;
      }
      if (command.type === "help") {
        pushLine("sys", TUI_HELP);
        return;
      }
      if (command.type === "session") {
        const session = live.getSession();
        const status = live.getStatus();
        pushLine(
          "sys",
          formatSession({
            id: session.id,
            title: session.title,
            messageCount: session.messageCount,
            provider: status.provider,
            queueSize: live.queue.size,
          }),
        );
        return;
      }
      if (command.type === "sessions") {
        try {
          const metas = await live.listSessions();
          pushLine("sys", formatSessionList(metas, live.getSession().id));
        } catch (err) {
          pushLine("error", messageOf(err));
        }
        return;
      }
      if (command.type === "open-usage") {
        pushLine("sys", "usage: /open <session-id>");
        return;
      }
      if (command.type === "open") {
        try {
          await live.openSession(command.id);
          pushLine("sys", `opened ${live.getSession().id}`);
        } catch (err) {
          pushLine("error", messageOf(err));
        }
        return;
      }
      if (command.type === "new") {
        try {
          await live.newSession();
          pushLine("sys", `new session ${live.getSession().id}`);
        } catch (err) {
          pushLine("error", messageOf(err));
        }
        return;
      }
      if (command.type === "compact") {
        try {
          pushLine("sys", formatCompact(await live.compact()));
        } catch (err) {
          pushLine("error", messageOf(err));
        }
        return;
      }
      if (command.type === "reset") {
        try {
          live.reset();
          pushLine("sys", "history cleared");
        } catch (err) {
          pushLine("error", messageOf(err));
        }
        return;
      }
      if (command.type === "queue") {
        pushLine("sys", formatQueue(live.queue.peek()));
        return;
      }
      if (command.type === "dense-usage") {
        pushLine("sys", "usage: /dense <text>  — queue as dense-latest supplement");
        return;
      }
      if (command.type === "dense") {
        try {
          live.queue.push(command.text, { mode: "dense-latest" });
          setQueueSize(live.queue.size);
          pushLine("sys", `queued dense-latest (size=${live.queue.size})`);
        } catch (err) {
          pushLine("error", messageOf(err));
        }
        return;
      }
      if (command.type === "prompt") {
        pushLine("user", command.text);
        try {
          await live.send(command.text);
        } catch (err) {
          pushLine("error", messageOf(err));
        }
      }
    },
    [exit, pushLine],
  );

  const submitLine = useCallback(
    async (text: string) => {
      const live = clientRef.current;
      if (!live) return;
      const route = routeSubmit(text, live.getStatus().busy);
      if (route.type === "empty") return;
      if (route.type === "send" || route.type === "queue") {
        pushLine("user", route.text);
        try {
          if (route.type === "queue") {
            live.queue.push(route.text);
            setQueueSize(live.queue.size);
          } else {
            await live.send(route.text);
          }
        } catch (err) {
          pushLine("error", messageOf(err));
        }
        return;
      }
      if (route.type === "busy-blocked") {
        pushLine("notice", `/${route.name} is unavailable while the agent is running`);
        return;
      }
      await runCommand(live, route.command);
    },
    [pushLine, runCommand],
  );

  const handleInput = useRef<(input: string, key: InputKey) => void>(() => {});
  handleInput.current = (input, key) => {
    const action = inputAction(input, key);
    if (action.type === "interrupt") {
      const live = clientRef.current;
      if (live?.getStatus().busy) {
        live.abort();
        return;
      }
      exit();
      return;
    }
    if (action.type === "scroll") {
      setScroll((current) => {
        const page = Math.max(1, viewRef.current.height);
        const max = Math.max(0, viewRef.current.total - viewRef.current.height);
        if (action.direction === "up") return Math.min(max, current + page);
        return Math.max(0, current - page);
      });
      return;
    }
    if (action.type === "toggle-tool-output") {
      setToolOutputExpanded((current) => !current);
      return;
    }
    if (pendingPerm) {
      const answer = key.ctrl || key.meta || key.return ? null : permissionAnswer(input);
      if (answer && clientRef.current) {
        clientRef.current.respondPermission(pendingPerm.id, answer);
        setPendingPerm(null);
      }
      return;
    }
    if (action.type === "complete") {
      const next = applyCommandCompletion(editor.text, completeIndex);
      if (next === null) return;
      setEditor((current) => ({ ...current, text: next, cursor: next.length }));
      setCompleteIndex(0);
      return;
    }
    if (action.type === "edit") {
      const matches = commandSuggestions(editor.text);
      if (matches.length > 0 && (action.op.op === "up" || action.op.op === "down")) {
        const direction = action.op.op;
        const count = matches.length;
        setCompleteIndex((current) =>
          direction === "down" ? (current + 1) % count : (current - 1 + count) % count,
        );
        return;
      }
      setCompleteIndex(0);
      setEditor((current) => reduceEditor(current, action.op));
      return;
    }
    if (action.type === "submit") {
      if (!clientRef.current) return;
      const committed = commitEditor(editor);
      setEditor(committed.state);
      setCompleteIndex(0);
      if (!committed.text) return;
      setScroll(0);
      void submitLine(committed.text);
    }
  };

  useEffect(() => {
    setRawMode(true);
    return () => setRawMode(false);
  }, [setRawMode]);

  useEffect(() => {
    const onChunk = (chunk: string | Buffer) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      const { input, key } = decodeInput(text);
      handleInput.current(input, key);
    };
    internal_eventEmitter.on("input", onChunk);
    return () => {
      internal_eventEmitter.off("input", onChunk);
    };
  }, [internal_eventEmitter]);

  const activity = activityFor(
    {
      status: statusLabel,
      streaming: stream.length > 0,
      toolName,
      continuing,
    },
    theme,
  );
  activityRef.current = activity;
  const activityKey = activity ? `${activity.phase}\0${activity.label}\0${activity.intervalMs}` : "";
  useEffect(() => {
    if (!activityKey) return;
    setSpinnerFrame(0);
    const interval = activityRef.current?.intervalMs ?? 80;
    const timer = setInterval(() => setSpinnerFrame((frame) => frame + 1), interval);
    return () => clearInterval(timer);
  }, [activityKey]);

  const columns = size.columns;
  const termRows = size.rows;
  const innerWidth = Math.max(1, columns - 2);
  const caret = editorCaret(editor);
  const suggestions = commandSuggestions(editor.text);
  const selectedComplete =
    suggestions.length > 0
      ? ((completeIndex % suggestions.length) + suggestions.length) % suggestions.length
      : 0;
  const ghost = commandGhost(editor.text, selectedComplete);
  const chatBar = theme.frames.chatBar;
  const composer = `${chatBar}${caret.before}${caret.caret}${caret.after}${ghost}`;
  const inputRows = wrapText(composer, innerWidth).length;
  const suggestRows = suggestions.length > 0 ? 1 : 0;
  const permText = pendingPerm ? permissionLines(pendingPerm) : [];
  const permRows = permText.reduce((count, line) => count + wrapText(line, innerWidth).length, 0);
  const footer = footerLines(busy, pendingPerm !== null, toolOutputExpanded);
  const footerRows = footer.reduce((count, line) => count + wrapText(line, innerWidth).length, 0);
  const activityRows = activity ? 1 : 0;
  const reserved =
    2 + activityRows + (permRows > 0 ? permRows + 1 : 0) + 1 + inputRows + suggestRows + footerRows;
  const userTone = toneFor("user", theme);
  const composerBody = `${caret.before}${caret.caret}${caret.after}${ghost}`;
  const composerPad = padToWidth(
    composerBody,
    Math.max(1, innerWidth - displayWidth(chatBar)),
  ).slice(composerBody.length);
  const logHeight = Math.max(1, termRows - reserved);
  const painted = paintCache.current.paint(toDisplayLines(logs, stream), innerWidth, {
    toolOutputExpanded,
  });
  const rowCount = painted.length;

  if (client) {
    const columnsChanged = innerWidth !== seenMeasure.columns;
    const delta = rowCount - seenMeasure.rows;
    const baselineChanged = rowCount !== seenMeasure.rows || columnsChanged;
    let nextScroll = scroll;
    if (baselineChanged && !columnsChanged && scroll > 0 && delta !== 0) {
      nextScroll = Math.max(0, scroll + delta);
    }
    const maxScroll = Math.max(0, rowCount - logHeight);
    if (nextScroll > maxScroll) nextScroll = maxScroll;
    if (baselineChanged) setSeenMeasure({ rows: rowCount, columns: innerWidth });
    if (nextScroll !== scroll) setScroll(nextScroll);
  }

  viewRef.current = { total: rowCount, height: logHeight };
  const layout = sliceViewport(painted, logHeight, scroll);

  if (error) {
    return (
      <Box flexDirection="column" padding={1}>
        <Text color={theme.chrome.error}>error: {error}</Text>
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

  const status = client.getStatus();
  const scrollHint =
    layout.hiddenAbove || layout.hiddenBelow
      ? ` · ↑${layout.hiddenAbove} ↓${layout.hiddenBelow}`
      : "";

  return (
    <Box flexDirection="column" paddingX={1} width={columns} height={termRows}>
      <Text wrap="truncate">
        <Text bold color={theme.chrome.brand}>
          min
        </Text>
        <Text dimColor={theme.chrome.statusDim}>
          {` · ${status.provider} · ${shortId(status.sessionId)} · ${statusLabel} · queue ${queueSize}${scrollHint}`}
        </Text>
      </Text>

      <Box flexDirection="column" marginTop={1} height={logHeight} overflow="hidden">
        {layout.visible.map((row) => {
          const tone = toneFor(row.kind, theme);
          if (row.kind === "gap") {
            return (
              <Box key={row.key} height={1} flexShrink={0}>
                <Text> </Text>
              </Box>
            );
          }
          return (
            <Box key={row.key} height={1} overflow="hidden" flexShrink={0}>
              <Text wrap="truncate" backgroundColor={tone.background}>
                {row.gutter ? (
                  <Text bold={row.lead} color={tone.label} dimColor={tone.dimLabel} backgroundColor={tone.background}>
                    {row.gutter}
                  </Text>
                ) : null}
                {row.spans.map((span, spanIndex) => (
                  <Text
                    key={spanIndex}
                    bold={span.bold}
                    color={tone.body}
                    backgroundColor={tone.background}
                    dimColor={tone.dimBody || span.tone === "code" || span.tone === "dim" || span.tone === "link"}
                  >
                    {span.text}
                  </Text>
                ))}
              </Text>
            </Box>
          );
        })}
      </Box>

      {activity ? (
        <Text color={activity.color}>
          {frameChar(activity, spinnerFrame)} {activity.label}
        </Text>
      ) : null}

      {permText.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          {permText.map((line, index) => (
            <Text
              key={`${index}:${line}`}
              color={index === 0 ? theme.chrome.permission : undefined}
              dimColor={index === permText.length - 1}
              wrap="wrap"
            >
              {line}
            </Text>
          ))}
        </Box>
      ) : null}

      <Box marginTop={1} width={innerWidth}>
        <Text wrap="truncate" backgroundColor={userTone.background}>
          <Text color={userTone.label} backgroundColor={userTone.background}>
            {chatBar}
          </Text>
          <Text color={userTone.body} backgroundColor={userTone.background}>
            {caret.before}
          </Text>
          <Text color={userTone.body} backgroundColor={userTone.background} inverse>
            {caret.caret}
          </Text>
          <Text color={userTone.body} backgroundColor={userTone.background}>
            {caret.after}
          </Text>
          {ghost ? (
            <Text color={userTone.body} backgroundColor={userTone.background} dimColor>
              {ghost}
            </Text>
          ) : null}
          {composerPad ? (
            <Text color={userTone.body} backgroundColor={userTone.background}>
              {composerPad}
            </Text>
          ) : null}
        </Text>
      </Box>
      {suggestions.length > 0 ? (
        <Text wrap="truncate">
          {suggestions.map((command, index) => (
            <Text
              key={command.name}
              color={index === selectedComplete ? theme.chrome.completeSelected : undefined}
              bold={index === selectedComplete}
              dimColor={index !== selectedComplete}
            >
              {`${index === 0 ? "" : "  "}/${command.name}`}
            </Text>
          ))}
          <Text dimColor>{`  · Tab · ↑↓`}</Text>
        </Text>
      ) : null}
      {footer.map((line) => (
        <Text key={line} dimColor wrap="wrap">
          {line}
        </Text>
      ))}
    </Box>
  );
}

function toDisplayLines(logs: readonly LogLine[], stream: string): TranscriptSource[] {
  const lines: TranscriptSource[] = logs.map((line) => ({
    key: String(line.id),
    kind: line.kind,
    text: line.text,
  }));
  if (stream) lines.push({ key: "stream", kind: "assistant", text: stream, streaming: true });
  return lines;
}

function footerLines(busy: boolean, pending: boolean, toolExpanded: boolean): string[] {
  if (pending) {
    return [
      "y once · n deny · a remember · no answer denies in 2 minutes",
      "PgUp/PgDn scroll · Ctrl+C abort",
    ];
  }
  const toolHint = toolExpanded ? "Ctrl+O collapse tools" : "Ctrl+O expand tools";
  return [
    `Enter ${busy ? "queues" : "sends"} · Tab completes /cmd · Alt+Enter newline · ↑↓ history · PgUp/PgDn scroll · ${toolHint} · Ctrl+C ${busy ? "abort" : "quit"}`,
    "/help /session /sessions /open /new /compact /reset /queue /dense /exit",
  ];
}

function terminalSize(stdout: NodeJS.WriteStream): { columns: number; rows: number } {
  return {
    columns: Math.max(20, stdout.columns || 80),
    rows: Math.max(8, (stdout.rows || 24) - 1),
  };
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 3)}...`;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
