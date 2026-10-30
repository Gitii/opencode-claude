/** Run payload/lifecycle regressions against the installed tarball, not src. */
import assert from "node:assert/strict";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const dist = join(
  resolve(process.env.PACKED_PREFIX!),
  "node_modules/@gitii/opencode-claude/dist",
);
const root = mkdtempSync("/tmp/opencode/t5-payload-");
const cases = [
  "transformed-context",
  "parked-context",
  "compaction-park",
  "compaction-live-turn",
  "compaction-resume",
  "interrupted-leaf",
  "graceful-stop",
  "provider-substitution",
  "cross-provider-compaction",
  "concurrent-generate",
  "turn-errors",
  "model-switch",
  "code-mode-catalog",
];
cpSync(new URL("fixtures", import.meta.url), join(root, "fixtures"), {
  recursive: true,
});
for (const name of [
  "helpers.ts",
  ...cases.map((name) => `${name}-regression.ts`),
]) {
  const source = readFileSync(new URL(name, import.meta.url), "utf8");
  writeFileSync(
    join(root, name),
    source.replace(
      /(["'])\.\.\/src\/([^"']+)\.ts\1/g,
      (_, quote, module) => `${quote}${dist}/${module}.js${quote}`,
    ),
  );
}
for (const name of cases) {
  const home = join(root, name);
  mkdirSync(home);
  const result = spawnSync(
    process.execPath,
    [join(root, `${name}-regression.ts`)],
    {
      env: {
        ...process.env,
        HOME: home,
        TMPDIR: root,
        XDG_CONFIG_HOME: join(home, "config"),
        XDG_DATA_HOME: join(home, "data"),
        XDG_CACHE_HOME: join(home, "cache"),
        XDG_STATE_HOME: join(home, "state"),
      },
      encoding: "utf8",
      timeout: 60000,
    },
  );
  writeFileSync(join(root, `${name}.log`), result.stdout + result.stderr);
  assert.equal(result.status, 0, `${name}: ${result.stdout}\n${result.stderr}`);
  console.log(`${name}: pass`);
}
console.log(JSON.stringify({ root, cases, dist }));
