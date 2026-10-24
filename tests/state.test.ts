// State-transition tests for the acceptance table (brief §12), using the deterministic mock through the
// same controller validation and application path as live reasoning.
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyEvent } from "../shared/applyEvent";
import { buildSynthesis } from "../shared/synthesis";
import { eventsAfter } from "../backend/src/domain/events";
import { assessClaim } from "../backend/src/domain/evidence";
import { correctTurn, createInterview, getInterview, startInterview } from "../backend/src/domain/interviews";
import { addDirective } from "../backend/src/domain/memory";
import { approvePlan, editQuestion, planHasUnapprovedChanges, runPlanner } from "../backend/src/domain/planning";
import { addThesisDocument, createProject } from "../backend/src/domain/projects";
import { buildSnapshot } from "../backend/src/domain/records";
import { buildPlanDocx } from "../backend/src/export/planDocx";
import { renderReport } from "../backend/src/export/report";
import { parseExpertCsv } from "../backend/src/ingest/csv";
import { extractDocxText } from "../backend/src/ingest/docx";
import { MockReasoningProvider } from "../backend/src/providers/mock";
import { OPERATOR_SCRIPT } from "../backend/src/providers/northstarFixture";
import type { ReasoningProvider } from "../backend/src/providers/types";
import { answer, askedKeys, coverage, decisions, deliveries, expertByName, lifecycle, makeEnv, questionByKey, respond, snap, startSynthetic, tick, waitFor, type TestEnv } from "./helpers";

let env: TestEnv;
let mock: MockReasoningProvider;
let pid: string;
beforeEach(async () => {
  mock = new MockReasoningProvider();
  env = makeEnv({}, { mock });
  pid = await env.svc.seedNorthstar();
});
afterEach(() => env.cleanup());

const evidenceRows = (iid?: string) =>
  (iid ? env.svc.db.prepare("SELECT * FROM evidence WHERE interview_id = ?").all(iid) : env.svc.db.prepare("SELECT * FROM evidence WHERE project_id = ?").all(pid)) as any[];
const claimByCode = (code: string) => env.svc.db.prepare("SELECT * FROM claims WHERE project_id = ? AND code = ? AND status = 'active'").get(pid, code) as any;

