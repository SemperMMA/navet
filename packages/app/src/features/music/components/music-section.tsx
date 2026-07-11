import { ImageWithFallback } from '@navet/app/components/figma/ImageWithFallback';
import { Button } from '@navet/app/components/primitives/button';
import { Slider } from '@navet/app/components/primitives/slider';
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
import { Checkbox } from '@navet/app/components/ui/checkbox';
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
  Repeat,
  Repeat1,
  Search,
  Shuffle,
  SkipBack,
  SkipForward,
  Speaker,
  Unlink,
  Unplug,
  Users,
  Volume2,
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

export function getMusicErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  if (error && typeof error === 'object') {
    const payload = error as { message?: unknown; error?: unknown };
    if (typeof payload.message === 'string' && payload.message.trim()) return payload.message;
    if (typeof payload.error === 'string' && payload.error.trim()) return payload.error;
    if (payload.error && typeof payload.error === 'object') {
      const nestedMessage = (payload.error as { message?: unknown }).message;
      if (typeof nestedMessage === 'string' && nestedMessage.trim()) return nestedMessage;
    }
  }
  return fallback;
}

export function collapseQueueEntries(queue: MusicQueueSnapshot | null) {
  if (!queue) return [];
  return queue.items.reduce<
    Array<{ item: MusicItem; count: number; startIndex: number; isCurrent: boolean }>
  >((entries, item, index) => {
    const isCurrent = index === queue.currentIndex;
    const previous = entries.at(-1);
    if (
      previous &&
      !isCurrent &&
      !previous.isCurrent &&
      previous.item.sourceId === item.sourceId &&
      previous.item.type === item.type &&
      previous.item.id === item.id
    ) {
      previous.count += 1;
      return entries;
    }
    entries.push({ item, count: 1, startIndex: index, isCurrent });
    return entries;
  }, []);
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
      <div className="flex shrink-0 items-center gap-1">
        {source.id === 'spotify' && !requiresSetup ? (
          <Button size="small" variant="ghost" disabled={busy} onClick={onConfigure}>
            {t('musicHub.setup.editAction')}
          </Button>
        ) : null}
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
        className={`hidden rounded-full px-3 py-2 text-xs font-medium md:block ${surface.textSecondary} ${surface.subtleBg} ${surface.hoverBg} ${item.type === 'track' ? '' : 'invisible'}`}
        disabled={busy || !item.playable || item.type !== 'track'}
        onClick={onEnqueue}
        aria-hidden={item.type !== 'track'}
        tabIndex={item.type === 'track' ? 0 : -1}
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
  includeNavetTargets = false,
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
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [selectedSourceId, setSelectedSourceId] = useState<MusicSourceId>('spotify');
  const [targets, setTargets] = useState<MusicPlaybackTarget[]>([]);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [playback, setPlayback] = useState<MusicPlaybackSnapshot | null>(null);
  const [queue, setQueue] = useState<MusicQueueSnapshot | null>(null);
  const [pendingItem, setPendingItem] = useState<MusicItem | null>(null);
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const [servicesOpen, setServicesOpen] = useState(false);
  const [spotifySetupOpen, setSpotifySetupOpen] = useState(false);
  const [groupingOpen, setGroupingOpen] = useState(false);
  const [groupMemberIds, setGroupMemberIds] = useState<string[]>([]);
  const [groupBusy, setGroupBusy] = useState(false);
  const [seekDraft, setSeekDraft] = useState<number | null>(null);
  const [volumeDraft, setVolumeDraft] = useState<number | null>(null);

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
      setLibraryError(null);
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
      const failed = results.find((result) => result.status === 'rejected');
      setLibraryError(
        failed?.status === 'rejected'
          ? failed.reason instanceof Error
            ? failed.reason.message
            : t('musicHub.providerFailed')
          : null
      );
      setLibrarySections(
        results.flatMap((result) => {
          if (result.status !== 'fulfilled') return [];
          const artists = result.value.items.filter((item) => item.type === 'artist');
          const recentlyPlayed = result.value.items.filter((item) => item.type !== 'artist');
          return [
            ...(artists.length
              ? [
                  {
                    sourceId: result.value.sourceId,
                    title: t('musicHub.topArtists'),
                    items: artists,
                  },
                ]
              : []),
            ...(recentlyPlayed.length
              ? [
                  {
                    sourceId: result.value.sourceId,
                    title: t('musicHub.recentlyPlayed'),
                    items: recentlyPlayed,
                  },
                ]
              : []),
          ];
        })
      );
    });
    return () => controller.abort();
  }, [sourceAdapters, statuses, t]);

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
        toast.error(getMusicErrorMessage(error, t('musicHub.providerFailed')));
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
        toast.error(getMusicErrorMessage(error, t('musicHub.providerFailed')));
      }
    },
    [findTargetAdapter, refreshPlayback, selectedSourceId, selectedTargetId, t, targets]
  );

  const executeTransport = useCallback(
    async (command: MusicTransportCommand) => {
      const target =
        targets.find((candidate) => candidate.id === playback?.targetId) ??
        targets.find((candidate) => candidate.id === selectedTargetId);
      const adapter = target ? findTargetAdapter(target) : null;
      if (!target || !adapter) return;
      try {
        await adapter.execute(target.id, command);
        await refreshPlayback();
      } catch (error) {
        toast.error(getMusicErrorMessage(error, t('musicHub.providerFailed')));
      }
    },
    [findTargetAdapter, playback?.targetId, refreshPlayback, selectedTargetId, t, targets]
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
      toast.error(getMusicErrorMessage(error, t('musicHub.providerFailed')));
    } finally {
      setAccountBusy(null);
    }
  };

  const visibleSections = submittedQuery ? sections : librarySections;
  const currentItem = playback?.sourceId === selectedSourceId ? playback.currentItem : null;
  const selectedTarget = targets.find((target) => target.id === selectedTargetId) ?? null;
  const playbackTarget =
    targets.find((target) => target.id === playback?.targetId) ?? selectedTarget;
  const playbackDuration = playback?.durationMs ?? currentItem?.durationMs ?? 0;
  const playbackPosition = Math.min(
    playbackDuration || Number.POSITIVE_INFINITY,
    seekDraft ?? playback?.positionMs ?? 0
  );
  const playbackVolume = volumeDraft ?? playback?.volume ?? 0.5;
  const repeatMode = playback?.repeat ?? 'off';
  const selectedTargetAdapter = selectedTarget ? findTargetAdapter(selectedTarget) : null;
  const groupingAvailable = Boolean(selectedTargetAdapter?.group && selectedTargetAdapter.ungroup);

  const openGrouping = () => {
    if (!selectedTarget) return;
    setGroupMemberIds(
      (selectedTarget.groupMemberIds ?? []).filter((targetId) => targetId !== selectedTarget.id)
    );
    setGroupingOpen((open) => !open);
  };

  const applyGrouping = async () => {
    if (!selectedTarget || !selectedTargetAdapter?.group) return;
    setGroupBusy(true);
    try {
      await selectedTargetAdapter.group(selectedTarget.id, groupMemberIds);
      await loadTargets(selectedSourceId);
      setGroupingOpen(false);
      toast.success(t('musicHub.groupUpdated'));
    } catch (error) {
      toast.error(getMusicErrorMessage(error, t('musicHub.groupFailed')));
    } finally {
      setGroupBusy(false);
    }
  };

  const ungroupTarget = async (target: MusicPlaybackTarget) => {
    const adapter = findTargetAdapter(target);
    if (!adapter?.ungroup) return;
    const memberIds = target.groupMemberIds ?? [];
    const targetsToUngroup =
      target.groupCoordinatorId === target.id
        ? memberIds.filter((targetId) => targetId !== target.id)
        : [target.id];
    setGroupBusy(true);
    try {
      for (const targetId of targetsToUngroup) await adapter.ungroup(targetId);
      await loadTargets(selectedSourceId);
      toast.success(t('musicHub.speakersUngrouped'));
    } catch (error) {
      toast.error(getMusicErrorMessage(error, t('musicHub.groupFailed')));
    } finally {
      setGroupBusy(false);
    }
  };
  const queueEntries = useMemo(() => collapseQueueEntries(queue), [queue]);
  const connectedServiceNames = sourceAdapters.flatMap((source) =>
    statuses[source.id]?.state === 'connected' ? [source.name] : []
  );

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
            <div
              className={`flex items-center justify-between gap-3 ${servicesOpen ? 'mb-4' : ''}`}
            >
              <div className="min-w-0">
                <h2 className={`text-base font-semibold ${surface.textPrimary}`}>
                  {t('musicHub.accounts')}
                </h2>
                <p className={`mt-1 truncate text-xs ${surface.textMuted}`}>
                  {connectedServiceNames.length
                    ? `${connectedServiceNames.join(', ')} · ${t('musicHub.connected')}`
                    : t('musicHub.noServicesConnected')}
                </p>
              </div>
              <Button
                size="small"
                variant="ghost"
                aria-expanded={servicesOpen}
                aria-controls="music-services-management"
                onClick={() => {
                  setServicesOpen((open) => !open);
                  if (servicesOpen) setSpotifySetupOpen(false);
                }}
              >
                {servicesOpen
                  ? t('common.done')
                  : connectedServiceNames.length
                    ? t('musicHub.manageServices')
                    : t('musicHub.setupServices')}
              </Button>
            </div>
            {servicesOpen ? (
              <div id="music-services-management">
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
                      onSaved={async () => {
                        await refreshStatuses();
                        setServicesOpen(false);
                      }}
                    />
                  </div>
                ) : null}
              </div>
            ) : null}
          </section>

          <section
            className={`rounded-[2rem] border p-4 md:p-5 ${surface.panel} ${surface.border}`}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className={`text-base font-semibold ${surface.textPrimary}`}>
                {submittedQuery || t('musicHub.browse')}
              </h2>
              {searching ? (
                <Loader2 className={`h-4 w-4 animate-spin ${surface.textMuted}`} />
              ) : null}
            </div>
            {!submittedQuery && libraryError ? (
              <div
                className={`rounded-2xl border p-4 text-sm leading-6 ${surface.border} ${surface.textSecondary}`}
              >
                {libraryError}
              </div>
            ) : searching ? (
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
                  <div key={`${section.sourceId}:${section.title}`}>
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
                      {section.items.map((item, index) => (
                        <ResultRow
                          key={`${item.sourceId}:${item.type}:${item.id}:${index}`}
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
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Speaker className={`h-4 w-4 ${surface.textMuted}`} aria-hidden="true" />
                <h2 className={`text-sm font-semibold ${surface.textPrimary}`}>
                  {t('musicHub.outputs')}
                </h2>
              </div>
              {groupingAvailable ? (
                <Button size="small" variant="ghost" onClick={openGrouping}>
                  <Users className="h-4 w-4" aria-hidden="true" />
                  {groupingOpen ? t('common.cancel') : t('musicHub.groupSpeakers')}
                </Button>
              ) : null}
            </div>
            {groupingOpen && selectedTarget ? (
              <div className={`mb-4 rounded-2xl border p-3 ${surface.border} ${surface.subtleBg}`}>
                <p className={`text-xs font-semibold ${surface.textPrimary}`}>
                  {t('musicHub.groupWith')} {selectedTarget.name}
                </p>
                <p className={`mt-1 text-[11px] leading-5 ${surface.textMuted}`}>
                  {t('musicHub.groupDescription')}
                </p>
                <div className="mt-3 space-y-1">
                  {targets
                    .filter(
                      (target) =>
                        target.adapterId === selectedTarget.adapterId &&
                        target.id !== selectedTarget.id
                    )
                    .map((target) => {
                      const checked = groupMemberIds.includes(target.id);
                      const checkboxId = `music-group-target-${target.id}`;
                      return (
                        <label
                          key={target.id}
                          htmlFor={checkboxId}
                          className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-2 ${surface.hoverBg}`}
                        >
                          <Checkbox
                            id={checkboxId}
                            checked={checked}
                            disabled={groupBusy}
                            onCheckedChange={(nextChecked) =>
                              setGroupMemberIds((current) =>
                                nextChecked
                                  ? [...current, target.id]
                                  : current.filter((targetId) => targetId !== target.id)
                              )
                            }
                          />
                          <span className={`min-w-0 truncate text-sm ${surface.textPrimary}`}>
                            {target.name}
                          </span>
                        </label>
                      );
                    })}
                </div>
                <Button
                  className="mt-3 w-full"
                  size="small"
                  disabled={groupBusy || groupMemberIds.length === 0}
                  onClick={() => void applyGrouping()}
                >
                  {groupBusy ? t('musicHub.updatingGroup') : t('musicHub.createGroup')}
                </Button>
              </div>
            ) : null}
            <div className="space-y-2">
              {targets.length ? (
                targets.map((target) => (
                  <div
                    key={`${target.adapterId}:${target.id}`}
                    className={`flex w-full items-center rounded-2xl border transition ${target.id === selectedTargetId ? surface.borderStrong : surface.border} ${target.id === selectedTargetId ? surface.subtleBg : surface.hoverBg}`}
                  >
                    <button
                      type="button"
                      disabled={!target.available}
                      onClick={() => setSelectedTargetId(target.id)}
                      className="flex min-w-0 flex-1 items-center gap-3 px-3 py-3 text-left disabled:opacity-45"
                    >
                      <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-current/5">
                        <Speaker className="h-4 w-4" aria-hidden="true" />
                        {target.isActive ? (
                          <span className="absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-current" />
                        ) : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span
                          className={`block truncate text-sm font-medium ${surface.textPrimary}`}
                        >
                          {target.name}
                        </span>
                        <span className={`block truncate text-xs ${surface.textMuted}`}>
                          {target.detail ||
                            (target.room && target.room !== target.name ? target.room : null) ||
                            (target.kind === 'browser'
                              ? t('musicHub.appleBrowserOnly')
                              : t('musicHub.navetSpeaker'))}
                        </span>
                        {(target.groupMemberIds?.length ?? 0) > 1 ? (
                          <span className="mt-1 flex items-center gap-1 text-[11px] text-emerald-500">
                            <Users className="h-3 w-3" aria-hidden="true" />
                            {target.groupCoordinatorId === target.id
                              ? t('musicHub.groupLeader')
                              : t('musicHub.grouped')}
                          </span>
                        ) : null}
                      </span>
                    </button>
                    {(target.groupMemberIds?.length ?? 0) > 1 ? (
                      <Button
                        iconOnly
                        label={t('musicHub.ungroup')}
                        variant="ghost"
                        size="small"
                        disabled={groupBusy}
                        onClick={(event) => {
                          event.stopPropagation();
                          void ungroupTarget(target);
                        }}
                      >
                        <Unlink className="h-4 w-4" />
                      </Button>
                    ) : null}
                  </div>
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
            {queueEntries.length ? (
              <ol className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
                {queueEntries.map(({ item, count, startIndex, isCurrent }) => (
                  <li
                    key={`${item.sourceId}:${item.id}:${startIndex}`}
                    className={`flex items-center gap-3 rounded-xl p-2 ${isCurrent ? surface.subtleBg : ''}`}
                  >
                    <span className={`w-5 text-center text-xs tabular-nums ${surface.textMuted}`}>
                      {startIndex + 1}
                    </span>
                    <MusicArtwork item={item} className="h-9 w-9 shrink-0 rounded-lg" />
                    <span className="min-w-0 flex-1">
                      <span
                        className={`flex items-center gap-2 text-xs font-medium ${surface.textPrimary}`}
                      >
                        <span className="truncate">{item.title}</span>
                        {count > 1 ? (
                          <span className={`shrink-0 tabular-nums ${surface.textMuted}`}>
                            ×{count}
                          </span>
                        ) : null}
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
        className={`fixed right-3 bottom-3 left-3 z-30 mx-auto max-w-5xl rounded-[1.75rem] border p-3 md:right-6 md:bottom-6 md:left-[calc(var(--sidebar-width,0px)+1.5rem)] ${surface.shellPanel} ${surface.cardShadow}`}
      >
        <div className="flex items-center gap-3">
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
              <div className="flex min-w-0 items-center gap-2">
                <p className={`min-w-0 truncate text-xs ${surface.textMuted}`}>
                  {currentItem.artists.join(', ')}
                </p>
                {playbackTarget ? (
                  <span
                    className={`flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium ${surface.subtleBg} ${surface.textSecondary}`}
                    title={`${t('musicHub.playingOn')} ${playbackTarget.name}`}
                  >
                    <Speaker className="h-3 w-3" aria-hidden="true" />
                    <span className="hidden sm:inline">{t('musicHub.playingOn')}</span>
                    <span className="max-w-28 truncate">{playbackTarget.name}</span>
                  </span>
                ) : null}
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-0.5 sm:gap-1">
            <Button
              iconOnly
              label={playback?.shuffle ? t('media.shuffle') : t('media.linearPlayback')}
              variant="ghost"
              size="small"
              disabled={!currentItem}
              aria-pressed={Boolean(playback?.shuffle)}
              style={playback?.shuffle ? { color: accentColor } : undefined}
              onClick={() =>
                void executeTransport({ type: 'set_shuffle', enabled: !playback?.shuffle })
              }
            >
              <Shuffle className="h-4 w-4" />
            </Button>
            <Button
              iconOnly
              label={t('media.previousTrack')}
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
              label={t('media.nextTrack')}
              variant="ghost"
              size="small"
              disabled={!currentItem}
              onClick={() => void executeTransport({ type: 'next' })}
            >
              <SkipForward className="h-4 w-4 fill-current" />
            </Button>
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
              disabled={!currentItem}
              aria-pressed={repeatMode !== 'off'}
              style={repeatMode !== 'off' ? { color: accentColor } : undefined}
              onClick={() =>
                void executeTransport({
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
          </div>
        </div>
        <div className="mt-2 flex items-center gap-3">
          <span className={`w-9 text-right text-[10px] tabular-nums ${surface.textMuted}`}>
            {formatDuration(playbackPosition)}
          </span>
          <Slider
            value={playbackPosition}
            max={Math.max(1, playbackDuration)}
            step={1000}
            ariaLabel={t('media.seek')}
            disabled={!currentItem || playbackDuration <= 0}
            onValueChange={setSeekDraft}
            onValueCommit={(positionMs) => {
              void executeTransport({ type: 'seek', positionMs }).finally(() => setSeekDraft(null));
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
            {formatDuration(playbackDuration)}
          </span>
          <div className="flex w-24 items-center gap-2 sm:w-28 md:w-36">
            <Volume2 className={`h-4 w-4 shrink-0 ${surface.textMuted}`} aria-hidden="true" />
            <Slider
              value={playbackVolume}
              max={1}
              step={0.01}
              ariaLabel={t('media.volume')}
              disabled={!currentItem}
              onValueChange={setVolumeDraft}
              onValueCommit={(volume) => {
                void executeTransport({ type: 'set_volume', volume }).finally(() =>
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
          <span
            className={`hidden w-7 text-right text-[10px] tabular-nums sm:block ${surface.textMuted}`}
          >
            {Math.round(playbackVolume * 100)}
          </span>
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
