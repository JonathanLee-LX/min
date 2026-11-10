import { describe, expect, it, vi } from "vitest";
import { hasStaged, resolveTurnSubmit, stageBytes, takeStaged } from "./staging.js";

const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0, 0, 0, 0,
]);

describe("attachment staging", () => {
  it("stages bytes and returns an id without writing the session store", () => {
    const staged = stageBytes({ filename: "shot.png", bytes: PNG });
    expect(staged.id).toMatch(/^stg_/);
    expect(staged.filename).toBe("shot.png");
    expect(staged.mediaType).toBe("image/png");
    expect(staged.byteLength).toBe(PNG.byteLength);
    expect(hasStaged(staged.id)).toBe(true);
  });

  it("submit consumes staged ids then deletes the staging files", () => {
    const staged = stageBytes({ filename: "shot.png", bytes: PNG });
    const result = resolveTurnSubmit({
      text: "look",
      attachmentIds: [staged.id],
      busy: false,
    });
    expect(result.type).toBe("send");
    if (result.type !== "send") return;
    expect(result.attachments[0]?.filename).toBe("shot.png");
    expect(result.attachments[0]?.bytes).toEqual(PNG);
    expect(hasStaged(staged.id)).toBe(false);
  });

  it("submit with unknown attachmentIds fails before send", () => {
    expect(() => takeStaged(["stg_missing"])).toThrow(/unknown attachment/);
    const send = vi.fn();
    const result = resolveTurnSubmit({
      text: "look",
      attachmentIds: ["stg_missing"],
      busy: false,
    });
    expect(result).toMatchObject({ type: "unknown", error: expect.stringMatching(/unknown attachment/) });
    expect(send).not.toHaveBeenCalled();
  });

  it("does not queue staged attachments while busy", () => {
    const staged = stageBytes({ filename: "shot.png", bytes: PNG });
    const queued: string[] = [];
    const result = resolveTurnSubmit({
      text: "look",
      attachmentIds: [staged.id],
      busy: true,
    });
    expect(result).toEqual({ type: "reject", reason: "attachments-while-busy" });
    expect(hasStaged(staged.id)).toBe(true);
    const plain = resolveTurnSubmit({
      text: "follow-up",
      attachmentIds: [],
      busy: true,
    });
    expect(plain).toEqual({ type: "queue", text: "follow-up" });
    if (plain.type === "queue") queued.push(plain.text);
    expect(queued).toEqual(["follow-up"]);
  });
});
