import {
  assistantMessage,
  textPart,
  toolCallPart,
  toolMessage,
  toolResultPart,
  userMessage,
  type Message,
} from "@min-agent/core";
import { describe, expect, it } from "vitest";
import { assembleHybridContext } from "./assemble-hybrid.js";
import { DEFAULT_MAX_CONTEXT_TOKENS } from "./defaults.js";
import { createRecallTool } from "./recall.js";
import { createContextStash, parseHiddenIds } from "./stash.js";
import { estimateMessagesTokens } from "./tokens.js";

/**
 * Product hybrid is restrained: fold/age only when the view exceeds the
 * token budget. Keep `false` only to lock the old eager 900-char scoreboard.
 *
 * Mapped from ses_mw4bvjcw: one user turn, roomy budget, fat skill read,
 * then recall, then two small tools that hide the recall page.
 */
const RESTRAINED_HYBRID = true;

/** Sizes from that session's real tool_results (chars). */
const SKILL_MD = "S".repeat(45_252);
const CLEAN_PY = "P".repeat(24_861);
const DRY_RUN = "D".repeat(457);
const RECALL_PAGE = "R".repeat(12_000);
const ANALYZE = "A".repeat(1_337);
const GREP = "G".repeat(3_781);

type EfficiencyScoreboard = {
  strategy: "hybrid";
  underBudget: boolean;
  /** First fat body still equal to the original after the 3rd in-turn result. */
  skillVisibleAfterThirdTool: boolean;
  /** Simulated recall page still full after two more small tools. */
  recallVisibleAfterTwoSmallTools: boolean;
  /** Middle-turn 10k body still full under a roomy budget. */
  middleFatVisibleUnderBudget: boolean;
};

const CURRENT_HYBRID: Omit<EfficiencyScoreboard, "strategy" | "underBudget"> = {
  skillVisibleAfterThirdTool: false,
  recallVisibleAfterTwoSmallTools: false,
  middleFatVisibleUnderBudget: false,
};

const RESTRAINED_TARGET: Omit<EfficiencyScoreboard, "strategy" | "underBudget"> =
  {
    skillVisibleAfterThirdTool: true,
    recallVisibleAfterTwoSmallTools: true,
    middleFatVisibleUnderBudget: true,
  };

function toolBody(messages: Message[], callId: string): string | undefined {
  for (const message of messages) {
    for (const part of message.content) {
      if (part.type === "tool_result" && part.toolCallId === callId) {
        return part.content;
      }
    }
  }
}

function isFull(messages: Message[], callId: string, original: string): boolean {
  const body = toolBody(messages, callId);
  return body === original && parseHiddenIds(body ?? "").length === 0;
}

function hiddenCount(messages: Message[]): number {
  let n = 0;
  for (const message of messages) {
    for (const part of message.content) {
      if (part.type === "tool_result") n += parseHiddenIds(part.content).length;
    }
  }
  return n;
}

function plus(
  messages: Message[],
  callId: string,
  tool: string,
  body: string,
): Message[] {
  return [
    ...messages,
    assistantMessage([toolCallPart(callId, tool, { id: callId })]),
    toolMessage([toolResultPart(callId, body)]),
  ];
}

function assemble(messages: Message[], maxContextTokens: number) {
  const stash = createContextStash();
  const result = assembleHybridContext({
    messages,
    budget: { maxContextTokens, stash },
  });
  return { result, stash };
}

/**
 * Single-turn loop shaped like the disk-cleaner session:
 * read skill → read script → dry-run → recall skill → analyze → grep.
 */
function diskCleanerLikeMessages(): Message[] {
  let messages: Message[] = [userMessage("find disk-cleaner skill and follow it")];
  messages = plus(messages, "skill", "read_file", SKILL_MD);
  messages = plus(messages, "script", "read_file", CLEAN_PY);
  messages = plus(messages, "dry", "bash", DRY_RUN);
  messages = plus(messages, "recall", "recall_context", RECALL_PAGE);
  messages = plus(messages, "analyze", "bash", ANALYZE);
  messages = plus(messages, "grep", "bash", GREP);
  return messages;
}

