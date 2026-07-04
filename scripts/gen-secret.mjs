// Generate a random publisher secret and copy it to the clipboard WITHOUT
// printing it (prints it only if no clipboard tool is available). Zero deps.
import { randomBytes } from "node:crypto";
import { copyToClipboard } from "./clip.mjs";

const secret = randomBytes(32).toString("hex");

if (await copyToClipboard(secret)) {
  console.log("✓ Generated a 64-character secret and copied it to your clipboard (not shown here).");
  console.log(
    "  Paste it as the value of the PAGEDROP_PUBLISH_SECRET Script Property, and again into .mcp.json.",
  );
} else {
  console.log("No clipboard tool found. Here is your secret — copy it now and keep it safe:\n");
  console.log(secret);
}
