import { Alert, ThemeProvider } from "@inkjs/ui";
import {
  createAutoPermissionApprover,
  createClient,
  type ClientEvent,
  type ClientStatus,
  type ContextUsage,
  type MinClient,
} from "@min-agent/client";
import {
  loadProviderExtensions,
  modelControls,
  modelSupportsEffort,
  parseReasoningEffort,
  resolveProvider,
  type ModelControls,
} from "@min-agent/runtime";
import { Box, Text, useApp, useStdin, useStdout } from "ink";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { TuiArgs } from "./args.js";
import { minBannerLines } from "./banner.js";
import { composerFrameRows } from "./chrome-layout.js";
import {
  TUI_HELP,
  applyCommandCompletion,
  buildEffortPickerItems,
  buildModelPickerItems,
  commandPlaceholder,
  commandSuggestions,
  cycleCommandIndex,
  formatCompact,
  formatModelStatus,
  formatQueue,
  formatSession,
  formatSessionList,
  resolveModelArgs,
  routeSubmit,
  slashMenuEnter,
  type EffortPickItem,
  type EffortPickValue,
  type ModelPickItem,
  type SessionListItem,
  type TuiCommand,
} from "./commands.js";
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
import { copyToClipboard } from "./clipboard.js";
import { enableFocusReporting, focusStateFromChunk } from "./focus.js";
import { applyMouse, scrollDelta } from "./mouse-session.js";
import { setPointerShape } from "./pointer.js";
import { clampScroll, createScrollPump } from "./scroll-pump.js";
import { composerCaretAnchor, installImeCursorHook } from "./ime-cursor.js";
import { createKeyBuffer } from "./key-buffer.js";
import { resolveKeybindings } from "./keybindings.js";
import { decodeInput } from "./keys.js";
import { rowSelectionCols, selectionRange, type SelCell } from "./selection.js";
import { sliceByColumns } from "./text.js";
import {
  activityFor,
  createPaintCache,
  toneFor,
  type PaintedRow,
  type TranscriptSource,
} from "./paint.js";
import { createStreamPump, type StreamPump } from "./stream-pump.js";
import { permissionAnswer } from "./permission-view.js";
import {
  applyPickerFilter,
  modelFilterHaystack,
  sessionFilterHaystack,
  visibleEfforts,
  visibleModels,
  visibleSessions,
} from "./picker-filter.js";
import { readGitBranch } from "./status-bar.js";
import { applyAuthToEnv, resolveMinConfig } from "@min-agent/config";
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
  activitySpinnerRows,
  CommandSelect,
  commandSelectRows,
  Composer,
  composerBodyRowCount,
  ContextMeter,
  contextMeterRows,
  inkThemeFromTui,
  ModelSelect,
  modelSelectRows,
  PermissionPrompt,
  permissionPromptRows,
  SessionSelect,
  sessionSelectRows,
} from "./ui/index.js";

interface SessionPickerState {
  sessions: SessionListItem[];
  selected: number;
  currentId: string;
  filter: EditorState;
}