function scoreDiskCleanerLike(): EfficiencyScoreboard & {
  estimatedTokens: number;
  messageBudget: number;
  foldedParts: number;
  hiddenMarkers: number;
} {
  const full = diskCleanerLikeMessages();
  const afterThird = full.slice(0, 1 + 3 * 2);
  const afterRecallPlusTwo = full;

  const third = assemble(afterThird, DEFAULT_MAX_CONTEXT_TOKENS);
  const end = assemble(afterRecallPlusTwo, DEFAULT_MAX_CONTEXT_TOKENS);

  const middleBlob = "M".repeat(10_000);
  const middleMessages: Message[] = [
    userMessage("sticky constraint"),
    assistantMessage([textPart("ok")]),
    userMessage("middle work"),
    assistantMessage([toolCallPart("mid", "bash", { command: "scan" })]),
    toolMessage([toolResultPart("mid", middleBlob)]),
    userMessage("tail"),
    assistantMessage([textPart("done")]),
  ];
  const middle = assemble(middleMessages, DEFAULT_MAX_CONTEXT_TOKENS);

  return {
    strategy: "hybrid",
    underBudget: end.result.estimatedTokens <= end.result.messageBudget,
    skillVisibleAfterThirdTool: isFull(third.result.view, "skill", SKILL_MD),
    recallVisibleAfterTwoSmallTools: isFull(
      end.result.view,
      "recall",
      RECALL_PAGE,
    ),
    middleFatVisibleUnderBudget: isFull(middle.result.view, "mid", middleBlob),
    estimatedTokens: end.result.estimatedTokens,
    messageBudget: end.result.messageBudget,
    foldedParts: end.result.foldedParts ?? 0,
    hiddenMarkers: hiddenCount(end.result.view),
  };
}

describe("hybrid efficiency eval (disk-cleaner-like loop)", () => {
  it("keeps strategy=hybrid and stays under the default token budget", () => {
    const score = scoreDiskCleanerLike();
    expect(score.strategy).toBe("hybrid");
    expect(score.underBudget).toBe(true);
    expect(score.messageBudget).toBeGreaterThan(100_000);
    expect(score.estimatedTokens).toBeLessThan(score.messageBudget);
  });

  it("scoreboard vs current hybrid / restrained target", () => {
    const score = scoreDiskCleanerLike();
    const expected = RESTRAINED_HYBRID ? RESTRAINED_TARGET : CURRENT_HYBRID;
    expect({
      skillVisibleAfterThirdTool: score.skillVisibleAfterThirdTool,
      recallVisibleAfterTwoSmallTools: score.recallVisibleAfterTwoSmallTools,
      middleFatVisibleUnderBudget: score.middleFatVisibleUnderBudget,
    }).toEqual(expected);
  });

  it("canonical history still holds the full skill body", () => {
    const messages = diskCleanerLikeMessages();
    const { result } = assemble(messages, DEFAULT_MAX_CONTEXT_TOKENS);
    expect(result.kept).toBe(messages);
    expect(toolBody(result.kept ?? [], "skill")).toBe(SKILL_MD);
  });

  it("still folds and stashes when the loop is over token budget", () => {
    const messages = diskCleanerLikeMessages();
    const { result, stash } = assemble(messages, 2_000);
    expect(result.strategy).toBe("hybrid");
    expect(estimateMessagesTokens(messages)).toBeGreaterThan(result.messageBudget);
    expect(result.foldedParts ?? 0).toBeGreaterThan(0);
    expect(stash.size).toBeGreaterThan(0);
    expect(hiddenCount(result.view)).toBeGreaterThan(0);
    expect(isFull(result.view, "skill", SKILL_MD)).toBe(false);
  });
});

/**
 * Fold compresses a fat body (needle sits past the 120-char head, so it
 * disappears from the view). Recall brings a 12k page back; two more small
 * tools must not hide that page again — that is the recall mechanism working
 * with fold, not against it.
 */
