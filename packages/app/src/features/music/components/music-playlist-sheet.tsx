import { ImageWithFallback } from '@navet/app/components/figma/ImageWithFallback';
import { Button, SheetSurface, SheetSurfaceHeader } from '@navet/app/components/primitives';
import { getThemeSurfaceTokens } from '@navet/app/components/shared/theme/theme-surface-tokens';
import { getThemeFocusRingClassName } from '@navet/app/components/system/tokens';
import {
  getMusicSourceAccent,
  MusicSourceIcon,
} from '@navet/app/features/music/components/music-presentation';
import { useI18n, useTheme } from '@navet/app/hooks';
import { sanitizeImageUrl } from '@navet/app/utils/url-security';
import type { MusicItem, MusicPlaylistDestination, MusicSourceAdapter } from '@navet/core/music';
import { Library, Loader2, Plus } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

interface MusicPlaylistSheetProps {
  open: boolean;
  item: MusicItem | null;
  source: MusicSourceAdapter | null;
  onOpenChange: (open: boolean) => void;
  onAdded: () => void;
}

function mergePlaylistDestinations(
  current: MusicPlaylistDestination[],
  incoming: MusicPlaylistDestination[]
) {
  const merged = new Map(
    current.map((playlist) => [`${playlist.sourceId}:${playlist.id}`, playlist] as const)
  );
  for (const playlist of incoming) {
    merged.set(`${playlist.sourceId}:${playlist.id}`, playlist);
  }
  return [...merged.values()];
}

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function PlaylistArtwork({
  playlist,
  source,
}: {
  playlist: MusicPlaylistDestination;
  source: MusicSourceAdapter;
}) {
  const safeArtwork = sanitizeImageUrl(
    playlist.artworkUrl,
    typeof window === 'undefined' ? undefined : window.location.origin
  );
  return safeArtwork ? (
    <ImageWithFallback
      src={safeArtwork}
      alt=""
      className="h-12 w-12 shrink-0 rounded-xl object-cover"
    />
  ) : (
    <span
      className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white"
      style={{ backgroundColor: getMusicSourceAccent(source) }}
    >
      <MusicSourceIcon source={source} className="h-5 w-5" />
    </span>
  );
}

