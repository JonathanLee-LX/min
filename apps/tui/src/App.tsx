import { Alert, Badge, ThemeProvider } from "@inkjs/ui";
import {
  type ClientEvent,
  type ClientStatus,
  type ContextUsage,
  type MinClient,
} from "@min-agent/client";
import { Box, Text, useApp, useStdin, useStdout } from "ink";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { TuiArgs } from "./args.js";
import { minBannerLines, minBannerRows } from "./banner.js";
import {
  TUI_HELP,
  applyCommandCompletion,
  commandSuggestions,
  cycleCommandIndex,
  formatCompact,
  formatQueue,
  formatSession,
  formatSessionList,
  routeSubmit,
  type SessionListItem,
  type TuiCommand,
} from "./commands.js";
import {
  attachTuiSession,
  listTuiSessions,
  type AttachedSession,
  type ClientHandshake,
} from "./session-host.js";
import { contextReport } from "./context-view.js";
import { formatVersionLine } from "./version.js";
import {
  commitEditor,
  createEditor,
  inputAction,
  reduceEditor,
  type EditorState,
  type InputKey,
} from "./editor.js";
import { enableFocusReporting, focusStateFromChunk } from "./focus.js";
import { composerCaretAnchor, installImeCursorHook } from "./ime-cursor.js";
import { createKeyBuffer } from "./key-buffer.js";
import { resolveKeybindings } from "./keybindings.js";
import { decodeInput } from "./keys.js";
import {
  activityFor,
  createPaintCache,
  toneFor,
  type TranscriptSource,
} from "./paint.js";
import { createStreamPump, type StreamPump } from "./stream-pump.js";
import { permissionAnswer } from "./permission-view.js";
import { readGitBranch } from "./status-bar.js";
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
import {
  ActivitySpinner,
  CommandSelect,
  commandSelectRows,
  Composer,
  composerBodyRowCount,
  ContextMeter,
  contextMeterRows,
  inkThemeFromTui,
  PermissionPrompt,
  permissionPromptRows,
  SessionSelect,
  sessionSelectRows,
} from "./ui/index.js";

