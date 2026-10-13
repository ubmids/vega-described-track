import {
  DescriptionScheduler, cueWindow, fitsAt, lastDescribed, nextCueFrom,
} from "../src/schedule.js";

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log("PASS " + name); pass++; }
  catch (e) { console.log("FAIL " + name + "\n      " + e.message); fail++; }
}
function eq(a, b, m) {
  const A = JSON.stringify(a), B = JSON.stringify(b);
  if (A !== B) throw new Error((m || "") + ` expected ${B}, got ${A}`);
}

// Two gaps, each with a description that fills most of it.
const CUES = [
  { id: "a", start: 2.0, end: 5.0, text: "A man crosses the street.", duration: 2.0 },
  { id: "b", start: 9.0, end: 12.0, text: "Snow fills the courtyard.", duration: 2.4 },
];

function make(opts = {}) {
  const spoken = [], stops = [];
  const s = new DescriptionScheduler(CUES, {
    onSpeak: c => spoken.push(c.id), onStop: () => stops.push(1), ...opts,
  });
  return { s, spoken, stops };
}

// timeupdate fires about four times a second, so that is how it is driven.
function play(s, from, to, step = 0.25, playing = true) {
  for (let t = from; t <= to + 1e-9; t += step) s.update(+t.toFixed(3), playing);
}

t("a cue fires once, inside its window", () => {
  const { s, spoken } = make();
  play(s, 0, 14);
  eq(spoken, ["a", "b"]);
});

t("nothing fires before its window opens", () => {
  const { s, spoken } = make();
  play(s, 0, 1.75);
  eq(spoken, []);
});

t("a cue is never started twice", () => {
  const { s, spoken } = make();
  play(s, 0, 6);
  play(s, 6, 6.5, 0.05);
  eq(spoken, ["a"]);
});

t("a cue is dropped when too little of its window is left", () => {
  // Joining at 3.5 leaves 1.5s of a window for 2.0s of speech.
  const { s, spoken } = make();
  play(s, 3.5, 6);
  eq(spoken, [], "it started a description that could not finish in the gap:");
});

t("a cue whose window has entirely passed is discarded", () => {
  const { s, spoken } = make();
  play(s, 5.5, 8);
  eq(spoken, []);
});

t("nothing fires while paused", () => {
  const { s, spoken } = make();
  play(s, 0, 4, 0.25, false);
  eq(spoken, []);
});

t("speaking is stopped when the viewer pauses", () => {
  const { s, spoken, stops } = make();
  play(s, 0, 2.5);
  eq(spoken, ["a"]);
  s.update(2.6, false);
  eq(stops, [1]);
});

t("two cues never overlap each other", () => {
  const tight = [
    { id: "x", start: 2.0, end: 8.0, text: "one", duration: 3.0 },
    { id: "y", start: 3.0, end: 8.0, text: "two", duration: 2.0 },
  ];
  const spoken = [];
  const s = new DescriptionScheduler(tight, { onSpeak: c => spoken.push(c.id) });
  play(s, 0, 4.5);
  eq(spoken, ["x"], "it began a second description over the first:");
});

t("seeking backwards re-arms a cue so a rewatch is described", () => {
  const { s, spoken } = make();
  play(s, 0, 6);
  eq(spoken, ["a"]);
  s.update(1.0);            // scrub back before the cue
  play(s, 1.0, 5.0);
  eq(spoken, ["a", "a"]);
});

t("seeking forwards past a cue discards it", () => {
  const { s, spoken } = make();
  play(s, 0, 1.5);
  s.update(8.0);            // skip over cue a entirely
  play(s, 8.0, 12);
  eq(spoken, ["b"], "it described a moment the viewer had already skipped:");
});

t("at double speed a window that is now too short is skipped", () => {
  const { s, spoken } = make();
  s.setRate(2);
  // 3.5s leaves 1.5s of window, which at 2x passes in 0.75s of real time.
  play(s, 3.5, 6);
  eq(spoken, []);
});

// The backend writes start and end around the speech and records the gap it
// was placed in separately. These pin the reading of that shape, because taking
// the cue times literally leaves no slack and silently refuses every cue.
const FROM_BACKEND = [
  // 1.3s of speech at the top of a 4.0s gap.
  { id: "g", start: 2.0, end: 3.3, text: "A man crosses.", gap: [2.0, 6.0] },
];

t("a cue's window is the gap, not the span of the speech", () => {
  const spoken = [];
  const s = new DescriptionScheduler(FROM_BACKEND, { onSpeak: c => spoken.push(c.id) });
  // Arriving at 2.25, a quarter second late, which is one timeupdate.
  play(s, 2.25, 5.0);
  eq(spoken, ["g"], "a cue was refused with 3.75s of gap left for 1.3s of speech:");
});

