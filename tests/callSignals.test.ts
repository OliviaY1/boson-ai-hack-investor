// The deterministic rules that read a spoken consent answer and an explicit wish to end the call.
import { describe, expect, it } from "vitest";
import { classifyCallEnd, classifyConsent } from "../backend/src/domain/callSignals";
import { CUSTOMER_INTERVIEW, OPERATOR_DEFAULT, OPERATOR_SCRIPT } from "../backend/src/providers/northstarFixture";

describe("spoken consent", () => {
  it.each([
    "Yes.",
    "yeah sure",
    "Sure, go ahead.",
    "Okay, I have a few minutes.",
    "Yes, I'm happy to help.",
    "No problem.",
    "Sure, why not.",
    "Of course",
    "I agree.",
  ])("accepts a clear yes: %s", (t) => expect(classifyConsent(t)).toBe("yes"));

  it.each(["No.", "No thanks, I'm not interested.", "Not right now, sorry.", "I don't have time for this.", "Can you call me back later?", "I'd rather not.", "Please don't call me."])(
    "treats a clear no as a refusal: %s",
    (t) => expect(classifyConsent(t)).toBe("no"),
  );

  it.each(["Hello?", "Who is this?", "I'm not sure.", "Yes, but no recording please, actually no.", "", "Okay... no, wait.", "What is this about?"])(
    "asks again when the answer is not a clear yes or no: %j",
    (t) => expect(classifyConsent(t)).toBe("unclear"),
  );
});

describe("ending the call by voice", () => {
  it.each(["Sorry, I have to go now. Bye.", "I need to go, thanks.", "Okay, bye.", "Goodbye.", "Thanks, bye bye", "Let's end the call.", "I'm going to have to go.", "Talk to you later"])(
    "a goodbye leaves the call: %s",
    (t) => expect(classifyCallEnd(t)).toBe("leave"),
  );

  it.each(["Please stop the interview.", "I don't want to do this anymore.", "I'd like to stop.", "Stop.", "Don't call me again.", "I don't want to continue this call."])(
    "an explicit request to stop withdraws: %s",
    (t) => expect(classifyCallEnd(t)).toBe("withdraw"),
  );

  it.each([
    "I don't want to continue with Northstar after what happened.",
    "I had to go to another dentist in the end.",
    "I have to go to the clinic every six months.",
    "Then I moved my family and we said goodbye to them for good last spring.",
    "They had to stop taking new patients.",
    "We were short four hygienists, so some chairs sat empty.",
  ])("research answers never end the call: %s", (t) => expect(classifyCallEnd(t)).toBeNull());

  it("no line of the scripted demo interviews ends the call", () => {
    const lines = [...CUSTOMER_INTERVIEW.map((s) => s.answer.text), ...Object.values(OPERATOR_SCRIPT).map((u) => u.text), OPERATOR_DEFAULT.text];
    for (const l of lines) expect(classifyCallEnd(l), l).toBeNull();
  });
});