interface SessionPickerState {
  sessions: SessionListItem[];
  selected: number;
  currentId: string;
}

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
  const { theme, keybindings } = useMemo(() => {
    const { config } = resolveMinConfig(
      { cwd: args.cwd },
      {
        ...(args.theme ? { theme: args.theme } : {}),
        ...(args.provider ? { provider: args.provider } : {}),
        ...(args.model ? { model: args.model } : {}),
      },
    );
    return {
      theme: themeFromConfig(config.ui),
      keybindings: resolveKeybindings(config.ui.keybindings),
    };
  }, [args.cwd, args.theme, args.provider, args.model]);
  const [client, setClient] = useState<MinClient | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState>(createEditor);
  /** Highlight index while the slash command menu is open. */
  const [completeIndex, setCompleteIndex] = useState(0);
  /**
   * After the slash menu closes, keep blank rows for one paint so eraseLines
   * rewrites the vacated lines instead of leaving ghost command text.
   */
  const [slashFillRows, setSlashFillRows] = useState(0);
  const slashOpenRowsRef = useRef(0);
  const [busy, setBusy] = useState(false);
  const [statusLabel, setStatusLabel] = useState<ClientStatus>("idle");
  const [queueSize, setQueueSize] = useState(0);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [stream, setStream] = useState("");
  const [thinking, setThinking] = useState("");
  const [pendingPerm, setPendingPerm] = useState<PendingPermission | null>(null);
  const [sessionPicker, setSessionPicker] = useState<SessionPickerState | null>(null);
  const [toolName, setToolName] = useState<string | null>(null);
  const [continuing, setContinuing] = useState(false);
  const [scroll, setScroll] = useState(0);
  /** Tool results start collapsed; Ctrl+O toggles. */
  const [toolOutputExpanded, setToolOutputExpanded] = useState(false);
  const [size, setSize] = useState(() => terminalSize(stdout));
  const [focused, setFocused] = useState(true);
  const [contextUsage, setContextUsage] = useState<ContextUsage | undefined>();
  const [gitBranch, setGitBranch] = useState<string | undefined>();
  const seq = useRef(0);
  const clientRef = useRef<MinClient | null>(null);
  const attachedRef = useRef<AttachedSession | null>(null);
  const unsubRef = useRef<(() => void) | undefined>(undefined);
  const focusedRef = useRef(true);
  const pendingStreamRef = useRef<string | null>(null);
  const pendingThinkingRef = useRef<string | null>(null);
  const pumpRef = useRef<StreamPump | null>(null);
  const thinkingPumpRef = useRef<StreamPump | null>(null);
  if (pumpRef.current === null) {
    pumpRef.current = createStreamPump((text) => {
      if (!focusedRef.current) {
        pendingStreamRef.current = text;
        return;
      }
      setContinuing(false);
      setStream(text);
    });
  }
  if (thinkingPumpRef.current === null) {
    thinkingPumpRef.current = createStreamPump((text) => {
      if (!focusedRef.current) {
        pendingThinkingRef.current = text;
        return;
      }
      setThinking(text);
    });
  }
  const paintCache = useRef(createPaintCache(theme));
  const paintThemeId = useRef(theme.id);
  if (paintThemeId.current !== theme.id) {
    paintThemeId.current = theme.id;
    paintCache.current = createPaintCache(theme);
  }
  const viewRef = useRef({ total: 0, height: 1 });
  /** Track painted row baseline without setState-during-render (that flickered). */
  const seenMeasureRef = useRef({ rows: 0, columns: 0 });
  const inflightTools = useRef(new Map<string, string>());
  const imeAnchorRef = useRef<ReturnType<typeof composerCaretAnchor> | null>(null);
  const termColumnsRef = useRef(80);

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
    thinkingPumpRef.current?.reset();
    setStream("");
    setThinking("");
    pendingStreamRef.current = null;
    pendingThinkingRef.current = null;
  }, []);

  useEffect(() => {
    const update = () => {
      // Hard-clear so Ink's eraseLines bookkeeping cannot leave duplicate
      // bottom chrome when the terminal size changes.
      if (stdout.isTTY) stdout.write("\x1b[2J\x1b[3J\x1b[H");
      setSize(terminalSize(stdout));
    };
    update();
    stdout.on("resize", update);
    return () => {
      stdout.off("resize", update);
    };
  }, [stdout]);

  useEffect(() => enableFocusReporting(stdout), [stdout]);

  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      void readGitBranch(args.cwd).then((branch) => {
        if (!cancelled) setGitBranch(branch);
      });
    };
    refresh();
    const timer = setInterval(refresh, 15_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [args.cwd]);

  useEffect(() => {
    focusedRef.current = focused;
    if (!focused) return;
    if (pendingThinkingRef.current !== null) {
      setThinking(pendingThinkingRef.current);
      pendingThinkingRef.current = null;
    }
    if (pendingStreamRef.current !== null) {
      setContinuing(false);
      setStream(pendingStreamRef.current);
      pendingStreamRef.current = null;
    }
  }, [focused]);

  const syncQueue = useCallback(() => {
    const live = clientRef.current;
    if (live) setQueueSize(live.queue.size);
  }, []);

  const handleClientEvent = useCallback(
    (event: ClientEvent) => {
      if (event.type === "status") {
        setStatusLabel(event.status);
        setBusy(event.status !== "idle");
        if (event.status !== "asking") setPendingPerm(null);
        if (event.status === "idle") {
          inflightTools.current.clear();
          setToolName(null);
          setContinuing(false);
          thinkingPumpRef.current?.reset();
          pendingThinkingRef.current = null;
          setThinking("");
        }
        if (event.status === "asking") setContinuing(false);
        syncQueue();
        return;
      }
      if (event.type === "context") {
        setContextUsage(event.usage);
        return;
      }
      if (event.type === "thinking_delta") {
        thinkingPumpRef.current?.push(event.text);
        return;
      }
      if (event.type === "thinking_done") {
        thinkingPumpRef.current?.reset();
        pendingThinkingRef.current = null;
        setThinking("");
        if (event.text.trim()) pushLine("thinking", event.text.trim());
        return;
      }
      if (event.type === "assistant_delta") {
        pumpRef.current?.push(event.text);
        return;
      }
      if (event.type === "assistant_done") {
        pumpRef.current?.reset();
        thinkingPumpRef.current?.reset();
        pendingStreamRef.current = null;
        pendingThinkingRef.current = null;
        setContinuing(false);
        setStream("");
        setThinking("");
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
      if (event.type === "permission_answer") {
        setPendingPerm(null);
        pushLine("notice", `permission ${event.answer}`);
        return;
      }
      if (event.type === "session") {
        if (event.messages) replaceLogs(event.messages);
        syncQueue();
      }
    },
    [pushLine, replaceLogs, syncQueue],
  );

  const applyHandshake = useCallback(
    (handshake: ClientHandshake, announce: boolean) => {
      replaceLogs(handshake.session.messages);
      pumpRef.current?.reset();
      thinkingPumpRef.current?.reset();
      pendingStreamRef.current = null;
      pendingThinkingRef.current = null;
      setStream(handshake.turn.text);
      setThinking(handshake.turn.thinking);
      const pending = handshake.pendingPermissions[0];
      setPendingPerm(
        pending
          ? {
              id: pending.id,
              reason: pending.reason,
              toolCall: {
                name: pending.toolCall.name,
                arguments: pending.toolCall.arguments,
              },
              grantRoot: pending.grantRoot,
            }
          : null,
      );
      setQueueSize(handshake.status.queueSize);
      setStatusLabel(handshake.status.status);
      setBusy(handshake.status.busy);
      setContextUsage(handshake.status.context);
      inflightTools.current.clear();
      setToolName(null);
      setContinuing(false);
      if (announce) {
        pushLine(
          "sys",
          `provider=${handshake.status.provider}  session=${handshake.status.sessionId}  cwd=${handshake.status.cwd}`,
        );
      }
    },
    [pushLine, replaceLogs],
  );

  const mountAttachment = useCallback(
    (attached: AttachedSession, announce: boolean) => {
      unsubRef.current?.();
      attachedRef.current = attached;
      clientRef.current = attached.client;
      unsubRef.current = attached.client.subscribe(handleClientEvent);
      applyHandshake(attached.handshake, announce);
      setClient(attached.client);
    },
    [applyHandshake, handleClientEvent],
  );

  const switchAttachment = useCallback(
    async (sessionId?: string, announce = true) => {
      const next = await attachTuiSession(args, sessionId);
      const previous = attachedRef.current;
      mountAttachment(next, announce);
      if (previous && previous !== next) await previous.release();
      return next;
    },
    [args, mountAttachment],
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const attached = await attachTuiSession(args, args.sessionId);
        if (cancelled) {
          await attached.release();
          return;
        }
        mountAttachment(attached, true);
      } catch (err) {
        if (!cancelled) setError(messageOf(err));
      }
    })();

    return () => {
      cancelled = true;
      unsubRef.current?.();
      unsubRef.current = undefined;
      clientRef.current = null;
      const attached = attachedRef.current;
      attachedRef.current = null;
      if (attached) void attached.release();
    };
  }, [
    args.auto,
    args.cwd,
    args.model,
    args.noTools,
    args.provider,
    args.sessionId,
    args.yes,
    mountAttachment,
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
      if (command.type === "context") {
        pushLine("sys", contextReport(live.getStatus().context));
        return;
      }
      if (command.type === "version") {
        pushLine("sys", formatVersionLine());
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
          const metas = await listTuiSessions(args.cwd);
          pushLine("sys", formatSessionList(metas, live.getSession().id));
        } catch (err) {
          pushLine("error", messageOf(err));
        }
        return;
      }
      if (command.type === "resume-pick") {
        try {
          const metas = await listTuiSessions(args.cwd);
          const currentId = live.getSession().id;
          if (metas.length === 0) {
            pushLine("sys", "(no saved sessions)");
            return;
          }
          const selected = Math.max(
            0,
            metas.findIndex((meta) => meta.id === currentId),
          );
          setSessionPicker({
            sessions: metas,
            selected: selected >= 0 ? selected : 0,
            currentId,
          });
          setEditor(createEditor());
        } catch (err) {
          pushLine("error", messageOf(err));
        }
        return;
      }
      if (command.type === "resume") {
        try {
          setSessionPicker(null);
          const next = await switchAttachment(command.id, false);
          pushLine("sys", `resumed ${next.sessionId}`);
        } catch (err) {
          pushLine("error", messageOf(err));
        }
        return;
      }
      if (command.type === "new") {
        try {
          const next = await switchAttachment(undefined, false);
          pushLine("sys", `new session ${next.sessionId}`);
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
    [args.cwd, exit, pushLine, switchAttachment],
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

  const handlePermissionAllow = useCallback(() => {
    const pending = pendingPerm;
    if (!pending) return;
    clientRef.current?.respondPermission(pending.id, "allow");
    setPendingPerm(null);
  }, [pendingPerm]);

  const handlePermissionDeny = useCallback(() => {
    const pending = pendingPerm;
    if (!pending) return;
    clientRef.current?.respondPermission(pending.id, "deny");
    setPendingPerm(null);
  }, [pendingPerm]);

  const handleInput = useRef<(input: string, key: InputKey) => void>(() => {});
  handleInput.current = (input, key) => {
    const action = inputAction(input, key, keybindings);
    if (sessionPicker) {
      if (key.escape || (action.type === "interrupt" && key.escape)) {
        setSessionPicker(null);
        return;
      }
      if (action.type === "interrupt") {
        // Ctrl+C quits even while picking.
        exit();
        return;
      }
      if (key.upArrow || key.downArrow) {
        const count = sessionPicker.sessions.length;
        setSessionPicker((current) => {
          if (!current || count <= 0) return current;
          return {
            ...current,
            selected: cycleCommandIndex(
              current.selected,
              count,
              key.downArrow ? "down" : "up",
            ),
          };
        });
        return;
      }
      if (action.type === "submit" || key.return) {
        const pick = sessionPicker.sessions[sessionPicker.selected];
        if (!pick) {
          setSessionPicker(null);
          return;
        }
        setSessionPicker(null);
        void (async () => {
          try {
            const next = await switchAttachment(pick.id, false);
            pushLine("sys", `resumed ${next.sessionId}`);
          } catch (err) {
            pushLine("error", messageOf(err));
          }
        })();
        return;
      }
      // Ignore composer edits while the picker owns the keyboard.
      return;
    }
    if (action.type === "interrupt") {
      const live = clientRef.current;
      if (live?.getStatus().busy) {
        live.abort();
        return;
      }
      // Escape only aborts a running turn; Ctrl+C still quits when idle.
      if (key.escape) return;
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
      // ConfirmInput owns Y/n/Enter; we only keep `a` for remember-session.
      if (!key.ctrl && !key.meta && permissionAnswer(input) === "allow_session") {
        clientRef.current?.respondPermission(pendingPerm.id, "allow_session");
        setPendingPerm(null);
      }
      return;
    }
    const slashMatches = commandSuggestions(editor.text);
    const slashOpen = slashMatches.length > 0;
    if (slashOpen && (key.upArrow || key.downArrow)) {
      setCompleteIndex((current) =>
        cycleCommandIndex(current, slashMatches.length, key.downArrow ? "down" : "up"),
      );
      return;
    }
    if (slashOpen && (key.tab || action.type === "complete")) {
      const next = applyCommandCompletion(editor.text, completeIndex);
      if (next === null) return;
      setEditor((current) => ({ ...current, text: next, cursor: next.length }));
      setCompleteIndex(0);
      return;
    }
    if (slashOpen && action.type === "submit") {
      const pick = slashMatches[
        ((completeIndex % slashMatches.length) + slashMatches.length) % slashMatches.length
      ]!;
      if (pick.arg) {
        const next = `/${pick.name} `;
        setEditor((current) => ({ ...current, text: next, cursor: next.length }));
        setCompleteIndex(0);
        return;
      }
      const line = `/${pick.name}`;
      const committed = commitEditor({ ...editor, text: line, cursor: line.length });
      setEditor(committed.state);
      setCompleteIndex(0);
      setScroll(0);
      void submitLine(committed.text);
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
    const buffer = createKeyBuffer((sequence) => {
      const focus = focusStateFromChunk(sequence);
      if (focus !== null) {
        setFocused(focus);
        return;
      }
      const { input, key } = decodeInput(sequence);
      handleInput.current(input, key);
    });
    const onChunk = (chunk: string | Buffer) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      // Focus reports are complete on their own; don't buffer-merge with keys.
      const focus = focusStateFromChunk(text);
      if (focus !== null) {
        setFocused(focus);
        return;
      }
      buffer.push(text);
    };
    internal_eventEmitter.on("input", onChunk);
    return () => {
      internal_eventEmitter.off("input", onChunk);
      buffer.dispose();
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
  const columns = size.columns;
  const termRows = size.rows;
  /**
   * Leave slack so Ink's outputHeight stays < stdout.rows.
   * Full-height frames take clearTerminal and flicker; `-2` covers yoga
   * rounding plus log-update's trailing newline bookkeeping.
   */
  const paintRows = Math.max(1, termRows - 2);
  const innerWidth = Math.max(1, columns - 2);
  const suggestions = commandSuggestions(editor.text);
  const selectedComplete =
    suggestions.length > 0
      ? ((completeIndex % suggestions.length) + suggestions.length) % suggestions.length
      : 0;
  const slashHighlight = editor.text.startsWith("/") ? editor.text.slice(1) : "";
  /** Body between rules: paddingY + content (+ soft wraps / newlines) + paddingY. */
  const inputRows = composerBodyRowCount(editor.text, innerWidth);
  const composerBorderRows = 2;
  const slashOpenRows = sessionPicker ? 0 : commandSelectRows(suggestions.length);
  const sessionPickRows = sessionPicker
    ? sessionSelectRows(sessionPicker.sessions.length)
    : 0;
  const suggestRows =
    sessionPickRows > 0 ? sessionPickRows : slashOpenRows > 0 ? slashOpenRows : slashFillRows;
  const activityRows = activity ? 1 : 0;
  const modelId = client?.getStatus().provider ?? "";
  const cwdPath = client?.getStatus().cwd ?? args.cwd;
  const bottomStatusRows = contextMeterRows(cwdPath, modelId);
  const bannerRows = minBannerRows(innerWidth);
  /** Banner + session meta (fixed 1 row) + transcript top margin. */
  const headerRows = bannerRows + 1 + 1;
  const permBlockRows = pendingPerm ? permissionPromptRows(pendingPerm) : 0;
  const reserved =
    headerRows +
    activityRows +
    permBlockRows +
    composerBorderRows +
    inputRows +
    suggestRows +
    bottomStatusRows;
  const logHeight = Math.max(1, paintRows - reserved);
  const rowsAboveComposer =
    headerRows + logHeight + activityRows + permBlockRows + 1; /* top rule */
  const rowsBelowComposer = 1 /* bottom rule */ + suggestRows + bottomStatusRows;
  const userTone = toneFor("user", theme);
  const imeAnchor =
    client && !error
      ? composerCaretAnchor({
          paddingX: 1,
          chatBar: "",
          text: editor.text,
          cursor: editor.cursor,
          columns: innerWidth,
          inputRows,
          rowsAboveComposer,
          rowsBelowComposer,
        })
      : null;
  imeAnchorRef.current = imeAnchor;
  termColumnsRef.current = columns;
  const painted = paintCache.current.paint(toDisplayLines(logs, stream, thinking), innerWidth, {
    toolOutputExpanded,
  });
  const rowCount = painted.length;

  useLayoutEffect(() => {
    if (!client) return;
    const seen = seenMeasureRef.current;
    const columnsChanged = innerWidth !== seen.columns;
    const delta = rowCount - seen.rows;
    const baselineChanged = rowCount !== seen.rows || columnsChanged;
    let nextScroll = scroll;
    if (baselineChanged && !columnsChanged && scroll > 0 && delta !== 0) {
      nextScroll = Math.max(0, scroll + delta);
    }
    const maxScroll = Math.max(0, rowCount - logHeight);
    if (nextScroll > maxScroll) nextScroll = maxScroll;
    if (baselineChanged) {
      seenMeasureRef.current = { rows: rowCount, columns: innerWidth };
    }
    if (nextScroll !== scroll) setScroll(nextScroll);
  }, [client, rowCount, innerWidth, logHeight, scroll]);

  useLayoutEffect(() => {
    if (slashOpenRows > 0) {
      slashOpenRowsRef.current = slashOpenRows;
      if (slashFillRows !== 0) setSlashFillRows(0);
      return;
    }
    if (slashFillRows > 0) {
      // Blanks are on screen for this paint; collapse on the next tick.
      const timer = setTimeout(() => setSlashFillRows(0), 0);
      return () => clearTimeout(timer);
    }
    if (slashOpenRowsRef.current <= 0) return;
    const fill = slashOpenRowsRef.current;
    slashOpenRowsRef.current = 0;
    setSlashFillRows(fill);
  }, [slashOpenRows, slashFillRows]);

  viewRef.current = { total: rowCount, height: logHeight };
  const layout = sliceViewport(painted, logHeight, scroll);

  // Re-park the caret inside each Ink stdout write. The hook also turns
  // eraseLines into an in-place frame so stream paints do not flash blank.
  // useLayoutEffect alone loses to Ink's throttled paint.
  useEffect(() => {
    return installImeCursorHook(
      stdout,
      () => imeAnchorRef.current,
      () => termColumnsRef.current,
    );
  }, [stdout]);

  const inkChromeTheme = useMemo(() => inkThemeFromTui(theme), [theme]);

  if (error) {
    return (
      <ThemeProvider theme={inkChromeTheme}>
        <Box flexDirection="column" padding={1}>
          <Alert variant="error">{error}</Alert>
        </Box>
      </ThemeProvider>
    );
  }

  if (!client) {
    return (
      <ThemeProvider theme={inkChromeTheme}>
        <Box padding={1}>
          <ActivitySpinner
            activity={{
              phase: "thinking",
              labels: ["starting min"],
              labelHold: 8,
              frames: ["·"],
              intervalMs: 250,
              color: theme.activity.thinking,
            }}
            focused={focused}
            theme={theme}
          />
        </Box>
      </ThemeProvider>
    );
  }

  const status = client.getStatus();
  const scrollHint =
    layout.hiddenAbove || layout.hiddenBelow
      ? ` · ↑${layout.hiddenAbove} ↓${layout.hiddenBelow}`
      : "";

  const banner = minBannerLines(innerWidth);

  return (
    <ThemeProvider theme={inkChromeTheme}>
    <Box flexDirection="column" paddingX={1} width={columns} height={paintRows}>
      <Box flexDirection="column" flexShrink={0}>
        {banner.map((line, index) => (
          <Text key={`banner:${index}`} bold color={theme.chrome.brand} wrap="truncate">
            {line}
          </Text>
        ))}
        <Box height={1} flexShrink={0} overflow="hidden">
          <Text dimColor={theme.chrome.statusDim} wrap="truncate">
            {`${shortId(status.sessionId)} · `}
          </Text>
          <Badge color={theme.chrome.brand}>{statusLabel}</Badge>
          <Text dimColor={theme.chrome.statusDim} wrap="truncate">
            {` · queue ${queueSize}${scrollHint}`}
          </Text>
        </Box>
      </Box>

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
              <Text wrap="truncate" backgroundColor={tone.background ?? undefined}>
                {row.gutter ? (
                  <Text
                    bold={row.lead}
                    italic={tone.italicBody}
                    color={tone.label}
                    dimColor={tone.dimLabel}
                    backgroundColor={tone.background ?? undefined}
                  >
                    {row.gutter}
                  </Text>
                ) : null}
                {row.spans.map((span, spanIndex) => (
                  <Text
                    key={spanIndex}
                    bold={span.bold}
                    italic={tone.italicBody || span.italic}
                    color={spanColor(span.tone, tone.body, theme)}
                    backgroundColor={
                      span.tone === "code"
                        ? (theme.markdown.codeBackground ?? tone.background)
                        : tone.background
                    }
                    dimColor={
                      tone.dimBody ||
                      span.tone === "dim" ||
                      (span.tone === "link" && !theme.markdown.link)
                    }
                  >
                    {span.text}
                  </Text>
                ))}
              </Text>
            </Box>
          );
        })}
        {/*
          Paint blank rows for the unused viewport. Empty Ink Box space is not
          cleared on eraseLines, so dismissing the slash Select would otherwise
          leave ghost command rows in the taller transcript area.
        */}
        {Array.from(
          { length: Math.max(0, logHeight - layout.visible.length) },
          (_, index) => (
            <Box key={`log-pad:${index}`} height={1} flexShrink={0}>
              <Text> </Text>
            </Box>
          ),
        )}
      </Box>

      {activity ? (
        <ActivitySpinner
          activity={activity}
          focused={focused}
          theme={theme}
          // Spinner ticks rewrite the whole Ink frame; freeze while tokens flow.
          animate={!stream && !thinking}
        />
      ) : null}

      {pendingPerm ? (
        <PermissionPrompt
          pending={pendingPerm}
          theme={theme}
          onAllow={handlePermissionAllow}
          onDeny={handlePermissionDeny}
        />
      ) : null}

      <Composer
        text={editor.text}
        columns={innerWidth}
        color={userTone.body}
        borderColor={theme.chrome.brand}
      />
      {sessionPicker ? (
        <SessionSelect
          sessions={sessionPicker.sessions}
          currentId={sessionPicker.currentId}
          selectedIndex={sessionPicker.selected}
        />
      ) : slashOpenRows > 0 ? (
        <CommandSelect
          suggestions={suggestions}
          selectedIndex={selectedComplete}
          highlightText={slashHighlight || undefined}
        />
      ) : slashFillRows > 0 ? (
        <Box flexDirection="column" flexShrink={0}>
          {Array.from({ length: slashFillRows }, (_, index) => (
            <Box key={`slash-pad:${index}`} height={1} flexShrink={0}>
              <Text> </Text>
            </Box>
          ))}
        </Box>
      ) : null}
      <ContextMeter
        cwd={cwdPath}
        model={modelId}
        usage={contextUsage}
        branch={gitBranch}
        theme={theme}
        dim={theme.chrome.statusDim}
      />
    </Box>
    </ThemeProvider>
  );
}