describe("hybrid fold + recall (over budget)", () => {
  const NEEDLE = "NEEDLE_SKILL_7f3c";
  const NEEDLE_AT = 5_000;
  const skillWithNeedle =
    "H".repeat(NEEDLE_AT) + NEEDLE + "T".repeat(45_252 - NEEDLE_AT - NEEDLE.length);

  async function foldThenRecallThenTwoSmall(maxContextTokens: number) {
    const stash = createContextStash();
    let messages: Message[] = [userMessage("find disk-cleaner skill and follow it")];
    messages = plus(messages, "skill", "read_file", skillWithNeedle);
    messages = plus(messages, "script", "read_file", CLEAN_PY);
    messages = plus(messages, "dry", "bash", DRY_RUN);

    const folded = assembleHybridContext({
      messages,
      budget: { maxContextTokens, stash },
    });
    const skillView = toolBody(folded.view, "skill") ?? "";
    const hiddenIds = parseHiddenIds(skillView);
    expect(folded.foldedParts ?? 0).toBeGreaterThan(0);
    expect(skillView).not.toContain(NEEDLE);
    expect(hiddenIds.length).toBeGreaterThan(0);

    const recallTool = createRecallTool(stash);
    const page = await recallTool.execute({ id: hiddenIds[0] }, {});
    expect(page.isError).toBeFalsy();
    expect(page.content).toContain(NEEDLE);

    messages = plus(messages, "recall", "recall_context", page.content);
    const justRecalled = assembleHybridContext({
      messages,
      budget: { maxContextTokens, stash },
    });

    messages = plus(messages, "analyze", "bash", ANALYZE);
    messages = plus(messages, "grep", "bash", GREP);
    const afterSmall = assembleHybridContext({
      messages,
      budget: { maxContextTokens, stash },
    });
    return { folded, justRecalled, afterSmall, hiddenIds };
  }

  it("does not stash a nested id when a recall page is the thing being folded", async () => {
    const { afterSmall, hiddenIds } = await foldThenRecallThenTwoSmall(8_000);
    const recalled = toolBody(afterSmall.view, "recall") ?? "";
    for (const id of parseHiddenIds(recalled)) {
      expect(hiddenIds).toContain(id);
    }
    expect(recalled).not.toMatch(/\[hidden:tool_recall/);
  });

  it("keeps the recalled needle in the view after two more small tools", async () => {
    // Tight enough that the 45k skill folds; roomy enough that a 12k recall
    // page plus two small results still fit, so recall can actually be used.
    const { justRecalled, afterSmall } = await foldThenRecallThenTwoSmall(12_000);
    expect(toolBody(justRecalled.view, "recall")).toContain(NEEDLE);
    const recalled = toolBody(afterSmall.view, "recall") ?? "";
    expect(recalled).toContain(NEEDLE);
    expect(parseHiddenIds(recalled)).toHaveLength(0);
    expect(isFull(afterSmall.view, "skill", skillWithNeedle)).toBe(false);
  });

  it("still emergency-folds a recall page when even that page cannot fit", async () => {
    const { afterSmall, hiddenIds } = await foldThenRecallThenTwoSmall(2_000);
    const recalled = toolBody(afterSmall.view, "recall") ?? "";
    expect(recalled.length).toBeGreaterThan(0);
    expect(recalled.length).toBeLessThan(12_000);
    // Truncation must not mint a nested hidden id on the recall page.
    // The original skill id stays in stash so the model can recall it again.
    expect(parseHiddenIds(recalled)).toHaveLength(0);
    expect(hiddenIds.length).toBeGreaterThan(0);
  });
});

/**
 * 256k product-default case: the needle sits past the default 12k recall
 * page. Eager hybrid (fold at 900, protect-last-2) therefore cannot expose
 * it with a single offset-0 recall; restrained hybrid at 256k never folds
 * the 45k body, so the needle stays in the view with no recall.
 */
describe("256k deep needle (default recall page misses)", () => {
  const NEEDLE = "NEEDLE_DEEP_7f3c";
  const NEEDLE_AT = 20_000;
  const deepSkill =
    "H".repeat(NEEDLE_AT) + NEEDLE + "T".repeat(45_252 - NEEDLE_AT - NEEDLE.length);

  it("restrained hybrid at 256k keeps the needle after five in-turn tools", () => {
    let messages: Message[] = [userMessage("follow the skill")];
    messages = plus(messages, "skill", "read_file", deepSkill);
    messages = plus(messages, "script", "read_file", CLEAN_PY);
    messages = plus(messages, "dry", "bash", DRY_RUN);
    messages = plus(messages, "ls", "bash", "total 2");
    messages = plus(messages, "pwd", "bash", "/tmp");
    const { result } = assemble(messages, DEFAULT_MAX_CONTEXT_TOKENS);
    expect(result.foldedParts ?? 0).toBe(0);
    expect(toolBody(result.view, "skill")).toContain(NEEDLE);
  });

  it("default 12k recall of a folded body misses; offset 12000 hits", async () => {
    const stash = createContextStash();
    let messages: Message[] = [userMessage("follow the skill")];
    messages = plus(messages, "skill", "read_file", deepSkill);
    messages = plus(messages, "script", "read_file", CLEAN_PY);
    messages = plus(messages, "dry", "bash", DRY_RUN);
    const folded = assembleHybridContext({
      messages,
      budget: { maxContextTokens: 8_000, stash },
    });
    const ids = parseHiddenIds(toolBody(folded.view, "skill") ?? "");
    expect(ids.length).toBeGreaterThan(0);
    expect(toolBody(folded.view, "skill")).not.toContain(NEEDLE);

    const recallTool = createRecallTool(stash);
    const page0 = await recallTool.execute({ id: ids[0] }, {});
    expect(page0.isError).toBeFalsy();
    expect(page0.content).not.toContain(NEEDLE);

    const page1 = await recallTool.execute({ id: ids[0], offset: 12_000 }, {});
    expect(page1.isError).toBeFalsy();
    expect(page1.content).toContain(NEEDLE);
  });
});

describe("hybrid efficiency timeline (under default budget)", () => {
  it("records when the skill body and recall page disappear from the view", () => {
    const stash = createContextStash();
    let messages: Message[] = [userMessage("find disk-cleaner skill and follow it")];
    const timeline: Array<{
      step: string;
      skillFull: boolean;
      recallFull: boolean | null;
      hidden: number;
      foldedParts: number;
    }> = [];

    const snap = (step: string) => {
      const result = assembleHybridContext({
        messages,
        budget: { maxContextTokens: DEFAULT_MAX_CONTEXT_TOKENS, stash },
      });
      timeline.push({
        step,
        skillFull: isFull(result.view, "skill", SKILL_MD),
        recallFull: toolBody(result.view, "recall")
          ? isFull(result.view, "recall", RECALL_PAGE)
          : null,
        hidden: hiddenCount(result.view),
        foldedParts: result.foldedParts ?? 0,
      });
    };

    messages = plus(messages, "skill", "read_file", SKILL_MD);
    snap("read SKILL.md");
    messages = plus(messages, "script", "read_file", CLEAN_PY);
    snap("read clean_disk.py");
    messages = plus(messages, "dry", "bash", DRY_RUN);
    snap("dry-run JSON");
    messages = plus(messages, "recall", "recall_context", RECALL_PAGE);
    snap("recall SKILL.md page");
    messages = plus(messages, "analyze", "bash", ANALYZE);
    snap("analyze");
    messages = plus(messages, "grep", "bash", GREP);
    snap("grep");

    expect(timeline[0]?.skillFull).toBe(true);
    expect(timeline[1]?.skillFull).toBe(true);

    if (RESTRAINED_HYBRID) {
      expect(timeline.every((row) => row.skillFull)).toBe(true);
      expect(
        timeline.filter((row) => row.recallFull !== null).every((row) => row.recallFull),
      ).toBe(true);
      expect(timeline.at(-1)?.hidden).toBe(0);
    } else {
      // Eager intra-turn aging: the 3rd result pushes SKILL.md out of the
      // last-2 window. Two small tools after recall hide the recall page.
      expect(timeline[2]?.skillFull).toBe(false);
      expect(timeline[3]?.recallFull).toBe(true);
      expect(timeline[5]?.recallFull).toBe(false);
      expect(timeline[5]?.hidden).toBeGreaterThan(0);
    }
  });
});
