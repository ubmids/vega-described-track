/**
 * Firing descriptions from a video player that only tells you the time.
 *
 * Vega OS gives a React Native app the W3C media surface and nothing below it:
 * `currentTime`, and a `timeupdate` event. There are no frame callbacks, so the
 * app cannot see the picture, and it does not need to. The track was built
 * against the film in advance; all that is left is saying the right thing at the
 * right moment, and refusing to say it at the wrong one.
 *
 * `timeupdate` is the whole difficulty. It fires roughly four times a second,
 * which is coarse next to gaps of a second and a half, so the scheduler is
 * always finding out slightly late. Everything here follows from that:
 *
 *  - A cue is only started if the rest of its gap can still hold it. Arriving
 *    200ms late into a window with 300ms of speech left means the description
 *    runs past the gap and lands on the next line. Better to say nothing.
 *  - A cue is never started late for the same reason, and lateness is measured
 *    against what is left of the window rather than against the cue's start.
 *  - Seeking backwards re-arms cues; seeking forwards past a cue discards it.
 *    A description that fires because the viewer scrubbed backwards over it is
 *    describing a moment that already happened.
 *  - Nothing fires while paused, and rate changes shrink the window, because a
 *    gap at double speed is half as long while the speech is not.
 *
 * A cue's window is the gap it was placed in, not the span of the speech. The
 * backend writes `start` and `end` around the audio itself and records the gap
 * separately, so a cue taken literally has no slack at all: arriving 40ms late
 * to a 1.3 second description leaves 1.26 seconds for 1.3 seconds of speech and
 * every cue in the film is refused. The gap is the real deadline, the speech
 * length is the real cost, and normalising that here keeps both facts in the
 * one file that reasons about them.
 */

/**
 * The window a cue is judged against, and what it costs.
 *
 * The backend writes `start` and `end` around the speech itself and records the
 * silence it was placed in separately, so a cue read literally has no slack at
 * all. The gap is the real deadline and the measured speech is the real cost.
 *
 * `spare` is the silence still left when the voice stops. The scheduler does
 * not need it, the screen does: showing a viewer that a description finished
 * with half a second of quiet still to go is the difference between the safety
 * claim being visible and it being asserted.
 *
 * It lives here rather than in a component because it is a timing rule. Held in
 * a component it would be a second opinion about when a cue fits, and two
 * opinions about that is how a schedule drifts.
 */
export function cueWindow(cue) {
  const speech = cue.duration ?? (cue.end - cue.start);
  const gap = Array.isArray(cue.gap) && cue.gap.length === 2 ? cue.gap : null;
  // Never shorten a window a caller stated outright, only widen it to the
  // silence the cue was actually validated against.
  const end = gap !== null && gap[1] > cue.end ? gap[1] : cue.end;
  const opens = gap !== null && gap[0] < cue.start ? gap[0] : cue.start;
  return {
    opens,                            // when the dialogue stops
    start: cue.start,                 // when the description starts
    end,                              // when the dialogue resumes
    speech,
    silence: end - opens,
    spare: end - cue.start - speech,  // quiet still left when the voice stops
  };
}

/**
 * Is there enough of the window left at `t` to say the whole thing?
 *
 * The one rule the app exists to enforce. At faster playback the window passes
 * sooner while the speech takes exactly as long as it always did, so what is
 * left is discounted by the rate.
 */
export function fitsAt(cue, t, rate = 1) {
  const w = cueWindow(cue);
  return (w.end - t) / (rate > 0 ? rate : 1) >= w.speech;
}

/**
 * The cue a viewer is either hearing or waiting for.
 *
 * Sorted cues, so the first whose silence has not closed is the one the screen
 * should be pointing at. Falls back to the last cue once the film is past all
 * of them, because an interface that empties out at the end of a film looks
 * broken rather than finished.
 */
export function nextCueFrom(cues, t) {
  for (const cue of cues) {
    if (cueWindow(cue).end > t) return cue;
  }
  return cues.length > 0 ? cues[cues.length - 1] : null;
}

/**
 * What the viewer last heard described, or would have, at time `t`.
 *
 * The answer to "what did I miss?". It is the latest cue that has started by
 * `t`, whether or not it was actually spoken: a viewer with narration off who
 * asks what is happening wants the most recent description of the picture,
 * and a viewer who talked over the last one wants that one again. Nothing
 * before the first cue has been described, so the answer there is nothing,
 * not a description of a moment still to come.
 */