function toDisplayLines(
  logs: readonly LogLine[],
  stream: string,
  thinking: string,
): TranscriptSource[] {
  const lines: TranscriptSource[] = logs.map((line) => ({
    key: String(line.id),
    kind: line.kind,
    text: line.text,
  }));
  if (thinking) {
    lines.push({ key: "thinking", kind: "thinking", text: thinking, streaming: true });
  }
  if (stream) lines.push({ key: "stream", kind: "assistant", text: stream, streaming: true });
  return lines;
}

/** Raw terminal size. Layout uses `rows - 1` so Ink avoids clearTerminal. */
function terminalSize(stdout: NodeJS.WriteStream): { columns: number; rows: number } {
  return {
    columns: Math.max(20, stdout.columns || 80),
    rows: Math.max(8, stdout.rows || 24),
  };
}

function spanColor(
  spanTone: "plain" | "strong" | "em" | "code" | "dim" | "link",
  body: string | undefined,
  theme: ReturnType<typeof themeFromConfig>,
): string | undefined {
  if (spanTone === "code") return theme.markdown.code ?? body;
  if (spanTone === "link") return theme.markdown.link ?? body;
  if (spanTone === "strong") return theme.markdown.strong ?? body;
  if (spanTone === "em") return theme.markdown.em ?? body;
  return body;
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
