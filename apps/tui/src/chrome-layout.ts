/**
 * Vertical budget for the pinned composer.
 * The command list, session picker, and model picker are `suggestRows` above the composer.
 * They take space from the transcript, so the composer stays on the same row
 * as long as the transcript still has a row to give up.
 */
export function composerFrameRows(input: {
  paintRows: number;
  activityRows: number;
  permBlockRows: number;
  inputRows: number;
  suggestRows: number;
  bottomStatusRows: number;
}): { logHeight: number; rowsAboveComposer: number; rowsBelowComposer: number } {
  const composerBorderRows = 2;
  const reserved =
    input.activityRows +
    input.permBlockRows +
    composerBorderRows +
    input.inputRows +
    input.suggestRows +
    input.bottomStatusRows;
  const logHeight = Math.max(1, input.paintRows - reserved);
  return {
    logHeight,
    rowsAboveComposer:
      logHeight + input.activityRows + input.permBlockRows + input.suggestRows + 1,
    rowsBelowComposer: 1 + input.bottomStatusRows,
  };
}
