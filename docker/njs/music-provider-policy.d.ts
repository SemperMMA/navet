declare const musicProviderPolicy: {
  SPOTIFY_OAUTH_SCOPES: readonly string[];
  hasRequiredSpotifyScopes(scope: unknown): boolean;
  isAllowedSpotifyOperation(method: string, path: string): boolean;
  isAllowedSoundCloudOperation(method: string, path: string): boolean;
  isAllowedYouTubeOperation(method: string, path: string): boolean;
};

export default musicProviderPolicy;