interface ModelPickerState {
  items: ModelPickItem[];
  selected: number;
  stage: "model" | "effort";
  pending?: ModelPickItem;
  efforts: EffortPickItem[];
  effortSelected: number;
  filter: EditorState;
  /** Model-list filter restored when backing out of the effort submenu. */
  modelFilter?: EditorState;
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
  const { stdin, setRawMode } = useStdin();
  const { theme, keybindings, config } = useMemo(() => {
    const { config } = resolveMinConfig(
      { cwd: args.cwd },
      {
        ...(args.theme ? { theme: args.theme } : {}),
        ...(args.provider ? { provider: args.provider } : {}),
        ...(args.model ? { model: args.model } : {}),
      },
    );
    return {
      config,
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
  const [modelPicker, setModelPicker] = useState<ModelPickerState | null>(null);
  const [toolName, setToolName] = useState<string | null>(null);
  const [continuing, setContinuing] = useState(false);
  const [scroll, setScroll] = useState(0);
  /** Tool and thinking blocks start collapsed; Ctrl+O / Ctrl+T toggle together. */
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  const [workedMs, setWorkedMs] = useState<number | null>(null);
  const [workedUntil, setWorkedUntil] = useState(0);
  const [activityClock, setActivityClock] = useState(() => Date.now());
  const [selection, setSelection] = useState<{
    anchor: SelCell;
    focus: SelCell;
    dragging: boolean;
  } | null>(null);
  const selectRef = useRef({
    paddingX: 1,
    logHeight: 0,
    rowCount: 0,
    rowWidth: 0,
    lines: [] as string[],
  });
  const selectionStateRef = useRef(selection);
  selectionStateRef.current = selection;
  const [size, setSize] = useState(() => terminalSize(stdout));
  const [focused, setFocused] = useState(true);
  const [contextUsage, setContextUsage] = useState<ContextUsage | undefined>();
  const [gitBranch, setGitBranch] = useState<string | undefined>();
  const seq = useRef(0);
  const clientRef = useRef<MinClient | null>(null);
  const modelRef = useRef<ModelControls | null>(null);
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
  const scrollPumpRef = useRef<ReturnType<typeof createScrollPump> | null>(null);
  if (scrollPumpRef.current === null) {
    scrollPumpRef.current = createScrollPump((delta) => {
      setScroll((current) => {
        const max = Math.max(0, viewRef.current.total - viewRef.current.height);
        return clampScroll(current, delta, max);
      });
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
  useEffect(() => () => scrollPumpRef.current?.dispose(), []);

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

  useEffect(() => {
    let cancelled = false;
    let unsub: (() => void) | undefined;
    let unsubNotices: (() => void) | undefined;

    const syncQueue = () => {
      const live = clientRef.current;
      if (live) setQueueSize(live.queue.size);
    };

    (async () => {
      try {
        await loadProviderExtensions();
        applyAuthToEnv(config.auth);
        const autoMode = args.auto ? "auto" : args.yes ? "yes" : undefined;
        const provider = resolveProvider({
          provider: config.provider,
          model: config.model,
          reasoningEffort: config.reasoningEffort,
        });
        modelRef.current = modelControls(provider) ?? null;
        const created = await createClient({
          cwd: args.cwd,
          provider,
          sessionId: args.sessionId,
          sessionDir: config.runtime.sessionDir,
          noTools: args.noTools,
          allowBash: args.yes || args.auto || config.settings.permissions?.bash === "allow",
          askWrite: config.settings.permissions?.write === "ask",
          maxContextTokens: config.runtime.maxContextTokens,
          maxTurns: config.runtime.maxTurns,
          contextStrategy: contextStrategyFrom(config.runtime.contextStrategy),
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
            if (event.status === "running" || event.status === "asking") {
              setRunStartedAt((start) => start ?? Date.now());
              setWorkedUntil(0);
              setWorkedMs(null);
            }
            if (event.status === "idle") {
              inflightTools.current.clear();
              setToolName(null);
              setContinuing(false);
              thinkingPumpRef.current?.reset();
              pendingThinkingRef.current = null;
              setThinking("");
              setRunStartedAt((start) => {
                if (start != null) {
                  const ms = Date.now() - start;
                  setWorkedMs(ms);
                  setWorkedUntil(Date.now() + 2500);
                }
                return null;
              });
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
          if (event.type === "session") {
            if (event.messages) replaceLogs(event.messages);
            syncQueue();
          }
        });
        const snapshot = created.getSession();
        replaceLogs(snapshot.messages);
        for (const notice of created.notices.list()) pushLine("notice", notice.message);
        unsubNotices = created.notices.subscribe((notice) => {
          pushLine("notice", notice.message);
        });
        const status = created.getStatus();
        pushLine(
          "sys",
          `provider=${status.provider}  session=${status.sessionId}  cwd=${status.cwd}`,
        );
        setQueueSize(status.queueSize);
        setStatusLabel(status.status);
        setBusy(status.status !== "idle");
        setContextUsage(status.context);
        setClient(created);
      } catch (err) {
        if (!cancelled) setError(messageOf(err));
      }
    })();

    return () => {
      cancelled = true;
      modelRef.current = null;
      unsub?.();
      unsubNotices?.();
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
    config,
    pushLine,
    replaceLogs,
  ]);

  const runCommand = useCallback(
    async (live: MinClient, command: TuiCommand) => {
      if (command.type === "model-pick") {
        const controls = modelRef.current;
        if (!controls) {
          pushLine("error", "model controls are unavailable");
          return;
        }
        const selected = controls.selection();
        const items = buildModelPickerItems(
          selected,
          controls.models(),
          config.providers,
          modelSupportsEffort,
        );
        if (items.length === 0) {
          pushLine(
            "sys",
            formatModelStatus({
              kind: selected.kind,
              model: selected.model,
              effort: selected.effort,
              models: controls.models(),
              saved: Object.keys(config.providers),
            }),
          );
          return;
        }
        const at = Math.max(
          0,
          items.findIndex((item) => item.current),
        );
        setSessionPicker(null);
        setModelPicker({
          items,
          selected: at,
          stage: "model",
          efforts: [],
          effortSelected: 0,
          filter: createEditor(),
        });
        setEditor(createEditor());
        return;
      }
      if (command.type === "model-set") {
        const controls = modelRef.current;
        if (!controls) {
          pushLine("error", "model controls are unavailable");
          return;
        }
        const change = resolveModelArgs(command.args, config.providers);
        if (change.type === "error") {
          pushLine("error", change.message);
          return;
        }
        try {
          if (change.type !== "show") applyModelChange(controls, change);
          reportModelStatus(controls, config.providers, pushLine);
        } catch (err) {
          pushLine("error", messageOf(err));
        }
        return;
      }
      if (command.type === "effort" || command.type === "effort-set") {
        const controls = modelRef.current;
        if (!controls) {
          pushLine("error", "model controls are unavailable");
          return;
        }
        if (command.type === "effort-set") {
          if (command.value.toLowerCase() === "default") {
            controls.setEffort(undefined);
          } else {
            const effort = parseReasoningEffort(command.value);
            if (!effort) {
              pushLine("error", "effort must be none, low, medium, high, max, or default");
              return;
            }
            controls.setEffort(effort);
          }
        }
        const selected = controls.selection();
        pushLine("sys", `effort ${selected.effort ?? "(default)"}`);
        return;
      }
      if (command.type === "thinking") {
        setDetailsExpanded((current) => {
          const next = !current;
          pushLine("sys", next ? "details expanded" : "details collapsed");
          return next;
        });
        return;
      }
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
      if (command.type === "name") {
        try {
          const title = await live.generateSessionTitle();
          pushLine("sys", `name ${title}`);
        } catch (err) {
          pushLine("error", messageOf(err));
        }
        return;
      }
      if (command.type === "name-set") {
        try {
          await live.renameSession(command.title);
          pushLine("sys", `name ${live.getSession().title ?? command.title}`);
        } catch (err) {
          pushLine("error", messageOf(err));
        }
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
      if (command.type === "resume-pick") {
        try {
          const metas = await live.listSessions();
          const currentId = live.getSession().id;
          if (metas.length === 0) {
            pushLine("sys", "(no saved sessions)");
            return;
          }
          const selected = Math.max(
            0,
            metas.findIndex((meta) => meta.id === currentId),
          );
          setModelPicker(null);
          setSessionPicker({
            sessions: metas.map((meta) => ({
              id: meta.id,
              title: meta.title,
              updatedAt: meta.updatedAt,
              messageCount: meta.messageCount,
              turns: meta.turns,
              preview: meta.preview,
              latest: meta.latest,
            })),
            selected: selected >= 0 ? selected : 0,
            currentId,
            filter: createEditor(),
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
          await live.openSession(command.id);
          pushLine("sys", `resumed ${live.getSession().id}`);
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
    [config.providers, exit, pushLine],
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
    if (key.mouse) {
      const next = applyMouse(key.mouse, selectRef.current, selectionStateRef.current);
      setPointerShape(next.pointer, stdout);
      if (key.mouse.kind === "move") return;
      if (key.mouse.kind === "down" || key.mouse.kind === "drag") {
        setSelection(next.selection);
        return;
      }
      if (next.copy) copyToClipboard(next.copy, stdout);
      if (selectionStateRef.current?.dragging) setSelection(next.selection);
      return;
    }
    const action = inputAction(input, key, keybindings);
    if (action.type === "scroll") {
      scrollPumpRef.current?.add(
        scrollDelta(action.direction, action.delta, viewRef.current.height),
      );
      return;
    }
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
        setSessionPicker((current) => {
          if (!current) return current;
          const count = visibleSessions(current.sessions, current.filter.text).length;
          if (count <= 0) return current;
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
        const matches = visibleSessions(sessionPicker.sessions, sessionPicker.filter.text);
        const pick = matches[sessionPicker.selected];
        if (!pick) return;
        setSessionPicker(null);
        void (async () => {
          const live = clientRef.current;
          if (!live) return;
          try {
            await live.openSession(pick.id);
            pushLine("sys", `resumed ${live.getSession().id}`);
          } catch (err) {
            pushLine("error", messageOf(err));
          }
        })();
        return;
      }
      if (action.type === "edit") {
        setSessionPicker((current) => {
          if (!current) return current;
          const next = applyPickerFilter(
            current.sessions,
            current.selected,
            current.filter,
            action.op,
            (session) => session.id,
            sessionFilterHaystack,
          );
          return { ...current, filter: next.filter, selected: next.selected };
        });
        return;
      }
      return;
    }
    if (modelPicker) {
      if (key.escape || (action.type === "interrupt" && key.escape)) {
        if (modelPicker.stage === "effort") {
          setModelPicker((current) =>
            current
              ? {
                  ...current,
                  stage: "model",
                  pending: undefined,
                  filter: current.modelFilter ?? createEditor(),
                  modelFilter: undefined,
                }
              : current,
          );
          return;
        }
        setModelPicker(null);
        return;
      }
      if (action.type === "interrupt") {
        exit();
        return;
      }
      if (key.upArrow || key.downArrow) {
        const direction = key.downArrow ? "down" : "up";
        setModelPicker((current) => {
          if (!current) return current;
          if (current.stage === "effort") {
            const count = visibleEfforts(current.efforts, current.filter.text).length;
            if (count <= 0) return current;
            return {
              ...current,
              effortSelected: cycleCommandIndex(current.effortSelected, count, direction),
            };
          }
          const count = visibleModels(current.items, current.filter.text).length;
          if (count <= 0) return current;
          return {
            ...current,
            selected: cycleCommandIndex(current.selected, count, direction),
          };
        });
        return;
      }
      if (action.type === "submit" || key.return) {
        const controls = modelRef.current;
        if (!controls) {
          setModelPicker(null);
          pushLine("error", "model controls are unavailable");
          return;
        }
        if (modelPicker.stage === "effort") {
          const pending = modelPicker.pending;
          const matches = visibleEfforts(modelPicker.efforts, modelPicker.filter.text);
          const effort = matches[modelPicker.effortSelected];
          if (!pending || !effort) return;
          setModelPicker(null);
          try {
            applyModelChange(controls, pending.change, effort.value);
            reportModelStatus(controls, config.providers, pushLine);
          } catch (err) {
            pushLine("error", messageOf(err));
          }
          return;
        }
        const matches = visibleModels(modelPicker.items, modelPicker.filter.text);
        const pick = matches[modelPicker.selected];
        if (!pick) return;
        if (pick.supportsEffort) {
          const efforts = buildEffortPickerItems(controls.selection().effort);
          const effortSelected = Math.max(
            0,
            efforts.findIndex((item) => item.current),
          );
          setModelPicker({
            ...modelPicker,
            stage: "effort",
            pending: pick,
            efforts,
            effortSelected,
            modelFilter: modelPicker.filter,
            filter: createEditor(),
          });
          return;
        }
        setModelPicker(null);
        try {
          applyModelChange(controls, pick.change);
          reportModelStatus(controls, config.providers, pushLine);
        } catch (err) {
          pushLine("error", messageOf(err));
        }
        return;
      }
      if (action.type === "edit") {
        setModelPicker((current) => {
          if (!current) return current;
          if (current.stage === "effort") {
            const next = applyPickerFilter(
              current.efforts,
              current.effortSelected,
              current.filter,
              action.op,
              (item) => item.value,
              modelFilterHaystack,
            );
            return {
              ...current,
              filter: next.filter,
              effortSelected: next.selected,
            };
          }
          const next = applyPickerFilter(
            current.items,
            current.selected,
            current.filter,
            action.op,
            (item) => item.key,
            modelFilterHaystack,
          );
          return { ...current, filter: next.filter, selected: next.selected };
        });
        return;
      }
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
    if (action.type === "toggle-tool-output" || action.type === "toggle-thinking") {
      setDetailsExpanded((current) => !current);
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
      const decision = slashMenuEnter(pick);
      if (decision.type === "fill") {
        setEditor((current) => ({
          ...current,
          text: decision.text,
          cursor: decision.text.length,
        }));
        setCompleteIndex(0);
        return;
      }
      const committed = commitEditor({
        ...editor,
        text: decision.line,
        cursor: decision.line.length,
      });
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
    stdin.resume();
    const buffer = createKeyBuffer((sequence) => {
      const focus = focusStateFromChunk(sequence);
      if (focus !== null) {
        setFocused(focus);
        return;
      }
      const { input, key } = decodeInput(sequence);
      handleInput.current(input, key);
    });
    const onData = (chunk: string | Buffer) => {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      // Focus reports are complete on their own; don't buffer-merge with keys.
      const focus = focusStateFromChunk(text);
      if (focus !== null) {
        setFocused(focus);
        return;
      }
      buffer.push(text);
    };
    stdin.on("data", onData);
    return () => {
      stdin.off("data", onData);
      buffer.dispose();
      setRawMode(false);
    };
  }, [stdin, setRawMode]);

  useEffect(() => {
    if (statusLabel !== "running" && statusLabel !== "asking" && workedUntil <= 0) return;
    const timer = setInterval(() => setActivityClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [statusLabel, workedUntil]);

  const workedVisible = workedMs != null && activityClock < workedUntil;
  const activity = activityFor(
    {
      status: statusLabel,
      streaming: stream.length > 0,
      toolName,
      continuing,
      nowMs: activityClock,
      runStartedAtMs: runStartedAt,
      workedDurationMs: workedMs,
      workedVisible,
    },
    theme,
  );
  const columns = size.columns;
  const termRows = size.rows;
  /**
   * Use the full terminal height so the composer and status chrome pin
   * flush to the bottom edge, giving maximum vertical space to the transcript.
   */
  const paintRows = Math.max(1, termRows);
  const innerWidth = Math.max(1, columns - 2);
  const suggestions = commandSuggestions(editor.text);
  const selectedComplete =
    suggestions.length > 0
      ? ((completeIndex % suggestions.length) + suggestions.length) % suggestions.length
      : 0;
  const slashHighlight = editor.text.startsWith("/") ? editor.text.slice(1) : "";
  /** Body between rules: paddingY + content (+ soft wraps / newlines) + paddingY. */
  const inputRows = composerBodyRowCount(editor.text, innerWidth);
  const pickerOpen = Boolean(sessionPicker || modelPicker);
  const slashOpenRows = pickerOpen ? 0 : commandSelectRows(suggestions.length);
  const sessionPickRows = sessionPicker
    ? sessionSelectRows(sessionPicker.sessions.length)
    : 0;
  const modelPickRows = modelPicker ? modelSelectRows(modelPicker.items.length) : 0;
  const suggestRows =
    sessionPickRows > 0
      ? sessionPickRows
      : modelPickRows > 0
        ? modelPickRows
        : slashOpenRows > 0
          ? slashOpenRows
          : slashFillRows;
  const activityRows = activitySpinnerRows(Boolean(activity));
  const modelId = client?.getStatus().provider ?? "";
  const cwdPath = client?.getStatus().cwd ?? args.cwd;
  const bottomStatusRows = contextMeterRows(cwdPath, modelId);
  const permBlockRows = pendingPerm ? permissionPromptRows(pendingPerm) : 0;
  const { logHeight, rowsAboveComposer, rowsBelowComposer } = composerFrameRows({
    paintRows,
    activityRows,
    permBlockRows,
    inputRows,
    suggestRows,
    bottomStatusRows,
  });
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
  const painted = paintCache.current.paint(
    toDisplayLines(logs, stream, thinking, detailsExpanded),
    innerWidth,
    {
      detailsExpanded,
    },
  );

  const bannerLines = minBannerLines(innerWidth);
  const bannerRows: PaintedRow[] = bannerLines.map((line, index) => ({
    key: `banner:${index}`,
    kind: "banner",
    lead: false,
    gutter: "",
    body: line,
    text: line,
    spans: [{ text: line, tone: "plain", bold: true, italic: false }],
  }));
  const metaText = client
    ? `${shortId(client.getStatus().sessionId)} · ${statusLabel}${queueSize > 0 ? ` · queue ${queueSize}` : ""}`
    : "";
  const bannerMetaRow: PaintedRow[] = metaText
    ? [
        {
          key: "banner:meta",
          kind: "banner-meta",
          lead: false,
          gutter: "",
          body: metaText,
          text: metaText,
          spans: [{ text: metaText, tone: "dim", bold: false, italic: false }],
        },
      ]
    : [];
  const bannerGapRow: PaintedRow = {
    key: "banner:gap",
    kind: "gap",
    lead: false,
    gutter: "",
    body: " ",
    text: " ",
    spans: [],
  };
  const allPainted: PaintedRow[] = [
    ...bannerRows,
    ...bannerMetaRow,
    bannerGapRow,
    ...painted,
  ];
  const rowCount = allPainted.length;

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
  const layout = sliceViewport(allPainted, logHeight, scroll);
  selectRef.current = {
    paddingX: 1,
    logHeight,
    rowCount: layout.visible.length,
    rowWidth: innerWidth,
    lines: layout.visible.map((row) => `${row.gutter}${row.body}`),
  };
  const selectedRange = selection ? selectionRange(selection.anchor, selection.focus) : null;

  // Re-park the caret inside each Ink stdout write. The hook also turns
  // eraseLines / clearTerminal into CUP diffs so stream paints do not flash.
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
              label: "Thinking...",
              color: theme.activity.thinking,
            }}
            focused={focused}
            theme={theme}
          />
        </Box>
      </ThemeProvider>
    );
  }

  const scrollHint =
    layout.hiddenAbove || layout.hiddenBelow
      ? `↑${layout.hiddenAbove} ↓${layout.hiddenBelow}`
      : "";

  return (
    <ThemeProvider theme={inkChromeTheme}>
    <Box flexDirection="column" paddingX={1} width={columns} height={paintRows}>
      <Box flexDirection="column" height={logHeight} overflow="hidden">
        {layout.visible.map((row, rowIndex) => {
          const selectedCols = selectedRange
            ? rowSelectionCols(rowIndex, selectedRange, innerWidth)
            : null;
          if (selectedCols) {
            const line = `${row.gutter}${row.body}`;
            const before = sliceByColumns(line, 0, selectedCols.start);
            const mid = sliceByColumns(line, selectedCols.start, selectedCols.end);
            const after = sliceByColumns(line, selectedCols.end, innerWidth + 8);
            return (
              <Box key={row.key} height={1} overflow="hidden" flexShrink={0}>
                <Text wrap="truncate">
                  {before}
                  {mid ? <Text inverse>{mid}</Text> : null}
                  {after}
                </Text>
              </Box>
            );
          }
          if (row.kind === "gap") {
            return (
              <Box key={row.key} height={1} flexShrink={0}>
                <Text> </Text>
              </Box>
            );
          }
          if (row.kind === "banner") {
            return (
              <Box key={row.key} height={1} overflow="hidden" flexShrink={0}>
                <Text bold color={theme.chrome.brand} wrap="truncate">
                  {row.text}
                </Text>
              </Box>
            );
          }
          if (row.kind === "banner-meta") {
            return (
              <Box key={row.key} height={1} overflow="hidden" flexShrink={0}>
                <Text dimColor={theme.chrome.statusDim} wrap="truncate">
                  {row.text}
                </Text>
              </Box>
            );
          }
          const tone = toneFor(row.kind, theme);
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
        <ActivitySpinner activity={activity} focused={focused} theme={theme} />
      ) : null}

      {pendingPerm ? (
        <PermissionPrompt
          pending={pendingPerm}
          theme={theme}
          onAllow={handlePermissionAllow}
          onDeny={handlePermissionDeny}
        />
      ) : null}

      {sessionPicker ? (
        <SessionSelect
          sessions={sessionPicker.sessions}
          currentId={sessionPicker.currentId}
          selectedIndex={sessionPicker.selected}
          columns={innerWidth}
          filter={sessionPicker.filter}
          minRows={sessionPickRows}
        />
      ) : modelPicker ? (
        <ModelSelect
          items={
            modelPicker.stage === "effort" ? modelPicker.efforts : modelPicker.items
          }
          selectedIndex={
            modelPicker.stage === "effort"
              ? modelPicker.effortSelected
              : modelPicker.selected
          }
          columns={innerWidth}
          hint={
            modelPicker.stage === "effort"
              ? "effort · ↑↓ select · Enter set · Esc back"
              : "model · ↑↓ select · Enter switch · Esc cancel"
          }
          minRows={modelPickRows}
          filter={modelPicker.filter}
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
      <Composer
        text={editor.text}
        cursor={editor.cursor}
        columns={innerWidth}
        color={userTone.body}
        borderColor={theme.chrome.brand}
        placeholder={
          editor.cursor === editor.text.length ? commandPlaceholder(editor.text) : undefined
        }
      />
      <ContextMeter
        cwd={cwdPath}
        model={modelId}
        usage={contextUsage}
        branch={gitBranch}
        theme={theme}
        dim={theme.chrome.statusDim}
        scrollHint={scrollHint || undefined}
      />
    </Box>
    </ThemeProvider>
  );
}

function contextStrategyFrom(
  value: string | undefined,
): "trim" | "hmt" | "tool-offload" | "sticky-trim" | "hybrid" | undefined {
  if (
    value === "trim" ||
    value === "hmt" ||
    value === "tool-offload" ||
    value === "sticky-trim" ||
    value === "hybrid"
  ) {
    return value;
  }
  return undefined;
}

function toDisplayLines(
  logs: readonly LogLine[],
  stream: string,
  thinking: string,
  detailsExpanded: boolean,
): TranscriptSource[] {
  const lines: TranscriptSource[] = logs.map((line) => ({
    key: String(line.id),
    kind: line.kind,
    text: line.text,
  }));
  if (thinking && detailsExpanded) {
    lines.push({ key: "thinking", kind: "thinking", text: thinking, streaming: true });
  }
  if (stream) lines.push({ key: "stream", kind: "assistant", text: stream, streaming: true });
  return lines;
}

/** Terminal size with environment and stderr fallbacks when stdout is not sized. */
function terminalSize(stdout: NodeJS.WriteStream): { columns: number; rows: number } {
  const envCols = Number(process.env.COLUMNS);
  const envRows = Number(process.env.LINES);
  const cols =
    stdout.columns ||
    process.stdout.columns ||
    process.stderr.columns ||
    (Number.isFinite(envCols) && envCols > 0 ? envCols : 80);
  const rows =
    stdout.rows ||
    process.stdout.rows ||
    process.stderr.rows ||
    (Number.isFinite(envRows) && envRows > 0 ? envRows : 24);
  return {
    columns: Math.max(20, cols),
    rows: Math.max(8, rows),
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

function applyModelChange(
  controls: ModelControls,
  change: ModelPickItem["change"],
  effort?: EffortPickValue,
): void {
  if (change.type === "model") controls.setModel(change.model);
  if (change.type === "provider") {
    controls.setProvider({
      kind: change.kind,
      model: change.model,
      baseURL: change.baseURL,
      apiKey: change.apiKey,
    });
  }
  if (effort === "default") {
    controls.setEffort(undefined);
    return;
  }
  if (effort) {
    const parsed = parseReasoningEffort(effort);
    if (parsed) controls.setEffort(parsed);
  }
}

function reportModelStatus(
  controls: ModelControls,
  named: Readonly<Record<string, unknown>>,
  pushLine: (kind: LogKind, text: string) => void,
): void {
  const selected = controls.selection();
  pushLine(
    "sys",
    formatModelStatus({
      kind: selected.kind,
      model: selected.model,
      effort: selected.effort,
      models: controls.models(),
      saved: Object.keys(named),
    }),
  );
}
