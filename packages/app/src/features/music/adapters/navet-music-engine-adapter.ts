import type {
  MusicItem,
  MusicPlaybackTargetAdapter,
  MusicSourceId,
  MusicTransportCommand,
} from '@navet/core/music';
import { navetMusicEngineClient } from '../music-engine-client';

export const navetMusicEngineTargetAdapter: MusicPlaybackTargetAdapter = {
  id: 'navet-music-engine',
  async listTargets(sourceId: MusicSourceId) {
    if (sourceId !== 'spotify') return [];
    const [status, targets] = await Promise.all([
      navetMusicEngineClient.getStatus(),
      navetMusicEngineClient.listTargets(),
    ]);
    const audioAvailable = status.state === 'ready' && status.spotifyAudioAvailable;
    return targets.map((target) => ({
      id: target.id,
      adapterId: 'navet-music-engine',
      name: target.name,
      kind: 'smart_home' as const,
      sourceIds: ['spotify' as const],
      available: target.available && audioAvailable,
      reasonUnavailable: !audioAvailable
        ? 'reason' in status
          ? status.reason
          : 'Navet music engine is starting'
        : target.available
          ? undefined
          : 'Sonos is not reachable on the network',
      room: target.room,
      detail: target.model ? `${target.model} · Direct Sonos` : 'Direct Sonos',
      isActive: target.isActive,
      groupId: target.groupId,
      groupCoordinatorId: target.groupCoordinatorId,
      groupMemberIds: target.groupMemberIds,
      capabilities: {
        enqueue: true,
        queuePositions: ['next', 'later'],
        grouping: true,
        transport: {
          play: true,
          pause: true,
          next: true,
          previous: true,
          seek: true,
          set_volume: true,
          set_shuffle: true,
          set_repeat: true,
        },
      },
    }));
  },
  async play(targetId: string, item: MusicItem, options?: { replaceQueue?: boolean }) {
    await navetMusicEngineClient.play({
      targetId,
      item,
      queueMode: options?.replaceQueue === false ? 'add' : 'replace',
    });
  },
  canEnqueue(_targetId: string, item: MusicItem) {
    return (
      item.sourceId === 'spotify' &&
      item.playable &&
      ['album', 'episode', 'playlist', 'track'].includes(item.type) &&
      item.uri?.startsWith(`spotify:${item.type}:`) === true
    );
  },
  async enqueue(targetId: string, item: MusicItem, options?: { position?: 'next' | 'later' }) {
    if (!navetMusicEngineTargetAdapter.canEnqueue?.(targetId, item)) {
      throw new Error('The Navet music engine cannot enqueue this item');
    }
    await navetMusicEngineClient.play({
      targetId,
      item,
      queueMode: options?.position === 'next' ? 'next' : 'add',
    });
  },
  async execute(targetId: string, command: MusicTransportCommand) {
    await navetMusicEngineClient.execute(targetId, command);
  },
  async group(coordinatorId: string, memberIds: string[]) {
    await navetMusicEngineClient.group(coordinatorId, memberIds);
  },
  async ungroup(targetId: string) {
    await navetMusicEngineClient.ungroup(targetId);
  },
};
