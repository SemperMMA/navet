import { Button } from '@navet/app/components/primitives/button';
import { Slider } from '@navet/app/components/primitives/slider';
import { getThemeSurfaceTokens } from '@navet/app/components/shared/theme/theme-surface-tokens';
import { useI18n, useTheme } from '@navet/app/hooks';
import {
  type MusicItem,
  type MusicPlaybackSnapshot,
  type MusicPlaybackTarget,
  type MusicTransportCommand,
  musicTargetSupportsCommand,
} from '@navet/core/music';
import {
  Music2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Speaker,
  Volume2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { formatMusicDuration, MusicArtwork } from './music-presentation';

interface MusicNowPlayingBarProps {
  playback: MusicPlaybackSnapshot | null;
  currentItem: MusicItem | null;
  playbackTarget: MusicPlaybackTarget | null;
  onExecute: (command: MusicTransportCommand) => Promise<void>;
  onOpenListening: () => void;
}

function estimatePosition(playback: MusicPlaybackSnapshot | null, now: number) {
  if (!playback) return 0;
  if (playback.state !== 'playing') return playback.positionMs;
  const updatedAt = Date.parse(playback.updatedAt);
  const elapsed = Number.isFinite(updatedAt) ? Math.max(0, now - updatedAt) : 0;
  return playback.positionMs + elapsed;
}

export function MusicNowPlayingBar({
  playback,
  currentItem,
  playbackTarget,
  onExecute,
  onOpenListening,
}: MusicNowPlayingBarProps) {
  const { t } = useI18n();
  const { theme, accentColor } = useTheme();
  const surface = getThemeSurfaceTokens(theme);
  const [now, setNow] = useState(() => Date.now());
  const [seekDraft, setSeekDraft] = useState<number | null>(null);
  const [volumeDraft, setVolumeDraft] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    if (playback?.state !== 'playing') return;
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [playback?.state, playback?.updatedAt]);

  const duration = playback?.durationMs ?? currentItem?.durationMs ?? 0;
  const position = Math.min(
    duration || Number.POSITIVE_INFINITY,
    seekDraft ?? estimatePosition(playback, now)
  );
  const volume = volumeDraft ?? playback?.volume ?? 0.5;
  const repeatMode = playback?.repeat ?? 'off';
  const canPlay = musicTargetSupportsCommand(playbackTarget, 'play');
  const canPause = musicTargetSupportsCommand(playbackTarget, 'pause');
  const canPrevious = musicTargetSupportsCommand(playbackTarget, 'previous');
  const canNext = musicTargetSupportsCommand(playbackTarget, 'next');
  const canSeek = musicTargetSupportsCommand(playbackTarget, 'seek');
  const canSetVolume = musicTargetSupportsCommand(playbackTarget, 'set_volume');
  const canShuffle = musicTargetSupportsCommand(playbackTarget, 'set_shuffle');
  const canRepeat = musicTargetSupportsCommand(playbackTarget, 'set_repeat');
  const progress = useMemo(
    () => (duration > 0 ? Math.max(0, Math.min(100, (position / duration) * 100)) : 0),
    [duration, position]
  );

  return (
    <div
      className={`fixed right-3 bottom-[calc(var(--mobile-bottom-dock-offset,0.75rem)+4.75rem)] left-3 z-40 mx-auto max-w-5xl overflow-hidden rounded-[1.6rem] border md:right-6 md:bottom-6 md:left-[calc(var(--sidebar-width,0px)+1.5rem)] ${surface.shellPanel} ${surface.cardShadow}`}
    >
      <div
        className="h-0.5 bg-current/10 md:hidden"
        role="progressbar"
        aria-label={t('media.seek')}
        aria-valuemin={0}
        aria-valuemax={Math.max(1, duration)}
        aria-valuenow={Math.round(position)}
      >
        <div
          className="h-full transition-[width] duration-300 motion-reduce:transition-none"
          style={{ backgroundColor: accentColor, width: `${progress}%` }}
        />
      </div>
      <div className="flex min-h-[4.5rem] items-center gap-2 p-2.5 sm:gap-3 sm:p-3">
        {currentItem ? (
          <MusicArtwork
            item={currentItem}
            className="h-11 w-11 shrink-0 rounded-2xl sm:h-12 sm:w-12"
          />
        ) : (
          <div
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl sm:h-12 sm:w-12 ${surface.iconBg}`}
          >
            <Music2 className="h-5 w-5" />
          </div>
        )}
        <button
          type="button"
          onClick={onOpenListening}
          className="min-w-0 flex-1 rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
          aria-label={
            playbackTarget
              ? `${t('musicHub.playingOn')} ${playbackTarget.name}`
              : t('musicHub.listening')
          }
        >
          <span className={`block truncate text-sm font-semibold ${surface.textPrimary}`}>
            {currentItem?.title || t('musicHub.noPlayback')}
          </span>
          <span className={`mt-0.5 flex min-w-0 items-center gap-1.5 text-xs ${surface.textMuted}`}>
            {playbackTarget ? <Speaker className="h-3 w-3 shrink-0" aria-hidden="true" /> : null}
            <span className="truncate">
              {playbackTarget
                ? `${t('musicHub.playingOn')} ${playbackTarget.name}`
                : currentItem?.artists.join(', ') || t('musicHub.listening')}
            </span>
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-0.5 sm:gap-1">
          {canShuffle ? (
            <Button
              iconOnly
              label={playback?.shuffle ? t('media.shuffle') : t('media.linearPlayback')}
              variant="ghost"
              size="small"
              className="hidden min-h-11 min-w-11 lg:inline-flex"
              disabled={!currentItem}
              aria-pressed={Boolean(playback?.shuffle)}
              style={playback?.shuffle ? { color: accentColor } : undefined}
              onClick={() => void onExecute({ type: 'set_shuffle', enabled: !playback?.shuffle })}
            >
              <Shuffle className="h-4 w-4" />
            </Button>
          ) : null}
          {canPrevious ? (
            <Button
              iconOnly
              label={t('media.previousTrack')}
              variant="ghost"
              size="small"
              className="hidden min-h-11 min-w-11 sm:inline-flex"
              disabled={!currentItem}
              onClick={() => void onExecute({ type: 'previous' })}
            >
              <SkipBack className="h-4 w-4 fill-current" />
            </Button>
          ) : null}
          <Button
            iconOnly
            label={
              playback?.state === 'playing' ? t('media.pausePlayback') : t('media.resumePlayback')
            }
            size="small"
            className="min-h-11 min-w-11 rounded-full"
            disabled={!currentItem || (playback?.state === 'playing' ? !canPause : !canPlay)}
            onClick={() =>
              void onExecute({ type: playback?.state === 'playing' ? 'pause' : 'play' })
            }
          >
            {playback?.state === 'playing' ? (
              <Pause className="h-4 w-4 fill-current" />
            ) : (
              <Play className="h-4 w-4 fill-current" />
            )}
          </Button>
          {canNext ? (
            <Button
              iconOnly
              label={t('media.nextTrack')}
              variant="ghost"
              size="small"
              className="min-h-11 min-w-11"
              disabled={!currentItem}
              onClick={() => void onExecute({ type: 'next' })}
            >
              <SkipForward className="h-4 w-4 fill-current" />
            </Button>
          ) : null}
          {canRepeat ? (
            <Button
              iconOnly
              label={
                repeatMode === 'one'
                  ? t('media.repeatOne')
                  : repeatMode === 'all'
                    ? t('media.repeatAll')
                    : t('media.repeatOff')
              }
              variant="ghost"
              size="small"
              className="hidden min-h-11 min-w-11 lg:inline-flex"
              disabled={!currentItem}
              aria-pressed={repeatMode !== 'off'}
              style={repeatMode !== 'off' ? { color: accentColor } : undefined}
              onClick={() =>
                void onExecute({
                  type: 'set_repeat',
                  mode: repeatMode === 'off' ? 'all' : repeatMode === 'all' ? 'one' : 'off',
                })
              }
            >
              {repeatMode === 'one' ? (
                <Repeat1 className="h-4 w-4" />
              ) : (
                <Repeat className="h-4 w-4" />
              )}
            </Button>
          ) : null}
        </div>
      </div>
      <div className="hidden items-center gap-3 px-3 pb-3 md:flex">
        <span className={`w-9 text-right text-[10px] tabular-nums ${surface.textMuted}`}>
          {formatMusicDuration(position)}
        </span>
        <Slider
          value={position}
          max={Math.max(1, duration)}
          step={1000}
          ariaLabel={t('media.seek')}
          disabled={!currentItem || duration <= 0 || !canSeek}
          onValueChange={setSeekDraft}
          onValueCommit={(positionMs) => {
            void onExecute({ type: 'seek', positionMs }).finally(() => setSeekDraft(null));
          }}
          rootClassName="relative flex h-7 min-w-0 flex-1 items-center touch-none select-none"
          trackClassName="relative h-1 grow rounded-full bg-current/15"
          rangeClassName="absolute h-full rounded-full"
          thumbClassName="block h-3.5 w-3.5 rounded-full outline-none ring-offset-2 focus-visible:ring-2"
          touchThumbClassName="block h-5 w-5 rounded-full outline-none ring-offset-2 focus-visible:ring-2"
          rangeStyle={{ backgroundColor: accentColor }}
          thumbStyle={{ backgroundColor: accentColor }}
        />
        <span className={`w-9 text-[10px] tabular-nums ${surface.textMuted}`}>
          {formatMusicDuration(duration)}
        </span>
        {canSetVolume ? (
          <div className="hidden w-36 items-center gap-2 lg:flex">
            <Volume2 className={`h-4 w-4 shrink-0 ${surface.textMuted}`} aria-hidden="true" />
            <Slider
              value={volume}
              max={1}
              step={0.01}
              ariaLabel={t('media.volume')}
              disabled={!currentItem}
              onValueChange={setVolumeDraft}
              onValueCommit={(nextVolume) => {
                void onExecute({ type: 'set_volume', volume: nextVolume }).finally(() =>
                  setVolumeDraft(null)
                );
              }}
              rootClassName="relative flex h-7 w-full items-center touch-none select-none"
              trackClassName="relative h-1 grow rounded-full bg-current/15"
              rangeClassName="absolute h-full rounded-full"
              thumbClassName="block h-3.5 w-3.5 rounded-full outline-none ring-offset-2 focus-visible:ring-2"
              touchThumbClassName="block h-5 w-5 rounded-full outline-none ring-offset-2 focus-visible:ring-2"
              rangeStyle={{ backgroundColor: accentColor }}
              thumbStyle={{ backgroundColor: accentColor }}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
