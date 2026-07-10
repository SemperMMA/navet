import { ImageWithFallback } from '@navet/app/components/figma/ImageWithFallback';
import { Button } from '@navet/app/components/primitives/button';
import { getThemeSurfaceTokens } from '@navet/app/components/shared/theme/theme-surface-tokens';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@navet/app/components/ui/alert-dialog';
import { createNavetMediaPlaybackTargetAdapter } from '@navet/app/features/music/adapters/navet-media-target-adapter';
import { MusicSetupPanel } from '@navet/app/features/music/components/music-setup-panel';
import { getMusicRuntime } from '@navet/app/features/music/music-runtime';
import { useDeviceCollectionsByKeys, useI18n, useTheme } from '@navet/app/hooks';
import { sanitizeImageUrl } from '@navet/app/utils/url-security';
import type {
  MusicAccountStatus,
  MusicItem,
  MusicPlaybackSnapshot,
  MusicPlaybackTarget,
  MusicPlaybackTargetAdapter,
  MusicQueueSnapshot,
  MusicSearchSection,
  MusicSourceAdapter,
  MusicSourceId,
  MusicTransportCommand,
} from '@navet/core/music';
import {
  Apple,
  Disc3,
  ListMusic,
  Loader2,
  Music2,
  Pause,
  Play,
  Search,
  SkipBack,
  SkipForward,
  Speaker,
  Unplug,
} from 'lucide-react';
import { type FormEvent, useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

const { sources: BUILT_IN_SOURCES, targets: BUILT_IN_TARGETS } = getMusicRuntime();
const EMPTY_STATUSES: Partial<Record<MusicSourceId, MusicAccountStatus>> = {};
const MUSIC_DEVICE_COLLECTION_KEYS = ['media'] as const;
const SOURCE_COLORS: Record<MusicSourceId, string> = {
  spotify: '#1DB954',
  apple_music: '#fa2d48',
};

function sourceLabel(sourceId: MusicSourceId) {
  return sourceId === 'spotify' ? 'Spotify' : 'Apple Music';
}

function sourceIcon(sourceId: MusicSourceId) {
  return sourceId === 'spotify' ? Disc3 : Apple;
}

function formatDuration(durationMs?: number) {
  if (!durationMs || durationMs < 0) return '';
  const totalSeconds = Math.floor(durationMs / 1000);
  return `${Math.floor(totalSeconds / 60)}:${String(totalSeconds % 60).padStart(2, '0')}`;
}

function MusicArtwork({ item, className }: { item: MusicItem; className: string }) {
  const safeArtwork = sanitizeImageUrl(
    item.artworkUrl,
    typeof window === 'undefined' ? undefined : window.location.origin
  );
  return safeArtwork ? (
    <ImageWithFallback src={safeArtwork} alt="" className={`${className} object-cover`} />
  ) : (
    <div className={`${className} flex items-center justify-center bg-current/5`}>
      <Music2 className="h-5 w-5 opacity-45" aria-hidden="true" />
    </div>
  );
}

function AccountCard({
  source,
  status,
  onConnect,
  onDisconnect,
  onConfigure,
  busy,
}: {
  source: MusicSourceAdapter;
  status?: MusicAccountStatus;
  onConnect: () => void;
  onDisconnect: () => void;
  onConfigure: () => void;
  busy: boolean;
}) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const surface = getThemeSurfaceTokens(theme);
  const Icon = sourceIcon(source.id);
  const connected = status?.state === 'connected';
  const unavailable = status?.state === 'unavailable';
  const requiresSetup = unavailable && source.id === 'spotify';

  return (
    <div
      className={`flex min-w-0 items-center gap-3 rounded-3xl border p-3 ${surface.panelMuted} ${surface.border}`}
    >
      <div
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-white"
        style={{ backgroundColor: SOURCE_COLORS[source.id] }}
      >
        <Icon className="h-5 w-5" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm font-semibold ${surface.textPrimary}`}>{source.name}</p>
        <p className={`truncate text-xs ${surface.textMuted}`}>
          {connected
            ? status.displayName || t('musicHub.connected')
            : unavailable
              ? status.reason
              : t('musicHub.disconnect')}
        </p>
      </div>
      <Button
        size="small"
        variant={connected ? 'ghost' : 'secondary'}
        disabled={busy}
        loading={busy}
        onClick={connected ? onDisconnect : requiresSetup ? onConfigure : onConnect}
      >
        {connected
          ? t('musicHub.disconnect')
          : requiresSetup
            ? t('musicHub.setup.action')
            : source.id === 'apple_music'
              ? t('musicHub.authenticate')
              : t('musicHub.connect')}
      </Button>
    </div>
  );
}

function ResultRow({
  item,
  onPlay,
  onEnqueue,
  busy,
}: {
  item: MusicItem;
  onPlay: () => void;
  onEnqueue: () => void;
  busy: boolean;
}) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const surface = getThemeSurfaceTokens(theme);
  return (
    <div className={`group flex items-center gap-3 rounded-2xl px-2 py-2 ${surface.hoverBg}`}>
      <MusicArtwork item={item} className="h-12 w-12 shrink-0 rounded-xl" />
      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm font-medium ${surface.textPrimary}`}>{item.title}</p>
        <p className={`truncate text-xs ${surface.textMuted}`}>
          {[item.artists.join(', '), item.album, formatDuration(item.durationMs)]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>
      <button
        type="button"
        className={`hidden rounded-full px-3 py-2 text-xs font-medium md:block ${surface.textSecondary} ${surface.subtleBg} ${surface.hoverBg}`}
        disabled={busy || !item.playable}
        onClick={onEnqueue}
      >
        {t('musicHub.addQueue')}
      </button>
      <Button
        iconOnly
        label={`${t('musicHub.play')} ${item.title}`}
        size="small"
        disabled={busy || !item.playable}
        loading={busy}
        onClick={onPlay}
      >
        <Play className="h-4 w-4 fill-current" />
      </Button>
    </div>
  );
}