export function MusicPlaylistSheet({
  open,
  item,
  source,
  onOpenChange,
  onAdded,
}: MusicPlaylistSheetProps) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const surface = getThemeSurfaceTokens(theme);
  const requestControllerRef = useRef<AbortController | null>(null);
  const [playlists, setPlaylists] = useState<MusicPlaylistDestination[]>([]);
  const [continuation, setContinuation] = useState<string>();
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busyPlaylistId, setBusyPlaylistId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    requestControllerRef.current?.abort();
    if (!open || !item || !source?.listEditablePlaylists) {
      setPlaylists([]);
      setContinuation(undefined);
      setLoading(false);
      setLoadingMore(false);
      setBusyPlaylistId(null);
      setError(null);
      return;
    }

    const controller = new AbortController();
    requestControllerRef.current = controller;
    setPlaylists([]);
    setContinuation(undefined);
    setLoading(true);
    setLoadingMore(false);
    setBusyPlaylistId(null);
    setError(null);
    void source
      .listEditablePlaylists({ signal: controller.signal })
      .then((page) => {
        if (controller.signal.aborted) return;
        setPlaylists(page.items);
        setContinuation(page.continuation);
      })
      .catch((requestError) => {
        if (!controller.signal.aborted) {
          setError(getErrorMessage(requestError, t('musicHub.providerFailed')));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => {
      requestControllerRef.current?.abort();
    };
  }, [item, open, source, t]);

  const loadMore = useCallback(async () => {
    if (!continuation || !source?.listEditablePlaylists || loadingMore) return;
    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    setLoadingMore(true);
    setError(null);
    try {
      const page = await source.listEditablePlaylists({
        continuation,
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setPlaylists((current) => mergePlaylistDestinations(current, page.items));
      setContinuation(page.continuation);
    } catch (requestError) {
      if (!controller.signal.aborted) {
        setError(getErrorMessage(requestError, t('musicHub.providerFailed')));
      }
    } finally {
      if (!controller.signal.aborted) setLoadingMore(false);
    }
  }, [continuation, loadingMore, source, t]);

  const addToPlaylist = useCallback(
    async (playlist: MusicPlaylistDestination) => {
      if (!item || !source?.addToPlaylist || busyPlaylistId) return;
      setBusyPlaylistId(playlist.id);
      setError(null);
      try {
        await source.addToPlaylist(playlist, item);
        toast.success(`${t('musicHub.addedToPlaylist')} · ${playlist.title}`);
        onAdded();
        onOpenChange(false);
      } catch (requestError) {
        setError(getErrorMessage(requestError, t('musicHub.providerFailed')));
      } finally {
        setBusyPlaylistId(null);
      }
    },
    [busyPlaylistId, item, onAdded, onOpenChange, source, t]
  );

  const description = item && source ? `${item.title} · ${source.name}` : '';
  const accentColor = source ? getMusicSourceAccent(source) : undefined;

  return (
    <SheetSurface
      isOpen={open}
      onOpenChange={onOpenChange}
      title={t('musicHub.addToPlaylist')}
      description={description}
      accentColor={accentColor}
      mobileOnly={false}
      contentClassName="sm:max-w-xl"
      bodyClassName="min-h-0 overflow-y-auto px-4 pb-5 sm:px-5"
    >
      <SheetSurfaceHeader
        title={t('musicHub.choosePlaylist')}
        description={description}
        closeLabel={t('common.close')}
        onClose={() => onOpenChange(false)}
        className="px-4 pt-3 pb-4 sm:px-5"
      />

      <div aria-busy={loading || loadingMore || busyPlaylistId !== null}>
        {error ? (
          <div
            role="alert"
            className={`mb-3 rounded-2xl border px-4 py-3 text-sm leading-5 ${surface.panelMuted} ${surface.border} ${surface.textSecondary}`}
          >
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className={`flex min-h-52 items-center justify-center gap-3 ${surface.textMuted}`}>
            <Loader2
              className="h-5 w-5 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
            <span className="text-sm">{t('common.loading')}</span>
          </div>
        ) : playlists.length && source ? (
          <div className="space-y-1">
            {playlists.map((playlist) => {
              const busy = busyPlaylistId === playlist.id;
              return (
                <button
                  key={`${playlist.sourceId}:${playlist.id}`}
                  type="button"
                  disabled={busyPlaylistId !== null}
                  aria-label={`${t('musicHub.addToPlaylist')}: ${playlist.title}`}
                  aria-busy={busy}
                  onClick={() => void addToPlaylist(playlist)}
                  className={`flex min-h-16 w-full items-center gap-3 rounded-2xl p-2 text-left disabled:cursor-not-allowed disabled:opacity-55 ${surface.hoverBg} ${getThemeFocusRingClassName(theme)}`}
                >
                  <PlaylistArtwork playlist={playlist} source={source} />
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-sm font-semibold ${surface.textPrimary}`}>
                      {playlist.title}
                    </span>
                    <span className={`block truncate text-xs ${surface.textMuted}`}>
                      {source.name}
                    </span>
                  </span>
                  {busy ? (
                    <Loader2
                      className="mr-2 h-4 w-4 shrink-0 animate-spin motion-reduce:animate-none"
                      aria-hidden="true"
                    />
                  ) : (
                    <Plus
                      className={`mr-2 h-4 w-4 shrink-0 ${surface.textMuted}`}
                      aria-hidden="true"
                    />
                  )}
                </button>
              );
            })}
            {continuation ? (
              <div className="flex justify-center pt-3">
                <Button
                  size="small"
                  variant="secondary"
                  loading={loadingMore}
                  disabled={busyPlaylistId !== null}
                  onClick={() => void loadMore()}
                >
                  {t('musicHub.loadMore')}
                </Button>
              </div>
            ) : null}
          </div>
        ) : (
          <div
            className={`flex min-h-52 flex-col items-center justify-center gap-3 text-center ${surface.textMuted}`}
          >
            <Library className="h-7 w-7" aria-hidden="true" />
            <p className="max-w-sm text-sm">{t('musicHub.noEditablePlaylists')}</p>
          </div>
        )}
      </div>
    </SheetSurface>
  );
}
