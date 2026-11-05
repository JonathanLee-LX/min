/**
 * Alternate screen buffer (DECSET 1049).
 *
 * The TUI already owns scrolling (viewport slice + wheel / PageUp).
 * Painting on the primary screen makes Ink's fullscreen path emit
 * ED2 (`CSI 2J`) on every frame, which web terminals flash. Alt-screen
 * keeps CUP (1,1) at the top of the UI and leaves the user's scrollback
 * alone, matching Pi / OpenCode / Neovim.
 */

export const ALT_SCREEN_ENTER = "\x1b[?1049h";
export const ALT_SCREEN_LEAVE = "\x1b[?1049l";

export function enterAltScreen(
  stream: NodeJS.WriteStream = process.stdout,
): () => void {
  if (!stream.isTTY) return () => {};
  stream.write(ALT_SCREEN_ENTER);
  let left = false;
  return () => {
    if (left) return;
    left = true;
    try {
      stream.write(ALT_SCREEN_LEAVE);
    } catch {
      /* exiting */
    }
  };
}
