import type { ITerminalOptions } from "@xterm/xterm";

/** 与虚拟机 SSH 终端一致：深色背景、绿色光标、足够滚动缓冲 */
export const kubeBtXtermOptions: ITerminalOptions = {
  cursorBlink: true,
  scrollback: 800,
  fontFamily: "SF Mono, ui-monospace, Menlo, Monaco, Consolas, monospace",
  fontSize: 13,
  theme: {
    background: "#1e1e1e",
    foreground: "#e8e8e8",
    cursor: "#22c55e",
    cursorAccent: "#1e1e1e",
    selectionBackground: "#22c55e80",
  },
};
