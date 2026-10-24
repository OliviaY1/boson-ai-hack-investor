import { describe, expect, it } from "vitest";
import { seedProjects } from "@/lib/mock-data";
import { roundsOf, startNextRound } from "@/lib/mock-service";
import { roundIndex } from "@/lib/round-view";

const northstar = () => seedProjects().find((p) => p.id === "northstar")!;

describe("round view state", () => {
  it("follows the current round unless the consultant picks one", () => {
    const p = startNextRound(northstar());
    expect(roundsOf(p).length).toBe(2);
    expect(roundIndex(p, null)).toBe(1);
    expect(roundIndex(p, 0)).toBe(0);
  });

  it("clamps a pick to rounds that actually exist", () => {
    const p = northstar();
    expect(roundsOf(p).length).toBe(1);
    expect(roundIndex(p, 4)).toBe(0);
    expect(roundIndex(p, -2)).toBe(0);
  });
});
