# vega-described-track

**Audio description for any React Native for Vega video on Fire TV.**

Audio description is a second voice that tells a blind or partially sighted
viewer what is on screen, in the silences between the dialogue. Streaming
apps on Vega OS can play a film; this library lets them play its description
track too, with three pieces that work with any `Video` or W3C `VideoPlayer`:

- **`parseWebVTT` / `parseTrack`**: read a description track from WebVTT or
  JSON, including where each cue's silence ends and which audio clip speaks it.
- **`useDescriptions`**: a React hook driven by the player's own clock
  (`currentTime` and whether it is playing). It starts a description only if
  the rest of its silence can hold the whole sentence, so it never starts one
  that would run onto the next line of dialogue. Seeking back re-arms cues,
  seeking forward drops the ones skipped over, pausing stops the voice.
- **`Speaker`**: one `AudioPlayer` from `@amazon-devices/react-native-w3cmedia`,
  classified as `CONTENT_TYPE_SPEECH` / `USAGE_ACCESSIBILITY` and initialised
  before first use (it plays nothing, silently, if you skip `initialize()`).

It was extracted from [aloud](https://github.com/ubmids/aloud), a Fire TV app
that plays open films with machine-written description, where it is the
playback half. The track-writing half (finding the gaps in the dialogue,
describing the picture, measuring each sentence into its gap) stays in aloud;
this library only plays a track, whoever wrote it.

## Why the scheduler is the hard part

Vega gives a React Native app `currentTime` and a `timeupdate` event about
four times a second, and no frame callbacks. A description placed in a
1.5-second silence is therefore always discovered slightly late. Start it
anyway and the last words land on the next line; refuse too eagerly and
nothing is ever said. The rule here is the one professional description
follows: a cue may start late only while the **rest of its gap** still holds
the **whole** sentence, measured in media time (at 2x the gap passes twice as
fast; the speech does not). That is why a track should record each cue's gap,
not only when its speech starts and stops.

## Install

Until it is published to npm:

```bash
npm install github:ubmids/vega-described-track
```

Peer dependencies: `react` and `@amazon-devices/react-native-w3cmedia` 2.1 or
later (the version range that has `AudioPlayer` with `USAGE_ACCESSIBILITY`).
The package ships TypeScript source, which Metro compiles like the rest of
your app.

## Use

```tsx
import {Speaker, parseWebVTT, useDescriptions, type Cue} from 'vega-described-track';

const speaker = useMemo(() => new Speaker(), []);
useEffect(() => () => speaker.release(), [speaker]);

const track = useMemo(() => parseWebVTT(vttText, {
  audioFor: (_c, i) => `/pkg/assets/ad/cue-${String(i + 1).padStart(3, '0')}.m4a`,
}), [vttText]);

const speak = useCallback((c: Cue) => speaker.speak(c), [speaker]);
const stop = useCallback(() => speaker.stop(), [speaker]);
const {onTimeUpdate, speaking} = useDescriptions(track, 'full', speak, stop);

// from your player's timeupdate / play / pause handling:
onTimeUpdate(video.currentTime, !video.paused);
```

`speaking` is the cue being said, for showing it on screen. `'sparse'` instead
of `'full'` keeps the half of the cues with the most room, for viewers who
want less talking.

### The track format

WebVTT stays valid WebVTT for every other player. The gap and the clip ride on
the cue identifier as `key=value` pairs:

```
WEBVTT

1 audio=cue-001.m4a gap=100.0-106.4
00:01:41.530 --> 00:01:45.980
A grey-haired man lies on a bench while a soldier aims a rifle.
```

A cue with no `gap` is judged against its own start and end: safe, and
strict (if the player reaches it late, it is skipped). JSON is
`{"source": "...", "cues": [{"start", "end", "text", "audio", "gap": [opens, closes]}]}`,
which is what aloud's pipeline writes.

## Adding description to Amazon's multi-TV app sample

[`examples/react-native-multi-tv-app-sample.patch`](examples/react-native-multi-tv-app-sample.patch)
adds description playback to the Vega player screen of
[AmazonAppDev/react-native-multi-tv-app-sample](https://github.com/AmazonAppDev/react-native-multi-tv-app-sample)
(written against commit `d435082`; `git apply --check` passes there). The
screen already keeps `currentTime`, `paused` and `isVideoBuffering` from the
W3C player's events, so the whole integration is this, in
`packages/shared-ui/src/screens/PlayerScreen.vega.tsx`, plus one line in
`apps/vega/package.json`:

```tsx
const speaker = useMemo(() => new Speaker(), []);
useEffect(() => () => speaker.release(), [speaker]);
const [adTrack, setAdTrack] = useState<Track | null>(null);
useEffect(() => {
  const vtt = movie.replace(/\.(mp4|m3u8|mpd)$/, '.ad.vtt');
  const clip = (_c: Cue, i: number) =>
    vtt.replace(/\.vtt$/, `/cue-${String(i + 1).padStart(3, '0')}.m4a`);
  fetch(vtt)
    .then((r) => (r.ok ? r.text() : ''))
    .then((text) => setAdTrack(parseWebVTT(text, { audioFor: clip })))
    .catch(() => setAdTrack(null));
}, [movie]);
const speak = useCallback((c: Cue) => speaker.speak(c), [speaker]);
const silence = useCallback(() => speaker.stop(), [speaker]);
const { onTimeUpdate, speaking } = useDescriptions(adTrack, 'full', speak, silence);
useEffect(() => {
  onTimeUpdate(currentTime, !paused && !isVideoBuffering);
}, [currentTime, paused, isVideoBuffering, onTimeUpdate]);

// in the JSX, over the video:
{speaking && <Text style={styles.description}>{speaking.text}</Text>}
```

A title with no `.ad.vtt` beside it plays exactly as before. The patch has been
checked to apply; it has not yet been built or run on a Vega device inside the
sample.

## Tests

```bash
npm install
npm test            # Jest (parsers, Speaker, hook) and the 23 scheduler tests
npm run typecheck
```

## Licence

MIT. Copyright (c) 2026 Subomi Olagoke.
