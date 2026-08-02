import {
  YOUTUBE_PLAYER_HOST_ID,
  YOUTUBE_PLAYER_SURFACE_ID,
} from '../adapters/youtube-music-adapter';

export function YouTubePlayerSurface() {
  return (
    <div
      id={YOUTUBE_PLAYER_SURFACE_ID}
      className="hidden aspect-video min-h-[200px] w-full overflow-hidden rounded-2xl bg-black [&>iframe]:h-full [&>iframe]:w-full"
    >
      <div id={YOUTUBE_PLAYER_HOST_ID} className="h-full w-full" />
    </div>
  );
}
