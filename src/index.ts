/**
 * vega-described-track: audio description for any React Native for Vega video.
 *
 * Give it a description track (WebVTT or JSON) and the player's clock; it
 * speaks each description through a Vega accessibility audio player, only
 * when the rest of the silence can hold it.
 */
export {
  DescriptionScheduler, cueWindow, fitsAt, lastDescribed, nextCueFrom,
} from './schedule';
export {Speaker} from './speaker';
export {
  atDensity, parseTimestamp, parseTrack, parseWebVTT, totalSpokenSeconds,
} from './track';
export type {Cue, Density, Track, WebVTTOptions} from './track';
export {useDescriptions} from './useDescriptions';
