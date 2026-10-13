import {
  AudioContentType,
  AudioPlayer,
  AudioUsageType,
} from '@amazon-devices/react-native-w3cmedia';

import type {Cue} from './track';

/**
 * Speaking a cue over the film.
 *
 * The description is a second audio stream, not a replacement for the first, so
 * it gets its own player rather than interrupting the film's. The film keeps
 * playing underneath, which is the point: a listener who loses the room tone
 * every time the describer speaks has lost more than they gained.
 *
 * The audio is classified rather than played anonymously. Vega is told this is
 * speech for accessibility, which is what lets the platform treat it correctly
 * against the film and against anything else making noise. Playing it as
 * generic media would leave that decision to luck.
 */
export class Speaker {
  private player: AudioPlayer | null = null;
  private current: Cue | null = null;
  private ready = false;
  private level = 1;

  constructor() {
    try {
      // Vega has a usage type specifically for accessibility prompts, which is
      // exactly what this is. Classifying it as generic media would put the
      // description in the same category as the film it is describing and leave
      // the platform no way to tell them apart.
      this.player = new AudioPlayer(
        AudioContentType.CONTENT_TYPE_SPEECH,
        AudioUsageType.USAGE_ACCESSIBILITY,
      );
      // The player does nothing at all until this resolves, and it fails
      // silently rather than throwing if you skip it: `src` is accepted, `play`
      // returns, and no sound is produced. Initialisation happens once at
      // startup, long before the first gap, so a cue arriving before the player
      // is ready is dropped rather than queued. A description that turns up late
      // is exactly the thing this system exists to prevent.
      this.player
        .initialize()
        .then(() => {
          this.ready = true;
        })
        .catch(() => {
          this.player = null;
        });
    } catch {
      // A device without a spare audio player must still play the film. The
      // description is the thing that degrades, never the content.
      this.player = null;
    }
  }

  get available(): boolean {
    return this.player !== null && this.ready;
  }

  speak(cue: Cue): void {
    if (!cue.audio) return;
    if (this.play(cue.audio)) this.current = cue;
  }

  /**
   * Play any bundled clip: a cue, or a title being read out on the shelf.
   * Returns whether it started, so a caller never believes a sound was made
   * by a player that was not ready to make it.
   */
  play(uri: string): boolean {
    if (!this.player || !this.ready) return false;
    try {
      this.player.src = uri;
      this.player.volume = this.level;
      this.player.play();
      return true;
    } catch {
      this.current = null;
      return false;
    }
  }

  /**
   * How loud the describer is, 0 to 1. Applied to the clip playing now and
   * to every one after it, so changing the level mid-sentence is heard at once.
   */
  setVolume(level: number): void {
    this.level = Math.max(0, Math.min(1, level));
    try {
      if (this.player) this.player.volume = this.level;
    } catch {
      // A player that refuses a volume still speaks at the old one.
    }
  }

  /**
   * Stop immediately, without a fade.
   *
   * Called when the viewer pauses or seeks, and when a cue's window closes. A
   * fade sounds nicer and is wrong here: the window closing means dialogue is
   * about to start, and the whole purpose is to not be talking when it does.
   */
  stop(): void {
    this.current = null;
    try {
      this.player?.pause();
    } catch {
      // Nothing to do. Failing to stop a sound must not take the app down.
    }
  }

  get speaking(): Cue | null {
    return this.current;
  }

  release(): void {
    this.stop();
    this.ready = false;
    this.player?.deinitialize().catch(() => {});
    this.player = null;
  }
}