describe("planning", () => {
  it("produces source-linked claims, grounded rankings, editable questions, an approved version, and a DOCX export", async () => {
    const s = snap(env.svc, pid);
    const claims = Object.values(s.claims);
    expect(claims.length).toBe(5);
    const passages = new Map(Object.values(s.documents).flatMap((d) => d.passages).map((p) => [p.id, p.text]));
    for (const c of claims) {
      expect(c.passageIds.length).toBeGreaterThan(0);
      for (const p of c.passageIds) expect(passages.has(p)).toBe(true);
    }
    const ranks = Object.values(s.rankings);
    expect(ranks.filter((r) => r.recommended).length).toBe(3);
    for (const r of ranks) expect(s.experts[r.expertId].background).toContain(r.backgroundQuote);
    const q = questionByKey(env.svc, pid, "q_pricing");
    editQuestion(env.svc.ctx, pid, q.id, { text: "How do insurer reimbursement limits compare with planned fee increases?" }, "consultant");
    const revs = env.svc.db.prepare("SELECT revision, text FROM question_revisions WHERE question_id = ? ORDER BY revision").all(q.id) as any[];
    expect(revs.map((r) => r.revision)).toEqual([1, 2]);
    expect(revs[0].text).toMatch(/typical annual fee increases/);
    expect(planHasUnapprovedChanges(env.svc.ctx, pid)).toBe(true);
    approvePlan(env.svc.ctx, pid, "consultant", "edited pricing question");
    const plan = snap(env.svc, pid).plans[snap(env.svc, pid).project.currentPlanId!];
    expect(plan.version).toBe(2);
    expect(plan.status).toBe("approved");
    expect(planHasUnapprovedChanges(env.svc.ctx, pid)).toBe(false);
    const zip = await JSZip.loadAsync(await buildPlanDocx(snap(env.svc, pid)));
    const xml = await zip.file("word/document.xml")!.async("string");
    expect(xml).toContain("SYNTHETIC");
    expect(xml).toContain("How do insurer reimbursement limits compare with planned fee increases?");
  });

  it("rejects an invalid planner proposal without any persistent change", async () => {
    const bad: ReasoningProvider = {
      ...mock,
      name: "mock",
      model: null,
      plan: async () => ({ claims: [{ ref: "C1", assertion: "Invented", passage_ids: ["psg_does_not_exist"] }] }),
      control: mock.control.bind(mock),
      copilot: mock.copilot.bind(mock),
    };
    const before = snap(env.svc, pid);
    await expect(runPlanner(env.svc.ctx, bad, pid)).rejects.toMatchObject({ status: 502 });
    const after = snap(env.svc, pid);
    expect(Object.keys(after.claims)).toEqual(Object.keys(before.claims));
    expect(Object.keys(after.plans)).toEqual(Object.keys(before.plans));
  });

  it("re-planning keeps claims with evidence under their codes and never reuses or duplicates a code", async () => {
    const before = Object.values(snap(env.svc, pid).claims).filter((c) => c.status === "active");
    const withEvidence = before.filter((c) => env.svc.db.prepare("SELECT 1 FROM evidence_claim_links WHERE claim_id = ?").get(c.id));
    expect(withEvidence.length).toBeGreaterThan(0);
    expect(withEvidence.length).toBeLessThan(before.length);
    await runPlanner(env.svc.ctx, mock, pid);
    const all = Object.values(snap(env.svc, pid).claims);
    const active = all.filter((c) => c.status === "active");
    expect(new Set(active.map((c) => c.code)).size).toBe(active.length);
    expect(new Set(all.map((c) => c.code)).size).toBe(all.length);
    for (const c of withEvidence) expect(active.find((a) => a.id === c.id)?.code).toBe(c.code);
  });

  it("labels heuristic plans for non-fixture content and never invents source passages", async () => {
    const p2 = createProject(env.svc.ctx, { company: "Acme Logistics", objective: "Test growth claims." });
    addThesisDocument(env.svc.ctx, env.svc.config.dataDir, p2, { kind: "pasted", text: "Acme grows revenue 12% a year.\n\nCustomer retention exceeds 95%.\n\nWarehouses run at 70% utilisation." });
    await runPlanner(env.svc.ctx, mock, p2);
    const s = snap(env.svc, p2);
    const passageTexts = Object.values(s.documents).flatMap((d) => d.passages);
    for (const c of Object.values(s.claims)) {
      expect(c.passageIds.length).toBeGreaterThan(0);
      for (const id of c.passageIds) expect(passageTexts.some((p) => p.id === id)).toBe(true);
    }
    expect(Object.values(s.rankings).length).toBe(0); // empty expert pool
    expect(s.plans[s.project.currentPlanId!].gaps.some((g) => /expert/i.test(g.description))).toBe(true);
  });
});

