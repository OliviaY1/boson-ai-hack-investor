import { describe, expect, it } from "vitest";
import { seedProjects } from "@/lib/mock-data";
import {
  addInterviewQuestion,
  advanceMockInterview,
  createInterviewsFromPlan,
  generateMockResearchPlan,
  missingSamples,
  startMockInterview,
  withoutProject,
} from "@/lib/mock-service";

const david = () =>
  startMockInterview(seedProjects()[0]!.interviews.find((i) => i.expertId === "e-david")!);

describe("interview simulation", () => {
  it("consultant follow-up is asked before remaining planned questions", () => {
    let iv = addInterviewQuestion(
      david(),
      "Are staffing shortages causing appointment cancellations?",
    );
    iv = advanceMockInterview(iv); // AI asks the follow-up
    expect(iv.transcript.at(-1)?.text).toContain("staffing shortages");
    iv = advanceMockInterview(iv); // expert answers
    expect(iv.findings.map((f) => f.id)).toContain("f-link");
  });

  it("interview completes after all questions answered", () => {
    let iv = david();
    for (let i = 0; i < 11; i++) iv = advanceMockInterview(iv);
    expect(iv.status).toBe("Completed");
  });
});

import {
  advanceMockInterview as adv,
  autoLaunchInterviews,
  canRecommendNextRound,
  completeMockInterview,
  generateMockFindings,
  pauseMockInterview,
  startNextRound,
} from "@/lib/mock-service";

describe("research rounds", () => {
  it("shows evidence from completed custom interviews without claiming the thesis is supported", () => {
    const seed = seedProjects().find((p) => p.id === "harbor");
    if (!seed) throw new Error("Missing Harbor fixture");
    const project = { ...seed, selectedExpertIds: seed.experts.map((e) => e.id) };
    const plan = { ...generateMockResearchPlan(project), approved: true };
    let interviews = createInterviewsFromPlan(plan).map(startMockInterview);
    for (let k = 0; k < 12; k++) interviews = interviews.map(advanceMockInterview);
    expect(interviews.every((iv) => iv.status === "Completed")).toBe(true);
    expect(interviews.flatMap((iv) => iv.findings)).toHaveLength(0);
    const done = { ...project, plan, interviews };
    const results = generateMockFindings(done);
    expect(results.findings).toHaveLength(8);
    expect(results.findings.every((f) => f.sentiment === "neutral")).toBe(true);
    expect(results.validation.every((v) => v.assessment === "Insufficient Evidence")).toBe(true);
    for (const finding of results.findings) {
      const iv = interviews.find((i) => i.id === finding.interviewId);
      expect(iv?.transcript.find((t) => t.id === finding.turnId)?.text).toBe(finding.quote);
    }
    expect(generateMockFindings(done)).toEqual(results);
    expect(generateMockFindings(startNextRound(done)).findings).toEqual(results.findings);
  });

  it("proposes Round 2 only after every interview is completed, and keeps Round 1 findings", () => {
    const p = seedProjects()[0]!;
    expect(canRecommendNextRound(p)).toBe(false);
    let ivs = p.interviews.map((i) => startMockInterview(i));
    for (let k = 0; k < 12; k++) ivs = ivs.map(adv);
    const done = { ...p, interviews: ivs.map(completeMockInterview) };
    expect(canRecommendNextRound(done)).toBe(true);
    const r2 = startNextRound(done);
    expect(r2.pastRounds).toHaveLength(1);
    expect(r2.plan!.hypotheses.map((h) => h.id)).toEqual(["h6", "h7"]);
    expect(r2.experts.some((e) => e.id === "e-linda")).toBe(true);
    expect(generateMockFindings(r2).findings.length).toBe(
      generateMockFindings(done).findings.length,
    );
  });
});

describe("automatic interview agents", () => {
  it("starts queued interviews on its own, two at a time, without a consultant pressing start", () => {
    const p = seedProjects()[0]!;
    expect(p.interviews.every((i) => i.status === "Not Started")).toBe(true);

    const started = autoLaunchInterviews(p);
    expect(started.interviews.filter((i) => i.status === "In Progress")).toHaveLength(2);
    expect(started.interviews.filter((i) => i.status === "Not Started")).toHaveLength(
      p.interviews.length - 2,
    );

    // A finished agent's slot is taken by the next queued interview.
    const oneDone = {
      ...started,
      interviews: started.interviews.map((i, idx) => (idx === 0 ? completeMockInterview(i) : i)),
    };
    expect(
      autoLaunchInterviews(oneDone).interviews.filter((i) => i.status === "In Progress"),
    ).toHaveLength(2);

    // A paused interview is never restarted by the scheduler.
    const paused = {
      ...started,
      interviews: started.interviews.map((i, idx) => (idx === 1 ? pauseMockInterview(i) : i)),
    };
    const afterPause = autoLaunchInterviews(paused);
    expect(afterPause.interviews.filter((i) => i.status === "Paused")).toHaveLength(1);
    expect(afterPause.interviews.filter((i) => i.status === "In Progress")).toHaveLength(2);
  });
});

describe("saved projects", () => {
  it("deleting one project leaves the others untouched", () => {
    const ps = seedProjects();
    expect(withoutProject(ps, "northstar").map((p) => p.id)).toEqual(["harbor", "summit"]);
    expect(withoutProject(ps, "not-saved")).toHaveLength(ps.length);
  });

  it("offers sample projects only when they are not already saved", () => {
    const ps = seedProjects();
    expect(missingSamples(ps)).toHaveLength(0);
    expect(missingSamples([]).map((p) => p.id)).toEqual(["northstar", "harbor", "summit"]);
    expect(missingSamples([ps[0]!]).map((p) => p.id)).toEqual(["harbor", "summit"]);
  });
});
