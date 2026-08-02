import type {
  MusicPlaybackTargetAdapter,
  MusicSourceAdapter,
  MusicSourceId,
} from '@navet/core/music';

const sourceAdapters = new Map<MusicSourceId, MusicSourceAdapter>();
const targetAdapters = new Map<string, MusicPlaybackTargetAdapter>();

export function registerMusicSourceAdapter(adapter: MusicSourceAdapter): () => void {
  const existing = sourceAdapters.get(adapter.id);
  if (existing && existing !== adapter) {
    throw new Error(`Music source adapter ${adapter.id} is already registered`);
  }
  sourceAdapters.set(adapter.id, adapter);
  return () => {
    if (sourceAdapters.get(adapter.id) === adapter) {
      sourceAdapters.delete(adapter.id);
    }
  };
}

export function getMusicSourceAdapter(sourceId: MusicSourceId): MusicSourceAdapter | null {
  return sourceAdapters.get(sourceId) ?? null;
}

export function listMusicSourceAdapters(): MusicSourceAdapter[] {
  return [...sourceAdapters.values()];
}

export function registerMusicPlaybackTargetAdapter(
  adapter: MusicPlaybackTargetAdapter
): () => void {
  const existing = targetAdapters.get(adapter.id);
  if (existing && existing !== adapter) {
    throw new Error(`Music playback target adapter ${adapter.id} is already registered`);
  }
  targetAdapters.set(adapter.id, adapter);
  return () => {
    if (targetAdapters.get(adapter.id) === adapter) {
      targetAdapters.delete(adapter.id);
    }
  };
}

export function getMusicPlaybackTargetAdapter(
  adapterId: string
): MusicPlaybackTargetAdapter | null {
  return targetAdapters.get(adapterId) ?? null;
}

export function listMusicPlaybackTargetAdapters(): MusicPlaybackTargetAdapter[] {
  return [...targetAdapters.values()];
}

export function resetMusicRegistryForTests() {
  sourceAdapters.clear();
  targetAdapters.clear();
}
