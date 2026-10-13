import React, {useEffect} from 'react';
import {act, render} from '@testing-library/react-native';

import {parseWebVTT, type Cue} from '../src/track';
import {useDescriptions} from '../src/useDescriptions';

const track = parseWebVTT(`WEBVTT

1 audio=a.m4a gap=10.0-16.0
00:00:11.500 --> 00:00:14.000
Rocket engines ignite.

2 audio=b.m4a
00:00:45.000 --> 00:00:47.000
On screen: 40 YEARS LATER.
`);

let clock: ((t: number, playing: boolean) => void) | null = null;
let now: Cue | null = null;

function Probe({speak, stop}: {speak: (c: Cue) => void; stop: () => void}) {
  const {onTimeUpdate, speaking} = useDescriptions(track, 'full', speak, stop);
  useEffect(() => {
    clock = onTimeUpdate;
  }, [onTimeUpdate]);
  now = speaking;
  return null;
}

function tick(t: number, playing = true) {
  act(() => clock?.(t, playing));
}

test('a cue reached a little late is still spoken while its gap can hold it', () => {
  const speak = jest.fn();
  render(<Probe speak={speak} stop={jest.fn()} />);
  tick(11.0);
  tick(11.75);                       // 250 ms late: 4.25 s of gap left for 2.5 s
  expect(speak).toHaveBeenCalledTimes(1);
  expect(speak.mock.calls[0][0].audio).toBe('a.m4a');
  expect(now?.text).toBe('Rocket engines ignite.');
});

test('a cue with no gap is skipped if the player arrives late, not spoken over the next line', () => {
  const speak = jest.fn();
  render(<Probe speak={speak} stop={jest.fn()} />);
  tick(44.75);
  tick(45.25);
  expect(speak).not.toHaveBeenCalled();
});

test('pausing stops the voice', () => {
  const stop = jest.fn();
  render(<Probe speak={jest.fn()} stop={stop} />);
  tick(11.0);
  tick(11.5);
  tick(11.75, false);
  expect(stop).toHaveBeenCalled();
});
