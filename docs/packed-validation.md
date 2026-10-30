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
set -gx PACKED_EXTENDED 1
bun test/packed-opencode.ts
```

Repeat dispatch with the currently installed OpenCode runtime. The driver isolates HOME, XDG directories, configuration, data, caches, and project files; disables updating; uses explicit loopback listeners; and kills its server. The fixture plugin imports the installed bridge's `dist/proxy.js` before the package loads, preserving module identity for its fake SDK starter. The bridge loads before SSD's registry discovery.

`packed-opencode.ts` checks real hook dispatch, native-file replacement, changing contributions, tool filtering/execution, auxiliary requests, permissions, custom roles, and controlled cross-provider fallback. With SSD enabled it also checks foundation, skills/Code Mode, spec-write restrictions, fixture-seeded memory through compaction, and generated explicit-agent effort. `PACKED_VALIDATE=1` runs the installed SSD CLI against merged isolated global/project configuration and its model-validation negative cases. The local package-path pin lint is recorded separately from model validity.

`packed-regressions.ts` copies the selected tests into a temporary directory and rewrites only their source-module imports to installed `dist` modules. Its 13 SDK-mocked regressions cover payload and query lifecycle boundaries without embedding OpenCode in the unit suite.

`PACKED_EXTENDED=1` adds real OpenCode intent/ledger tool updates, interrupt/resume, visible provider substitution, an existing-session provider round trip, and automatic experimental background compaction. The SDK summary is deliberately held while the primary continues, then released and applied as a completed automatic checkpoint. Usage and the long transcript are fixture data, not billable inference. The mock has no saved native SDK session, so parked-query replacement rebuilds with completed results; native same-session resume is separately proven by the real SDK test.

For opt-in real inference after account/request access is confirmed, unset `PACKED_VALIDATE`, set `PACKED_LIVE=1`, `PACKED_REAL_HOME=1`, and `CLAUDE_CODE_MAX_OUTPUT_TOKENS=1024`. Real-HOME mode retains XDG isolation, uses temporary project SSD overlays, and refuses mutations of the real global SSD config. Live mode suppresses title inference, defaults to Opus 5.5/low, and uses normal 2,000 ms stop grace; mocks use 50 ms. A real OpenCode read changes the next hook contribution and removes tools; the following response must obey the changed instructions without repeating that read. `PACKED_MODEL` and `PACKED_EFFORT` can select another listed model/effort when a test specifically requires it, not as blind billing retries. Separately, set `OPENCODE_CLAUDE_LIVE_DIST=<prefix>/node_modules/@gitii/opencode-claude/dist` and run `bun test/parked-context-live.ts` to verify actual SDK same-session resume and native file suppression.

`packed-sdk-smoke.ts` is a tiny direct installed-SDK control: actual CLI, real HOME, isolated XDG, Opus 5.5/low, output cap 1024, no native tools/settings/connectors, and no persistence. It does not alter SDK/client identity.

Generate provenance with `packed-manifest.ts <output.json>`, setting `PACKED_ARTIFACTS`, `PACKED_PREFIX`, `SSD_SOURCE_SHA`, and `FORK_SOURCE_SHA` to the tested runtime inputs. Keep the report outside the packed payload so its hash does not refer to itself.

## 2026-10-30 result

Bridge input: `b6508a35a3e05dfebbd3380ba8b481780d179451`, version 1.7.1, SDK 0.3.224, Zod 4.4.3. Installed artifact SHA-256 is recorded in SSD's `docs/claude-code-artifacts.json`, alongside the SSD package inputs and resolved dependencies.

The 13 installed-artifact regressions passed. Real OpenCode 2.2.3 and 2.2.4 dispatch passed with the mocked SDK and packed SSD/fallback. The real SDK parked-resume test passed on CLI 2.1.314: `NEW_STATE | RESULT_6fd2b5`, one completed tool, same SDK session, and a drained interruption leaf. Empty native settings/skills, disabled native auto-memory, and disabled system-prompt snapshots prevented stale/ambient instruction revival.

All billing-independent end-to-end rows now pass on both OpenCode versions: intent phase changes after an edit and reaches the next append; one question reply updates the seeded ledger and its next append; actual interrupt/close is followed by successful same-session continuation; an expendable session transfers to another loopback provider and back with transcript markers present; background warming allows concurrent primary progress and finishes as an automatic checkpoint. These use real OpenCode and the installed bridge, with scripted SDK inference. The final controlled fallback uses SSD's repacked per-event lookup-recovery fix.

The combined live smoke remains blocked by HTTP 402 `claude_extra_usage`, including with real HOME, suppressed title inference, low effort, output caps 4096 and then 1024, and normal stop grace. This is not a blanket account/model/SDK availability failure: primary's tiny official Opus CLI control and the child's matched tiny installed SDK control both answer `OK`. The rejected combined request has a streaming prompt, native preset, 39,555 appended characters, 18 bridge tools, and session persistence; the successful SDK control is a tiny string prompt with no tools or persistence. The precise billing cause is unestablished. Do not change billing, enable extra usage, buy credits, mask identity, or make more unchanged inference retries. Operator/account-admin support must establish why this larger request shape is refused, or provide an authorized capacity context that accepts it before the combined live proof and cutover.

The SSD report `docs/claude-code-packed-validation.md` carries the complete matrix and remaining gates. Generic hook compatibility preserves the Claude Code preset; it does not reproduce another provider's complete prompt or guarantee identical behavior. Cross-provider history transfer is lossy; use fresh sessions for cutover.
