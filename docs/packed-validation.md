# Packed compatibility checks

Run these manual integration checks before shipping instruction/lifecycle changes. They install and execute the packed artifact; the normal regression suite alone does not prove packaging or real OpenCode hook dispatch.

1. Use the committed Bun lockfile, build, and `npm pack --ignore-scripts --pack-destination <artifacts>`.
2. Install the tarball and the SSD OpenCode/fallback/nudge/CLI/types/platform tarballs into a new isolated npm prefix. Do not use workspace links.
3. Put the actual Claude CLI first on PATH. Set `CLAUDE_CONFIG_DIR` to the existing signed-in directory without copying credentials.

```fish
set -gx PACKED_PREFIX /tmp/opencode/t5-installed
set -gx OPENCODE_BIN /tmp/opencode/pinned-2.2.3/opencode
bun test/packed-regressions.ts
bun test/packed-opencode.ts
set -gx PACKED_SSD 1
set -gx PACKED_VALIDATE 1
bun test/packed-opencode.ts
```

Repeat dispatch with the currently installed OpenCode runtime. The driver isolates HOME, XDG directories, configuration, data, caches, and project files; disables updating; uses explicit loopback listeners; and kills its server. The fixture plugin imports the installed bridge's `dist/proxy.js` before the package loads, preserving module identity for its fake SDK starter. The bridge loads before SSD's registry discovery.

`packed-opencode.ts` checks real hook dispatch, native-file replacement, changing contributions, tool filtering/execution, auxiliary requests, permissions, custom roles, and controlled cross-provider fallback. With SSD enabled it also checks foundation, skills/Code Mode, spec-write restrictions, fixture-seeded memory through compaction, and generated explicit-agent effort. `PACKED_VALIDATE=1` runs the installed SSD CLI against merged isolated global/project configuration and its model-validation negative cases. The local package-path pin lint is recorded separately from model validity.

`packed-regressions.ts` copies the selected tests into a temporary directory and rewrites only their source-module imports to installed `dist` modules. Its 13 SDK-mocked regressions cover payload and query lifecycle boundaries without embedding OpenCode in the unit suite.

For opt-in real inference, set `PACKED_LIVE=1`. A real OpenCode read changes the next hook contribution and removes tools; the following response must obey the changed instructions without repeating that read. `PACKED_MODEL` can select another CLI-listed model. Separately, set `OPENCODE_CLAUDE_LIVE_DIST=<prefix>/node_modules/@gitii/opencode-claude/dist` and run `bun test/parked-context-live.ts` to verify actual SDK same-session resume and native file suppression.

Generate provenance with `packed-manifest.ts <output.json>`, setting `PACKED_ARTIFACTS`, `PACKED_PREFIX`, `SSD_SOURCE_SHA`, and `FORK_SOURCE_SHA` to the tested runtime inputs. Keep the report outside the packed payload so its hash does not refer to itself.

## 2026-10-30 result

Bridge input: `b6508a35a3e05dfebbd3380ba8b481780d179451`, version 1.7.1, SDK 0.3.224, Zod 4.4.3. Installed artifact SHA-256 is recorded in SSD's `docs/claude-code-artifacts.json`, alongside the SSD package inputs and resolved dependencies.

The 13 installed-artifact regressions passed. Real OpenCode 2.2.3 and 2.2.4 dispatch passed with the mocked SDK and packed SSD/fallback. The real SDK parked-resume test passed on CLI 2.1.314: `NEW_STATE | RESULT_6fd2b5`, one completed tool, same SDK session, and a drained interruption leaf. Empty native settings/skills, disabled native auto-memory, and disabled system-prompt snapshots prevented stale/ambient instruction revival.

The combined OpenCode/live-CLI smoke was blocked by the account's HTTP 402 extra-usage error on both tested Haiku selections. Do not claim that combined proof or cut over until it passes. Intent/ledger tool updates, automatic background compaction, actual OpenCode interrupt/resume, and a real old-session provider round trip still need end-to-end coverage. SDK-mocked lifecycle tests are not live evidence for those rows.

The SSD report `docs/claude-code-packed-validation.md` carries the complete matrix and remaining gates. Generic hook compatibility preserves the Claude Code preset; it does not reproduce another provider's complete prompt or guarantee identical behavior. Cross-provider history transfer is lossy; use fresh sessions for cutover.
