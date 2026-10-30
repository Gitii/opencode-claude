/** Opt-in tiny SDK control matched to the official CLI baseline. No identity overrides. */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = mkdtempSync("/tmp/opencode/t5-sdk-control-");
const env: NodeJS.ProcessEnv = {
  ...process.env,
  CLAUDE_CONFIG_DIR: "/home/germinii/.claude",
  CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
  CLAUDE_CODE_MAX_OUTPUT_TOKENS: "1024",
};
for (const name of ["CONFIG", "DATA", "CACHE", "STATE"]) {
  env[`XDG_${name}_HOME`] = join(root, name.toLowerCase());
  mkdirSync(env[`XDG_${name}_HOME`]);
}
const { startClaudeQuery } = await import(
  pathToFileURL(
    join(
      resolve(process.env.PACKED_PREFIX!),
      "node_modules/@gitii/opencode-claude/dist/query.js",
    ),
  ).href
);
const handle = await startClaudeQuery({
  cwd: root,
  model: "claude-opus-5-5",
  effort: "low",
  prompt: "Reply only OK.",
  tools: [],
  skills: [],
  settingSources: [],
  persistSession: false,
  isolateMcp: true,
  maxTurns: 1,
  env,
  pathToClaudeCodeExecutable: "/home/germinii/.local/bin/claude",
});
const results: unknown[] = [];
try {
  for await (const event of handle.stream)
    if (event.type === "result")
      results.push({
        subtype: event.subtype,
        is_error: event.is_error,
        result: event.result,
        errors: event.errors,
      });
  writeFileSync(
    join(root, "result.json"),
    JSON.stringify(
      {
        root,
        model: "claude-opus-5-5",
        effort: "low",
        maxOutputTokens: 1024,
        results,
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ root, results }));
  assert.ok(
    results.some(
      (result: any) => !result.is_error && result.result?.trim() === "OK",
    ),
  );
} finally {
  handle.close();
}
