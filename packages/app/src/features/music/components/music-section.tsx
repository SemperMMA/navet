import { Button, SheetSurface, SheetSurfaceHeader } from '@navet/app/components/primitives';
import { getThemeSurfaceTokens } from '@navet/app/components/shared/theme/theme-surface-tokens';
import { getThemeFocusRingClassName } from '@navet/app/components/system/tokens';
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
import { MusicLibraryBrowser } from '@navet/app/features/music/components/music-library-browser';
import { MusicNowPlayingBar } from '@navet/app/features/music/components/music-now-playing-bar';
import { MusicOutputPanel } from '@navet/app/features/music/components/music-output-panel';
import { MusicPlaylistSheet } from '@navet/app/features/music/components/music-playlist-sheet';
import { MusicServiceSheet } from '@navet/app/features/music/components/music-service-sheet';
import { SoundCloudPlayerSurface } from '@navet/app/features/music/components/soundcloud-player-surface';
import { YouTubePlayerSurface } from '@navet/app/features/music/components/youtube-player-surface';
import { getMusicRuntime } from '@navet/app/features/music/music-runtime';
import { useDeviceCollectionsByKeys, useI18n, useTheme } from '@navet/app/hooks';
import {
  createMusicItemKey,
  createMusicTargetKey,
  type MusicAccountStatus,
  type MusicBrowseSection,
  type MusicItem,
  type MusicPlaybackSnapshot,
  type MusicPlaybackState,
  type MusicPlaybackTarget,
  type MusicPlaybackTargetAdapter,
  type MusicQueuePosition,
  type MusicQueueSnapshot,
  type MusicSearchSection,
  type MusicSourceAdapter,
  type MusicSourceId,
  type MusicTransportCommand,
} from '@navet/core/music';
import { Headphones, Search, Speaker } from 'lucide-react';
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

const EMPTY_STATUSES: Partial<Record<MusicSourceId, MusicAccountStatus>> = {};
const MUSIC_DEVICE_COLLECTION_KEYS = ['media'] as const;

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

function supportsQueuePosition(target: MusicPlaybackTarget, position: MusicQueuePosition) {
  const positions = target.capabilities?.queuePositions;
  return positions ? positions.includes(position) : position === 'later';
}

function updateItemFavorite(item: MusicItem, key: string, favorite: boolean) {
  return createMusicItemKey(item) === key ? { ...item, isFavorite: favorite } : item;
}

function updateBrowseSections(sections: MusicBrowseSection[], key: string, favorite: boolean) {
  return sections.map((section) => ({
    ...section,
    items: section.items.map((item) => updateItemFavorite(item, key, favorite)),
  }));
}

function updateSearchSections(sections: MusicSearchSection[], key: string, favorite: boolean) {
  return sections.map((section) => ({
    ...section,
    items: section.items.map((item) => updateItemFavorite(item, key, favorite)),
  }));
}

function mergeBrowseSectionPage(
  sections: MusicBrowseSection[],
  page: MusicBrowseSection
): MusicBrowseSection[] {
  return sections.map((section) => {
    if (section.sourceId !== page.sourceId || section.id !== page.id) return section;
    const existingKeys = new Set(section.items.map(createMusicItemKey));
    const additionalItems = page.items.filter((item) => {
      const key = createMusicItemKey(item);
      if (existingKeys.has(key)) return false;
      existingKeys.add(key);
      return true;
    });
    return {
      ...section,
      items: [...section.items, ...additionalItems],
      continuation: additionalItems.length ? page.continuation : undefined,
    };
  });
}

function chooseTargetKey(targets: MusicPlaybackTarget[], current: string | null) {
  if (
    current &&
    targets.some((target) => createMusicTargetKey(target) === current && target.available)
  ) {
    return current;
  }
  const preferred =
    targets.find((target) => target.isActive && target.available) ??
    targets.find((target) => target.available);
  return preferred ? createMusicTargetKey(preferred) : null;
}

interface MusicSectionProps {
  sourceAdapters?: MusicSourceAdapter[];
  playbackTargetAdapters?: MusicPlaybackTargetAdapter[];
  includeNavetTargets?: boolean;
}