interface MusicSectionProps {
  sourceAdapters?: MusicSourceAdapter[];
  playbackTargetAdapters?: MusicPlaybackTargetAdapter[];
  includeNavetTargets?: boolean;
}

export function MusicSection({
  sourceAdapters = BUILT_IN_SOURCES,
  playbackTargetAdapters = BUILT_IN_TARGETS,
  includeNavetTargets = true,
}: MusicSectionProps = {}) {
  const { t } = useI18n();
  const { theme, accentColor } = useTheme();
  const surface = getThemeSurfaceTokens(theme);
  const mediaDevices = useDeviceCollectionsByKeys(MUSIC_DEVICE_COLLECTION_KEYS).media;
  const navetTargetAdapter = useMemo(
    () => createNavetMediaPlaybackTargetAdapter(() => mediaDevices),
    [mediaDevices]
  );
  const targetAdapters = useMemo(
    () =>
      includeNavetTargets
        ? [...playbackTargetAdapters, navetTargetAdapter]
        : playbackTargetAdapters,
    [includeNavetTargets, navetTargetAdapter, playbackTargetAdapters]
  );
  const [statuses, setStatuses] = useState(EMPTY_STATUSES);
  const [accountBusy, setAccountBusy] = useState<MusicSourceId | null>(null);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query.trim());
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [sections, setSections] = useState<MusicSearchSection[]>([]);
  const [librarySections, setLibrarySections] = useState<MusicSearchSection[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedSourceId, setSelectedSourceId] = useState<MusicSourceId>('spotify');
  const [targets, setTargets] = useState<MusicPlaybackTarget[]>([]);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [playback, setPlayback] = useState<MusicPlaybackSnapshot | null>(null);
  const [queue, setQueue] = useState<MusicQueueSnapshot | null>(null);
  const [pendingItem, setPendingItem] = useState<MusicItem | null>(null);
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const [spotifySetupOpen, setSpotifySetupOpen] = useState(false);

  const refreshStatuses = useCallback(async () => {
    const settled = await Promise.allSettled(
      sourceAdapters.map(async (source) => [source.id, await source.getAccountStatus()] as const)
    );
    const next: Partial<Record<MusicSourceId, MusicAccountStatus>> = {};
    for (const result of settled) {
      if (result.status === 'fulfilled') next[result.value[0]] = result.value[1];
    }
    setStatuses(next);
  }, [sourceAdapters]);

  useEffect(() => {
    void refreshStatuses();
    const callbackStatus = new URLSearchParams(window.location.search).get('status');
    if (callbackStatus === 'connected') toast.success('Spotify connected');
    if (callbackStatus === 'failed') toast.error('Spotify connection failed');
  }, [refreshStatuses]);

  useEffect(() => {
    const firstConnected = sourceAdapters.find(
      (source) => statuses[source.id]?.state === 'connected'
    );
    if (firstConnected && statuses[selectedSourceId]?.state !== 'connected') {
      setSelectedSourceId(firstConnected.id);
    }
  }, [selectedSourceId, sourceAdapters, statuses]);

  const loadTargets = useCallback(
    async (sourceId: MusicSourceId) => {
      const settled = await Promise.allSettled(
        targetAdapters.map((adapter) => adapter.listTargets(sourceId))
      );
      const next = settled.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
      setTargets(next);
      const preferred =
        next.find((target) => target.isActive && target.available) ??
        next.find((target) => target.available);
      setSelectedTargetId((current) =>
        next.some((target) => target.id === current && target.available)
          ? current
          : (preferred?.id ?? null)
      );
      return next;
    },
    [targetAdapters]
  );

  useEffect(() => {
    if (statuses[selectedSourceId]?.state !== 'connected') {
      setTargets([]);
      setSelectedTargetId(null);
      return;
    }
    void loadTargets(selectedSourceId);
  }, [loadTargets, selectedSourceId, statuses]);

  useEffect(() => {
    const controller = new AbortController();
    const connectedSources = sourceAdapters.filter(
      (source) => statuses[source.id]?.state === 'connected' && source.browseLibrary
    );
    if (connectedSources.length === 0) {
      setLibrarySections([]);
      return;
    }
    void Promise.allSettled(
      connectedSources.map(async (source) => ({
        sourceId: source.id,
        title: sourceLabel(source.id),
        items: (await source.browseLibrary?.(controller.signal)) ?? [],
      }))
    ).then((results) => {
      if (controller.signal.aborted) return;
      setLibrarySections(
        results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
      );
    });
    return () => controller.abort();
  }, [sourceAdapters, statuses]);

  useEffect(() => {
    if (!submittedQuery || deferredQuery !== submittedQuery) return;
    const controller = new AbortController();
    const connectedSources = sourceAdapters.filter(
      (source) => statuses[source.id]?.state === 'connected'
    );
    setSearching(true);
    void Promise.allSettled(
      connectedSources.map(async (source) => ({
        sourceId: source.id,
        title: sourceLabel(source.id),
        items: await source.search(submittedQuery, controller.signal),
      }))
    ).then((results) => {
      if (controller.signal.aborted) return;
      setSections(
        results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
      );
      setSearching(false);
    });
    return () => controller.abort();
  }, [deferredQuery, sourceAdapters, statuses, submittedQuery]);

  const refreshPlayback = useCallback(async () => {
    const source = sourceAdapters.find((candidate) => candidate.id === selectedSourceId);
    if (!source || statuses[selectedSourceId]?.state !== 'connected') return;
    const [nextPlayback, nextQueue] = await Promise.allSettled([
      source.getPlaybackSnapshot?.(),
      source.getQueue?.(),
    ]);
    if (nextPlayback.status === 'fulfilled' && nextPlayback.value) {
      setPlayback(nextPlayback.value);
    }
    if (nextQueue.status === 'fulfilled' && nextQueue.value) setQueue(nextQueue.value);
  }, [selectedSourceId, sourceAdapters, statuses]);

  useEffect(() => {
    void refreshPlayback();
    const interval = window.setInterval(() => void refreshPlayback(), 5_000);
    return () => window.clearInterval(interval);
  }, [refreshPlayback]);

  const findTargetAdapter = useCallback(
    (target: MusicPlaybackTarget) =>
      targetAdapters.find((adapter) => adapter.id === target.adapterId) ?? null,
    [targetAdapters]
  );

  const playItem = useCallback(
    async (item: MusicItem) => {
      setPlayingKey(`${item.sourceId}:${item.id}`);
      try {
        const sourceTargets =
          item.sourceId === selectedSourceId ? targets : await loadTargets(item.sourceId);
        const target =
          sourceTargets.find(
            (candidate) => candidate.id === selectedTargetId && candidate.available
          ) ??
          sourceTargets.find((candidate) => candidate.isActive && candidate.available) ??
          sourceTargets.find((candidate) => candidate.available);
        if (!target) throw new Error(t('musicHub.outputRequired'));
        const adapter = findTargetAdapter(target);
        if (!adapter) throw new Error(t('musicHub.outputRequired'));
        setSelectedSourceId(item.sourceId);
        setSelectedTargetId(target.id);
        await adapter.play(target.id, item, { replaceQueue: true });
        await refreshPlayback();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t('musicHub.providerFailed'));
      } finally {
        setPlayingKey(null);
      }
    },
    [
      findTargetAdapter,
      loadTargets,
      refreshPlayback,
      selectedSourceId,
      selectedTargetId,
      t,
      targets,
    ]
  );

  const requestPlay = useCallback(
    (item: MusicItem) => {
      if (queue?.items.length && queue.sourceId !== item.sourceId) {
        setPendingItem(item);
        return;
      }
      void playItem(item);
    },
    [playItem, queue]
  );

  const enqueueItem = useCallback(
    async (item: MusicItem) => {
      const target = targets.find((candidate) => candidate.id === selectedTargetId);
      const adapter = target ? findTargetAdapter(target) : null;
      if (!target || !adapter?.enqueue || item.sourceId !== selectedSourceId) {
        toast.error(t('musicHub.outputRequired'));
        return;
      }
      try {
        await adapter.enqueue(target.id, item);
        await refreshPlayback();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t('musicHub.providerFailed'));
      }
    },
    [findTargetAdapter, refreshPlayback, selectedSourceId, selectedTargetId, t, targets]
  );

  const executeTransport = useCallback(
    async (command: MusicTransportCommand) => {
      const target = targets.find((candidate) => candidate.id === selectedTargetId);
      const adapter = target ? findTargetAdapter(target) : null;
      if (!target || !adapter) return;
      try {
        await adapter.execute(target.id, command);
        await refreshPlayback();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : t('musicHub.providerFailed'));
      }
    },
    [findTargetAdapter, refreshPlayback, selectedTargetId, t, targets]
  );

  const handleSearch = (event: FormEvent) => {
    event.preventDefault();
    const next = query.trim();
    if (next) setSubmittedQuery(next);
  };

  const handleAccountAction = async (source: MusicSourceAdapter, connect: boolean) => {
    setAccountBusy(source.id);
    try {
      await (connect ? source.connect() : source.disconnect());
      await refreshStatuses();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('musicHub.providerFailed'));
    } finally {
      setAccountBusy(null);
    }
  };

  const visibleSections = submittedQuery ? sections : librarySections;
  const currentItem = playback?.sourceId === selectedSourceId ? playback.currentItem : null;

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-6 pb-28">
      <section
        className={`relative overflow-hidden rounded-[2rem] border p-5 md:p-8 ${surface.panel} ${surface.border} ${surface.cardShadow}`}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 w-2/3 opacity-25"
          style={{
            background: `radial-gradient(circle at 75% 20%, ${accentColor}, transparent 58%)`,
          }}
        />
        <div className="relative grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.75fr)] lg:items-end">
          <div>
            <p
              className={`mb-3 text-xs font-semibold uppercase tracking-[0.24em] ${surface.textMuted}`}
            >
              {t('musicHub.eyebrow')}
            </p>
            <h1
              className={`max-w-3xl text-3xl font-semibold tracking-[-0.04em] md:text-5xl ${surface.textPrimary}`}
            >
              {t('musicHub.title')}
            </h1>
            <p className={`mt-3 max-w-2xl text-sm leading-6 md:text-base ${surface.textSecondary}`}>
              {t('musicHub.description')}
            </p>
          </div>
          <form onSubmit={handleSearch} className="flex gap-2">
            <label
              className={`flex h-12 min-w-0 flex-1 items-center gap-3 rounded-full border px-4 ${surface.inputBg} ${surface.border}`}
            >
              <Search className={`h-4 w-4 shrink-0 ${surface.textMuted}`} aria-hidden="true" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('musicHub.searchPlaceholder')}
                className={`min-w-0 flex-1 bg-transparent text-sm outline-none ${surface.textPrimary} ${surface.placeholder}`}
              />
            </label>
            <Button type="submit" disabled={!query.trim()}>
              {t('musicHub.searchAction')}
            </Button>
          </form>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <main className="space-y-6">
          <section
            className={`rounded-[2rem] border p-4 md:p-5 ${surface.panel} ${surface.border}`}
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className={`text-base font-semibold ${surface.textPrimary}`}>
                {t('musicHub.accounts')}
              </h2>
              <div className="flex gap-2">
                {sourceAdapters.map((source) => (
                  <button
                    type="button"
                    key={source.id}
                    onClick={() => setSelectedSourceId(source.id)}
                    className={`h-2.5 w-2.5 rounded-full ring-2 ring-offset-2 ${selectedSourceId === source.id ? 'opacity-100' : 'opacity-35'} ${surface.ringOffset}`}
                    style={{ backgroundColor: SOURCE_COLORS[source.id] }}
                    aria-label={source.name}
                  />
                ))}
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {sourceAdapters.map((source) => (
                <AccountCard
                  key={source.id}
                  source={source}
                  status={statuses[source.id]}
                  busy={accountBusy === source.id}
                  onConnect={() => void handleAccountAction(source, true)}
                  onDisconnect={() => void handleAccountAction(source, false)}
                  onConfigure={() => setSpotifySetupOpen(true)}
                />
              ))}
            </div>
            {spotifySetupOpen ? (
              <div className="mt-4">
                <MusicSetupPanel
                  onClose={() => setSpotifySetupOpen(false)}
                  onSaved={refreshStatuses}
                />
              </div>
            ) : null}
          </section>

          <section
            className={`rounded-[2rem] border p-4 md:p-5 ${surface.panel} ${surface.border}`}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className={`text-base font-semibold ${surface.textPrimary}`}>
                {submittedQuery || t('musicHub.recentlyPlayed')}
              </h2>
              {searching ? (
                <Loader2 className={`h-4 w-4 animate-spin ${surface.textMuted}`} />
              ) : null}
            </div>
            {searching ? (
              <p className={`py-10 text-center text-sm ${surface.textMuted}`}>
                {t('musicHub.searching')}
              </p>
            ) : visibleSections.length === 0 ? (
              <div
                className={`flex flex-col items-center gap-3 py-12 text-center ${surface.textMuted}`}
              >
                <Search className="h-7 w-7" aria-hidden="true" />
                <p className="max-w-md text-sm">
                  {submittedQuery ? t('musicHub.noResults') : t('musicHub.emptySearch')}
                </p>
              </div>
            ) : (
              <div className="space-y-6">
                {visibleSections.map((section) => (
                  <div key={section.sourceId}>
                    <div className="mb-2 flex items-center gap-2">
                      <span
                        className="h-2 w-2 rounded-full"
                        style={{ backgroundColor: SOURCE_COLORS[section.sourceId] }}
                      />
                      <h3
                        className={`text-xs font-semibold uppercase tracking-[0.16em] ${surface.textMuted}`}
                      >
                        {section.title}
                      </h3>
                    </div>
                    <div className="space-y-1">
                      {section.items.map((item) => (
                        <ResultRow
                          key={`${item.sourceId}:${item.type}:${item.id}`}
                          item={item}
                          busy={playingKey === `${item.sourceId}:${item.id}`}
                          onPlay={() => requestPlay(item)}
                          onEnqueue={() => void enqueueItem(item)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </main>

        <aside className="space-y-6 xl:sticky xl:top-6 xl:self-start">
          <section className={`rounded-[2rem] border p-5 ${surface.panel} ${surface.border}`}>
            <div className="mb-4 flex items-center gap-2">
              <Speaker className={`h-4 w-4 ${surface.textMuted}`} aria-hidden="true" />
              <h2 className={`text-sm font-semibold ${surface.textPrimary}`}>
                {t('musicHub.outputs')}
              </h2>
            </div>
            <div className="space-y-2">
              {targets.length ? (
                targets.map((target) => (
                  <button
                    type="button"
                    key={`${target.adapterId}:${target.id}`}
                    disabled={!target.available}
                    onClick={() => setSelectedTargetId(target.id)}
                    className={`flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left transition ${target.id === selectedTargetId ? surface.borderStrong : surface.border} ${target.id === selectedTargetId ? surface.subtleBg : surface.hoverBg} disabled:opacity-45`}
                  >
                    <span className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-current/5">
                      <Speaker className="h-4 w-4" aria-hidden="true" />
                      {target.isActive ? (
                        <span className="absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-current" />
                      ) : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-sm font-medium ${surface.textPrimary}`}>
                        {target.name}
                      </span>
                      <span className={`block truncate text-xs ${surface.textMuted}`}>
                        {target.room ||
                          (target.kind === 'browser'
                            ? t('musicHub.appleBrowserOnly')
                            : target.kind)}
                      </span>
                    </span>
                  </button>
                ))
              ) : (
                <div
                  className={`flex items-center gap-3 rounded-2xl border p-3 ${surface.border} ${surface.textMuted}`}
                >
                  <Unplug className="h-4 w-4" />
                  <p className="text-xs">{t('musicHub.outputRequired')}</p>
                </div>
              )}
            </div>
          </section>

          <section className={`rounded-[2rem] border p-5 ${surface.panel} ${surface.border}`}>
            <div className="mb-4 flex items-center gap-2">
              <ListMusic className={`h-4 w-4 ${surface.textMuted}`} aria-hidden="true" />
              <h2 className={`text-sm font-semibold ${surface.textPrimary}`}>
                {t('musicHub.queue')}
              </h2>
            </div>
            {queue?.items.length ? (
              <ol className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
                {queue.items.map((item, index) => (
                  <li
                    key={`${item.sourceId}:${item.id}:${index}`}
                    className={`flex items-center gap-3 rounded-xl p-2 ${index === queue.currentIndex ? surface.subtleBg : ''}`}
                  >
                    <span className={`w-5 text-center text-xs tabular-nums ${surface.textMuted}`}>
                      {index + 1}
                    </span>
                    <MusicArtwork item={item} className="h-9 w-9 shrink-0 rounded-lg" />
                    <span className="min-w-0">
                      <span className={`block truncate text-xs font-medium ${surface.textPrimary}`}>
                        {item.title}
                      </span>
                      <span className={`block truncate text-[11px] ${surface.textMuted}`}>
                        {item.artists.join(', ')}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className={`py-7 text-center text-xs ${surface.textMuted}`}>
                {t('musicHub.queueEmpty')}
              </p>
            )}
          </section>
        </aside>
      </div>

      <div
        className={`fixed right-3 bottom-3 left-3 z-30 mx-auto flex max-w-4xl items-center gap-3 rounded-[1.75rem] border p-3 md:right-6 md:bottom-6 md:left-[calc(var(--sidebar-width,0px)+1.5rem)] ${surface.shellPanel} ${surface.cardShadow}`}
      >
        {currentItem ? (
          <MusicArtwork item={currentItem} className="h-12 w-12 shrink-0 rounded-2xl" />
        ) : (
          <div
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl ${surface.iconBg}`}
          >
            <Music2 className="h-5 w-5" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p
            className={`text-[10px] font-semibold uppercase tracking-[0.16em] ${surface.textMuted}`}
          >
            {t('musicHub.nowPlaying')}
          </p>
          <p className={`truncate text-sm font-semibold ${surface.textPrimary}`}>
            {currentItem?.title || t('musicHub.noPlayback')}
          </p>
          {currentItem ? (
            <p className={`truncate text-xs ${surface.textMuted}`}>
              {currentItem.artists.join(', ')}
            </p>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          <Button
            iconOnly
            label="Previous"
            variant="ghost"
            size="small"
            disabled={!currentItem}
            onClick={() => void executeTransport({ type: 'previous' })}
          >
            <SkipBack className="h-4 w-4 fill-current" />
          </Button>
          <Button
            iconOnly
            label={playback?.state === 'playing' ? 'Pause' : 'Play'}
            size="small"
            disabled={!currentItem}
            onClick={() =>
              void executeTransport({ type: playback?.state === 'playing' ? 'pause' : 'play' })
            }
          >
            {playback?.state === 'playing' ? (
              <Pause className="h-4 w-4 fill-current" />
            ) : (
              <Play className="h-4 w-4 fill-current" />
            )}
          </Button>
          <Button
            iconOnly
            label="Next"
            variant="ghost"
            size="small"
            disabled={!currentItem}
            onClick={() => void executeTransport({ type: 'next' })}
          >
            <SkipForward className="h-4 w-4 fill-current" />
          </Button>
        </div>
      </div>

      <AlertDialog
        open={pendingItem !== null}
        onOpenChange={(open) => !open && setPendingItem(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('musicHub.replaceQueueTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('musicHub.replaceQueueDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const item = pendingItem;
                setPendingItem(null);
                if (item) void playItem(item);
              }}
            >
              {t('musicHub.replaceQueueAction')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
