/** Final provider payloads, not hook redispatch: arbitrary plugins, no inference. */
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { forwardedSystemInstructions } from "../src/opencode-context.ts";
import { OPENCODE_2_2_3_BUILD_PROMPT } from "../src/opencode-stock.ts";
import type { StartClaudeQueryParams } from "../src/query.ts";
import { assert, bashTool, callTool, mcpExtra, mcpHandlers, mockHandle, startMockedProxy, textDelta } from "./helpers.ts";

const { tmp, post, proxy } = await startMockedProxy("transformed-context");
const configDir = join(tmp, "claude");
const cwd = join(tmp, "project");
mkdirSync(configDir);
mkdirSync(cwd);
const system = (text: string) => ({ role: "system", content: text });
const user = { role: "user", content: "Fixture user request." };
const forward = (blocks: string[], native = true) => forwardedSystemInstructions(blocks.map(system), cwd, configDir, native);

const original = "First plugin contribution.";
const added = "Unknown instructions without a recognized heading.";
const replaced = "Whole replacement: follow only these current instructions.";
const markers = ["SSD_FOUNDATION_MARKER", "SSD_INTENT_MARKER", "SSD_MEMORY_MARKER"];
const skills = "Skills provide specialized instructions and workflows for specific tasks.\n<available_skills>fixture-skill</available_skills>";
const catalogs = "# Code Mode\n\n## Code Mode tools (call only inside `execute`)\n\n- fixture (1 tool)\n  - tools.fixture.read(): Promise<string>";
const mcp = "<mcp_instructions>Fixture MCP guidance.</mcp_instructions>";
const cases = [
  [original, added],
  [replaced],
  [],
  ["You are OpenCode, but a plugin replaced this entire stock-like block."],
  ["You are an AI agent running in OpenCode, a coding agent harness.\nPLUGIN_EDIT\n# Your Model\nPlugin-edited identity"],
  ["# Your Model\nPlugin identity replacement", "# Environment\nPLUGIN_ENVIRONMENT"],
  ["Custom reviewer role with no identity heading", catalogs, skills, mcp, ...markers],
];
for (const blocks of cases) assert.equal(forward(blocks), blocks.join("\n\n"));
assert.equal(forward([OPENCODE_2_2_3_BUILD_PROMPT, added]), added);
assert.equal(forward([`${OPENCODE_2_2_3_BUILD_PROMPT}\nPlugin edit`]), `${OPENCODE_2_2_3_BUILD_PROMPT}\nPlugin edit`);
const debug = process.env.OPENCODE_CLAUDE_DEBUG;
const stderr = console.error;
const diagnostics: string[] = [];
try {
  process.env.OPENCODE_CLAUDE_DEBUG = "1";
  console.error = (...args) => diagnostics.push(args.join(" "));
  forward(["You are OpenCode. STOCK_PLUGIN_SECRET"]);
} finally {
  console.error = stderr;
  if (debug === undefined) delete process.env.OPENCODE_CLAUDE_DEBUG;
  else process.env.OPENCODE_CLAUDE_DEBUG = debug;
}
assert.match(diagnostics.join("\n"), /unmatched leading stock-like.*systemBlockCount.*leadingCharacters/);
assert.doesNotMatch(diagnostics.join("\n"), /STOCK_PLUGIN_SECRET/);
assert.equal(forwardedSystemInstructions([{ role: "system", content: [{ type: "text", text: original }, { type: "text", text: added }] }, user], cwd, configDir), `${original}\n${added}`);

const nativeText = "Native rules shared with Claude Code.";
writeFileSync(join(cwd, "CLAUDE.md"), `${nativeText}\n`);
const instruction = (text: string) => `Instructions from: ${join(cwd, "CLAUDE.md")}\n${text}`;
assert.equal(forward([instruction(nativeText)]), "");
assert.equal(forward([instruction(`${nativeText}\nPlugin addition`)]), instruction(`${nativeText}\nPlugin addition`));
assert.equal(forward([instruction("Plugin replacement")]), instruction("Plugin replacement"));
assert.equal(forward([instruction(nativeText)], false), instruction(nativeText), "utilities load no native files");
// Identical first 200 characters or path must not hide an edited suffix.
const long = "x".repeat(250);
writeFileSync(join(cwd, "CLAUDE.md"), `${long}\n`);
assert.equal(forward([instruction(`${long}\nEdited tail`)]), instruction(`${long}\nEdited tail`));
writeFileSync(join(cwd, "CLAUDE.md"), "Changed on disk since dispatch");
assert.equal(forward([instruction(long)]), instruction(long), "disk does not reconstruct stale text");
writeFileSync(join(cwd, "AGENTS.md"), "Not native when CLAUDE.md exists");
const agents = `Instructions from: ${join(cwd, "AGENTS.md")}\nNot native when CLAUDE.md exists`;
assert.equal(forward([agents]), agents);
assert.equal(forward(["Removed instruction file"]), "Removed instruction file", "no instructions revived from disk");

