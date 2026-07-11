import type {
  MusicEngineClient,
  MusicEnginePlayRequest,
  MusicEngineStatus,
  MusicEngineTarget,
  MusicPlaybackSession,
  MusicPlaybackSnapshot,
  MusicQueueSnapshot,
  MusicTransportCommand,
} from '@navet/core/music';

const ENGINE_ROOT = '/__navet_music_engine__';

async function engineJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${ENGINE_ROOT}${path}`, {
    credentials: 'same-origin',
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error || `Navet music engine failed (${response.status})`);
  }
  return (await response.json()) as T;
}

export const navetMusicEngineClient: MusicEngineClient = {
  getStatus: () => engineJson<MusicEngineStatus>('/status'),
  listTargets: () => engineJson<MusicEngineTarget[]>('/targets'),
  play: (request: MusicEnginePlayRequest) =>
    engineJson<MusicPlaybackSession>('/play', {
      method: 'POST',
      body: JSON.stringify(request),
    }),
  execute: (targetId: string, command: MusicTransportCommand) =>
    engineJson<MusicPlaybackSnapshot>('/control', {
      method: 'POST',
      body: JSON.stringify({ targetId, command }),
    }),
  group: (coordinatorId: string, memberIds: string[]) =>
    engineJson<MusicEngineTarget[]>('/group', {
      method: 'POST',
      body: JSON.stringify({ coordinatorId, memberIds }),
    }),
  ungroup: (targetId: string) =>
    engineJson<MusicEngineTarget[]>('/ungroup', {
      method: 'POST',
      body: JSON.stringify({ targetId }),
    }),
  getPlayback: () => engineJson<MusicPlaybackSnapshot>('/playback'),
  getQueue: () => engineJson<MusicQueueSnapshot>('/queue'),
};