export function lastDescribed(cues, t) {
  let last = null;
  for (const cue of cues) {
    if (cue.start > t) break;
    last = cue;
  }
  return last;
}

export class DescriptionScheduler {
  /**
   * @typedef {object} ScheduledCue
   * @property {number} start        when the description should begin
   * @property {number} end          when the speech ends, widened to the gap below
   * @property {string} text
   * @property {string | null} [audio]  pre-synthesised speech, passed through
   *   to whatever does the speaking
   * @property {[number, number] | null} [gap]  the silence this cue was validated
   *   against. Nullable because the backend writes `"gap": null` for a cue it
   *   could not tie to one, and the parser keeps that rather than inventing a
   *   range. The scheduler never reads it; it is carried so the UI can show
   *   which silence a description was placed in.
   * @property {number} [duration]   measured length of the speech, defaults to end - start
   * @property {string|number} [id]
   *
   * @param {ScheduledCue[]} cues
   * @param {object} opts
   * @param {(cue: ScheduledCue) => void} opts.onSpeak  start speaking a cue
   * @param {() => void} [opts.onStop]                  stop whatever is speaking
   * @param {number} [opts.seekThreshold]               jump size that counts as a seek
   */
  constructor(cues = [], opts = {}) {
    this.cues = [...cues]
      .map((c, i) => {
        const w = cueWindow(c);
        return {...c, id: c.id ?? i, duration: w.speech, end: w.end};
      })
      .sort((a, b) => a.start - b.start);
    this.onSpeak = opts.onSpeak || (() => {});
    this.onStop = opts.onStop || (() => {});
    this.seekThreshold = opts.seekThreshold ?? 1.0;
    this.reset();
  }

  reset() {
    this.fired = new Set();
    this.lastTime = null;
    this.speaking = null;
    // The cue whose window is still open. It outlives the speech: once a gap
    // has been used it stays used, so a second description cannot start in the
    // tail of the same silence.
    this.holding = null;
    this.speakingUntil = null;
    this.rate = 1;
  }

  setRate(rate) {
    this.rate = rate > 0 ? rate : 1;
  }

  /** Call from `timeupdate`. `playing` is false while paused or buffering. */
  update(currentTime, playing = true) {
    const t = currentTime;

    if (this.lastTime !== null && Math.abs(t - this.lastTime) > this.seekThreshold) {
      this._onSeek(t);
    }
    this.lastTime = t;

    // Speech ending and the window closing are different moments, and the
    // difference is visible: the interface claims to show what is being said
    // right now, so it must stop claiming it the moment the audio stops.
    if (this.speaking && this.speakingUntil !== null && t >= this.speakingUntil) {
      this.speaking = null;
    }
    if (this.holding && t >= this.holding.end) {
      this.holding = null;
    }
    if (!playing) {
      if (this.speaking) { this.onStop(); this.speaking = null; }
      this.speakingUntil = null;
      return null;
    }
    if (this.holding) return null;                // one voice at a time

    for (const cue of this.cues) {
      if (this.fired.has(cue.id)) continue;
      if (t < cue.start) break;                   // sorted: nothing earlier is due
      if (t >= cue.end) { this.fired.add(cue.id); continue; }   // missed it

      // The rest of the window has to hold the rest of the description.
      if (!fitsAt(cue, t, this.rate)) {
        this.fired.add(cue.id);                   // too late to start safely
        continue;
      }

      this.fired.add(cue.id);
      this.speaking = cue;
      this.holding = cue;
      // Media time, not wall time: at double speed the film passes twice as
      // fast underneath speech that takes exactly as long as it always did.
      this.speakingUntil = t + cue.duration * this.rate;
      this.onSpeak(cue);
      return cue;
    }
    return null;
  }

  _onSeek(t) {
    if (this.speaking) { this.onStop(); this.speaking = null; }
    this.holding = null;
    this.speakingUntil = null;
    // Backwards: re-arm anything now in the future, so a rewatch is described.
    // Forwards: discard anything skipped over, because describing it now would
    // describe a moment the viewer has already passed.
    for (const cue of this.cues) {
      if (cue.start >= t) this.fired.delete(cue.id);
      else this.fired.add(cue.id);
    }
  }
}

export default DescriptionScheduler;
