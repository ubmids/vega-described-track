/**
 * A description track: what to say, when, and how long the silence lasts.
 *
 * Audio description is a second voice that speaks in the gaps between a
 * film's dialogue. A track is made ahead of time, by a person or a pipeline,
 * and played beside the film. This library plays it; it does not write it.
 *
 * A cue has three times, and the third is the one most formats leave out:
 *
 *   start  when the description starts
 *   end    when the speech ends
 *   gap    the silence it was placed in, [opens, closes]
 *
 * The gap matters because a TV player only learns the time a few times a
 * second (`timeupdate` on Vega fires about every 250 ms). A cue read as just
 * start..end has no slack: arrive 40 ms late and the speech would run past
 * its end, onto the next line of dialogue. With the gap, the scheduler can
 * start a little late as long as the rest of the silence still holds the
 * whole sentence, and refuse when it does not.
 */

export type Cue = {
  start: number;
  end: number;
  text: string;
  /** Pre-synthesised speech for this cue: a path or URL the player can open. */
  audio?: string | null;
  /** The silence this cue was placed in. */
  gap?: [number, number] | null;
};

export type Track = {
  source: string;
  cues: Cue[];
};

/** 'full' says everything; 'sparse' keeps the half of the cues with the most room. */
export type Density = 'full' | 'sparse';

/**
 * How much to say. Sparse keeps the cues with the most room, which are
 * usually the ones describing the biggest changes. A filter over the track,
 * never a regeneration, so it cannot introduce a cue that was not placed in a
 * gap.
 */
export function atDensity(track: Track, density: Density): Cue[] {
  if (density === 'full') return track.cues;
  const sorted = [...track.cues].sort(
    (a, b) => b.end - b.start - (a.end - a.start),
  );
  const keep = new Set(sorted.slice(0, Math.ceil(sorted.length / 2)));
  return track.cues.filter((c) => keep.has(c));
}

export function totalSpokenSeconds(cues: Cue[]): number {
  return cues.reduce((n, c) => n + (c.end - c.start), 0);
}

function gapOf(g: unknown): [number, number] | null {
  return Array.isArray(g) && g.length === 2 &&
    typeof g[0] === 'number' && typeof g[1] === 'number' && g[1] > g[0]
    ? [g[0], g[1]] : null;
}

/**
 * Parse a JSON track: `{"source": "...", "cues": [{start, end, text, audio?,
 * gap?}]}`. This is what the aloud pipeline writes. Tolerant on purpose: a
 * malformed cue is dropped, never thrown, because a broken track should leave
 * the film playing.
 */
export function parseTrack(raw: unknown): Track {
  const obj = (raw ?? {}) as Record<string, unknown>;
  const cues = Array.isArray(obj.cues) ? obj.cues : [];
  return {
    source: typeof obj.source === 'string' ? obj.source : '',
    cues: cues
      .map((c) => (c ?? {}) as Record<string, unknown>)
      .filter(
        (c) =>
          typeof c.start === 'number' &&
          typeof c.end === 'number' &&
          typeof c.text === 'string' &&
          c.text.trim().length > 0 &&
          (c.end as number) > (c.start as number),
      )
      .map((c) => ({
        start: c.start as number,
        end: c.end as number,
        text: (c.text as string).trim(),
        audio: typeof c.audio === 'string' ? c.audio : null,
        gap: gapOf(c.gap),
      }))
      .sort((a, b) => a.start - b.start),
  };
}

/** "00:01:41.530", "01:41.530" or "1:41.53" to seconds; NaN if it is none of those. */
export function parseTimestamp(s: string): number {
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.,](\d{1,3}))?$/.exec(s.trim());
  if (!m) return NaN;
  const [, h, min, sec, frac] = m;
  return (Number(h ?? 0) * 3600) + Number(min) * 60 + Number(sec) +
    (frac ? Number(frac.padEnd(3, '0')) / 1000 : 0);
}

export type WebVTTOptions = {
  /**
   * The audio for a cue, when the file does not name it. `index` counts from
   * 0 in file order. For a track from aloud:
   * `(c, i) => \`${base}/cue-${String(i + 1).padStart(3, '0')}.m4a\``.
   */
  audioFor?: (cue: Cue, index: number) => string | null;
};

/**
 * Parse WebVTT into a track.
 *
 * Plain WebVTT carries no gap and no audio. This library reads both from the
 * cue identifier line when it is written as `key=value` pairs, which keeps the
 * file valid WebVTT for every other player:
 *
 *     WEBVTT
 *
 *     1 audio=cue-001.m4a gap=100.0-106.4
 *     00:01:41.530 --> 00:01:45.980
 *     A grey-haired man lies on a bench while a soldier aims a rifle.
 *
 * A cue with no gap is judged against its own start and end, which is safe
 * and strict: it is skipped unless the player reaches it on time. NOTE,
 * STYLE and REGION blocks are ignored; cue settings after the timing are
 * ignored; tags such as `<i>` are stripped from the text.
 */
export function parseWebVTT(vtt: string, opts: WebVTTOptions = {}): Track {
  const text = vtt.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  if (!/^WEBVTT(?:[ \t].*)?(?:\n|$)/.test(text)) return {source: '', cues: []};
  const blocks = text.split(/\n{2,}/).slice(1);
  const cues: Cue[] = [];
  for (const block of blocks) {
    const lines = block.split('\n').filter((l) => l.length > 0);
    if (lines.length === 0 || /^(NOTE|STYLE|REGION)\b/.test(lines[0])) continue;
    const at = lines.findIndex((l) => l.includes('-->'));
    if (at < 0 || at > 1) continue;
    const [from, rest] = lines[at].split('-->');
    const start = parseTimestamp(from);
    const end = parseTimestamp(rest.trim().split(/\s+/)[0] ?? '');
    const words = lines.slice(at + 1).join(' ').replace(/<[^>]*>/g, '').trim();
    if (!isFinite(start) || !isFinite(end) || end <= start || !words) continue;

    const meta: Record<string, string> = {};
    if (at === 1) {
      for (const kv of lines[0].split(/\s+/)) {
        const eq = kv.indexOf('=');
        if (eq > 0) meta[kv.slice(0, eq)] = kv.slice(eq + 1);
      }
    }
    let gap: [number, number] | null = null;
    const g = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(meta.gap ?? '');
    if (g && Number(g[2]) > Number(g[1])) gap = [Number(g[1]), Number(g[2])];
    cues.push({start, end, text: words, audio: meta.audio ?? null, gap});
  }
  cues.sort((a, b) => a.start - b.start);
  if (opts.audioFor) {
    cues.forEach((c, i) => {
      if (!c.audio) c.audio = opts.audioFor!(c, i);
    });
  }
  return {source: '', cues};
}
