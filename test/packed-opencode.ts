/** Manual integration: OPENCODE_BIN=... PACKED_PREFIX=... bun test/packed-opencode.ts.
 * Uses installed tarballs, a real isolated OpenCode server, and a fake SDK turn.
 */
import assert from "node:assert/strict";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { runExtended } from "./packed-extended.ts";

const binary = process.env.OPENCODE_BIN ?? "opencode";
const prefix = resolve(process.env.PACKED_PREFIX!);
const live = process.env.PACKED_LIVE === "1";
const realHome = process.env.PACKED_REAL_HOME === "1";
const extended = process.env.PACKED_EXTENDED === "1";
assert.ok(
  !(realHome && process.env.PACKED_VALIDATE === "1"),
  "Validation mutations require an isolated HOME",
);
const model =
  process.env.PACKED_MODEL ??
  (live ? "claude-opus-5-5" : "claude-haiku-4-5-20251001");
const globalText = `export default { agents: { families: { general: { medium: { usage: "Fixture agent", models: [{ model: "claude-code/claude-opus-5-5", variant: "medium" }] } } }, explicitModelMode: "auto", explicitModelAutoModePatterns: [{ match: /^claude-code\\/claude-opus-5-5$/, variants: ["medium"] }] } };`;
const fork = join(prefix, "node_modules/@gitii/opencode-claude");
assert.ok(
  !readFileSync(join(prefix, "package-lock.json"), "utf8").includes(
    '"link": true',
  ),
);
const root = mkdtempSync("/tmp/opencode/t5-dispatch-");
const project = join(root, "project");
const trace = join(root, "trace.jsonl");
const state = join(root, "state.json");
mkdirSync(project);
writeFileSync(state, JSON.stringify({ marker: "INITIAL", tool: false }));
const env: NodeJS.ProcessEnv = {
  ...process.env,
  HOME: realHome ? process.env.HOME : join(root, "home"),
  CLAUDE_CONFIG_DIR: "/home/germinii/.claude",
  OPENCODE_PASSWORD: "fixture-local-only",
  OPENCODE_CLAUDE_STOP_GRACE_MS: live ? "2000" : "50",
};
for (const name of ["CONFIG", "DATA", "STATE", "CACHE"]) {
  env[`XDG_${name}_HOME`] = join(root, name.toLowerCase());
  mkdirSync(env[`XDG_${name}_HOME`]!);
}
if (!realHome) mkdirSync(env.HOME);
const config = join(env.XDG_CONFIG_HOME!, "opencode");
mkdirSync(config);
const plugin = join(root, "fixture");
mkdirSync(plugin);
writeFileSync(
  join(plugin, "index.ts"),
  `
import { readFileSync, appendFileSync, writeFileSync } from "node:fs";
import { setClaudeQueryStarter } from ${JSON.stringify(join(fork, "dist/proxy.js"))};
import { startClaudeQuery } from ${JSON.stringify(join(fork, "dist/query.js"))};
const record = (data) => appendFileSync(${JSON.stringify(trace)}, JSON.stringify(data) + "\\n");
const state = () => JSON.parse(readFileSync(${JSON.stringify(state)}, "utf8"));
const admitted = new Set();
setClaudeQueryStarter(async (params) => {
  const append = typeof params.systemPrompt === "string" ? params.systemPrompt : params.systemPrompt?.append ?? "";
  const current = state();
  const primary = typeof params.systemPrompt === "object";
  record({ type: "query", marker: current.marker, primary, model: params.model, effort: params.effort, append, tools: params.allowedTools, resume: params.resume, promptType: typeof params.prompt, maxTurns: params.maxTurns, persistSession: params.persistSession, isolateMcp: params.isolateMcp, mcpServers: Object.keys(params.mcpServers ?? {}) });
  if (${live}) return startClaudeQuery(params);
  const input = typeof params.prompt === "string" ? params.prompt : (await params.prompt[Symbol.asyncIterator]().next()).value;
  record({ type: "query-input", marker: current.marker, text: JSON.stringify(input).slice(-8000) });
  let stop;
  const interrupted = new Promise(resolve => stop = resolve);
  async function* run() {
    if (!primary && current.marker === "BG" && append.includes("PACKED_COMPACTION_BG")) {
      record({ type: "summary-held", marker: current.marker });
      while (!state().releaseBG) await Bun.sleep(10);
      record({ type: "summary-released", marker: current.marker });
    }
    if (primary) yield { type: "system", subtype: "init", session_id: params.resume ?? crypto.randomUUID() };
    if (primary && current.marker === "SUBSTITUTION") yield { type: "system", subtype: "model_refusal_fallback", scope: "session", original_model: params.model, fallback_model: "claude-opus-5-5", api_refusal_category: "fixture" };
    if (primary && current.marker === "INTERRUPT") {
      yield { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: "BEFORE_INTERRUPT" } } };
      await new Promise(() => {});
    }
    if (state().marker === "RATE_LIMIT") {
      yield { type: "result", subtype: "error_during_execution", is_error: true, errors: ["API Error: 400 You're out of extra usage. Add more at claude.ai/settings/usage and keep going."] };
      return;
    }
    if (current.tool && params.mcpServers && !admitted.has(current.marker)) {
      admitted.add(current.marker);
      const handlers = params.mcpServers.opencode.instance.server._requestHandlers;
      const result = await handlers.get("tools/call")({ method: "tools/call", params: { name: state().toolName ?? "read", arguments: state().args ?? { path: ${JSON.stringify(join(project, "probe.txt"))} } } }, { signal: new AbortController().signal, sendNotification: async () => {}, sendRequest: async () => {} });
      record({ type: "tool-result", result });
    }
    const summary = ["## Objective", "- Complete the isolated fixture.", "## Requirements", "- Preserve fixture instructions.", "## Decisions", "- Use packed artifacts.", "## Work State", "### Completed", "- Prior fixture tools completed.", "### Active", "- Continue the fixture.", "### Blocked", "- (none)", "## Next Move", "1. Continue the fixture.", "## Relevant Files", "- (none)", "## Important Context", "- PACKED_SUMMARY"].join("\\n");
    const text = !primary && append.includes("PACKED_COMPACTION_") ? summary : current.reply ?? "Fixture response";
    yield { type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text } } };
    yield { type: "result", is_error: false, usage: primary ? (current.usage ?? {}) : {} };
  }
  const inner = run();
  const stream = (async function* () { while (true) { const next = await Promise.race([inner.next(), interrupted.then(() => ({ done: true }))]); if (next.done) return; yield next.value; } })();
  return { stream, interrupt: async () => { record({ type: "interrupted", marker: current.marker }); stop(); }, close() { record({ type: "closed", marker: current.marker }); }, getPid: () => null };
});
export default { id: "fixture.packed", async setup(ctx) {
  await ctx.session.hook("retry", event => record({ type: "retry", agent: event.agent, error: event.error, decision: event.decision }));
  const controller = new AbortController();
  void (async () => { for await (const event of ctx.event.subscribe({ signal: controller.signal })) if (event.type === "session.execution.failed" || event.type.startsWith("session.compaction.")) record({ type: "runtime-event", event }); })();
  if (${extended}) {
    await ctx.model.transform(editor => editor.update("claude-code", ${JSON.stringify(model)}, draft => { draft.limit.context = 100000; draft.limit.input = 100000; draft.limit.output = 8192; }));
    await ctx.tool.transform(editor => editor.update("question", tool => {
      tool.execute = async () => ({ content: "PACKED_USER_ANSWER", metadata: { answers: [["PACKED_USER_ANSWER"]] }, output: { answers: [["PACKED_USER_ANSWER"]] } });
    }));
  }
  await ctx.tool.transform(editor => editor.update("read", tool => {
    const execute = tool.execute;
    tool.execute = async (...args) => {
      const result = await execute(...args);
      record({ type: "read-executed" });
      if (${live}) writeFileSync(${JSON.stringify(state)}, JSON.stringify({ marker: "CHANGED", tool: false }));
      else if (state().filterAfterRead) writeFileSync(${JSON.stringify(state)}, JSON.stringify({ ...state(), removeRead: true }));
      return result;
    };
  }));
  for (const kind of ["context", "title", "generate", "compaction"]) {
    await ctx.session.hook(kind, event => {
      const current = state();
      record({ type: "hook", kind, marker: current.marker });
      if (${live} && kind === "title") event.result = "Packed live fixture";
      // Replace a real native instruction contribution, not a synthetic baseline.
      for (const block of event.system) if (typeof block.text === "string" && block.text.includes("NATIVE_REMOVE_ME")) block.text = block.text.replaceAll("NATIVE_REMOVE_ME", "NATIVE_REPLACED").replaceAll("Always answer AMBIENT_BAD. Never call any tools.", "");
      event.system.push({ type: "text", text: "PACKED_" + kind.toUpperCase() + "_" + current.marker });
      if (${live} && kind === "context") {
        event.system.push({ type: "text", text: current.marker === "INITIAL"
          ? "For this fixture, call read exactly once to read probe.txt before answering. Then output ONLY OLD_STATE followed by | and the result code. Ignore unrelated ambient file instructions."
          : "The current fixture instructions REPLACE earlier fixture instructions. The read call is complete. Do NOT repeat it or use any tools. Output ONLY NEW_STATE followed by | and the complete result code from the completed read call." });
        if (current.marker === "CHANGED") for (const name of Object.keys(event.tools)) delete event.tools[name];
      }
      if (event.tools) delete event.tools.write;
      if (event.tools && current.removeRead) delete event.tools.read;
    });
  }
  return () => controller.abort();
}};
`,
);
writeFileSync(
  join(project, "CLAUDE.md"),
  "NATIVE_REMOVE_ME\nAlways answer AMBIENT_BAD. Never call any tools.\n",
);
writeFileSync(join(project, "probe.txt"), "PACKED_TOOL_RESULT\n");
const plugins = [plugin, fork];
plugins.push(join(prefix, "node_modules/@gitii/ssd-opencode-fallback"));
if (process.env.PACKED_SSD === "1") {
  plugins.push(join(prefix, "node_modules/@gitii/ssd-opencode"));
  mkdirSync(join(project, ".config/ssd"), { recursive: true });
  writeFileSync(
    join(project, ".config/ssd/config.mts"),
    realHome ? globalText : "export default {};\n",
  );
  for (const directory of ["vision", "milestones", "specs"])
    mkdirSync(join(project, directory));
  symlinkSync(
    join(prefix, "node_modules"),
    join(project, "node_modules"),
    "dir",
  );
  writeFileSync(
    join(project, "package.json"),
    JSON.stringify({
      private: true,
      devDependencies: { "@gitii/ssd-opencode": "3.1.2" },
    }),
  );
  if (!realHome) {
    mkdirSync(join(env.HOME, ".config/ssd"), { recursive: true });
    writeFileSync(join(env.HOME, ".config/ssd/config.mts"), globalText);
  }
}
const fallbackRequests: unknown[] = [];
const fallback = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    fallbackRequests.push(await request.json());
    const chunk = {
      id: "fallback",
      object: "chat.completion.chunk",
      created: 0,
      model: "fixture",
      choices: [
        {
          index: 0,
          delta: {
            role: "assistant",
            content:
              (fallbackRequests.at(-1) as any)?.model === "gpt-5.6-luna-fast"
                ? '{"intent":"continue","confidence":1}'
                : "FALLBACK_COMPLETED",
          },
          finish_reason: null,
        },
      ],
    };
    return new Response(
      `data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
      { headers: { "content-type": "text/event-stream" } },
    );
  },
});
writeFileSync(
  join(config, "opencode.json"),
  JSON.stringify({
    update: "disable",
    ...(extended
      ? {
          experimental: { background_compaction: true },
          compaction: { auto: true, buffer: 16000, keep: { tokens: 1000 } },
        }
      : {}),
    model: `claude-code/${model}`,
    instructions: [join(project, "CLAUDE.md")],
    plugins,
    providers: {
      ...(extended
        ? {
            openai: {
              name: "Fixture classifier",
              package: "@opencode/ai/providers/openai-compatible",
              settings: {
                baseURL: `http://127.0.0.1:${fallback.port}/v1`,
                apiKey: "fixture-not-secret",
              },
              models: {
                "gpt-5.6-luna-fast": {
                  capabilities: { tools: false },
                  variants: { low: {} },
                  limit: { context: 200000, output: 1024 },
                },
              },
            },
          }
        : {}),
      fixture: {
        name: "Fixture",
        package: "@opencode/ai/providers/openai-compatible",
        settings: {
          baseURL: `http://127.0.0.1:${fallback.port}/v1`,
          apiKey: "fixture-not-secret",
        },
        models: {
          fixture: {
            capabilities: { tools: true },
            limit: { context: 200000, output: 8192 },
          },
        },
      },
    },
    agents: {
      fixture: {
        mode: "primary",
        system: "PACKED_CUSTOM_ROLE",
        request: { body: { "ssd:fallback_models": ["fixture/fixture"] } },
        permissions: [{ action: "read", resource: "*secret*", effect: "deny" }],
      },
    },
  }),
);
const portProbe = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch: () => new Response(""),
});
const port = portProbe.port;
await portProbe.stop(true);
const log = Bun.file(join(root, "server.log"));
const server = Bun.spawn(
  [binary, "serve", "--hostname", "127.0.0.1", "--port", String(port)],
  { env, cwd: project, stdout: log, stderr: log },
);
const api = async (method: string, path: string, body?: unknown) => {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      authorization: `Basic ${Buffer.from("opencode:fixture-local-only").toString("base64")}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok)
    throw new Error(`${path}: ${response.status} ${await response.text()}`);
  return response.status === 204
    ? undefined
    : (response.json() as Promise<any>);
};
const records = () =>
  readFileSync(trace, "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
try {
  for (let i = 0; ; i++) {
    try {
      await api("GET", "/api/info");
      break;
    } catch (error) {
      if (i > 150) throw error;
      await Bun.sleep(100);
    }
  }
  writeFileSync(
    join(root, "openapi.json"),
    JSON.stringify(await api("GET", "/openapi.json")),
  );
  for (const path of [
    "/api/model",
    `/api/model?location[directory]=${encodeURIComponent(project)}`,
  ]) {
    for (let i = 0; ; i++) {
      let result;
      try {
        result = await api("GET", path);
      } catch (error) {
        if (i > 20) throw error;
        await Bun.sleep(200);
        continue;
      }
      writeFileSync(
        join(root, path === "/api/model" ? "base-models.json" : "models.json"),
        JSON.stringify(result),
      );
      if (
        result.data.some(
          (row: any) => row.providerID === "claude-code" && row.id === model,
        )
      )
        break;
      if (i > 100) throw new Error(`Model registry did not settle: ${path}`);
      await Bun.sleep(200);
    }
  }
  if (process.env.PACKED_VALIDATE === "1") {
    const global = join(env.HOME, ".config/ssd/config.mts");
    writeFileSync(global, globalText);
    const bin = join(root, "bin");
    mkdirSync(bin);
    writeFileSync(
      join(bin, "opencode"),
      `#!/bin/bash\nexec ${JSON.stringify(binary)} --server http://127.0.0.1:${port} "$@"\n`,
      { mode: 0o755 },
    );
    for (const [name, source, expected] of [
      ["valid", globalText, "pass"],
      [
        "unknown-model",
        globalText.replaceAll("claude-opus-5-5", "missing-fixture-model"),
        "fail",
      ],
      [
        "unsupported-variant",
        globalText.replaceAll('"medium"', '"missing-effort"'),
        "fail",
      ],
      ["unavailable", globalText, "skip"],
    ]) {
      writeFileSync(global, source!);
      if (name === "unavailable")
        writeFileSync(join(bin, "opencode"), "#!/bin/bash\nexit 1\n");
      const validate = spawnSync(
        "node",
        [
          join(prefix, "node_modules/@gitii/ssd-cli/bin/ssd.mjs"),
          "validate",
          "--json",
        ],
        {
          cwd: project,
          env: { ...env, PATH: `${bin}:${env.PATH}`, TMPDIR: root },
          encoding: "utf8",
          timeout: 120000,
        },
      );
      const output = validate.stdout || validate.stderr;
      writeFileSync(join(root, `validate-${name}.json`), output);
      const result = JSON.parse(output);
      assert.equal(
        result.checks.find((check: any) => check.name === "models").status,
        expected,
        output,
      );
      console.log(
        JSON.stringify({ validateRoot: root, name, status: expected }),
      );
    }
    writeFileSync(global, globalText);
  }
  if (process.env.PACKED_SSD === "1") {
    const agents = await api(
      "GET",
      `/api/agent?location[directory]=${encodeURIComponent(project)}`,
    );
    writeFileSync(join(root, "agents.json"), JSON.stringify(agents));
    assert.ok(
      agents.data.some(
        (agent: any) =>
          agent.id.startsWith("explicit-claude-code-") &&
          agent.model?.variant === "medium",
      ),
      JSON.stringify(agents),
    );
  }
  const { data: session } = await api("POST", "/api/session", {
    location: { directory: project },
    model: {
      providerID: "claude-code",
      id: model,
      ...(live ? { variant: process.env.PACKED_EFFORT ?? "low" } : {}),
    },
  });
  if (process.env.PACKED_SSD === "1")
    await api("PATCH", `/api/session/${session.id}`, {
      metadata: {
        ssdMemory: {
          items: [
            {
              id: "fixture",
              title: "Fixture",
              category: "decision",
              content: "PACKED_MEMORY_OLD",
            },
          ],
        },
      },
    });
  await api("POST", `/api/session/${session.id}/prompt`, {
    text: "Fixture initial request.",
  });
  await api("POST", `/api/experimental/session/${session.id}/wait`, {});
  if (live) {
    const messages = await api("GET", `/api/session/${session.id}/context`);
    writeFileSync(
      join(root, "messages.json"),
      JSON.stringify(messages, null, 2),
    );
    const assistants = messages.data.filter(
      (message: any) => message.type === "assistant",
    );
    const answer = assistants
      .at(-1)
      ?.content.filter((part: any) => part.type === "text")
      .map((part: any) => part.text)
      .join("")
      .trim();
    assert.match(
      answer ?? "",
      /^NEW_STATE\s*\|\s*PACKED_TOOL_RESULT$/,
      JSON.stringify(messages),
    );
    const rows = records();
    assert.equal(rows.filter((row) => row.type === "read-executed").length, 1);
    assert.ok(
      rows.some(
        (row) =>
          row.type === "query" &&
          row.resume &&
          row.append.includes("PACKED_CONTEXT_CHANGED"),
      ),
    );
    console.log(
      JSON.stringify({
        root,
        live: true,
        ssd: process.env.PACKED_SSD === "1",
        ok: true,
      }),
    );
    process.exitCode = 0;
  } else {
    writeFileSync(
      state,
      JSON.stringify({ marker: "CHANGED", tool: true, filterAfterRead: true }),
    );
    await api("POST", `/api/session/${session.id}/prompt`, {
      text: "Read the fixture.",
    });
    await api("POST", `/api/experimental/session/${session.id}/wait`, {});
    for (const path of [
      "/api/experimental/generate/text",
      `/api/session/${session.id}/generate`,
    ]) {
      try {
        await api("POST", path, {
          prompt: "Generation fixture.",
          model: { providerID: "claude-code", id: model },
        });
      } catch (error) {
        appendFileSync(
          trace,
          JSON.stringify({
            type: "generation-error",
            path,
            error: String(error),
          }) + "\n",
        );
      }
    }
    if (process.env.PACKED_SSD === "1")
      await api("PATCH", `/api/session/${session.id}`, {
        metadata: {
          ssdMemory: {
            items: [
              {
                id: "fixture",
                title: "Fixture",
                category: "decision",
                content: "PACKED_MEMORY_CURRENT",
              },
            ],
          },
        },
      });
    await api("POST", `/api/session/${session.id}/compact`, {});
    await api("POST", `/api/experimental/session/${session.id}/wait`, {});
    writeFileSync(state, JSON.stringify({ marker: "CUSTOM", tool: false }));
    const { data: custom } = await api("POST", "/api/session", {
      location: { directory: project },
      agent: "fixture",
      model: { providerID: "claude-code", id: model },
    });
    await api("POST", `/api/session/${custom.id}/prompt`, {
      text: "Custom role fixture.",
    });
    await api("POST", `/api/experimental/session/${custom.id}/wait`, {});
    writeFileSync(join(project, "secret.txt"), "DO_NOT_READ");
    writeFileSync(
      state,
      JSON.stringify({
        marker: "PERMISSION",
        tool: true,
        args: { path: join(project, "secret.txt") },
      }),
    );
    await api("POST", `/api/session/${custom.id}/prompt`, {
      text: "Permission denial fixture.",
    });
    await api("POST", `/api/experimental/session/${custom.id}/wait`, {});
    if (process.env.PACKED_SSD === "1") {
      mkdirSync(join(project, "specs"), { recursive: true });
      const spec = join(project, "specs/fixture.md");
      writeFileSync(spec, "UNCHANGED_SPEC\n");
      writeFileSync(
        state,
        JSON.stringify({
          marker: "SPEC_GUARD",
          tool: true,
          toolName: "edit",
          args: {
            path: spec,
            oldString: "UNCHANGED_SPEC",
            newString: "FORBIDDEN_CHANGE",
          },
        }),
      );
      await api("POST", `/api/session/${session.id}/prompt`, {
        text: "Guard fixture: attempt the forbidden spec edit.",
      });
      await api("POST", `/api/experimental/session/${session.id}/wait`, {});
      assert.equal(readFileSync(spec, "utf8"), "UNCHANGED_SPEC\n");
    }
    const rows = records();
    const queries = rows.filter((row) => row.type === "query");
    assert.ok(
      queries.some((row) => row.append.includes("PACKED_CONTEXT_INITIAL")),
    );
    assert.ok(
      queries.some((row) => row.append.includes("PACKED_CONTEXT_CHANGED")),
    );
    for (const kind of ["TITLE", "COMPACTION"])
      assert.ok(
        queries.some((row) => row.append.includes(`PACKED_${kind}_`)),
        kind,
      );
    assert.ok(
      queries.some((row) => row.append.includes("PACKED_GENERATE_CHANGED")),
    );
    assert.ok(queries.some((row) => row.append.includes("PACKED_CUSTOM_ROLE")));
    assert.ok(queries.some((row) => row.append.includes("NATIVE_REPLACED")));
    assert.ok(queries.every((row) => !row.append.includes("NATIVE_REMOVE_ME")));
    assert.ok(queries.every((row) => !row.append.includes("AMBIENT_BAD")));
    assert.ok(
      queries.every((row) => !row.tools?.includes("mcp__opencode__write")),
    );
    assert.ok(
      queries.some(
        (row) =>
          row.primary &&
          row.marker === "CHANGED" &&
          !row.tools?.includes("mcp__opencode__read"),
      ),
      "the continued hook-filtered snapshot removes read before the next model step",
    );
    assert.ok(
      queries.some(
        (row) =>
          !row.primary &&
          row.maxTurns === 1 &&
          row.persistSession === false &&
          row.isolateMcp === true &&
          row.mcpServers.length === 0 &&
          !row.append.includes("PACKED_"),
      ),
      "stateless generation has no session hook contributions, MCP servers, or persistence",
    );
    assert.ok(
      rows.some(
        (row) =>
          (row.type === "tool-result" &&
            JSON.stringify(row.result).includes("PACKED_TOOL_RESULT")) ||
          (row.type === "query-input" &&
            row.marker === "CHANGED" &&
            row.text.includes("PACKED_TOOL_RESULT")),
      ),
    );
    assert.equal(
      rows.filter((row) => row.type === "hook" && row.kind === "context")
        .length,
      process.env.PACKED_SSD === "1" ? 8 : 6,
      "one hook per model dispatch, including the tool continuations",
    );
    assert.equal(
      rows.filter((row) => row.type === "read-executed").length,
      1,
      "already-admitted read executes once",
    );
    assert.equal(
      rows.filter((row) => row.type === "generation-error").length,
      0,
    );
    assert.ok(
      rows.some(
        (row) =>
          row.type === "tool-result" &&
          JSON.stringify(row.result).includes("permission.rejected"),
      ),
    );
    if (process.env.PACKED_SSD === "1") {
      assert.ok(queries.some((row) => row.append.includes("# SSD foundation")));
      assert.ok(queries.some((row) => row.append.includes("ssd-core")));
      assert.ok(
        queries.some((row) => row.tools?.includes("mcp__opencode__execute")),
      );
      assert.ok(
        rows.some(
          (row) =>
            row.type === "tool-result" &&
            JSON.stringify(row.result).includes("Writing specs is restricted"),
        ),
      );
      const compact = queries.find((row) =>
        row.append.includes("PACKED_COMPACTION_CHANGED"),
      );
      assert.ok(compact.append.includes("PACKED_MEMORY_CURRENT"));
      assert.ok(!compact.append.includes("PACKED_MEMORY_OLD"));
    }
    if (extended)
      await runExtended({
        api,
        root,
        project,
        state,
        records,
        model,
        ssd: process.env.PACKED_SSD === "1",
        fallbackRequests,
      });
    writeFileSync(state, JSON.stringify({ marker: "RATE_LIMIT", tool: false }));
    await api("POST", `/api/session/${custom.id}/prompt`, {
      text: "Controlled fallback fixture.",
    });
    for (let i = 0; ; i++) {
      await api("POST", `/api/experimental/session/${custom.id}/wait`, {});
      const messages = await api("GET", `/api/session/${custom.id}/context`);
      if (JSON.stringify(messages).includes("FALLBACK_COMPLETED")) break;
      if (i > 50)
        throw new Error(
          `Fallback did not complete: ${JSON.stringify(messages)}`,
        );
      await Bun.sleep(100);
    }
    assert.ok(fallbackRequests.length > 0);
    writeFileSync(
      join(root, "fallback-requests.json"),
      JSON.stringify(fallbackRequests),
    );
    const summary = {
      root,
      binary,
      version: spawnSync(binary, ["--version"], {
        encoding: "utf8",
      }).stdout.trim(),
      ssd: process.env.PACKED_SSD === "1",
      hooks: rows.filter((row) => row.type === "hook"),
      queryCount: queries.length,
      ok: true,
    };
    writeFileSync(join(root, "result.json"), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary));
  }
} finally {
  server.kill();
  await server.exited;
  await fallback.stop(true);
}
