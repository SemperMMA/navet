import { describe, expect, it } from 'vitest';
import { createMusicItemKey, createMusicTargetKey, isMusicSourceId } from './music';

describe('music contracts', () => {
  it('keeps source-scoped item identities distinct', () => {
    expect(createMusicItemKey({ sourceId: 'spotify', type: 'track', id: '42' })).toBe(
      'spotify:track:42'
    );
    expect(createMusicItemKey({ sourceId: 'apple_music', type: 'track', id: '42' })).toBe(
      'apple_music:track:42'
    );
  });

  it('keeps adapter-scoped playback target identities distinct', () => {
    expect(createMusicTargetKey({ adapterId: 'spotify-connect', id: 'speaker-1' })).not.toBe(
      createMusicTargetKey({ adapterId: 'navet-music-engine', id: 'speaker-1' })
    );
  });

  it('accepts safe runtime music source identifiers without a core allowlist', () => {
    expect(isMusicSourceId('spotify')).toBe(true);
    expect(isMusicSourceId('apple_music')).toBe(true);
    expect(isMusicSourceId('youtube_music')).toBe(true);
    expect(isMusicSourceId('soundcloud')).toBe(true);
    expect(isMusicSourceId('YouTube Music')).toBe(false);
    expect(isMusicSourceId('../spotify')).toBe(false);
  });
});
