import type { MusicPlaybackTargetAdapter, MusicSourceAdapter } from '@navet/core/music';
import { afterEach, describe, expect, it } from 'vitest';
import {
  getMusicPlaybackTargetAdapter,
  getMusicSourceAdapter,
  listMusicPlaybackTargetAdapters,
  listMusicSourceAdapters,
  registerMusicPlaybackTargetAdapter,
  registerMusicSourceAdapter,
  resetMusicRegistryForTests,
} from '../music-registry';

const sourceAdapter: MusicSourceAdapter = {
  id: 'spotify',
  name: 'Spotify',
  capabilities: {
    search: true,
    library: false,
    queue: false,
    favorites: false,
    browserPlayback: false,
    playbackHandoff: true,
  },
  getAccountStatus: async () => ({ state: 'disconnected' }),
  connect: async () => undefined,
  disconnect: async () => undefined,
  search: async () => [],
};

const targetAdapter: MusicPlaybackTargetAdapter = {
  id: 'test-target',
  listTargets: async () => [],
  play: async () => undefined,
  execute: async () => undefined,
};

afterEach(() => resetMusicRegistryForTests());

describe('music registry', () => {
  it('registers music sources outside the smart-home provider registry', () => {
    const unregister = registerMusicSourceAdapter(sourceAdapter);
    expect(getMusicSourceAdapter('spotify')).toBe(sourceAdapter);
    expect(listMusicSourceAdapters()).toEqual([sourceAdapter]);
    unregister();
    expect(getMusicSourceAdapter('spotify')).toBeNull();
  });

  it('registers independently addressable playback target adapters', () => {
    const unregister = registerMusicPlaybackTargetAdapter(targetAdapter);
    expect(getMusicPlaybackTargetAdapter('test-target')).toBe(targetAdapter);
    expect(listMusicPlaybackTargetAdapters()).toEqual([targetAdapter]);
    unregister();
    expect(getMusicPlaybackTargetAdapter('test-target')).toBeNull();
  });
});
