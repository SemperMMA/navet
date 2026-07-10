import {
  appleMusicBrowserTargetAdapter,
  appleMusicSourceAdapter,
} from './adapters/apple-music-adapter';
import {
  spotifyMusicSourceAdapter,
  spotifyPlaybackTargetAdapter,
} from './adapters/spotify-music-adapter';
import {
  listMusicPlaybackTargetAdapters,
  listMusicSourceAdapters,
  registerMusicPlaybackTargetAdapter,
  registerMusicSourceAdapter,
} from './music-registry';

let initialized = false;

export function initializeMusicRuntime() {
  if (initialized) return;
  initialized = true;
  registerMusicSourceAdapter(spotifyMusicSourceAdapter);
  registerMusicSourceAdapter(appleMusicSourceAdapter);
  registerMusicPlaybackTargetAdapter(spotifyPlaybackTargetAdapter);
  registerMusicPlaybackTargetAdapter(appleMusicBrowserTargetAdapter);
}

export function getMusicRuntime() {
  initializeMusicRuntime();
  return {
    sources: listMusicSourceAdapters(),
    targets: listMusicPlaybackTargetAdapters(),
  };
}

export function resetMusicRuntimeForTests() {
  initialized = false;
}
