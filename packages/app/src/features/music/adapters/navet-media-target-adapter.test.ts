import { EMPTY_NAVET_MEDIA_CAPABILITIES } from '@navet/app/core/navet-device-state';
import type { MediaDevice } from '@navet/app/types/device.types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mediaService = vi.hoisted(() => ({ playMedia: vi.fn() }));

vi.mock('@navet/app/commands', () => ({ dispatchEntityCommand: vi.fn() }));
vi.mock('@navet/app/services/integration-media-feature.service', () => ({
  integrationMediaFeatureService: mediaService,
}));

import {
  createNavetMediaPlaybackTargetAdapter,
  dedupeNavetMediaDevices,
} from './navet-media-target-adapter';

function mediaDevice(overrides: Partial<MediaDevice>): MediaDevice {
  return {
    id: 'home_assistant:media_player.bathroom',
    name: 'Bathroom',
    room: 'Bathroom',
    providerId: 'home_assistant',
    size: 'medium',
    title: '',
    artist: '',
    state: 'idle',
    volume: 0.5,
    isMuted: false,
    mediaCapabilities: { ...EMPTY_NAVET_MEDIA_CAPABILITIES, canPlayMedia: true },
    source: 'Spotify',
    ...overrides,
  };
}

describe('Navet media playback targets', () => {
  beforeEach(() => vi.clearAllMocks());

  it('collapses indistinguishable speakers and keeps the active entity', () => {
    const idle = mediaDevice({ id: 'home_assistant:media_player.bathroom_sonos' });
    const playing = mediaDevice({
      id: 'home_assistant:media_player.bathroom_music_assistant',
      state: 'playing',
    });

    expect(dedupeNavetMediaDevices([idle, playing])).toEqual([playing]);
  });

  it('keeps matching speaker names from different rooms or providers distinct', () => {
    const bathroom = mediaDevice({});
    const kitchen = mediaDevice({ id: 'home_assistant:media_player.kitchen', room: 'Kitchen' });
    const secondProvider = mediaDevice({ id: 'homey:living_room', providerId: 'homey' });

    expect(dedupeNavetMediaDevices([bathroom, kitchen, secondProvider])).toHaveLength(3);
  });

  it('sends Spotify tracks to smart-home speakers as music media', async () => {
    const bathroom = mediaDevice({});
    const adapter = createNavetMediaPlaybackTargetAdapter(() => [bathroom]);
    const [target] = await adapter.listTargets('spotify');

    await adapter.play(target.id, {
      id: 'track-id',
      sourceId: 'spotify',
      type: 'track',
      title: 'A track',
      artists: ['An artist'],
      playable: true,
      uri: 'spotify:track:track-id',
    });

    expect(mediaService.playMedia).toHaveBeenCalledWith(bathroom.id, {
      mediaContentId: 'spotify:track:track-id',
      mediaContentType: 'music',
      enqueue: 'replace',
    });
  });
});
