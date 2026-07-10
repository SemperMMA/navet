import { dispatchEntityCommand } from '@navet/app/commands';
import { integrationMediaFeatureService } from '@navet/app/services/integration-media-feature.service';
import type { MediaDevice } from '@navet/app/types/device.types';
import type {
  MusicItem,
  MusicPlaybackTarget,
  MusicPlaybackTargetAdapter,
  MusicSourceId,
  MusicTransportCommand,
} from '@navet/core/music';

function acceptsSpotify(device: MediaDevice) {
  const searchText = [device.id, device.name, device.source, ...(device.sourceList ?? [])]
    .join(' ')
    .toLowerCase();
  return device.mediaCapabilities?.canPlayMedia === true && searchText.includes('spotify');
}

function toTarget(device: MediaDevice): MusicPlaybackTarget {
  return {
    id: device.id,
    adapterId: 'navet-media-player',
    name: device.name,
    kind: 'smart_home',
    sourceIds: ['spotify'],
    available: device.state !== 'off',
    reasonUnavailable:
      device.state === 'off' ? 'Turn on this player before starting music' : undefined,
    room: device.room,
    isActive: device.state === 'playing' || device.state === 'paused',
  };
}

export function createNavetMediaPlaybackTargetAdapter(
  getDevices: () => MediaDevice[]
): MusicPlaybackTargetAdapter {
  function getDevice(targetId: string) {
    const device = getDevices().find((candidate) => candidate.id === targetId);
    if (!device) throw new Error('The selected Navet media player is no longer available');
    return device;
  }

  return {
    id: 'navet-media-player',
    async listTargets(sourceId: MusicSourceId) {
      if (sourceId !== 'spotify') return [];
      return getDevices().filter(acceptsSpotify).map(toTarget);
    },
    async play(targetId: string, item: MusicItem) {
      getDevice(targetId);
      if (!item.uri) throw new Error('This Spotify item has no playable identifier');
      await integrationMediaFeatureService.playMedia(targetId, {
        mediaContentId: item.uri,
        mediaContentType: item.type,
        enqueue: 'replace',
      });
    },
    async enqueue(targetId: string, item: MusicItem) {
      getDevice(targetId);
      if (!item.uri) throw new Error('This Spotify item has no playable identifier');
      await integrationMediaFeatureService.playMedia(targetId, {
        mediaContentId: item.uri,
        mediaContentType: item.type,
        enqueue: 'add',
      });
    },
    async execute(targetId: string, command: MusicTransportCommand) {
      getDevice(targetId);
      if (command.type === 'play' || command.type === 'pause') {
        await dispatchEntityCommand({ type: 'play_pause', entityId: targetId });
      } else if (command.type === 'next') {
        await dispatchEntityCommand({ type: 'next_track', entityId: targetId });
      } else if (command.type === 'previous') {
        await dispatchEntityCommand({ type: 'previous_track', entityId: targetId });
      } else if (command.type === 'seek') {
        await integrationMediaFeatureService.seekMediaPlayer(targetId, command.positionMs / 1000);
      } else {
        await dispatchEntityCommand({
          type: 'set_volume',
          entityId: targetId,
          volume: command.volume,
        });
      }
    },
  };
}