const seen: StartClaudeQueryParams[] = [];
proxy.setClaudeQueryStarter(async (params) => {
  seen.push(params);
  return mockHandle((async function* () { yield textDelta("Fixture response"); yield { type: "result", is_error: false, usage: {} }; })());
});
const dispatch = async (session: string, body: Record<string, unknown>) => {
  const response = await post(session, body);
  assert.equal(response.status, 200);
  await response.text();
  return seen.at(-1)!;
};
try {
  for (const [index, blocks] of cases.entries()) {
    const params = await dispatch("plugins", { tools: [bashTool], messages: [...blocks.map(system), user] });
    assert.equal(typeof params.systemPrompt, "object");
    const prompt = params.systemPrompt as { preset: string; append: string };
    assert.equal(prompt.preset, "claude_code");
    if (blocks.length) assert.ok(prompt.append.includes(blocks.join("\n\n")), "ordered final blocks reach the append unchanged");
    if (index > 0) assert.ok(!prompt.append.includes(original), "replacement/removal does not revive the preceding query's instructions");
    for (const marker of [...markers, skills, catalogs, mcp]) {
      assert.equal(prompt.append.split(marker).length - 1, blocks.includes(marker) ? 1 : 0, "no selective extraction duplicates");
    }
    assert.deepEqual(params.tools, []);
    assert.deepEqual(params.allowedTools, ["mcp__opencode__bash"]);
    assert.equal(params.toolAliases?.write, undefined);
    const listed = await mcpHandlers(params).get("tools/list")!({ method: "tools/list", params: {} }, mcpExtra);
    assert.deepEqual(listed.tools.map((tool: any) => tool.name), ["bash"]);
    const removed = await callTool(params, "write", {});
    assert.equal((removed as any).isError, true, "a hook-removed tool cannot be admitted");
  }

  const fixture = JSON.parse(readFileSync(new URL("./fixtures/opencode-2.2.3-dispatch.json", import.meta.url), "utf8"));
  assert.equal(fixture.version, "2.2.3");
  const chat = fixture.requests.find((r: any) => r.kind === "primary");
  assert.ok(chat);
  // OpenCode flattens parts into one string, including hook text, without
  // instruction provenance. Exact standalone stock matching cannot strip it.
  assert.ok(chat.body.messages[0].content.startsWith(OPENCODE_2_2_3_BUILD_PROMPT));
  for (const [index, request] of fixture.requests.entries()) {
    const { kind, body } = request;
    assert.ok(["primary", "title", "generate", "compaction", null].includes(kind));
    assert.ok(!body.tools?.some((tool: any) => tool.function.name === "write"));
    // Supplying the header is the provider plugin's model.request contract.
    const response = await fetch(`http://127.0.0.1:${(await proxy.startProxy())}/v1/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(kind ? { "x-opencode-claude-session": `capture-${index}`, "x-opencode-claude-kind": kind } : {}) },
      body: JSON.stringify({ ...body, model: "sonnet", stream: false }),
    });
    assert.equal(response.status, 200);
    await response.text();
    const params = seen.at(-1)!;
    const forwarded = forwardedSystemInstructions(body.messages, cwd, configDir, false);
    const sdkSystem = typeof params.systemPrompt === "string" ? params.systemPrompt : params.systemPrompt?.append ?? "";
    assert.ok(sdkSystem.includes(forwarded), `real ${kind} system payload preserved`);
    if (kind !== "primary") {
      assert.deepEqual(params.tools, []);
      assert.equal(params.allowedTools, undefined);
      assert.equal(params.mcpServers, undefined);
      assert.equal(params.maxTurns, 1);
    }
  }
  assert.equal(seen.length, cases.length + fixture.requests.length, "each payload creates one SDK query; no OpenCode callbacks exist in this test");
  console.log("transformed context regression ok");
} finally {
  await proxy.stopProxy();
}
