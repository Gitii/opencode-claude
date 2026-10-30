/** Manual fixture capture: bun test/capture-opencode-dispatch.ts. No real inference. */
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";

const version = spawnSync("opencode", ["--version"], { encoding: "utf8" }).stdout.trim().replace(/^opencode v/, "");
if (version !== "2.2.3") throw new Error(`Expected OpenCode 2.2.3, got ${version}`);
const root = mkdtempSync("/tmp/opencode/dispatch-capture-");
const project = join(root, "project");
mkdirSync(project);
const requests: unknown[] = [];
const fake = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(req) {
  const body = await req.json() as any;
  requests.push({ kind: req.headers.get("x-opencode-claude-kind"), body });
  const chunk = { id: "capture", object: "chat.completion.chunk", created: 0, model: "fixture", choices: [{ index: 0, delta: { role: "assistant", content: "Fixture response" }, finish_reason: null }] };
  return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`, { headers: { "content-type": "text/event-stream" } });
} });
const env = { ...process.env };
env.OPENCODE_PASSWORD = "fixture-local-only";
for (const name of ["CONFIG", "DATA", "STATE", "CACHE"]) {
  const dir = join(root, name.toLowerCase());
  mkdirSync(dir);
  env[`XDG_${name}_HOME`] = dir;
}
const config = join(env.XDG_CONFIG_HOME!, "opencode");
mkdirSync(config);
const plugin = join(root, "capture-plugin");
mkdirSync(plugin);
writeFileSync(join(plugin, "index.ts"), `export default { id: "fixture.capture", async setup(ctx) {
  await ctx.session.hook("model.request", (request) => {
    request.headers["x-opencode-claude-kind"] = request.kind;
  });
  for (const kind of ["context", "title", "generate", "compaction"]) {
    await ctx.session.hook(kind, (event) => {
      event.system.push({ type: "text", text: "FIXTURE_" + kind.toUpperCase() + "_ADDITION" });
      if (event.tools) delete event.tools.write;
    });
  }
}};`);
writeFileSync(join(project, "AGENTS.md"), "Fixture project instruction.\n");
writeFileSync(join(config, "opencode.json"), JSON.stringify({
  model: "fixture/fixture", plugins: [plugin],
  providers: { fixture: { name: "Fixture", package: "@opencode/ai/providers/openai-compatible", settings: { baseURL: `http://127.0.0.1:${fake.port}/v1`, apiKey: "fixture-not-a-secret" }, models: { fixture: { capabilities: { tools: true }, limit: { context: 200000, output: 8192 } } } } },
}));
const portProbe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("") });
const port = portProbe.port;
await portProbe.stop(true);
const server = spawn("opencode", ["serve", "--hostname", "127.0.0.1", "--port", String(port)], { env, cwd: project, stdio: ["ignore", "ignore", "inherit"] });
const api = async (method: string, path: string, body?: unknown) => {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { "content-type": "application/json", authorization: `Basic ${Buffer.from("opencode:fixture-local-only").toString("base64")}` }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
  return response.json() as Promise<any>;
};
try {
  for (let i = 0; ; i++) {
    try { await api("GET", "/api/info"); break; } catch (error) { if (i > 100) throw error; await Bun.sleep(100); }
  }
  const { data: session } = await api("POST", "/api/session", { location: { directory: project }, model: { providerID: "fixture", id: "fixture" } });
  await api("POST", `/api/session/${session.id}/prompt`, { text: "Fixture user request." });
  await api("POST", `/api/experimental/session/${session.id}/wait`, {});
  await api("POST", "/api/experimental/generate/text", { prompt: "Fixture stateless generation.", model: { providerID: "fixture", id: "fixture" } });
  await api("POST", `/api/session/${session.id}/generate`, { prompt: "Fixture transient generation." });
  await api("POST", `/api/session/${session.id}/compact`, {});
  await api("POST", `/api/experimental/session/${session.id}/wait`, {});
  const sanitized = JSON.parse(JSON.stringify(requests).replaceAll(root, "/fixture").replaceAll(project, "/fixture/project"));
  const output = resolve("test/fixtures/opencode-2.2.3-dispatch.json");
  mkdirSync(resolve("test/fixtures"), { recursive: true });
  writeFileSync(output, JSON.stringify({ version, capture: "isolated XDG, loopback OpenAI-compatible fake, context/title/generate/compaction hooks; write filtered", requests: sanitized }, null, 2) + "\n");
  console.log(`Captured ${requests.length} requests: ${output}`);
} finally {
  server.kill("SIGTERM");
  await fake.stop(true);
}
