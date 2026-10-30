/** Provider substitutions stay visible and update the OpenCode session model. */
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assert, mockHandle, startMockedProxy, textDelta } from "./helpers.ts";

async function main() {
  const { tmp, proxy } = await startMockedProxy("provider-substitution");
  const bin = join(tmp, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "claude"), "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo '2.1.314 (Claude Code)'; fi\n");
  chmodSync(join(bin, "claude"), 0o755);
  process.env.HOME = tmp;
  process.env.PATH = `${bin}:/usr/bin:/bin`;

  const { ClaudeCodePlugin } = await import("../src/index.ts");
  const { modelsFromSdk, setDiscoveredModels } = await import("../src/models.ts");
  setDiscoveredModels(modelsFromSdk([
    { value: "claude-fable-5-1", supportedEffortLevels: ["medium", "high"] },
    { value: "claude-opus-5-5", supportedEffortLevels: ["medium", "high"] },
  ]));

  const switches: unknown[] = [];
  let requestHook!: (request: any) => Promise<void>;
  const dispose = await ClaudeCodePlugin.setup({
    options: {},
    location: { directory: tmp },
    provider: {
      transform: async (transform: any) => transform({ add: () => {} }),
      reload: async () => {},
    },
    session: {
      hook: async (name: string, hook: typeof requestHook) => {
        if (name === "model.request") requestHook = hook;
      },
      switchModel: async (selection: unknown) => { switches.push(selection); },
    },
    integration: {
      transform: async (transform: any) => transform({ method: { update: () => {} }, update: () => {} }),
    },
    event: {
      subscribe: ({ signal }: { signal: AbortSignal }) => (async function* () {
        await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
      })(),
    },
  } as any);

  try {
    proxy.setClaudeQueryStarter(async () => mockHandle((async function* () {
      yield {
        type: "system", subtype: "model_refusal_fallback", scope: "session",
        original_model: "claude-fable-5-1", fallback_model: "claude-opus-5-5",
        api_refusal_category: "test",
      };
      yield textDelta("answer from the substituted model");
      yield { type: "result", is_error: false, usage: {} };
    })()));
    const request = {
      model: { id: "claude-fable-5-1", providerID: "claude-code", variant: "medium" },
      kind: "primary", sessionID: "ses_substitution", baseURL: "", headers: {} as Record<string, string>,
    };
    await requestHook(request);
    const response = await fetch(`${request.baseURL}/chat/completions`, {
      method: "POST",
      headers: { ...request.headers, "content-type": "application/json" },
      body: JSON.stringify({
        model: request.model.id, stream: true,
        messages: [{ role: "user", content: "Answer using the requested model." }],
      }),
    });
    assert.equal(response.status, 200);
    const output = await response.text();
    assert.match(output, /declined this request/);
    assert.match(output, /Opus 5\.5 answered/);
    assert.match(output, /answer from the substituted model/);
    assert.deepEqual(switches, [{
      sessionID: "ses_substitution",
      model: { id: "claude-opus-5-5", providerID: "claude-code", variant: "medium" },
    }]);
  } finally {
    proxy.setClaudeQueryStarter(null);
    proxy.setModelFallbackHandler(null);
    if (typeof dispose === "function") await dispose();
    await proxy.stopProxy();
  }
  console.log("provider-substitution regression ok");
}

main().then(() => process.exit(0), (error) => { console.error(error); process.exit(1); });
