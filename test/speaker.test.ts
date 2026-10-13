const mockPlayers: any[] = [];
let mockInitFails = false;
jest.mock('@amazon-devices/react-native-w3cmedia', () => ({
  AudioContentType: {CONTENT_TYPE_SPEECH: 'speech'},
  AudioUsageType: {USAGE_ACCESSIBILITY: 'accessibility'},
  AudioPlayer: jest.fn().mockImplementation(function (this: any, content, usage) {
    this.content = content;
    this.usage = usage;
    this.play = jest.fn();
    this.pause = jest.fn();
    this.initialize = jest.fn(() => (mockInitFails ? Promise.reject(new Error('no')) : Promise.resolve()));
    this.deinitialize = jest.fn(() => Promise.resolve());
    mockPlayers.push(this);
  }),
}));

import {Speaker} from '../src';

const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  mockPlayers.length = 0;
  mockInitFails = false;
});

test('the voice is classified as accessibility speech, not as media', () => {
  new Speaker();
  expect(mockPlayers[0].content).toBe('speech');
  expect(mockPlayers[0].usage).toBe('accessibility');
  expect(mockPlayers[0].initialize).toHaveBeenCalled();
});

test('nothing is played before initialize() resolves, and nothing is queued', async () => {
  const s = new Speaker();
  expect(s.play('/a.m4a')).toBe(false);
  expect(mockPlayers[0].play).not.toHaveBeenCalled();
  await flush();
  expect(s.available).toBe(true);
  expect(s.play('/b.m4a')).toBe(true);
  expect(mockPlayers[0].src).toBe('/b.m4a');
  expect(mockPlayers[0].play).toHaveBeenCalledTimes(1);
});

test('a cue is spoken at the chosen level, and stop is immediate', async () => {
  const s = new Speaker();
  await flush();
  s.setVolume(1.7);
  s.speak({start: 1, end: 2, text: 'A ship.', audio: '/cue.m4a'});
  expect(mockPlayers[0].volume).toBe(1);
  expect(s.speaking?.text).toBe('A ship.');
  s.stop();
  expect(mockPlayers[0].pause).toHaveBeenCalled();
  expect(s.speaking).toBeNull();
});

test('a device that refuses the player still plays the film: the voice degrades silently', async () => {
  mockInitFails = true;
  const s = new Speaker();
  await flush();
  expect(s.available).toBe(false);
  expect(s.play('/a.m4a')).toBe(false);
});
