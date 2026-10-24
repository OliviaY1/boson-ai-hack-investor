// Deterministic reading of what a participant says about the call itself (not research content):
// the spoken answer to the consent request, and an explicit wish to end the call. Both are deliberately
// conservative. Consent needs a clear yes with no hedging; anything else is asked again. A call ends
// only on explicit phrasing at the end of an utterance, so research answers such as "I didn't want to
// continue with them" never end it.

export type ConsentReply = "yes" | "no" | "unclear";
export type CallEnd = "leave" | "withdraw" | null;

/** Lowercase words only, apostrophes kept: transcripts vary in punctuation and casing. */
export function normalizeUtterance(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const AFFIRM = [
  /\byes\b/,
  /\byeah\b/,
  /\byep\b/,
  /\byup\b/,
  /\bsure\b/,
  /\bok(ay)?\b/,
  /\bof course\b/,
  /\bcertainly\b/,
  /\babsolutely\b/,
  /\bdefinitely\b/,
  /\bi agree\b/,
  /\bi consent\b/,
  /\bgo ahead\b/,
  /\bsounds good\b/,
  /\bthat'?s fine\b/,
  /\bfine\b/,
  /\ball ?right\b/,
  /\bhappy to\b/,
  /\bglad to\b/,
  /\bi'?m in\b/,
];

const NEGATE = [
  /\bno\b/,
  /\bnope\b/,
  /\bnah\b/,
  /\bnot interested\b/,
  /\b(don'?t|do not|wouldn'?t|would not) (want|like) to\b/,
  /\bdecline\b/,
  /\bnot (now|today|right now|a good time)\b/,
  /\b(i'?m|i am) (busy|not)\b/,
  /\b(can'?t|cannot) (talk|do (this|it)|right now)\b/,
  /\bi'?d rather not\b/,
  /\bnot really\b/,
  /\b(don'?t|do not) have (the |any )?time\b/,
  /\bcall (me )?back\b/,
  /\bremove me\b/,
  /\b(don'?t|do not) call\b/,
];

/** Classify the spoken reply to "Would you be willing to take part?". */
export function classifyConsent(text: string): ConsentReply {
  // Affirmative idioms that contain a negative word, and a negative idiom that contains an affirmative one.
  const t = normalizeUtterance(text)
    .replace(/\b(no problem|not a problem|why not|no worries)\b/g, " yes ")
    .replace(/\bnot sure\b|\bunsure\b/g, " hmm ");
  if (!t) return "unclear";
  const yes = AFFIRM.some((r) => r.test(t));
  const no = NEGATE.some((r) => r.test(t));
  if (yes && !no) return "yes";
  if (no && !yes) return "no";
  return "unclear";
}

const WITHDRAW = [
  /\bstop (the|this) (interview|call|survey|conversation)\b/,
  /\b(i (don'?t|do not) want to|i'?d (like|prefer) to|i would (like|prefer) to) (stop|end|do this|continue|take part|participate|answer (any )?more( questions)?)( (this|the) (call|interview|conversation))?( any ?more)?( (please|thanks|thank you))?$/,
  /\b(take me off|remove me from) (your|the|this) (list|calls?)\b/,
  /\b(don'?t|do not|stop) call(ing)? me\b/,
  /^(please )?stop( please| now)?$/,
];

const LEAVE = [
  /\b(i (really )?(have|need|got|gotta) to (go|run|hang up)|i'?m going to (have to )?(go|hang up)|i (have|need) to get going)( now)?( (sorry|thanks|thank you|bye|goodbye))*$/,
  /\b(end|finish) (the|this) call\b/,
  /\bhang up now\b/,
  /\b(talk|speak) (to you )?later$/,
  /(^|\b(ok(ay)?|thanks|thank you|alright|all right|sorry|right|well|that'?s all)\b)( (then|so))? (bye( bye)?|goodbye|good bye)( now)?$/,
  /^(bye( bye)?|goodbye|good bye)( now)?$/,
];

/** An explicit wish to end the call: withdraw (stop participating) or leave (polite goodbye). */
export function classifyCallEnd(text: string): CallEnd {
  const t = normalizeUtterance(text);
  if (!t) return null;
  if (WITHDRAW.some((r) => r.test(t))) return "withdraw";
  if (LEAVE.some((r) => r.test(t))) return "leave";
  return null;
}
