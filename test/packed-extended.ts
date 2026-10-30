/** Billing-independent end-to-end cases using the packed driver's real server. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export async function runExtended({
  api,
  root,
  project,
  state,
  records,
  model,
  ssd,
  fallbackRequests,
}: any) {
  const set = (value: object) => writeFileSync(state, JSON.stringify(value));
  const create = async (agent = "build") =>
    (
      await api("POST", "/api/session", {
        location: { directory: project },
        agent,
        model: { providerID: "claude-code", id: model },
      })
    ).data;
  const wait = (id: string) =>
    api("POST", `/api/experimental/session/${id}/wait`, {});
  const prompt = async (id: string, text: string) => {
    await api("POST", `/api/session/${id}/prompt`, { text });
    await wait(id);
  };
  const poll = async (
    check: () => boolean | Promise<boolean>,
    description: string,
  ) => {
    for (let i = 0; i < 200; i++) {
      if (await check()) return;
      await Bun.sleep(50);
    }
    throw new Error(`Timed out: ${description}`);
  };
  const result: Record<string, any> = {};

  if (ssd) {
    const intent = await create("ssd-spec-cc");
    const path = join(project, "intent.txt");
    writeFileSync(path, "BEFORE_INTENT_TOOL\n");
    await api("PATCH", `/api/session/${intent.id}`, {
      metadata: {
        intentGate: {
          state: "PLANNING",
          phase: "planning",
          lastConfidence: 1,
          seq: 1,
          updatedAt: Date.now(),
        },
      },
    });
    set({
      marker: "INTENT",
      tool: true,
      toolName: "edit",
      args: {
        path,
        oldString: "BEFORE_INTENT_TOOL",
        newString: "AFTER_INTENT_TOOL",
      },
    });
    await prompt(
      intent.id,
      "Fixture transition bookkeeping: perform the deterministic edit.",
    );
    const stored = (await api("GET", `/api/session/${intent.id}`)).data.metadata
      .intentGate;
    assert.equal(readFileSync(path, "utf8"), "AFTER_INTENT_TOOL\n");
    assert.equal(stored.phase, "building");
    assert.ok(stored.seq >= 3);
    const queries = records().filter(
      (row: any) =>
        row.type === "query" && row.marker === "INTENT" && row.primary,
    );
    assert.ok(queries.some((row: any) => row.append.includes("[PLANNING]")));
    assert.ok(queries.some((row: any) => row.append.includes("[RE-PLANNING]")));
    result.intent = {
      sessionID: intent.id,
      phase: stored.phase,
      seq: stored.seq,
      queryStarts: queries.length,
      result: "pass",
    };

    const ledger = await create();
    await api("PATCH", `/api/session/${ledger.id}`, {
      metadata: {
        ssdSpecVerifyReports: {
          reports: [
            {
              reportId: "fixture-report",
              scope: ["specs/fixture.md"],
              verdict: "NO_PASS",
              status: "open",
              createdAt: Date.now(),
              cycleCount: 0,
              findings: [
                {
                  id: "F1",
                  source: "user-decision",
                  specPath: "specs/fixture.md",
                  location: "spec-level",
                  severity: "blocking",
                  verdict: "DECISION",
                  claimSummary: "PACKED_LEDGER_CLAIM",
                  requirementToClose: "Record the fixture user's choice",
                  status: "open",
                  stuckCount: 0,
                  responses: [],
                },
              ],
            },
          ],
        },
      },
    });
    set({
      marker: "LEDGER",
      tool: true,
      toolName: "question",
      args: {
        questions: [
          {
            header: "F1",
            question: "Fixture user decision",
            options: [
              {
                label: "PACKED_USER_ANSWER",
                description: "Deterministic fixture choice",
              },
            ],
          },
        ],
      },
    });
    await prompt(
      ledger.id,
      "Record the fixture decision through the question tool.",
    );
    const metadata = (await api("GET", `/api/session/${ledger.id}`)).data
      .metadata;
    const finding = metadata.ssdSpecVerifyReports.reports[0].findings[0];
    assert.equal(finding.userAnswers.length, 1);
    assert.equal(finding.userAnswers[0].text, "PACKED_USER_ANSWER");
    assert.equal(
      finding.status,
      "open",
      "recording an answer does not close the finding",
    );
    assert.ok(
      records().some(
        (row: any) =>
          row.type === "query" &&
          row.marker === "LEDGER" &&
          row.append.includes("cycle 0: PACKED_USER_ANSWER"),
      ),
    );
    result.ledger = {
      sessionID: ledger.id,
      answers: finding.userAnswers,
      status: finding.status,
      result: "pass",
    };
  }

  set({ marker: "INTERRUPT", tool: false });
  const interrupted = await create();
  await api("POST", `/api/session/${interrupted.id}/prompt`, {
    text: "Wait for the fixture interruption.",
  });
  await poll(
    () =>
      records().some(
        (row: any) =>
          row.type === "query" && row.marker === "INTERRUPT" && row.primary,
      ),
    "primary query starts",
  );
  await api("POST", `/api/session/${interrupted.id}/interrupt`, {
    resume: false,
  });
  await wait(interrupted.id);
  assert.ok(
    records().some(
      (row: any) => row.type === "interrupted" && row.marker === "INTERRUPT",
    ),
  );
  assert.ok(
    records().some(
      (row: any) => row.type === "closed" && row.marker === "INTERRUPT",
    ),
  );
  set({ marker: "RESUMED", tool: false, reply: "AFTER_RESUME" });
  await prompt(interrupted.id, "Resume after the fixture interruption.");
  const resumed = await api("GET", `/api/session/${interrupted.id}/context`);
  assert.ok(JSON.stringify(resumed).includes("AFTER_RESUME"));
  assert.ok(
    resumed.data.some(
      (message: any) =>
        message.type === "idle" && message.outcome === "interrupted",
    ),
  );
  result.interruptResume = { sessionID: interrupted.id, result: "pass" };

  set({
    marker: "TRANSFER_OUT",
    tool: false,
    reply: "TRANSFER_CLAUDE_RESPONSE",
  });
  const transfer = await create("fixture");
  await prompt(transfer.id, "TRANSFER_ORIGINAL_USER");
  await api("POST", `/api/session/${transfer.id}/model`, {
    model: { providerID: "fixture", id: "fixture" },
  });
  await prompt(transfer.id, "TRANSFER_OTHER_PROVIDER");
  assert.ok(
    fallbackRequests.some((request: any) =>
      JSON.stringify(request).includes("TRANSFER_ORIGINAL_USER"),
    ),
  );
  await api("POST", `/api/session/${transfer.id}/model`, {
    model: { providerID: "claude-code", id: model },
  });
  set({ marker: "TRANSFER_RETURN", tool: false, reply: "TRANSFER_RETURNED" });
  await prompt(transfer.id, "TRANSFER_BACK_TO_CLAUDE");
  const roundtrip = await api("GET", `/api/session/${transfer.id}/context`);
  assert.ok(JSON.stringify(roundtrip).includes("TRANSFER_RETURNED"));
  const inputs = records().filter(
    (row: any) =>
      row.type === "query-input" && row.marker === "TRANSFER_RETURN",
  );
  result.providerRoundtrip = {
    sessionID: transfer.id,
    originalUserForwarded: true,
    foreignAnswerInResumedInput: inputs.some((row: any) =>
      row.text.includes("FALLBACK_COMPLETED"),
    ),
    result: "pass",
    caveat:
      "Text transcript transfer is not a lossless native SDK conversation conversion",
  };

  set({ marker: "SUBSTITUTION", tool: false, reply: "SUBSTITUTED_ANSWER" });
  const substituted = (
    await api("POST", "/api/session", {
      location: { directory: project },
      agent: "fixture",
      model: {
        providerID: "claude-code",
        id: "claude-fable-5-1",
        variant: "medium",
      },
    })
  ).data;
  await prompt(substituted.id, "Controlled provider substitution fixture.");
  const selection = (await api("GET", `/api/session/${substituted.id}`)).data
    .model;
  const visible = JSON.stringify(
    await api("GET", `/api/session/${substituted.id}/context`),
  );
  assert.equal(selection.id, "claude-opus-5-5");
  assert.equal(selection.variant, "medium");
  assert.ok(
    visible.includes("declined this request") &&
      visible.includes("Opus 5.5 answered") &&
      visible.includes("SUBSTITUTED_ANSWER"),
  );
  result.visibleSubstitution = {
    sessionID: substituted.id,
    requested: "claude-fable-5-1",
    actual: selection.id,
    variant: selection.variant,
    visibleNotice: true,
    result: "pass",
  };

  set({
    marker: "BG",
    tool: false,
    usage: { input_tokens: 75000, output_tokens: 10 },
  });
  const background = await create();
  await prompt(background.id, "BG_USER_" + "x".repeat(260000));
  const second = prompt(background.id, "BG_SECOND_BOUNDARY");
  await poll(
    () =>
      records().some((row: any) => row.type === "summary-held") &&
      records().filter(
        (row: any) =>
          row.type === "query" && row.primary && row.marker === "BG",
      ).length >= 2,
    "primary proceeds while automatic background summary is held",
  );
  set({
    marker: "BG",
    tool: false,
    releaseBG: true,
    usage: { input_tokens: 90000, output_tokens: 10 },
  });
  await second;
  await poll(
    () => records().some((row: any) => row.type === "summary-released"),
    "release speculative summary",
  );
  await prompt(background.id, "BG_THIRD_BOUNDARY");
  await prompt(background.id, "BG_APPLY_BOUNDARY");
  const events = [
    ...new Map(
      records()
        .filter(
          (row: any) =>
            row.type === "runtime-event" &&
            row.event.type.startsWith("session.compaction.") &&
            row.event.data.sessionID === background.id,
        )
        .map((row: any) => [row.event.id, row.event]),
    ).values(),
  ] as any[];
  assert.ok(
    events.some(
      (event) =>
        event.type === "session.compaction.started" &&
        event.data.reason === "auto",
    ),
  );
  const context = await api("GET", `/api/session/${background.id}/context`);
  writeFileSync(
    join(root, "background-context.json"),
    JSON.stringify(context, null, 2),
  );
  const checkpoints = context.data.filter(
    (message: any) => message.type === "compaction",
  );
  assert.ok(
    checkpoints.some(
      (message: any) =>
        message.reason === "auto" && message.status === "completed",
    ),
  );
  result.backgroundCompaction = {
    sessionID: background.id,
    events,
    automatic: true,
    completedCheckpoints: checkpoints.length,
    primaryProceededWhileSummaryHeld: true,
    result: "pass",
  };
  writeFileSync(
    join(root, "extended-results.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify({ extendedRoot: root, result }));
}
