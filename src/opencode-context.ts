/** Preserve OpenCode's final system text; native settings loading is disabled. */
import { metaSystemPrompt } from "./request-kind.js";
import { extractTextContent } from "./prompt.js";
import { log } from "./log.js";
import { OPENCODE_2_2_3_BUILD_PROMPT } from "./opencode-stock.js";

type MessageLike = { role?: string; content?: unknown };
const INSTRUCTIONS_FROM = /^Instructions from: (.+?)[\t ]*\r?$/gm;

/** Instruction-file view for callers that need just those wire sections. */
export function openCodeInstructionFiles(messages: MessageLike[]): string {
  const system = metaSystemPrompt(messages);
  const headings = [...system.matchAll(INSTRUCTIONS_FROM)];
  return headings.map((heading, i) =>
    system.slice(heading.index!, headings[i + 1]?.index ?? system.length).trim(),
  ).join("\n\n");
}

/**
 * No provenance survives OpenAI lowering. Unknown/edited stock-like text stays
 * whole, including catalogs and custom roles; extracting them again duplicates it.
 * OpenCode owns instruction files; never reconstruct or deduplicate them from disk.
 */
export function forwardedSystemInstructions(messages: MessageLike[]): string {
  const blocks = messages.filter((m) => m.role === "system").map((m) => extractTextContent(m.content));
  if (blocks[0] !== OPENCODE_2_2_3_BUILD_PROMPT && /^\s*You are (?:an AI agent running in OpenCode|OpenCode|opencode)\b/.test(blocks[0] ?? "")) {
    log.info("[opencode-claude] preserving unmatched leading stock-like system block", {
      systemBlockCount: blocks.length,
      leadingCharacters: blocks[0]!.length,
    });
  }
  return blocks.filter((block) => block && block !== OPENCODE_2_2_3_BUILD_PROMPT).join("\n\n");
}

/** OpenCode's `<mcp_instructions>` block: what MCP servers say about their tools. */
export function mcpInstructions(messages: MessageLike[]): string {
  const system = metaSystemPrompt(messages);
  const start = system.indexOf("<mcp_instructions>");
  if (start < 0) return "";
  const end = system.indexOf("</mcp_instructions>", start);
  if (end < 0) return "";
  return system.slice(start, end + "</mcp_instructions>".length).trim();
}

const CONTEXT_BLOCK = /<context key="[^"\n]+">\n[\s\S]*?\n<\/context>/g;

/** Index of the first message after OpenCode's leading system prompt. */
function leadingSystemEnd(messages: MessageLike[]): number {
  let i = 0;
  while (i < messages.length && messages[i]?.role === "system") i++;
  return i;
}

/**
 * Session context entries from OpenCode's session instructions API. Later
 * keyed changes arrive separately as `<system-update>` user messages.
 */
export function sessionContextBlocks(messages: MessageLike[]): string {
  const system = metaSystemPrompt(messages.slice(0, leadingSystemEnd(messages)));
  return [...system.matchAll(CONTEXT_BLOCK)].map((m) => m[0]).join("\n\n");
}