export function MusicSection({
  sourceAdapters: providedSourceAdapters,
  playbackTargetAdapters: providedPlaybackTargetAdapters,
  includeNavetTargets = false,
}: MusicSectionProps = {}) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const surface = getThemeSurfaceTokens(theme);
  const builtInRuntime = useMemo(() => getMusicRuntime(), []);
  const sourceAdapters = providedSourceAdapters ?? builtInRuntime.sources;
  const playbackTargetAdapters = providedPlaybackTargetAdapters ?? builtInRuntime.targets;
  const mediaDevices = useDeviceCollectionsByKeys(MUSIC_DEVICE_COLLECTION_KEYS).media;
  const mediaDevicesRef = useRef(mediaDevices);
  mediaDevicesRef.current = mediaDevices;
  const navetTargetAdapter = useMemo(
    () => createNavetMediaPlaybackTargetAdapter(() => mediaDevicesRef.current),
    []
  );
  const targetAdapters = useMemo(
    () =>
      includeNavetTargets
        ? [...playbackTargetAdapters, navetTargetAdapter]
        : playbackTargetAdapters,
    [includeNavetTargets, navetTargetAdapter, playbackTargetAdapters]
  );

  const [statuses, setStatuses] = useState(EMPTY_STATUSES);
  const [statusesLoading, setStatusesLoading] = useState(true);
  const [accountBusy, setAccountBusy] = useState<MusicSourceId | null>(null);
  const [query, setQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [searchSections, setSearchSections] = useState<MusicSearchSection[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchRefresh, setSearchRefresh] = useState(0);
  const [librarySections, setLibrarySections] = useState<MusicBrowseSection[]>([]);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryRefresh, setLibraryRefresh] = useState(0);
  const [sourceFilter, setSourceFilter] = useState<'all' | MusicSourceId>('all');
  const [selectedItem, setSelectedItem] = useState<MusicItem | null>(null);
  const [playlistItem, setPlaylistItem] = useState<MusicItem | null>(null);
  const [detailSections, setDetailSections] = useState<MusicBrowseSection[]>([]);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailRefresh, setDetailRefresh] = useState(0);
  const [selectedSourceId, setSelectedSourceId] = useState<MusicSourceId>('spotify');
  const [targets, setTargets] = useState<MusicPlaybackTarget[]>([]);
  const targetsRef = useRef<MusicPlaybackTarget[]>([]);
  const [targetError, setTargetError] = useState<string | null>(null);
  const [selectedTargetKey, setSelectedTargetKey] = useState<string | null>(null);
  const [playback, setPlayback] = useState<MusicPlaybackSnapshot | null>(null);
  const [queue, setQueue] = useState<MusicQueueSnapshot | null>(null);
  const [pendingItem, setPendingItem] = useState<MusicItem | null>(null);
  const [playingKey, setPlayingKey] = useState<string | null>(null);
  const [favoriteBusyKey, setFavoriteBusyKey] = useState<string | null>(null);
  const [pageBusyKey, setPageBusyKey] = useState<string | null>(null);
  const [servicesOpen, setServicesOpen] = useState(false);
  const [listeningOpen, setListeningOpen] = useState(false);
  const [groupingOpen, setGroupingOpen] = useState(false);
  const [groupBusy, setGroupBusy] = useState(false);
  const targetLoadIdRef = useRef(0);

  const commitTargets = useCallback((next: MusicPlaybackTarget[]) => {
    targetsRef.current = next;
    setTargets(next);
    setSelectedTargetKey((current) => chooseTargetKey(next, current));
  }, []);

  const refreshStatuses = useCallback(async () => {
    setStatusesLoading(true);
    const settled = await Promise.all(
      sourceAdapters.map(async (source) => {
        try {
          return [source.id, await source.getAccountStatus()] as const;
        } catch (error) {
          return [
            source.id,
            {
              state: 'unavailable',
              reason: getMusicErrorMessage(error, t('musicHub.providerFailed')),
            } satisfies MusicAccountStatus,
          ] as const;
        }
      })
    );
    const next: Partial<Record<MusicSourceId, MusicAccountStatus>> = {};
    for (const result of settled) {
      next[result[0]] = result[1];
    }
    setStatuses(next);
    setStatusesLoading(false);
  }, [sourceAdapters, t]);

  useEffect(() => {
    void refreshStatuses();
    const callbackUrl = new URL(window.location.href);
    const callbackStatus = callbackUrl.searchParams.get('status');
    const callbackSourceId = callbackUrl.searchParams.get('music_oauth');
    const callbackSource = sourceAdapters.find((source) => source.id === callbackSourceId);
    if (callbackStatus === 'connected' && callbackSource) {
      toast.success(`${callbackSource.name} · ${t('musicHub.connected')}`);
    }
    if (callbackStatus === 'failed') toast.error(t('musicHub.providerFailed'));
    if (callbackStatus || callbackSourceId) {
      callbackUrl.searchParams.delete('status');
      callbackUrl.searchParams.delete('music_oauth');
      window.history.replaceState(window.history.state, '', callbackUrl);
    }
  }, [refreshStatuses, sourceAdapters, t]);

  const connectedSources = useMemo(
    () => sourceAdapters.filter((source) => statuses[source.id]?.state === 'connected'),
    [sourceAdapters, statuses]
  );
  const playlistSource = useMemo(
    () =>
      playlistItem
        ? (connectedSources.find((source) => source.id === playlistItem.sourceId) ?? null)
        : null,
    [connectedSources, playlistItem]
  );
  const canAddToPlaylist = useCallback(
    (item: MusicItem) => {
      const source = connectedSources.find((candidate) => candidate.id === item.sourceId);
      return Boolean(
        source?.capabilities.playlistMutation &&
          source.listEditablePlaylists &&
          source.addToPlaylist &&
          source.canAddToPlaylist?.(item) !== false
      );
    },
    [connectedSources]
  );

  useEffect(() => {
    const firstConnected = connectedSources[0];
    if (firstConnected && statuses[selectedSourceId]?.state !== 'connected') {
      setSelectedSourceId(firstConnected.id);
    }
  }, [connectedSources, selectedSourceId, statuses]);

  useEffect(() => {
    if (sourceFilter !== 'all' && statuses[sourceFilter]?.state !== 'connected') {
      setSourceFilter('all');
    }
  }, [sourceFilter, statuses]);

  const loadTargets = useCallback(
    async (sourceId: MusicSourceId) => {
      const loadId = ++targetLoadIdRef.current;
      const results = targetAdapters.map((): MusicPlaybackTarget[] => []);
      const errors: unknown[] = [];
      setTargetError(null);
      if (!targetAdapters.length) {
        commitTargets([]);
        return [];
      }
      await Promise.all(
        targetAdapters.map(async (adapter, index) => {
          try {
            results[index] = await adapter.listTargets(sourceId);
          } catch (error) {
            errors.push(error);
          }
          if (targetLoadIdRef.current !== loadId) return;
          commitTargets(results.flat());
          setTargetError(
            errors.length ? getMusicErrorMessage(errors[0], t('musicHub.providerFailed')) : null
          );
        })
      );
      return results.flat();
    },
    [commitTargets, t, targetAdapters]
  );

  useEffect(() => {
    if (statuses[selectedSourceId]?.state !== 'connected') {
      commitTargets([]);
      setTargetError(null);
      return;
    }
    void loadTargets(selectedSourceId);
  }, [commitTargets, loadTargets, selectedSourceId, statuses]);

  useEffect(() => {
    if (!includeNavetTargets || statuses[selectedSourceId]?.state !== 'connected') return;
    let active = true;
    void navetTargetAdapter
      .listTargets(selectedSourceId)
      .then((localTargets) => {
        if (!active) return;
        commitTargets([
          ...targetsRef.current.filter((target) => target.adapterId !== navetTargetAdapter.id),
          ...localTargets,
        ]);
      })
      .catch((error) => {
        if (active) setTargetError(getMusicErrorMessage(error, t('musicHub.providerFailed')));
      });
    return () => {
      active = false;
    };
  }, [
    commitTargets,
    includeNavetTargets,
    mediaDevices,
    navetTargetAdapter,
    selectedSourceId,
    statuses,
    t,
  ]);

  useEffect(() => {
    const controller = new AbortController();
    const sources = connectedSources.filter((source) => source.browseLibrary);
    if (!sources.length) {
      setLibrarySections([]);
      setLibraryError(null);
      setLibraryLoading(false);
      return;
    }
    setLibraryLoading(true);
    setLibraryError(null);
    void Promise.allSettled(
      sources.map(async (source) => (await source.browseLibrary?.(controller.signal)) ?? [])
    ).then((results) => {
      if (controller.signal.aborted) return;
      const next = results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
      const failed = results.find((result) => result.status === 'rejected');
      setLibrarySections(next);
      setLibraryError(
        failed?.status === 'rejected'
          ? getMusicErrorMessage(failed.reason, t('musicHub.providerFailed'))
          : null
      );
      setLibraryLoading(false);
    });
    return () => controller.abort();
  }, [connectedSources, libraryRefresh, t]);

  useEffect(() => {
    if (!submittedQuery) {
      setSearchSections([]);
      setSearchError(null);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    setSearchError(null);
    void Promise.allSettled(
      connectedSources.map(async (source) => ({
        sourceId: source.id,
        title: source.name,
        items: await source.search(submittedQuery, controller.signal),
      }))
    ).then((results) => {
      if (controller.signal.aborted) return;
      const failed = results.find((result) => result.status === 'rejected');
      setSearchSections(
        results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []))
      );
      setSearchError(
        failed?.status === 'rejected'
          ? getMusicErrorMessage(failed.reason, t('musicHub.providerFailed'))
          : null
      );
      setSearching(false);
    });
    return () => controller.abort();
  }, [connectedSources, searchRefresh, submittedQuery, t]);

  useEffect(() => {
    if (!selectedItem) {
      setDetailSections([]);
      setDetailError(null);
      setDetailLoading(false);
      return;
    }
    const source = sourceAdapters.find((candidate) => candidate.id === selectedItem.sourceId);
    if (!source?.browseItem) {
      setDetailSections([]);
      setDetailLoading(false);
      return;
    }
    const controller = new AbortController();
    setDetailLoading(true);
    setDetailError(null);
    void source
      .browseItem(selectedItem, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) setDetailSections(next);
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          setDetailError(getMusicErrorMessage(error, t('musicHub.detailFailed')));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoading(false);
      });
    return () => controller.abort();
  }, [detailRefresh, selectedItem, sourceAdapters, t]);

  const refreshPlayback = useCallback(
    async (sourceId: MusicSourceId = selectedSourceId): Promise<MusicPlaybackState | undefined> => {
      const source = sourceAdapters.find((candidate) => candidate.id === sourceId);
      if (!source || statuses[sourceId]?.state !== 'connected') return undefined;
      const [nextPlayback, nextQueue] = await Promise.allSettled([
        source.getPlaybackSnapshot?.(),
        source.getQueue?.(),
      ]);
      if (nextPlayback.status === 'fulfilled' && nextPlayback.value) {
        setPlayback(nextPlayback.value);
      }
      if (nextQueue.status === 'fulfilled' && nextQueue.value) setQueue(nextQueue.value);
      return nextPlayback.status === 'fulfilled' ? nextPlayback.value?.state : undefined;
    },
    [selectedSourceId, sourceAdapters, statuses]
  );

  useEffect(() => {
    if (statuses[selectedSourceId]?.state !== 'connected') return;
    let active = true;
    let timeoutId: number | null = null;
    const poll = async () => {
      if (!active || document.visibilityState !== 'visible') return;
      const state = await refreshPlayback(selectedSourceId);
      if (active && document.visibilityState === 'visible') {
        timeoutId = window.setTimeout(() => void poll(), state === 'playing' ? 5_000 : 15_000);
      }
    };
    const handleVisibilityChange = () => {
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      timeoutId = null;
      if (document.visibilityState === 'visible') void poll();
    };
    void poll();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      active = false;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [refreshPlayback, selectedSourceId, statuses]);

  const findTargetAdapter = useCallback(
    (target: MusicPlaybackTarget) =>
      targetAdapters.find((adapter) => adapter.id === target.adapterId) ?? null,
    [targetAdapters]
  );

  const playItem = useCallback(
    async (item: MusicItem) => {
      setPlayingKey(createMusicItemKey(item));
      try {
        const sourceTargets =
          item.sourceId === selectedSourceId ? targets : await loadTargets(item.sourceId);
        const target =
          sourceTargets.find(
            (candidate) =>
              createMusicTargetKey(candidate) === selectedTargetKey && candidate.available
          ) ??
          sourceTargets.find((candidate) => candidate.isActive && candidate.available) ??
          sourceTargets.find((candidate) => candidate.available);
        if (!target) throw new Error(t('musicHub.outputRequired'));
        const adapter = findTargetAdapter(target);
        if (!adapter) throw new Error(t('musicHub.outputRequired'));
        setSelectedSourceId(item.sourceId);
        setSelectedTargetKey(createMusicTargetKey(target));
        await adapter.play(target.id, item, { replaceQueue: true });
        await refreshPlayback(item.sourceId);
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
      selectedTargetKey,
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
    async (item: MusicItem, position: MusicQueuePosition) => {
      const target = targets.find(
        (candidate) => createMusicTargetKey(candidate) === selectedTargetKey
      );
      const adapter = target ? findTargetAdapter(target) : null;
      const source = sourceAdapters.find((candidate) => candidate.id === item.sourceId);
      if (
        !target?.available ||
        !adapter?.enqueue ||
        !source?.capabilities.queue ||
        item.sourceId !== selectedSourceId ||
        target.capabilities?.enqueue === false ||
        !supportsQueuePosition(target, position) ||
        adapter.canEnqueue?.(target.id, item, position) === false
      ) {
        toast.error(t('musicHub.outputRequired'));
        return;
      }
      try {
        await adapter.enqueue(target.id, item, { position });
        await refreshPlayback(selectedSourceId);
      } catch (error) {
        toast.error(getMusicErrorMessage(error, t('musicHub.providerFailed')));
      }
    },
    [
      findTargetAdapter,
      refreshPlayback,
      selectedSourceId,
      selectedTargetKey,
      sourceAdapters,
      t,
      targets,
    ]
  );

  const executeTransport = useCallback(
    async (command: MusicTransportCommand) => {
      const target =
        targets.find(
          (candidate) =>
            candidate.id === playback?.targetId &&
            (!playback.targetAdapterId || candidate.adapterId === playback.targetAdapterId)
        ) ?? targets.find((candidate) => createMusicTargetKey(candidate) === selectedTargetKey);
      const adapter = target ? findTargetAdapter(target) : null;
      if (!target || !adapter) return;
      try {
        await adapter.execute(target.id, command);
        await refreshPlayback(selectedSourceId);
      } catch (error) {
        toast.error(getMusicErrorMessage(error, t('musicHub.providerFailed')));
      }
    },
    [
      findTargetAdapter,
      playback?.targetId,
      refreshPlayback,
      selectedSourceId,
      selectedTargetKey,
      t,
      targets,
    ]
  );

  const toggleFavorite = useCallback(
    async (item: MusicItem) => {
      const source = sourceAdapters.find((candidate) => candidate.id === item.sourceId);
      if (
        !source?.capabilities.favoriteMutation ||
        !source.setFavorite ||
        source.canSetFavorite?.(item) === false
      ) {
        return;
      }
      const key = createMusicItemKey(item);
      const favorite = !item.isFavorite;
      const applyFavorite = (value: boolean) => {
        setLibrarySections((current) => updateBrowseSections(current, key, value));
        setSearchSections((current) => updateSearchSections(current, key, value));
        setDetailSections((current) => updateBrowseSections(current, key, value));
        setSelectedItem((current) =>
          current && createMusicItemKey(current) === key
            ? { ...current, isFavorite: value }
            : current
        );
        setPlayback((current) =>
          current?.currentItem && createMusicItemKey(current.currentItem) === key
            ? { ...current, currentItem: { ...current.currentItem, isFavorite: value } }
            : current
        );
        setQueue((current) =>
          current
            ? {
                ...current,
                items: current.items.map((entry) => updateItemFavorite(entry, key, value)),
              }
            : current
        );
      };
      setFavoriteBusyKey(key);
      applyFavorite(favorite);
      try {
        await source.setFavorite(item, favorite);
        toast.success(favorite ? t('musicHub.saved') : t('musicHub.removeSaved'));
        setLibraryRefresh((revision) => revision + 1);
      } catch (error) {
        applyFavorite(!favorite);
        toast.error(getMusicErrorMessage(error, t('musicHub.providerFailed')));
      } finally {
        setFavoriteBusyKey(null);
      }
    },
    [sourceAdapters, t]
  );

  const loadMoreSection = useCallback(
    async (section: MusicBrowseSection, scope: 'library' | 'detail') => {
      const source = sourceAdapters.find((candidate) => candidate.id === section.sourceId);
      if (!source?.browseNextPage || !section.continuation) return;
      const key = `${scope}:${section.sourceId}:${section.id}`;
      setPageBusyKey(key);
      try {
        const page = await source.browseNextPage(section);
        if (scope === 'detail') {
          setDetailSections((current) => mergeBrowseSectionPage(current, page));
        } else {
          setLibrarySections((current) => mergeBrowseSectionPage(current, page));
        }
      } catch (error) {
        toast.error(getMusicErrorMessage(error, t('musicHub.providerFailed')));
      } finally {
        setPageBusyKey((current) => (current === key ? null : current));
      }
    },
    [sourceAdapters, t]
  );

  const handleSearch = (event: FormEvent) => {
    event.preventDefault();
    const next = query.trim();
    setSelectedItem(null);
    setSubmittedQuery(next);
  };

  const handleAccountAction = async (source: MusicSourceAdapter, connect: boolean) => {
    setAccountBusy(source.id);
    try {
      await (connect ? source.connect() : source.disconnect());
      if (!connect) {
        setPlayback((current) => (current?.sourceId === source.id ? null : current));
        setQueue((current) => (current?.sourceId === source.id ? null : current));
        setPendingItem((current) => (current?.sourceId === source.id ? null : current));
        setSelectedItem((current) => (current?.sourceId === source.id ? null : current));
      }
      await refreshStatuses();
    } catch (error) {
      toast.error(getMusicErrorMessage(error, t('musicHub.providerFailed')));
    } finally {
      setAccountBusy(null);
    }
  };

  const selectedTarget =
    targets.find((target) => createMusicTargetKey(target) === selectedTargetKey) ?? null;
  const playbackTarget =
    targets.find(
      (target) =>
        target.id === playback?.targetId &&
        (!playback.targetAdapterId || target.adapterId === playback.targetAdapterId)
    ) ?? selectedTarget;
  const currentItem = playback?.sourceId === selectedSourceId ? playback.currentItem : null;
  const hasNowPlaying = currentItem !== null;
  const selectedTargetAdapter = selectedTarget ? findTargetAdapter(selectedTarget) : null;
  const groupCoordinator =
    targets.find(
      (target) =>
        target.adapterId === selectedTarget?.adapterId &&
        target.id === selectedTarget?.groupCoordinatorId
    ) ?? selectedTarget;
  const groupCoordinatorAdapter = groupCoordinator ? findTargetAdapter(groupCoordinator) : null;
  const groupingAvailable = Boolean(
    groupCoordinator?.capabilities?.grouping !== false &&
      groupCoordinatorAdapter?.group &&
      groupCoordinatorAdapter.ungroup
  );
  const canEnqueue = useCallback(
    (item: MusicItem, position: MusicQueuePosition) =>
      Boolean(
        item.sourceId === selectedSourceId &&
          sourceAdapters.find((source) => source.id === item.sourceId)?.capabilities.queue &&
          selectedTarget?.available &&
          selectedTargetAdapter?.enqueue &&
          selectedTarget.capabilities?.enqueue !== false &&
          supportsQueuePosition(selectedTarget, position) &&
          selectedTargetAdapter.canEnqueue?.(selectedTarget.id, item, position) !== false
      ),
    [selectedSourceId, selectedTarget, selectedTargetAdapter, sourceAdapters]
  );

  const toggleGroupTarget = async (target: MusicPlaybackTarget) => {
    if (!groupCoordinator || !groupCoordinatorAdapter?.group || !groupCoordinatorAdapter.ungroup) {
      return;
    }
    const attached = groupCoordinator.groupMemberIds?.includes(target.id) ?? false;
    setGroupBusy(true);
    try {
      if (attached) await groupCoordinatorAdapter.ungroup(target.id);
      else await groupCoordinatorAdapter.group(groupCoordinator.id, [target.id]);
      await loadTargets(selectedSourceId);
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
    const targetIds =
      target.groupCoordinatorId === target.id
        ? memberIds.filter((targetId) => targetId !== target.id)
        : [target.id];
    setGroupBusy(true);
    try {
      for (const targetId of targetIds) await adapter.ungroup(targetId);
      await loadTargets(selectedSourceId);
      toast.success(t('musicHub.speakersUngrouped'));
    } catch (error) {
      toast.error(getMusicErrorMessage(error, t('musicHub.groupFailed')));
    } finally {
      setGroupBusy(false);
    }
  };

  const queueEntries = useMemo(() => collapseQueueEntries(queue), [queue]);
  const connectedServiceCount = connectedSources.length;
  const outputPanel = (
    <MusicOutputPanel
      targets={targets}
      selectedTargetKey={selectedTargetKey}
      groupCoordinator={groupCoordinator}
      groupingAvailable={groupingAvailable}
      groupingOpen={groupingOpen}
      groupBusy={groupBusy}
      error={targetError}
      queueEntries={queueEntries}
      hasConnectedServices={connectedServiceCount > 0}
      onSelectTarget={setSelectedTargetKey}
      onToggleGrouping={() => setGroupingOpen((open) => !open)}
      onToggleGroupTarget={(target) => void toggleGroupTarget(target)}
      onUngroupTarget={(target) => void ungroupTarget(target)}
    />
  );

  return (
    <div
      className={`w-full space-y-4 md:space-y-5 ${
        hasNowPlaying ? 'pb-[calc(11rem+env(safe-area-inset-bottom,0px))] md:pb-32' : 'pb-4 md:pb-5'
      }`}
    >
      <header className="px-1">
        <div className="flex items-center justify-between gap-3">
          <h1
            className={`text-2xl font-semibold tracking-[-0.025em] md:text-3xl ${surface.textPrimary}`}
          >
            {t('sidebar.music')}
          </h1>
          <Button
            size="small"
            variant="secondary"
            className="shrink-0"
            aria-expanded={servicesOpen}
            onClick={() => setServicesOpen(true)}
          >
            {connectedServiceCount ? t('musicHub.manageServices') : t('musicHub.setupServices')}
          </Button>
        </div>
        <p className={`mt-1 max-w-2xl text-sm leading-5 ${surface.textSecondary}`}>
          {t('musicHub.description')}
        </p>
      </header>

      <form onSubmit={handleSearch} className="flex gap-2">
        <label htmlFor="music-search" className="sr-only">
          {t('musicHub.searchPlaceholder')}
        </label>
        <div
          className={`flex h-12 min-w-0 flex-1 items-center gap-3 rounded-full border px-4 ${surface.inputBg} ${surface.border}`}
        >
          <Search className={`h-4 w-4 shrink-0 ${surface.textMuted}`} aria-hidden="true" />
          <input
            id="music-search"
            name="music-search"
            type="search"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(event) => {
              const next = event.target.value;
              setQuery(next);
              if (!next.trim()) setSubmittedQuery('');
            }}
            placeholder={t('musicHub.searchPlaceholder')}
            className={`min-w-0 flex-1 rounded-sm bg-transparent text-sm ${surface.textPrimary} ${surface.placeholder} ${getThemeFocusRingClassName(theme)}`}
          />
        </div>
        <Button type="submit" disabled={!query.trim()}>
          {t('musicHub.searchAction')}
        </Button>
      </form>

      <button
        type="button"
        onClick={() => setListeningOpen(true)}
        className={`flex min-h-14 w-full items-center gap-3 rounded-2xl border px-4 text-left xl:hidden ${surface.panelMuted} ${surface.border} ${surface.hoverBg} ${getThemeFocusRingClassName(theme)}`}
      >
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${surface.iconBg}`}
        >
          <Speaker className="h-4 w-4" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block text-xs font-semibold ${surface.textPrimary}`}>
            {t('musicHub.outputs')}
          </span>
          <span className={`block truncate text-xs ${surface.textMuted}`}>
            {selectedTarget?.name || t('musicHub.outputRequired')}
          </span>
        </span>
        {groupingAvailable ? (
          <span className={`text-xs font-medium ${surface.textSecondary}`}>
            {t('musicHub.groupSpeakers')}
          </span>
        ) : null}
      </button>

      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <MusicLibraryBrowser
          sources={connectedSources}
          librarySections={librarySections}
          searchSections={searchSections}
          submittedQuery={submittedQuery}
          loading={statusesLoading || (submittedQuery ? searching : libraryLoading)}
          error={submittedQuery ? searchError : libraryError}
          sourceFilter={sourceFilter}
          selectedItem={selectedItem}
          detailSections={detailSections}
          detailLoading={detailLoading}
          detailError={detailError}
          playingKey={playingKey}
          favoriteBusyKey={favoriteBusyKey}
          pageBusyKey={pageBusyKey}
          canEnqueue={canEnqueue}
          canAddToPlaylist={canAddToPlaylist}
          onFilterChange={(sourceId) => {
            setSourceFilter(sourceId);
            setSelectedItem(null);
          }}
          onOpenItem={(item) => {
            if (selectedItem && createMusicItemKey(selectedItem) === createMusicItemKey(item)) {
              setDetailRefresh((revision) => revision + 1);
            } else {
              setSelectedItem(item);
            }
          }}
          onCloseItem={() => setSelectedItem(null)}
          onPlay={requestPlay}
          onEnqueue={(item, position) => void enqueueItem(item, position)}
          onAddToPlaylist={setPlaylistItem}
          onToggleFavorite={(item) => void toggleFavorite(item)}
          onLoadMore={(section, scope) => void loadMoreSection(section, scope)}
          onRetry={() =>
            submittedQuery
              ? setSearchRefresh((revision) => revision + 1)
              : setLibraryRefresh((revision) => revision + 1)
          }
        />
        <aside className="hidden min-w-0 xl:sticky xl:top-5 xl:block xl:self-start">
          <div className="space-y-4">{outputPanel}</div>
        </aside>
      </div>

      <div className="mx-auto max-w-2xl space-y-4">
        <SoundCloudPlayerSurface />
        <YouTubePlayerSurface />
      </div>

      <MusicServiceSheet
        open={servicesOpen}
        sources={sourceAdapters}
        statuses={statuses}
        loading={statusesLoading}
        busySourceId={accountBusy}
        onOpenChange={setServicesOpen}
        onAccountAction={(source, connect) => void handleAccountAction(source, connect)}
        onConfigurationChanged={refreshStatuses}
      />

      <MusicPlaylistSheet
        open={playlistItem !== null && playlistSource !== null}
        item={playlistItem}
        source={playlistSource}
        onOpenChange={(open) => {
          if (!open) setPlaylistItem(null);
        }}
        onAdded={() => {
          setLibraryRefresh((revision) => revision + 1);
          setDetailRefresh((revision) => revision + 1);
        }}
      />

      <SheetSurface
        isOpen={listeningOpen}
        onOpenChange={setListeningOpen}
        title={t('musicHub.listening')}
        description={selectedTarget?.name || t('musicHub.outputRequired')}
        mobileOnly={false}
        contentClassName="sm:max-w-xl"
        bodyClassName="min-h-0 overflow-y-auto px-4 pb-5 sm:px-5"
      >
        <SheetSurfaceHeader
          title={t('musicHub.listening')}
          description={selectedTarget?.name || t('musicHub.outputRequired')}
          closeLabel={t('common.close')}
          onClose={() => setListeningOpen(false)}
          className="px-4 pt-3 pb-4 sm:px-5"
          titleAccessory={<Headphones className="h-4 w-4" aria-hidden="true" />}
        />
        {outputPanel}
      </SheetSurface>

      {hasNowPlaying ? (
        <MusicNowPlayingBar
          playback={playback}
          currentItem={currentItem}
          playbackTarget={playbackTarget}
          onExecute={executeTransport}
          onOpenListening={() => setListeningOpen(true)}
        />
      ) : null}

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
