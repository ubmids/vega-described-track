import {useCallback, useEffect, useMemo, useRef, useState} from 'react';

import {DescriptionScheduler} from './schedule';
import {atDensity, type Cue, type Density, type Track} from './track';

/**
 * Drives the tested scheduler from whatever clock the player provides.
 *
 * The scheduler itself is deliberately free of React and of Vega: it is plain
 * logic with its own tests, and it decides the only thing that matters, which
 * is whether there is still enough of the gap left to say something without
 * landing on the next line. This hook is the thin part. It owns no rules.
 *
 * Vega's `timeupdate` fires about four times a second, so the app is always
 * finding out slightly late. That is the scheduler's problem and it is solved
 * there; nothing here compensates for it, because two places compensating for
 * the same thing is how a schedule drifts.
 */
export function useDescriptions(
  track: Track | null,
  density: Density,
  speak: (cue: Cue) => void,
  stop: () => void,
) {
  const [speaking, setSpeaking] = useState<Cue | null>(null);
  const [spokenCount, setSpokenCount] = useState(0);
  const schedulerRef = useRef<any>(null);

  const cues = useMemo(
    () => (track ? atDensity(track, density) : []),
    [track, density],
  );

  useEffect(() => {
    schedulerRef.current = new DescriptionScheduler(cues, {
      onSpeak: (cue: Cue) => {
        setSpeaking(cue);
        setSpokenCount((n) => n + 1);
        speak(cue);
      },
      onStop: () => {
        setSpeaking(null);
        stop();
      },
    });
    setSpeaking(null);
    setSpokenCount(0);
    // Rebuilding on a density change is intentional: the viewer has asked for a
    // different amount of speech, and carrying over which cues had already
    // fired would leave the new selection half spent.
  }, [cues, speak, stop]);

  const onTimeUpdate = useCallback(
    (currentTime: number, playing: boolean) => {
      const s = schedulerRef.current;
      if (!s) return;
      s.update(currentTime, playing);
      // The scheduler owns the truth about what is being said. Reading it back
      // rather than tracking it here keeps one source of it.
      setSpeaking(s.speaking ?? null);
    },
    [],
  );

  const setRate = useCallback((rate: number) => {
    schedulerRef.current?.setRate(rate);
  }, []);

  const reset = useCallback(() => {
    schedulerRef.current?.reset();
    setSpeaking(null);
    setSpokenCount(0);
  }, []);

  return {cues, speaking, spokenCount, onTimeUpdate, setRate, reset};
}
