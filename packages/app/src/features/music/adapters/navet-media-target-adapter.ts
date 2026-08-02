import { dispatchEntityCommand } from '@navet/app/commands';
import { integrationMediaFeatureService } from '@navet/app/services/integration-media-feature.service';
import type { MediaDevice } from '@navet/app/types/device.types';
import { getProviderNativeId } from '@navet/core/ids';
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

function resolveGroupMemberId(
  memberId: string,
  providerId: MediaDevice['providerId'],
  devices: MediaDevice[]
) {
  const nativeId = getProviderNativeId(memberId);
  return devices.find(
    (candidate) =>
      candidate.providerId === providerId &&
      (candidate.id === memberId ||
        candidate.canonicalId === memberId ||
        candidate.nativeId === nativeId ||
        getProviderNativeId(candidate.id) === nativeId)
  )?.id;
}

function getGroupMetadata(device: MediaDevice, devices: MediaDevice[]) {
  const resolvedMembers = (device.groupMembers ?? []).flatMap((memberId) => {
    const resolved = resolveGroupMemberId(memberId, device.providerId, devices);
    return resolved ? [resolved] : [];
  });
  const memberIds = [...new Set(resolvedMembers)];
  if (!memberIds.includes(device.id)) memberIds.unshift(device.id);
  if (memberIds.length <= 1) return {};

  const coordinatorId = memberIds[0] ?? device.id;
  return {
    groupId: [...memberIds].sort().join('|'),
    groupCoordinatorId: coordinatorId,
    groupMemberIds: memberIds,
  };
}

function toTarget(device: MediaDevice, devices: MediaDevice[]): MusicPlaybackTarget {
  const capabilities = device.mediaCapabilities;
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
    ...getGroupMetadata(device, devices),
    capabilities: {
      enqueue: capabilities?.canEnqueue ?? false,
      queuePositions: capabilities?.canEnqueue ? ['next', 'later'] : [],
      grouping: capabilities?.canGroup ?? device.supportsGrouping ?? false,
      transport: {
        play: capabilities?.canPlay ?? true,
        pause: capabilities?.canPause ?? true,
        next: capabilities?.canNextTrack ?? false,
        previous: capabilities?.canPreviousTrack ?? false,
        seek: capabilities?.canSeek ?? false,
        set_volume: capabilities?.canSetVolume ?? false,
        set_shuffle: capabilities?.canShuffle ?? false,
        set_repeat: capabilities?.canRepeat ?? false,
      },
    },
  };
}

function targetIdentity(device: MediaDevice) {
  return [device.providerId ?? '', device.room, device.name]
    .map((value) => value.trim().toLocaleLowerCase())
    .join(':');
}

export function dedupeNavetMediaDevices(devices: MediaDevice[]): MediaDevice[] {
  const unique = new Map<string, MediaDevice>();
  for (const device of devices) {
    const key = targetIdentity(device);
    const current = unique.get(key);
    if (
      !current ||
      (device.state === 'playing' && current.state !== 'playing') ||
      (device.state !== 'off' && current.state === 'off')
    ) {
      unique.set(key, device);
    }
  }
  return [...unique.values()];
}

function homeAssistantMediaType(item: MusicItem) {
  return item.type === 'track' ? 'music' : item.type;
}

function isQueueableNavetMediaItem(item: MusicItem): item is MusicItem & { uri: string } {
  return (
    item.sourceId === 'spotify' &&
    item.playable &&
    ['album', 'episode', 'playlist', 'track'].includes(item.type) &&
    item.uri?.startsWith(`spotify:${item.type}:`) === true
  );
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
      const devices = dedupeNavetMediaDevices(getDevices().filter(acceptsSpotify));
      return devices.map((device) => toTarget(device, devices));
    },
    async play(targetId: string, item: MusicItem) {
      getDevice(targetId);
      if (!item.uri) throw new Error('This Spotify item has no playable identifier');
      await integrationMediaFeatureService.playMedia(targetId, {
        mediaContentId: item.uri,
        mediaContentType: homeAssistantMediaType(item),
        enqueue: 'replace',
      });
    },
    canEnqueue: (_targetId: string, item: MusicItem) => isQueueableNavetMediaItem(item),
    async enqueue(targetId: string, item: MusicItem, options?: { position?: 'next' | 'later' }) {
      getDevice(targetId);
      if (!isQueueableNavetMediaItem(item)) {
        throw new Error('This Spotify item cannot be added to the selected media player');
      }
      await integrationMediaFeatureService.playMedia(targetId, {
        mediaContentId: item.uri,
        mediaContentType: homeAssistantMediaType(item),
        enqueue: options?.position === 'next' ? 'next' : 'add',
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
      } else if (command.type === 'set_volume') {
        await dispatchEntityCommand({
          type: 'set_volume',
          entityId: targetId,
          volume: command.volume,
        });
      } else if (command.type === 'set_shuffle') {
        await dispatchEntityCommand({
          type: 'set_shuffle',
          entityId: targetId,
          shuffle: command.enabled,
        });
      } else {
        await dispatchEntityCommand({
          type: 'set_repeat_mode',
          entityId: targetId,
          repeatMode: command.mode,
        });
      }
    },
    async group(coordinatorId: string, memberIds: string[]) {
      const coordinator = getDevice(coordinatorId);
      if (!(coordinator.mediaCapabilities?.canGroup ?? coordinator.supportsGrouping)) {
        throw new Error('The selected Navet media player does not support grouping');
      }
      const members = memberIds.map(getDevice);
      if (members.some((member) => member.providerId !== coordinator.providerId)) {
        throw new Error('Only players from the same smart-home provider can be grouped');
      }
      await dispatchEntityCommand({
        type: 'join_group',
        entityId: coordinatorId,
        members: members.map((member) => member.nativeId ?? getProviderNativeId(member.id)),
      });
    },
    async ungroup(targetId: string) {
      const target = getDevice(targetId);
      if (!(target.mediaCapabilities?.canGroup ?? target.supportsGrouping)) {
        throw new Error('The selected Navet media player does not support grouping');
      }
      await dispatchEntityCommand({ type: 'leave_group', entityId: targetId });
    },
  };
}