describe("controller loop on the deterministic Northstar operator interview", () => {
  it("runs the adaptive demo: indirect answers, unknown answers, a private directive, neutral follow-ups, findings, and memory", async () => {
    const iid = await startSynthetic(env.svc, pid, "Dana Whitfield");
    expect(askedKeys(env.svc, iid)).toEqual(["q_staffing"]);
    await respond(env.svc, iid); // operator:1 answers staffing and, indirectly, capacity
    const qCap = questionByKey(env.svc, pid, "q_capacity");
    expect(coverage(env.svc, iid, questionByKey(env.svc, pid, "q_staffing").id)).toBe("answered");
    expect(coverage(env.svc, iid, qCap.id)).toBe("answered");
    expect(claimByCode("C3").gaps).toMatch(/staffing shortfall/);
    expect(askedKeys(env.svc, iid)).toEqual(["q_staffing", "q_cancellations"]);

    // Private directive: becomes a neutral follow-up; the expert never hears the consultant's words.
    const instruction = "Ask the operator whether the cancellations were concentrated in specific clinics.";
    addDirective(env.svc.ctx, pid, instruction, [], "consultant");
    env.svc.engine.onResearchChange(pid);
    await env.svc.engine.whenIdle(iid);
    expect(askedKeys(env.svc, iid)).toEqual(["q_staffing", "q_cancellations"]); // waits for the pending answer
    await respond(env.svc, iid); // operator:5 cannot answer the network-wide trend
    expect(coverage(env.svc, iid, questionByKey(env.svc, pid, "q_cancellations").id)).toBe("unable_to_answer");
    expect(askedKeys(env.svc, iid)).toEqual(["q_staffing", "q_cancellations", "f_locations"]);
    expect(env.svc.db.prepare("SELECT COUNT(*) AS n FROM questions WHERE project_id = ? AND fixture_key = 'f_locations'").get(pid)).toEqual({ n: 1 }); // no duplicate follow-up
    for (const d of deliveries(env.svc, iid)) expect(d.authorized_text).not.toContain("Ask the operator");
    await respond(env.svc, iid); // operator:2
    expect(askedKeys(env.svc, iid).at(-1)).toBe("f_disruption_types");
    await respond(env.svc, iid); // operator:3
    expect(lifecycle(env.svc, iid)).toBe("ended");
    expect(deliveries(env.svc, iid).at(-1)!.kind).toBe("closing");

    const s = snap(env.svc, pid);
    const findings = Object.values(s.findings);
    expect(findings.map((f) => f.kind).sort()).toEqual(["possible_consequence", "possible_constraint"]);
    for (const f of findings) {
      const experts = new Set(f.evidenceIds.map((id) => s.experts[s.evidence[id].expertId].name));
      expect(experts.has("Dana Whitfield") && experts.has("Priya Raman")).toBe(true); // both sources cited
    }
    // Metric mismatch: the single-clinic 12% estimate is not comparable, so churn is not "contradicted".
    const twelve = Object.values(s.evidence).find((e) => e.quote.includes("twelve percent"))!;
    expect(twelve.basis).toBe("estimate");
    expect(twelve.links[0].comparability).toBe("not_comparable");
    expect(claimByCode("C1").assessment).toBe("inconclusive");
    // Every citation resolves to the exact span of the cited turn version.
    for (const e of Object.values(s.evidence)) {
      const t = s.turns[e.turnId];
      const v = t.versions.find((x) => x.version === e.turnVersion)!;
      expect(v.text.slice(e.spanStart, e.spanEnd)).toBe(e.quote);
      expect(t.speaker).toBe("expert");
    }
  });

  it("gives a reused plan interview-specific coverage while earlier evidence stays available", async () => {
    const iid = await startSynthetic(env.svc, pid, "Dana Whitfield");
    await respond(env.svc, iid);
    env.svc.engine.stop(iid, "consultant_ended");
    const before = evidenceRows().length;
    const iid2 = await startSynthetic(env.svc, pid, "Tom Becker");
    for (const q of env.svc.db.prepare("SELECT id FROM questions WHERE project_id = ? AND status = 'active'").all(pid) as any[]) expect(coverage(env.svc, iid2, q.id)).toBe("pending");
    expect(evidenceRows().length).toBe(before);
    expect(coverage(env.svc, iid, questionByKey(env.svc, pid, "q_staffing").id)).toBe("answered");
  });

  it("records an unknown answer for this expert while the project gap stays open", async () => {
    const iid = await startSynthetic(env.svc, pid, "Tom Becker");
    const first = deliveries(env.svc, iid).find((d) => d.kind === "question")!;
    await answer(env.svc, iid, "I don't know, that was not something I tracked.");
    expect(coverage(env.svc, iid, first.question_id)).toBe("unable_to_answer");
    expect(evidenceRows(iid).length).toBe(0);
    const q = env.svc.db.prepare("SELECT status FROM questions WHERE id = ?").get(first.question_id) as any;
    expect(q.status).toBe("active");
  });

  it("does not call a scope mismatch a contradiction", async () => {
    const iid = await startSynthetic(env.svc, pid, "Dana Whitfield");
    await respond(env.svc, iid); // operator:1: vacancies in one region, not a network turnover rate
    const vacancies = evidenceRows(iid).find((e) => e.quote.includes("four hygienist positions short"))!;
    const link = env.svc.db.prepare("SELECT relation, comparability FROM evidence_claim_links WHERE evidence_id = ? AND claim_id = ?").get(vacancies.id, claimByCode("C5").id) as any;
    expect(link).toEqual({ relation: "challenges", comparability: "unclear" });
    expect(claimByCode("C5").assessment).toBe("inconclusive");
  });

  it("keeps both sides of conflicting comparable evidence visible and assesses the claim as mixed", async () => {
    const iid = await startSynthetic(env.svc, pid, "Dana Whitfield");
    await respond(env.svc, iid);
    const c5 = claimByCode("C5").id;
    const against = "Across the whole network our 2024 hygienist turnover was about double the Ontario average.";
    const support = "In 2023 our hygienist turnover was in line with the Ontario average, before the 2024 gaps.";
    mock.controlHook = (env2, p) => {
      const turn = env2.context.newTurns.find((t) => t.speaker === "expert" && (t.text === against || t.text === support));
      if (!turn) return p;
      const sup = turn.text === support;
      return {
        ...p,
        observations: [
          {
            ref: "x1",
            turn_id: turn.id,
            quote: sup ? "In 2023 our hygienist turnover was in line with the Ontario average" : "our 2024 hygienist turnover was about double the Ontario average",
            statement: sup ? "Operator reports 2023 network turnover in line with the provincial average." : "Operator reports 2024 network turnover about double the provincial average.",
            basis: "direct_observation",
            period: sup ? "2023" : "2024",
            population: "Northstar network",
            metric: "Hygienist turnover vs Ontario average",
            unit: null,
            calc_basis: null,
            value: null,
            claim_links: [{ claim_id: c5, relation: sup ? "supports" : "challenges", comparability: "comparable", note: "Same metric and basis." }],
            supersedes_evidence_ids: [],
            retracts_evidence_ids: [],
          },
        ],
      };
    };
    await answer(env.svc, iid, against);
    expect(claimByCode("C5").assessment).toBe("contradicted_by_interview");
    await answer(env.svc, iid, support);
    expect(claimByCode("C5").assessment).toBe("mixed_evidence");
    const syn = buildSynthesis(snap(env.svc, pid)).claims.find((c) => c.claim.code === "C5")!;
    expect(syn.supporting.length).toBe(1);
    expect(syn.challenging.length).toBeGreaterThan(1); // the earlier regional observation stays visible too
    expect(assessClaim([{ relation: "supports", comparability: "not_comparable", disputed: false, interviewId: "a" }]).assessment).toBe("inconclusive");
  });

  it("lets new participant testimony supersede earlier evidence without rewriting history", async () => {
    const iid = await startSynthetic(env.svc, pid, "Dana Whitfield");
    await respond(env.svc, iid);
    const original = evidenceRows(iid).find((e) => e.quote.includes("four hygienist positions short"))!;
    const text = "Correction: it was six hygienist positions short across my eleven clinics, not four.";
    mock.controlHook = (env2, p) => {
      const turn = env2.context.newTurns.find((t) => t.text === text);
      if (!turn) return p;
      return {
        ...p,
        observations: [
          {
            ref: "c1",
            turn_id: turn.id,
            quote: "it was six hygienist positions short across my eleven clinics",
            statement: "Operator corrects the shortfall to six positions.",
            basis: "direct_observation",
            period: "mid-2024",
            population: "Eleven Eastern Ontario clinics",
            metric: "Unfilled hygienist positions",
            unit: "positions",
            calc_basis: null,
            value: "6",
            claim_links: [{ claim_id: claimByCode("C5").id, relation: "challenges", comparability: "comparable", note: "Corrected figure." }],
            supersedes_evidence_ids: [original.id],
            retracts_evidence_ids: [],
          },
        ],
      };
    };
    await answer(env.svc, iid, text);
    const old = env.svc.db.prepare("SELECT * FROM evidence WHERE id = ?").get(original.id) as any;
    expect(old.status).toBe("superseded");
    expect(old.quote).toBe(original.quote);
    const replacement = env.svc.db.prepare("SELECT * FROM evidence WHERE id = ?").get(old.superseded_by) as any;
    expect(replacement.value).toBe("6");
    expect(renderReport(snap(env.svc, pid))).toContain("Superseded, retracted, or invalidated");
  });

  it("invalidates and re-extracts dependent evidence after an ASR correction", async () => {
    const iid = await startSynthetic(env.svc, pid, "Dana Whitfield");
    await respond(env.svc, iid); // staffing
    await respond(env.svc, iid); // cancellations: unable
    await respond(env.svc, iid); // f_locations
    await respond(env.svc, iid); // f_disruption_types (12% estimate)
    const turn = env.svc.db.prepare("SELECT * FROM transcript_turns WHERE interview_id = ? AND source_event_id = 'fixture:operator:3'").get(iid) as any;
    const corrected = OPERATOR_SCRIPT.f_disruption_types.text.replace("around twelve percent", "around fifteen percent");
    correctTurn(env.svc.ctx, pid, turn.id, corrected, "consultant");
    await env.svc.engine.reextract(iid, turn.id);
    const rows = env.svc.db.prepare("SELECT * FROM evidence WHERE turn_id = ? ORDER BY created_at").all(turn.id) as any[];
    const v1 = rows.filter((e) => e.turn_version === 1);
    const v2 = rows.filter((e) => e.turn_version === 2 && e.status === "active");
    expect(v1.every((e) => e.status === "invalidated")).toBe(true);
    expect(v2.map((e) => e.quote)).toEqual(["Most clinic-initiated cancellations were rebooked, maybe two-thirds."]); // the 12% quote no longer exists
    expect(lifecycle(env.svc, iid)).toBe("ended"); // re-extraction never restarts the interview
    const s = snap(env.svc, pid);
    for (const e of Object.values(s.evidence).filter((x) => x.status === "active")) {
      const v = s.turns[e.turnId].versions.find((x) => x.version === e.turnVersion)!;
      expect(v.text.slice(e.spanStart, e.spanEnd)).toBe(e.quote);
    }
  });

  it("rejects invalid model data without partial changes, then retries once", async () => {
    const iid = await startSynthetic(env.svc, pid, "Dana Whitfield");
    let calls = 0;
    mock.controlHook = (env2, p) => {
      calls++;
      if (calls === 1) {
        const turn = env2.context.newTurns.find((t) => t.speaker === "expert")!;
        // Valid shape, but one quote is not in the transcript: the whole proposal must be rejected.
        return { ...p, observations: [...p.observations, { ...p.observations[0], ref: "bad", quote: "a sentence the expert never said", turn_id: turn.id }] };
      }
      if (calls === 2) return { totally: "wrong shape" };
      return p;
    };
    const evBefore = evidenceRows(iid).length;
    const deliveriesBefore = deliveries(env.svc, iid).length;
    env.svc.engine.respondScripted(iid);
    await env.svc.engine.whenIdle(iid);
    const ds = decisions(env.svc, iid).filter((d) => d.trigger.includes("expert_turn"));
    expect(ds.map((d) => d.result)).toEqual(["rejected_invalid", "rejected_invalid"]);
    expect(JSON.parse(ds[0].rejection_reasons).join(" ")).toMatch(/not an exact span/);
    expect(evidenceRows(iid).length).toBe(evBefore);
    expect(deliveries(env.svc, iid).length).toBe(deliveriesBefore);
    expect(coverage(env.svc, iid, questionByKey(env.svc, pid, "q_staffing").id)).toBe("pending");
  });

  it("ignores duplicate turn events and records late transcripts after the end as evidence only", async () => {
    const iid = await startSynthetic(env.svc, pid, "Tom Becker");
    const t1 = env.svc.engine.submitTypedTurn(iid, "Vacancies lasted about three months on average.", "evt_dup_1");
    const t2 = env.svc.engine.submitTypedTurn(iid, "Vacancies lasted about three months on average.", "evt_dup_1");
    await env.svc.engine.whenIdle(iid);
    expect(t1).toBe(t2);
    expect(decisions(env.svc, iid).filter((d) => d.trigger === "expert_turn").length).toBe(1);
    const evCount = evidenceRows(iid).length;
    env.svc.engine.stop(iid, "consultant_ended");
    const nDeliveries = deliveries(env.svc, iid).length;
    env.svc.engine.submitTypedTurn(iid, "One more thing: wage offers rose 15% in 2024.", "evt_late");
    await env.svc.engine.whenIdle(iid);
    expect(lifecycle(env.svc, iid)).toBe("ended");
    expect(deliveries(env.svc, iid).length).toBe(nDeliveries);
    const late = env.svc.db.prepare("SELECT after_end FROM transcript_turns WHERE interview_id = ? AND source_event_id = 'evt_late'").get(iid) as any;
    expect(late.after_end).toBe(1);
    expect(evidenceRows(iid).length).toBe(evCount + 1);
  });

  it("discards a stale decision when the consultant edits a question during reasoning, and never speaks the old wording", async () => {
    const iid = await startSynthetic(env.svc, pid, "Dana Whitfield");
    let release!: () => void;
    let held = false;
    mock.controlHook = async (_e, p) => {
      if (!held) {
        held = true;
        await new Promise<void>((r) => (release = r));
      }
      return p;
    };
    env.svc.engine.respondScripted(iid);
    await waitFor(() => held, 2000, "controller in flight");
    const q = questionByKey(env.svc, pid, "q_cancellations");
    const oldText = q.text ?? (env.svc.db.prepare("SELECT text FROM question_revisions WHERE question_id = ? AND revision = 1").get(q.id) as any).text;
    const newText = "Thinking about the clinics you oversaw, how often were appointments cancelled or moved, and who initiated those changes?";
    editQuestion(env.svc.ctx, pid, q.id, { text: newText }, "consultant");
    release();
    await env.svc.engine.whenIdle(iid);
    const results = decisions(env.svc, iid).map((d) => d.result);
    expect(results).toContain("rejected_stale");
    const texts = deliveries(env.svc, iid).map((d) => d.authorized_text);
    expect(texts).toContain(newText);
    expect(texts).not.toContain(oldText);
  });

  it("stops pending work on opt-out and when the consultant ends mid-reasoning", async () => {
    const expertId = expertByName(env.svc, pid, "Dana Whitfield");
    const iid = createInterview(env.svc.ctx, pid, expertId, "synthetic", false);
    startInterview(env.svc.ctx, iid, 60);
    env.svc.engine.onStarted(iid);
    env.svc.engine.consent(iid, false);
    expect(getInterview(env.svc.ctx, iid).consent).toBe("declined");
    expect(deliveries(env.svc, iid).filter((d) => d.kind === "question").length).toBe(0);

    const iid2 = await startSynthetic(env.svc, pid, "Tom Becker");
    let release!: () => void;
    mock.controlHook = async (_e, p) => {
      await new Promise<void>((r) => (release = r));
      return p;
    };
    env.svc.engine.submitTypedTurn(iid2, "Vacancies took four months to fill.");
    await waitFor(() => !!release, 2000, "controller in flight");
    const n = deliveries(env.svc, iid2).length;
    env.svc.engine.stop(iid2, "consultant_ended");
    release();
    await env.svc.engine.whenIdle(iid2);
    expect(deliveries(env.svc, iid2).length).toBe(n);
    expect(decisions(env.svc, iid2).at(-1)!.result).toBe("rejected_stale");
    expect(lifecycle(env.svc, iid2)).toBe("ended");
  });
});

