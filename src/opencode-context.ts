/** Preserve OpenCode's final system text; only exact native-loaded files deduplicate. */
import { readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, parse } from "node:path";
import { claudeConfigDir } from "./config-dir.js";
import { metaSystemPrompt } from "./request-kind.js";
import { extractTextContent } from "./prompt.js";
import { log } from "./log.js";
import { OPENCODE_2_2_3_BUILD_PROMPT } from "./opencode-stock.js";

type MessageLike = { role?: string; content?: unknown };

const INSTRUCTIONS_FROM = /^Instructions from: (.+?)[\t ]*\r?$/gm;

function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function realPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/** Directories Claude Code searches for project instruction files: cwd and its parents. */
function projectDirs(cwd: string): Set<string> {
  const dirs = new Set<string>();
  let dir = realPath(cwd);
  for (;;) {
    dirs.add(dir);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return dirs;
}

/** CLAUDE.md files Claude Code loads itself for this working directory. */
function claudeMdFiles(cwd: string, configDir?: string): string[] {
  const files = [join(claudeConfigDir(configDir), "CLAUDE.md")];
  let dir = cwd;
  const { root } = parse(cwd);
  for (;;) {
    files.push(join(dir, "CLAUDE.md"), join(dir, "CLAUDE.local.md"), join(dir, ".claude", "CLAUDE.md"));
    if (dir === root) break;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return files;
}

/** Claude Code follows `@path` imports from a CLAUDE.md up to four hops deep. */
const IMPORT_DEPTH = 4;
/** An `@path` import: at the start of a line or after whitespace, `\ ` keeps a space. */
const IMPORT = /(?<=^|\s)@((?:\\ |\S)+)/g;

/** Text without Markdown code spans and fenced blocks, where imports aren't parsed. */
function stripCode(text: string): string {
  return text.replace(/```[\s\S]*?(?:```|$)/g, "").replace(/`[^`\n]*`/g, "");
}

/** Files a CLAUDE.md imports: `~/` is the home directory, relative paths are from the file. */
function importsOf(file: string, text: string): string[] {
  const out: string[] = [];
  for (const match of stripCode(text).matchAll(IMPORT)) {
    let target = match[1]!.replace(/\\ /g, " ");
    if (target === "~" || target.startsWith("~/") || target.startsWith("~\\")) {
      target = join(homedir(), target.slice(1));
    }
    out.push(isAbsolute(target) ? target : join(dirname(file), target));
  }
  return out;
}

/**
 * The CLAUDE.md files plus everything their `@path` imports pull in, the way
 * Claude Code expands them (nested, at most IMPORT_DEPTH hops, each file once).
 */
function withImports(files: string[]): string[] {
  const out = [...files];
  const seen = new Set(files.map(realPath));
  const walk = (file: string, depth: number) => {
    if (depth > IMPORT_DEPTH) return;
    const text = readText(file);
    if (!text) return;
    for (const target of importsOf(file, text)) {
      const real = realPath(target);
      if (seen.has(real)) continue;
      seen.add(real);
      out.push(target);
      walk(target, depth + 1);
    }
  };
  for (const file of files) walk(file, 1);
  return out;
}

function nativeInstructionTexts(cwd: string, configDir?: string): Set<string> {
  const loaded = withImports(claudeMdFiles(cwd, configDir));
  // AGENTS.md is native only where no CLAUDE.md takes its place.
  for (const dir of projectDirs(cwd)) {
    for (const candidate of [dir, join(dir, ".claude")]) {
      if (readText(join(candidate, "CLAUDE.md")) === null) {
        loaded.push(join(candidate, "AGENTS.md"));
      }
    }
  }
  return new Set(
    loaded.map((file) => readText(file)?.trim()).filter((text): text is string => !!text),
  );
}

/** Boundaries come from the wire, never from a prefix match against disk text. */
function instructionSections(system: string): Array<{ start: number; end: number; text: string }> {
  const headings = [...system.matchAll(INSTRUCTIONS_FROM)];
  return headings.map((heading, i) => {
    const start = heading.index!;
    const end = headings[i + 1]?.index ?? system.length;
    return { start, end, text: system.slice(start + heading[0].length, end).trim() };
  });
}

/** Instruction-file view for callers that need just those sections. */
export function openCodeInstructionFiles(messages: MessageLike[], cwd: string, configDir?: string): string {
  const native = nativeInstructionTexts(cwd, configDir);
  const system = metaSystemPrompt(messages);
  return instructionSections(system)
    .filter((section) => !native.has(section.text))
    .map(({ start, end }) => system.slice(start, end).trim())
    .join("\n\n");
}

/**
 * No provenance survives OpenAI lowering. Unknown/edited stock-like text stays
 * whole, including catalogs and custom roles; extracting them again duplicates it.
 * Utility queries disable native settings, so they deduplicate no files.
 */
export function forwardedSystemInstructions(
  messages: MessageLike[],
  cwd: string,
  configDir?: string,
  nativeFiles = true,
): string {
  const native = nativeFiles ? nativeInstructionTexts(cwd, configDir) : new Set<string>();
  const blocks = messages.filter((m) => m.role === "system").map((m) => extractTextContent(m.content));
  if (blocks[0] !== OPENCODE_2_2_3_BUILD_PROMPT && /^\s*You are (?:an AI agent running in OpenCode|OpenCode|opencode)\b/.test(blocks[0] ?? "")) {
    // Content-free drift diagnostic: no headings/prefixes authorize stripping.
    log.info("[opencode-claude] preserving unmatched leading stock-like system block", {
      systemBlockCount: blocks.length,
      leadingCharacters: blocks[0]!.length,
    });
  }
  return blocks.map((block) => {
    if (block === OPENCODE_2_2_3_BUILD_PROMPT) return "";
    let end = block.length;
    let result = "";
    for (const section of instructionSections(block).reverse()) {
      if (!native.has(section.text)) continue;
      result = block.slice(section.end, end) + result;
      end = section.start;
    }
    return block.slice(0, end) + result;
  }).filter(Boolean).join("\n\n");
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
 * Session context entries a host attached through OpenCode's session
 * instructions API (OpenChamber's guidance, pinned notes, memory, checkout),
 * as OpenCode renders them into its system prompt: `<context key="…">`
 * blocks. Only their values as of the session start (or its last compaction)
 * sit there. Later changes reach the proxy as `<system-update>` user text,
 * which Claude already gets with the next prompt.
 */
export function sessionContextBlocks(messages: MessageLike[]): string {
  const system = metaSystemPrompt(messages.slice(0, leadingSystemEnd(messages)));
  return [...system.matchAll(CONTEXT_BLOCK)].map((m) => m[0]).join("\n\n");
}
