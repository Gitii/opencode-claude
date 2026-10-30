/** Current transformed instructions/tools must precede the next model step. */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { StartClaudeQueryParams } from "../src/query.ts";
import { assert, bashTool, callTool, interruptibleTurn, mcpExtra, mcpHandlers, mockHandle, startMockedProxy, textDelta } from "./helpers.ts";

const keepAlive = setInterval(() => {}, 1000);
const { tmp, post, proxy } = await startMockedProxy("parked-context");
process.env.CLAUDE_CONFIG_DIR = join(tmp, "claude");
const project = join(process.env.CLAUDE_CONFIG_DIR, "projects", "fixture");
mkdirSync(project, { recursive: true });
const { getSessionLeafUuid } = await import("../src/session-store.ts");
const { findBridgeByConversation } = await import("../src/bridge-pool.ts");
const readTool = { ...bashTool, function: { ...bashTool.function, name: "read" } };
const sys = (content: string) => ({ role: "system", content });
const user = { role: "user", content: "Run the fixture tools." };
const tools = [bashTool, readTool];

try {
  for (const [index, after] of [["added", "FIRST\n\nADDED"], ["replaced", "REPLACEMENT"], ["removed", ""], ["tool-only", "FIRST"], ["late", "LATE_REPLACEMENT"], ["system-only", "SYSTEM_ONLY_REPLACEMENT"]] as const) {
    const key = `chat-${index}`;
    const session = `session-${index}`;
    writeFileSync(join(project, `${session}.jsonl`), [
      JSON.stringify({ uuid: `${index}-use` }),
      JSON.stringify({ uuid: `${index}-reject`, parentUuid: `${index}-use` }),
      JSON.stringify({ uuid: `${index}-marker`, parentUuid: `${index}-reject` }), "",
    ].join("\n"));
    const log: string[] = [];
    const seen: StartClaudeQueryParams[] = [];
    let resolved = 0;
    proxy.setClaudeQueryStarter(async (params) => {
      seen.push(params);
      if (seen.length > 1) return mockHandle((async function* () {
        yield textDelta("continued"); yield { type: "result", is_error: false, usage: {} };
      })());
      return interruptibleTurn(log, index, async function* () {
        yield { type: "system", subtype: "init", session_id: session };
        yield { type: "assistant", uuid: `${index}-use`, session_id: session, parent_tool_use_id: null, message: { content: [] } };
        for (const name of ["bash", "read"]) {
          callTool(params, name, {}).then((result) => { if (!(result as any).isError) resolved++; }, () => {});
        }
        await new Promise(() => {});
      }, { sessionId: session });
    });
    const first = await post(key, { tools, messages: [sys("FIRST"), user] });
    const initial = await first.json() as any;
    const calls = initial.choices[0].message.tool_calls;
    assert.equal(calls.length, 2);
    const step = { role: "assistant", content: null, tool_calls: calls };
    const result = (n: number) => ({ role: "tool", tool_call_id: calls[n].id, content: `EXACT_RESULT_${n}` });
    const messages = [sys(after), user, step];
    const updatedTools = index === "system-only" ? tools : [readTool];
    const partial = await post(key, { tools: index === "late" ? tools : updatedTools,
      messages: index === "late" ? [sys("FIRST"), user, step, result(0)] : [...messages, result(0)] });
    const partialBody = await partial.json() as any;
    assert.equal(partialBody.choices[0].message.tool_calls.length, 1, "completed calls are not re-emitted");
    assert.equal(seen.length, 1, "wait for all admitted calls, without starting a model step");
    assert.equal(resolved, 0, "obsolete query never receives completed results");
    if (index !== "late" && index !== "system-only") {
      const rejected = await callTool(seen[0]!, "bash", {});
      assert.equal((rejected as any).isError, true, "old registration cannot admit a removed tool");
      const list = await mcpHandlers(seen[0]!).get("tools/list")!({ method: "tools/list", params: {} }, mcpExtra);
      assert.deepEqual(list.tools.map((t: any) => t.name), ["read"]);
    }
    const complete = await post(key, { tools: updatedTools, messages: [...messages, result(0), result(1)] });
    assert.equal(complete.status, 200);
    await complete.text();
    assert.equal(seen.length, 2);
    for (const params of seen) {
      assert.deepEqual(params.settingSources, [], "initial and resumed queries suppress ambient files");
      assert.deepEqual(params.skills, [], "only OpenCode's current skill catalog is authoritative");
      assert.deepEqual(params.tools, [], "built-ins remain disabled");
      assert.equal(params.env?.CLAUDE_CODE_DISABLE_AUTO_MEMORY, "1");
    }
    assert.deepEqual(log, [`${index}:interrupt`, `${index}:close`]);
    assert.equal(seen[1]!.resume, session);
    assert.equal(getSessionLeafUuid(key), `${index}-marker`, "resume follows drained interruption leaf");
    const system = seen[1]!.systemPrompt as { preset: string; append: string };
    assert.equal(system.preset, "claude_code");
    if (after) assert.ok(system.append.includes(after));
    if (index !== "added" && index !== "tool-only") assert.ok(!system.append.includes("FIRST"));
    assert.deepEqual(seen[1]!.allowedTools, updatedTools.map((tool) => `mcp__opencode__${tool.function.name}`));
    // The rebuilt prompt relays each completed result once, never as system state.
    const prompt = seen[1]!.prompt as AsyncIterable<unknown>;
    const input = await prompt[Symbol.asyncIterator]().next();
    const text = JSON.stringify(input.value);
    for (let n = 0; n < 2; n++) assert.equal(text.split(`EXACT_RESULT_${n}`).length - 1, 1);
    assert.ok(!text.includes("REPLACEMENT"));
    assert.equal(resolved, 0);
  }

  let starts = 0;
  proxy.setClaudeQueryStarter(async (params) => {
    starts++;
    return mockHandle((async function* () {
      await callTool(params, "bash", {});
      yield textDelta("same query"); yield { type: "result", is_error: false, usage: {} };
    })());
  });
  const first = await post("unchanged", { tools, messages: [sys("SAME"), user] });
  const calls = (await first.json() as any).choices[0].message.tool_calls;
  const continued = await post("unchanged", { tools: [...tools].reverse(), messages: [sys("SAME"), user,
    { role: "assistant", tool_calls: calls }, { role: "tool", tool_call_id: calls[0].id, content: "done" }] });
  assert.equal((await continued.json() as any).choices[0].message.content, "same query");
  assert.equal(starts, 1, "identical effective state does not restart, even with reordered tools");
  assert.equal(findBridgeByConversation("unchanged"), undefined);
  console.log("parked context regression ok");
} finally {
  await proxy.stopProxy();
  clearInterval(keepAlive);
}
