/** Only final wire instruction files are forwarded, never reconstructed from disk. */
import assert from "node:assert/strict";
import { mcpInstructions, openCodeInstructionFiles } from "../src/opencode-context.ts";

const system = (blocks: string[]) => [{ role: "system", content: blocks.join("\n\n") }];
const block = (path: string, text: string) => `Instructions from: ${path}\n${text}`;
const files = [
  block("/project/AGENTS.md", "Project rules."),
  block("/project/CLAUDE.md", "Claude rules."),
  block("/home/user/.claude/CLAUDE.md", "Global rules."),
  block("/project/imported.md", "Imported rules."),
];
assert.equal(openCodeInstructionFiles(system(files)), files.join("\n\n"));
assert.equal(openCodeInstructionFiles(system(["No files on the wire."])), "");
const replaced = block("/project/CLAUDE.md", "Plugin replacement.");
assert.equal(openCodeInstructionFiles(system([replaced])), replaced);
const mcp = '<mcp_instructions>\n  <server name="linear">\n    Use tools.\n  </server>\n</mcp_instructions>';
assert.equal(mcpInstructions(system(["# Code Mode", mcp, "Today's date: x"])), mcp);
assert.equal(mcpInstructions(system(["Today's date: x"])), "");
console.log("instruction files regression ok");