t("a cue is still refused when the gap itself is nearly over", () => {
  const spoken = [];
  const s = new DescriptionScheduler(FROM_BACKEND, { onSpeak: c => spoken.push(c.id) });
  play(s, 5.0, 7.0);        // 1.0s of gap left, 1.3s of speech
  eq(spoken, [], "it started a description that would have run past the gap:");
});

t("speaking clears when the speech ends, not when the gap does", () => {
  const s = new DescriptionScheduler(FROM_BACKEND, {});
  play(s, 0, 2.0);
  eq(s.speaking?.id, "g");
  play(s, 2.0, 3.5);        // speech is 1.3s, so it is over by 3.3
  eq(s.speaking, null, "the interface would still be claiming to speak:");
});

t("a used gap is not used twice", () => {
  const two = [
    { id: "p", start: 2.0, end: 3.0, text: "one", gap: [2.0, 9.0] },
    { id: "q", start: 4.0, end: 5.0, text: "two", gap: [4.0, 9.0] },
  ];
  const spoken = [];
  const s = new DescriptionScheduler(two, { onSpeak: c => spoken.push(c.id) });
  play(s, 0, 8.0);
  eq(spoken, ["p"], "a second description started in the tail of the same silence:");
});

t("an empty track is harmless", () => {
  const s = new DescriptionScheduler([], {});
  play(s, 0, 10);
  eq(s.speaking, null);
});

// The screen draws a cue sitting inside a silence, with the quiet that is left
// over when the voice stops. Those numbers are the same reading of a cue the
// scheduler fires on, so they are tested here and computed once.

t("a window is the silence, and the cost is the speech", () => {
  const w = cueWindow({ start: 2.0, end: 3.3, gap: [1.8, 6.0] });
  eq([w.opens, w.start, w.end], [1.8, 2.0, 3.3 + 2.7]);
  eq(+w.speech.toFixed(3), 1.3);
  eq(+w.silence.toFixed(3), 4.2);
  eq(+w.spare.toFixed(3), 2.7, "the drawn slack disagrees with the real slack:");
});

t("a cue with no gap recorded is its own window", () => {
  const w = cueWindow({ start: 2.0, end: 3.3, gap: null });
  eq([w.opens, w.end, w.spare], [2.0, 3.3, 0]);
});

t("normalising a window twice changes nothing", () => {
  const once = cueWindow({ start: 2.0, end: 3.3, gap: [2.0, 6.0] });
  const twice = cueWindow({ start: once.start, end: once.end, duration: once.speech, gap: [2.0, 6.0] });
  eq([twice.end, +twice.speech.toFixed(3), +twice.spare.toFixed(3)], [6.0, 1.3, 2.7]);
});

t("fit is measured against what is left of the silence", () => {
  const cue = { start: 2.0, end: 3.3, gap: [2.0, 6.0] };
  eq(fitsAt(cue, 2.25), true, "refused with 3.75s left for 1.3s of speech:");
  eq(fitsAt(cue, 5.0), false, "accepted with 1.0s left for 1.3s of speech:");
});

t("fit shrinks with the playback rate", () => {
  const cue = { start: 2.0, end: 3.3, gap: [2.0, 6.0] };
  eq(fitsAt(cue, 4.0, 1), true);
  eq(fitsAt(cue, 4.0, 2), false, "2.0s of gap at double speed is 1.0s of room:");
});

t("the cue to point at is the one whose silence has not closed", () => {
  const cues = [
    { id: "a", start: 2.0, end: 5.0 },
    { id: "b", start: 9.0, end: 12.0 },
  ];
  eq(nextCueFrom(cues, 0).id, "a");
  eq(nextCueFrom(cues, 4.9).id, "a", "it moved on while the cue was still speaking:");
  eq(nextCueFrom(cues, 5.0).id, "b");
  eq(nextCueFrom(cues, 99).id, "b", "the screen emptied out at the end of the film:");
  eq(nextCueFrom([], 0), null);
});

t("asked what is happening, the answer is the last description that has started", () => {
  const cues = [
    { id: "a", start: 2.0, end: 5.0 },
    { id: "b", start: 9.0, end: 12.0 },
  ];
  eq(lastDescribed(cues, 1.9), null, "described a moment still to come:");
  eq(lastDescribed(cues, 2.0).id, "a");
  eq(lastDescribed(cues, 8.9).id, "a", "the gap after a cue still answers with it:");
  eq(lastDescribed(cues, 9.5).id, "b", "mid-sentence, the sentence being said:");
  eq(lastDescribed(cues, 99).id, "b");
  eq(lastDescribed([], 5), null);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
