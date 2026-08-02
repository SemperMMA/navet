interface NavetMusicStore {
  engineRequestAllowed(request: unknown): string;
  getSpotifyAuthorizeLocation(
    request: unknown,
    config: { redirectUri: string; ingressPath: string },
    spotifyAuthorizeUri: string
  ): string;
  handle(request: unknown): Promise<void>;
  isMusicConfigPatch(value: unknown): boolean;
  readMusicConfig(): Record<string, string>;
  resetAppleMusicDeveloperTokenCacheForTests(): void;
  resetMusicConfigFsForTests(): void;
  resolveAppleMusicDeveloperToken(): Promise<string>;
  setMusicConfigFsForTests(fileSystem: unknown): void;
}

declare const musicStore: NavetMusicStore;

export default musicStore;