describe("consistency, persistence, and boundaries", () => {
  it("restores state from a snapshot plus ordered events without replaying completed questions", async () => {
    const iid = await startSynthetic(env.svc, pid, "Dana Whitfield");
    const early = snap(env.svc, pid);
    await respond(env.svc, iid);
    await respond(env.svc, iid);
    let s = early;
    for (const e of eventsAfter(env.svc.db, pid, early.project.stateRevision, 10000)) {
      expect(e.revision).toBe(s.project.stateRevision + 1);
      s = applyEvent(s, e);
    }
    expect(JSON.parse(JSON.stringify(s))).toEqual(JSON.parse(JSON.stringify(snap(env.svc, pid))));
    // Restart: the live interview becomes interrupted (resumable); completed questions are not replayed.
    const asked = askedKeys(env.svc, iid);
    expect(env.svc.recover()).toContain(iid);
    expect(lifecycle(env.svc, iid)).toBe("interrupted");
    expect(askedKeys(env.svc, iid)).toEqual(asked);
  });

  it("answers “Where were we?” in a fresh process from saved state with citations", async () => {
    const iid = await startSynthetic(env.svc, pid, "Dana Whitfield");
    for (let i = 0; i < 4; i++) await respond(env.svc, iid);
    const dir = env.dir;
    env.svc.close();
    const env2 = makeEnv({ dataDir: dir });
    try {
      const out = await env2.svc.copilotText(pid, "Where were we?");
      expect(out.reply).toMatch(/Where we were/);
      expect(out.reply).toMatch(/Citations:/);
      expect(out.reply).toMatch(/Dana Whitfield, turn \d+ v1: "/);
      expect(out.navigation?.kind).toBe("turn");
      const msgs = env2.svc.db.prepare("SELECT role FROM copilot_messages WHERE project_id = ?").all(pid) as any[];
      expect(msgs.map((m) => m.role)).toContain("assistant");
    } finally {
      env2.svc.close();
    }
    env = makeEnv({ dataDir: dir }); // so afterEach cleanup works
  });

  it("reports missing credentials per mode and keeps the synthetic demo available", () => {
    const caps = env.svc.capabilities();
    expect(caps.modes.find((m) => m.mode === "synthetic")!.available).toBe(true);
    expect(caps.modes.find((m) => m.mode === "live_voice")!.requirement).toMatch(/BOSON_API_KEY and ANTHROPIC_API_KEY/);
    expect(() => env.svc.assertModeAvailable("live_voice")).toThrow(/unavailable/);
    expect(caps.reasoningProvider).toBe("mock");
  });

  it("allows only one active expert interview even with back-to-back start requests", () => {
    const a = createInterview(env.svc.ctx, pid, expertByName(env.svc, pid, "Dana Whitfield"), "synthetic", false);
    const b = createInterview(env.svc.ctx, pid, expertByName(env.svc, pid, "Tom Becker"), "synthetic", false);
    const results = [a, b].map((id) => {
      try {
        startInterview(env.svc.ctx, id, 60);
        return "started";
      } catch (e) {
        return (e as any).code;
      }
    });
    expect(results).toEqual(["started", "interview_already_active"]);
    expect((env.svc.db.prepare("SELECT COUNT(*) AS n FROM interviews WHERE active_slot IS NOT NULL").get() as any).n).toBe(1);
  });

  it("rejects malformed DOCX, decompression bombs, and invalid CSV rows with clear errors", async () => {
    await expect(extractDocxText(Buffer.from("definitely not a zip"), 5_000_000)).rejects.toMatchObject({ status: 400 });
    const bomb = new JSZip();
    bomb.file("[Content_Types].xml", "<Types/>");
    bomb.file("word/document.xml", "<w:document>" + "A".repeat(45_000_000) + "</w:document>");
    const buf = await bomb.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } });
    await expect(extractDocxText(buf, 5_000_000)).rejects.toMatchObject({ status: 400 });
    const noDoc = new JSZip();
    noDoc.file("hello.txt", "hi");
    await expect(extractDocxText(await noDoc.generateAsync({ type: "nodebuffer" }), 5_000_000)).rejects.toMatchObject({ status: 400 });
    expect(() => parseExpertCsv(Buffer.from("full_name,email\nA,a@b.c\n"))).toThrow(/background/);
    const r = parseExpertCsv(Buffer.from("name,background\nAlice,Ten years in dental operations\n,missing name\nBob,\n"));
    expect(r.valid.map((v) => v.expert.name)).toEqual(["Alice"]);
    expect(r.errors.map((e) => e.row)).toEqual([3, 4]);
    expect(() => parseExpertCsv(Buffer.alloc(0))).toThrow(/empty/);
  });

  it("keeps consultant directives private: never transcript, never evidence, never spoken verbatim", async () => {
    const iid = await startSynthetic(env.svc, pid, "Tom Becker");
    const secret = "Investigate whether the CFO is hiding churn from lenders";
    await env.svc.copilotText(pid, secret);
    await env.svc.engine.whenIdle(iid);
    const turns = env.svc.db.prepare("SELECT v.text FROM transcript_turns t JOIN transcript_versions v ON v.turn_id = t.id WHERE t.interview_id = ?").all(iid) as any[];
    expect(turns.some((t) => t.text.includes("CFO"))).toBe(false);
    expect(evidenceRows(iid).some((e) => e.quote.includes("CFO"))).toBe(false);
    for (const d of deliveries(env.svc, iid)) expect(d.authorized_text).not.toContain(secret);
    await tick(0);
  });
});
