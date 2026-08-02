import {
  appleMusicBrowserTargetAdapter,
  appleMusicSourceAdapter,
} from './adapters/apple-music-adapter';
import { navetMusicEngineTargetAdapter } from './adapters/navet-music-engine-adapter';
import {
  soundCloudBrowserTargetAdapter,
  soundCloudMusicSourceAdapter,
} from './adapters/soundcloud-music-adapter';
import {
  spotifyBrowserPlaybackTargetAdapter,
  spotifyMusicSourceAdapter,
  spotifyPlaybackTargetAdapter,
} from './adapters/spotify-music-adapter';
import {
  youtubeMusicBrowserTargetAdapter,
  youtubeMusicSourceAdapter,
} from './adapters/youtube-music-adapter';
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
  registerMusicSourceAdapter(soundCloudMusicSourceAdapter);
  registerMusicSourceAdapter(youtubeMusicSourceAdapter);
  registerMusicPlaybackTargetAdapter(spotifyBrowserPlaybackTargetAdapter);
  registerMusicPlaybackTargetAdapter(spotifyPlaybackTargetAdapter);
  registerMusicPlaybackTargetAdapter(navetMusicEngineTargetAdapter);
  registerMusicPlaybackTargetAdapter(appleMusicBrowserTargetAdapter);
  registerMusicPlaybackTargetAdapter(soundCloudBrowserTargetAdapter);
  registerMusicPlaybackTargetAdapter(youtubeMusicBrowserTargetAdapter);
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
