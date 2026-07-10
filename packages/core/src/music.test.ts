import { describe, expect, it } from 'vitest';
import { createMusicItemKey, isMusicSourceId } from './music';

describe('music contracts', () => {
  it('keeps source-scoped item identities distinct', () => {
    expect(createMusicItemKey({ sourceId: 'spotify', type: 'track', id: '42' })).toBe(
      'spotify:track:42'
    );
    expect(createMusicItemKey({ sourceId: 'apple_music', type: 'track', id: '42' })).toBe(
      'apple_music:track:42'
    );
  });

  it('accepts only implemented music source identifiers', () => {
    expect(isMusicSourceId('spotify')).toBe(true);
    expect(isMusicSourceId('apple_music')).toBe(true);
    expect(isMusicSourceId('home_assistant')).toBe(false);
    expect(isMusicSourceId('youtube_music')).toBe(false);
  });
});
