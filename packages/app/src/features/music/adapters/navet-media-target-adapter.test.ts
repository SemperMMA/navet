import { EMPTY_NAVET_MEDIA_CAPABILITIES } from '@navet/app/core/navet-device-state';
import type { MediaDevice } from '@navet/app/types/device.types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const commands = vi.hoisted(() => ({ dispatchEntityCommand: vi.fn() }));
const mediaService = vi.hoisted(() => ({ playMedia: vi.fn() }));

vi.mock('@navet/app/commands', () => commands);
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

  it('maps explicit queue positions to provider-neutral media enqueue modes', async () => {
    const bathroom = mediaDevice({
      mediaCapabilities: {
        ...EMPTY_NAVET_MEDIA_CAPABILITIES,
        canPlayMedia: true,
        canEnqueue: true,
      },
    });
    const adapter = createNavetMediaPlaybackTargetAdapter(() => [bathroom]);
    const track = {
      id: 'track-id',
      sourceId: 'spotify' as const,
      type: 'track' as const,
      title: 'A track',
      artists: ['An artist'],
      playable: true,
      uri: 'spotify:track:track-id',
    };

    await adapter.enqueue?.(bathroom.id, track, { position: 'next' });
    await adapter.enqueue?.(bathroom.id, track, { position: 'later' });

    expect(mediaService.playMedia).toHaveBeenNthCalledWith(1, bathroom.id, {
      mediaContentId: track.uri,
      mediaContentType: 'music',
      enqueue: 'next',
    });
    expect(mediaService.playMedia).toHaveBeenNthCalledWith(2, bathroom.id, {
      mediaContentId: track.uri,
      mediaContentType: 'music',
      enqueue: 'add',
    });
  });

  it('normalizes provider-native group members and exposes the coordinator', async () => {
    const bathroom = mediaDevice({
      nativeId: 'media_player.bathroom',
      groupMembers: ['media_player.bathroom', 'media_player.kitchen'],
      mediaCapabilities: {
        ...EMPTY_NAVET_MEDIA_CAPABILITIES,
        canPlayMedia: true,
        canGroup: true,
      },
    });
    const kitchen = mediaDevice({
      id: 'home_assistant:media_player.kitchen',
      nativeId: 'media_player.kitchen',
      name: 'Kitchen',
      room: 'Kitchen',
      groupMembers: ['media_player.bathroom', 'media_player.kitchen'],
      mediaCapabilities: {
        ...EMPTY_NAVET_MEDIA_CAPABILITIES,
        canPlayMedia: true,
        canGroup: true,
      },
    });
    const adapter = createNavetMediaPlaybackTargetAdapter(() => [bathroom, kitchen]);

    const targets = await adapter.listTargets('spotify');

    expect(targets).toEqual([
      expect.objectContaining({
        id: bathroom.id,
        groupCoordinatorId: bathroom.id,
        groupMemberIds: [bathroom.id, kitchen.id],
      }),
      expect.objectContaining({
        id: kitchen.id,
        groupCoordinatorId: bathroom.id,
        groupMemberIds: [bathroom.id, kitchen.id],
      }),
    ]);
  });

  it('groups and ungroups through provider-neutral media commands', async () => {
    const bathroom = mediaDevice({
      nativeId: 'media_player.bathroom',
      mediaCapabilities: {
        ...EMPTY_NAVET_MEDIA_CAPABILITIES,
        canPlayMedia: true,
        canGroup: true,
      },
    });
    const kitchen = mediaDevice({
      id: 'home_assistant:media_player.kitchen',
      nativeId: 'media_player.kitchen',
      name: 'Kitchen',
      room: 'Kitchen',
      mediaCapabilities: {
        ...EMPTY_NAVET_MEDIA_CAPABILITIES,
        canPlayMedia: true,
        canGroup: true,
      },
    });
    const adapter = createNavetMediaPlaybackTargetAdapter(() => [bathroom, kitchen]);

    await adapter.group?.(bathroom.id, [kitchen.id]);
    await adapter.ungroup?.(kitchen.id);

    expect(commands.dispatchEntityCommand).toHaveBeenNthCalledWith(1, {
      type: 'join_group',
      entityId: bathroom.id,
      members: ['media_player.kitchen'],
    });
    expect(commands.dispatchEntityCommand).toHaveBeenNthCalledWith(2, {
      type: 'leave_group',
      entityId: kitchen.id,
    });
  });
});
