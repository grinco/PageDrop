// Copy text (or a file's contents) to the OS clipboard, with a print fallback
// when no clipboard tool is available. Zero dependencies.
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { platform } from "node:os";

/** Candidate clipboard commands per platform, tried in order. */
function clipboardCommands() {
  switch (platform()) {
    case "darwin":
      return [["pbcopy"]];
    case "win32":
      return [["clip"]];
    default:
      // Linux/BSD: Wayland first, then X11 options.
      return [
        ["wl-copy"],
        ["xclip", "-selection", "clipboard"],
        ["xsel", "--clipboard", "--input"],
      ];
  }
}

function tryCopy([cmd, ...args], text) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { stdio: ["pipe", "ignore", "ignore"] });
    } catch {
      resolve(false);
      return;
    }
    child.on("error", () => resolve(false));
    child.on("close", (code) => resolve(code === 0));
    child.stdin.on("error", () => resolve(false));
    child.stdin.end(text);
  });
}

/** Copy text to the clipboard; resolves true on success, false if no tool worked. */
export async function copyToClipboard(text) {
  for (const command of clipboardCommands()) {
    if (await tryCopy(command, text)) return true;
  }
  return false;
}

// Run directly: `node scripts/clip.mjs <file>`
if (import.meta.url === `file://${process.argv[1]}`) {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: node scripts/clip.mjs <file>");
    process.exit(1);
  }
  const content = await readFile(file, "utf8");
  const lines = content.split("\n").length;
  if (await copyToClipboard(content)) {
    console.log(`✓ Copied ${file} (${lines} lines) to your clipboard.`);
    console.log(
      "  Now paste it into the Apps Script editor: click inside Code.gs, select all (Ctrl/Cmd+A), then paste.",
    );
  } else {
    console.log(
      `No clipboard tool found, so here are the contents of ${file} to copy manually:\n`,
    );
    console.log(content);
  }
}
