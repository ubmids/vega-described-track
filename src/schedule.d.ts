import type {Cue} from './track';

export type ScheduledCue = Cue & {duration?: number; id?: string | number};

export type Window = {
  opens: number;
  start: number;
  end: number;
  speech: number;
  silence: number;
  spare: number;
};

export function cueWindow(cue: ScheduledCue): Window;
export function fitsAt(cue: ScheduledCue, t: number, rate?: number): boolean;
export function nextCueFrom<C extends Cue>(cues: C[], t: number): C | null;
export function lastDescribed<C extends Cue>(cues: C[], t: number): C | null;

export class DescriptionScheduler {
  constructor(cues?: ScheduledCue[], opts?: {
    onSpeak?: (cue: ScheduledCue) => void;
    onStop?: () => void;
    seekThreshold?: number;
  });
  speaking: ScheduledCue | null;
  reset(): void;
  setRate(rate: number): void;
  update(currentTime: number, playing?: boolean): ScheduledCue | null;
}

export default DescriptionScheduler;
