/** Generate provenance after packing; source SHAs identify runtime inputs, not this report. */
import { createHash } from "node:crypto";
import {
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const artifacts = resolve(process.env.PACKED_ARTIFACTS!);
const prefix = resolve(process.env.PACKED_PREFIX!);
const sha256 = (path: string) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
const lock = JSON.parse(
  readFileSync(join(prefix, "package-lock.json"), "utf8"),
);
const runtime = (path: string) => ({
  path,
  realpath: realpathSync(path),
  version: spawnSync(path, ["--version"], { encoding: "utf8" }).stdout.trim(),
  sha256: sha256(realpathSync(path)),
});
const manifest = {
  date: process.env.PACKED_DATE ?? new Date().toISOString().slice(0, 10),
  sources: {
    ssd: process.env.SSD_SOURCE_SHA,
    fork: process.env.FORK_SOURCE_SHA,
  },
  artifacts: readdirSync(artifacts)
    .filter((name) => name.endsWith(".tgz"))
    .sort()
    .map((name) => ({ file: name, sha256: sha256(join(artifacts, name)) })),
  runtimes: [
    runtime("/tmp/opencode/pinned-2.2.3/opencode"),
    runtime("/home/germinii/.opencode/bin/opencode"),
    runtime("/home/germinii/.local/bin/claude"),
  ],
  installation: {
    prefix,
    packageLockSha256: sha256(join(prefix, "package-lock.json")),
    workspaceLinks: false,
  },
  dependencies: Object.fromEntries(
    Object.entries(lock.packages)
      .filter(([name]) => name !== "")
      .map(([name, value]: [string, any]) => [name, value.version]),
  ),
};
writeFileSync(
  resolve(process.argv[2]!),
  JSON.stringify(manifest, null, 2) + "\n",
);
