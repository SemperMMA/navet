import { Button } from '@navet/app/components/primitives/button';
import { SurfacePanel } from '@navet/app/components/primitives/surface-panel';
import { getThemeSurfaceTokens } from '@navet/app/components/shared/theme/theme-surface-tokens';
import { getThemeFocusRingClassName } from '@navet/app/components/system/tokens';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@navet/app/components/ui/dropdown-menu';
import { useI18n, useTheme } from '@navet/app/hooks';
import {
  createMusicItemKey,
  type MusicBrowseSection,
  type MusicItem,
  type MusicQueuePosition,
  type MusicSearchSection,
  type MusicSourceAdapter,
  type MusicSourceId,
} from '@navet/core/music';
import {
  ArrowLeft,
  FolderPlus,
  Heart,
  Library,
  ListMusic,
  ListPlus,
  Loader2,
  MoreHorizontal,
  Play,
  RotateCw,
} from 'lucide-react';
import { useMemo } from 'react';
import {
  formatMusicDuration,
  getMusicSourceAccent,
  MusicArtwork,
  MusicSourceIcon,
} from './music-presentation';

interface MusicLibraryBrowserProps {
  sources: MusicSourceAdapter[];
  librarySections: MusicBrowseSection[];
  searchSections: MusicSearchSection[];
  submittedQuery: string;
  loading: boolean;
  error: string | null;
  sourceFilter: 'all' | MusicSourceId;
  selectedItem: MusicItem | null;
  detailSections: MusicBrowseSection[];
  detailLoading: boolean;
  detailError: string | null;
  playingKey: string | null;
  favoriteBusyKey: string | null;
  pageBusyKey: string | null;
  canEnqueue: (item: MusicItem, position: MusicQueuePosition) => boolean;
  canAddToPlaylist: (item: MusicItem) => boolean;
  onFilterChange: (sourceId: 'all' | MusicSourceId) => void;
  onOpenItem: (item: MusicItem) => void;
  onCloseItem: () => void;
  onPlay: (item: MusicItem) => void;
  onEnqueue: (item: MusicItem, position: MusicQueuePosition) => void;
  onAddToPlaylist: (item: MusicItem) => void;
  onToggleFavorite: (item: MusicItem) => void;
  onLoadMore: (section: MusicBrowseSection, scope: 'library' | 'detail') => void;
  onRetry: () => void;
}

function MusicItemActionsMenu({
  item,
  canPlayNext,
  canPlayLater,
  canAddToPlaylist,
  queueBusy,
  onPlayNext,
  onPlayLater,
  onAddToPlaylist,
  className,
}: {
  item: MusicItem;
  canPlayNext: boolean;
  canPlayLater: boolean;
  canAddToPlaylist: boolean;
  queueBusy: boolean;
  onPlayNext: () => void;
  onPlayLater: () => void;
  onAddToPlaylist: () => void;
  className?: string;
}) {
  const { t } = useI18n();
  if (!canPlayNext && !canPlayLater && !canAddToPlaylist) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          iconOnly
          label={`${t('common.moreActions')}: ${item.title}`}
          variant="ghost"
          size="small"
          className={`min-h-11 min-w-11 shrink-0 ${className ?? ''}`}
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        {canPlayNext ? (
          <DropdownMenuItem disabled={queueBusy} onSelect={onPlayNext}>
            <ListPlus aria-hidden="true" />
            {t('musicHub.playNext')}
          </DropdownMenuItem>
        ) : null}
        {canPlayLater ? (
          <DropdownMenuItem disabled={queueBusy} onSelect={onPlayLater}>
            <ListMusic aria-hidden="true" />
            {t('musicHub.playLater')}
          </DropdownMenuItem>
        ) : null}
        {canAddToPlaylist ? (
          <DropdownMenuItem onSelect={onAddToPlaylist}>
            <FolderPlus aria-hidden="true" />
            {t('musicHub.addToPlaylist')}
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function getSectionTitle(section: MusicBrowseSection, t: ReturnType<typeof useI18n>['t']) {
  if (section.title) return section.title;
  switch (section.kind) {
    case 'recent':
      return t('musicHub.recentlyPlayed');
    case 'favorites':
      return t('musicHub.likedSongs');
    case 'playlists':
      return t('musicHub.playlists');
    case 'albums':
      return t('musicHub.albums');
    case 'artists':
      return t('musicHub.artists');
    case 'tracks':
      return t('musicHub.tracks');
    case 'recommendations':
      return t('musicHub.recommendations');
    default:
      return t('musicHub.collections');
  }
}

function ItemFavoriteButton({
  item,
  source,
  busy,
  onToggle,
  className,
}: {
  item: MusicItem;
  source?: MusicSourceAdapter;
  busy: boolean;
  onToggle: () => void;
  className?: string;
}) {
  const { t } = useI18n();
  if (
    !source?.capabilities.favoriteMutation ||
    !source.setFavorite ||
    source.canSetFavorite?.(item) === false
  ) {
    return null;
  }
  return (
    <Button
      iconOnly
      label={`${item.isFavorite ? t('musicHub.removeSaved') : t('musicHub.save')}: ${item.title}`}
      variant="ghost"
      size="small"
      className={`min-h-11 min-w-11 shrink-0 ${className ?? ''}`}
      disabled={busy}
      loading={busy}
      aria-pressed={Boolean(item.isFavorite)}
      onClick={onToggle}
    >
      <Heart className={`h-4 w-4 ${item.isFavorite ? 'fill-current' : ''}`} />
    </Button>
  );
}

function MusicListItem({
  item,
  source,
  playing,
  favoriteBusy,
  canPlayNext,
  canPlayLater,
  canAddToPlaylist,
  onOpen,
  onPlay,
  onPlayNext,
  onPlayLater,
  onAddToPlaylist,
  onToggleFavorite,
}: {
  item: MusicItem;
  source?: MusicSourceAdapter;
  playing: boolean;
  favoriteBusy: boolean;
  canPlayNext: boolean;
  canPlayLater: boolean;
  canAddToPlaylist: boolean;
  onOpen: () => void;
  onPlay: () => void;
  onPlayNext: () => void;
  onPlayLater: () => void;
  onAddToPlaylist: () => void;
  onToggleFavorite: () => void;
}) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const surface = getThemeSurfaceTokens(theme);
  const canOpen = Boolean(
    source?.capabilities.itemDetails &&
      source.browseItem &&
      (item.type === 'album' || item.type === 'playlist' || item.type === 'artist')
  );
  return (
    <article className={`group flex min-w-0 items-center gap-2 rounded-2xl p-2 ${surface.hoverBg}`}>
      <button
        type="button"
        onClick={canOpen ? onOpen : onPlay}
        disabled={playing || (!canOpen && !item.playable)}
        aria-label={
          canOpen
            ? `${t('musicHub.openCollection')}: ${item.title}`
            : `${t('musicHub.play')} ${item.title}`
        }
        className={`flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left ${getThemeFocusRingClassName(theme)}`}
      >
        <MusicArtwork item={item} className="h-12 w-12 shrink-0 rounded-xl" />
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-sm font-medium ${surface.textPrimary}`}>
            {item.title}
          </span>
          <span className={`block truncate text-xs ${surface.textMuted}`}>
            {[item.artists.join(', '), item.album, formatMusicDuration(item.durationMs)]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </span>
      </button>
      <ItemFavoriteButton
        item={item}
        source={source}
        busy={favoriteBusy}
        onToggle={onToggleFavorite}
      />
      <MusicItemActionsMenu
        item={item}
        canPlayNext={canPlayNext}
        canPlayLater={canPlayLater}
        canAddToPlaylist={canAddToPlaylist}
        queueBusy={playing}
        onPlayNext={onPlayNext}
        onPlayLater={onPlayLater}
        onAddToPlaylist={onAddToPlaylist}
      />
      <Button
        iconOnly
        label={`${t('musicHub.play')} ${item.title}`}
        size="small"
        className={`min-h-11 min-w-11 shrink-0 ${item.type === 'track' ? 'max-sm:hidden' : ''}`}
        disabled={playing || !item.playable}
        loading={playing}
        onClick={onPlay}
      >
        <Play className="h-4 w-4 fill-current" />
      </Button>
    </article>
  );
}

function MusicGridItem({
  item,
  source,
  playing,
  favoriteBusy,
  canPlayNext,
  canPlayLater,
  canAddToPlaylist,
  onOpen,
  onPlay,
  onPlayNext,
  onPlayLater,
  onAddToPlaylist,
  onToggleFavorite,
}: {
  item: MusicItem;
  source?: MusicSourceAdapter;
  playing: boolean;
  favoriteBusy: boolean;
  canPlayNext: boolean;
  canPlayLater: boolean;
  canAddToPlaylist: boolean;
  onOpen: () => void;
  onPlay: () => void;
  onPlayNext: () => void;
  onPlayLater: () => void;
  onAddToPlaylist: () => void;
  onToggleFavorite: () => void;
}) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const surface = getThemeSurfaceTokens(theme);
  const canOpen = Boolean(source?.capabilities.itemDetails && source.browseItem);
  const actionLabel = canOpen
    ? `${t('musicHub.openCollection')}: ${item.title}`
    : `${t('musicHub.play')} ${item.title}`;
  return (
    <article className="group min-w-0 snap-start">
      <div className="relative aspect-square overflow-hidden rounded-[1.35rem]">
        <button
          type="button"
          onClick={canOpen ? onOpen : onPlay}
          disabled={playing || (!canOpen && !item.playable)}
          aria-label={actionLabel}
          className={`h-full w-full rounded-[1.35rem] text-left ${getThemeFocusRingClassName(theme)}`}
        >
          <MusicArtwork
            item={item}
            className="h-full w-full rounded-[1.35rem] transition-transform duration-300 group-hover:scale-[1.025] motion-reduce:transition-none"
          />
        </button>
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent" />
        <ItemFavoriteButton
          item={item}
          source={source}
          busy={favoriteBusy}
          onToggle={onToggleFavorite}
          className="pointer-events-auto absolute top-1.5 right-1.5 bg-black/45 text-white hover:bg-black/60"
        />
        <MusicItemActionsMenu
          item={item}
          canPlayNext={canPlayNext}
          canPlayLater={canPlayLater}
          canAddToPlaylist={canAddToPlaylist}
          queueBusy={playing}
          onPlayNext={onPlayNext}
          onPlayLater={onPlayLater}
          onAddToPlaylist={onAddToPlaylist}
          className="pointer-events-auto absolute top-1.5 left-1.5 bg-black/45 text-white hover:bg-black/60"
        />
        {item.playable ? (
          <Button
            iconOnly
            label={`${t('musicHub.play')} ${item.title}`}
            size="small"
            className="pointer-events-auto absolute right-2 bottom-2 min-h-11 min-w-11 rounded-full shadow-lg"
            disabled={playing}
            loading={playing}
            onClick={onPlay}
          >
            <Play className="h-4 w-4 fill-current" />
          </Button>
        ) : null}
      </div>
      <button
        type="button"
        onClick={canOpen ? onOpen : onPlay}
        disabled={playing || (!canOpen && !item.playable)}
        className={`mt-2 block w-full rounded-lg text-left ${getThemeFocusRingClassName(theme)}`}
      >
        <span className={`block truncate text-sm font-semibold ${surface.textPrimary}`}>
          {item.title}
        </span>
        <span className={`mt-0.5 block truncate text-xs ${surface.textMuted}`}>
          {item.artists.join(', ') || source?.name}
        </span>
      </button>
    </article>
  );
}

function MusicShelf({
  section,
  sourceById,
  playingKey,
  favoriteBusyKey,
  pageBusyKey,
  canEnqueue,
  canAddToPlaylist,
  onOpenItem,
  onPlay,
  onEnqueue,
  onAddToPlaylist,
  onToggleFavorite,
  onLoadMore,
  scope,
}: {
  section: MusicBrowseSection;
  sourceById: Map<MusicSourceId, MusicSourceAdapter>;
  playingKey: string | null;
  favoriteBusyKey: string | null;
  pageBusyKey: string | null;
  canEnqueue: (item: MusicItem, position: MusicQueuePosition) => boolean;
  canAddToPlaylist: (item: MusicItem) => boolean;
  onOpenItem: (item: MusicItem) => void;
  onPlay: (item: MusicItem) => void;
  onEnqueue: (item: MusicItem, position: MusicQueuePosition) => void;
  onAddToPlaylist: (item: MusicItem) => void;
  onToggleFavorite: (item: MusicItem) => void;
  onLoadMore: (section: MusicBrowseSection, scope: 'library' | 'detail') => void;
  scope: 'library' | 'detail';
}) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const surface = getThemeSurfaceTokens(theme);
  const source = sourceById.get(section.sourceId);
  return (
    <SurfacePanel>
      <div className="mb-4 flex min-w-0 items-center gap-2.5">
        {source ? (
          <span
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-white"
            style={{ backgroundColor: getMusicSourceAccent(source) }}
          >
            <MusicSourceIcon source={source} className="h-3.5 w-3.5" />
          </span>
        ) : null}
        <div className="min-w-0">
          <h2 className={`truncate text-base font-semibold ${surface.textPrimary}`}>
            {getSectionTitle(section, t)}
          </h2>
          {source ? <p className={`text-xs ${surface.textMuted}`}>{source.name}</p> : null}
        </div>
      </div>
      {section.layout === 'grid' ? (
        <div className="grid snap-x snap-mandatory auto-cols-[minmax(8.75rem,44%)] grid-flow-col gap-3 overflow-x-auto overscroll-x-contain pb-2 sm:auto-cols-[minmax(9rem,30%)] lg:grid-flow-row lg:grid-cols-4 lg:overflow-visible xl:grid-cols-3 2xl:grid-cols-4">
          {section.items.map((item) => (
            <MusicGridItem
              key={createMusicItemKey(item)}
              item={item}
              source={sourceById.get(item.sourceId)}
              playing={playingKey === createMusicItemKey(item)}
              favoriteBusy={favoriteBusyKey === createMusicItemKey(item)}
              canPlayNext={canEnqueue(item, 'next')}
              canPlayLater={canEnqueue(item, 'later')}
              canAddToPlaylist={canAddToPlaylist(item)}
              onOpen={() => onOpenItem(item)}
              onPlay={() => onPlay(item)}
              onPlayNext={() => onEnqueue(item, 'next')}
              onPlayLater={() => onEnqueue(item, 'later')}
              onAddToPlaylist={() => onAddToPlaylist(item)}
              onToggleFavorite={() => onToggleFavorite(item)}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-1">
          {section.items.map((item) => (
            <MusicListItem
              key={createMusicItemKey(item)}
              item={item}
              source={sourceById.get(item.sourceId)}
              playing={playingKey === createMusicItemKey(item)}
              favoriteBusy={favoriteBusyKey === createMusicItemKey(item)}
              canPlayNext={canEnqueue(item, 'next')}
              canPlayLater={canEnqueue(item, 'later')}
              canAddToPlaylist={canAddToPlaylist(item)}
              onOpen={() => onOpenItem(item)}
              onPlay={() => onPlay(item)}
              onPlayNext={() => onEnqueue(item, 'next')}
              onPlayLater={() => onEnqueue(item, 'later')}
              onAddToPlaylist={() => onAddToPlaylist(item)}
              onToggleFavorite={() => onToggleFavorite(item)}
            />
          ))}
        </div>
      )}
      {section.continuation && source?.browseNextPage ? (
        <div className="mt-4 flex justify-center">
          <Button
            size="small"
            variant="secondary"
            loading={pageBusyKey === `${scope}:${section.sourceId}:${section.id}`}
            disabled={pageBusyKey !== null}
            aria-label={`${t('musicHub.loadMore')} ${getSectionTitle(section, t)}`}
            onClick={() => onLoadMore(section, scope)}
          >
            {t('musicHub.loadMore')}
          </Button>
        </div>
      ) : null}
    </SurfacePanel>
  );
}

export function MusicLibraryBrowser({
  sources,
  librarySections,
  searchSections,
  submittedQuery,
  loading,
  error,
  sourceFilter,
  selectedItem,
  detailSections,
  detailLoading,
  detailError,
  playingKey,
  favoriteBusyKey,
  pageBusyKey,
  canEnqueue,
  canAddToPlaylist,
  onFilterChange,
  onOpenItem,
  onCloseItem,
  onPlay,
  onEnqueue,
  onAddToPlaylist,
  onToggleFavorite,
  onLoadMore,
  onRetry,
}: MusicLibraryBrowserProps) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const surface = getThemeSurfaceTokens(theme);
  const sourceById = useMemo(
    () => new Map(sources.map((source) => [source.id, source] as const)),
    [sources]
  );
  const sections = useMemo<MusicBrowseSection[]>(() => {
    if (selectedItem) return detailSections;
    const available = submittedQuery
      ? searchSections.map((section) => ({
          id: `search:${section.sourceId}`,
          sourceId: section.sourceId,
          title: section.title,
          kind: 'tracks' as const,
          layout: 'list' as const,
          items: section.items,
        }))
      : librarySections;
    return sourceFilter === 'all'
      ? available
      : available.filter((section) => section.sourceId === sourceFilter);
  }, [detailSections, librarySections, searchSections, selectedItem, sourceFilter, submittedQuery]);

  return (
    <section className="min-w-0 space-y-4 md:space-y-5" aria-busy={loading || detailLoading}>
      {selectedItem ? (
        <SurfacePanel>
          <Button variant="ghost" size="small" onClick={onCloseItem}>
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            {t('musicHub.backToLibrary')}
          </Button>
          <div className="mt-4 flex min-w-0 items-end gap-4 sm:items-center">
            <MusicArtwork
              item={selectedItem}
              className="h-28 w-28 shrink-0 rounded-[1.6rem] sm:h-36 sm:w-36"
            />
            <div className="min-w-0 flex-1 pb-1">
              <p
                className={`text-xs font-semibold uppercase tracking-[0.16em] ${surface.textMuted}`}
              >
                {sourceById.get(selectedItem.sourceId)?.name} · {selectedItem.type}
              </p>
              <h1
                className={`mt-1 text-2xl font-semibold tracking-tight sm:text-3xl ${surface.textPrimary}`}
              >
                {selectedItem.title}
              </h1>
              <p className={`mt-1 truncate text-sm ${surface.textSecondary}`}>
                {selectedItem.artists.join(', ')}
              </p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {selectedItem.playable ? (
                  <Button
                    size="small"
                    disabled={playingKey === createMusicItemKey(selectedItem)}
                    loading={playingKey === createMusicItemKey(selectedItem)}
                    onClick={() => onPlay(selectedItem)}
                  >
                    <Play className="h-4 w-4 fill-current" />
                    {t('musicHub.play')}
                  </Button>
                ) : null}
                <ItemFavoriteButton
                  item={selectedItem}
                  source={sourceById.get(selectedItem.sourceId)}
                  busy={favoriteBusyKey === createMusicItemKey(selectedItem)}
                  onToggle={() => onToggleFavorite(selectedItem)}
                />
                <MusicItemActionsMenu
                  item={selectedItem}
                  canPlayNext={canEnqueue(selectedItem, 'next')}
                  canPlayLater={canEnqueue(selectedItem, 'later')}
                  canAddToPlaylist={canAddToPlaylist(selectedItem)}
                  queueBusy={playingKey === createMusicItemKey(selectedItem)}
                  onPlayNext={() => onEnqueue(selectedItem, 'next')}
                  onPlayLater={() => onEnqueue(selectedItem, 'later')}
                  onAddToPlaylist={() => onAddToPlaylist(selectedItem)}
                />
              </div>
            </div>
          </div>
        </SurfacePanel>
      ) : sources.length > 1 ? (
        <fieldset className="flex min-w-0 snap-x gap-2 overflow-x-auto border-0 px-1 pb-1">
          <legend className="sr-only">{t('musicHub.allServices')}</legend>
          <Button
            size="small"
            variant={sourceFilter === 'all' ? 'secondary' : 'ghost'}
            aria-pressed={sourceFilter === 'all'}
            onClick={() => onFilterChange('all')}
          >
            {t('musicHub.allServices')}
          </Button>
          {sources.map((source) => (
            <Button
              key={source.id}
              size="small"
              variant={sourceFilter === source.id ? 'secondary' : 'ghost'}
              aria-pressed={sourceFilter === source.id}
              onClick={() => onFilterChange(source.id)}
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: getMusicSourceAccent(source) }}
                aria-hidden="true"
              />
              {source.name}
            </Button>
          ))}
        </fieldset>
      ) : null}

      {error || detailError ? (
        <SurfacePanel variant="muted">
          <div className="flex items-center justify-between gap-4">
            <p className={`text-sm leading-6 ${surface.textSecondary}`}>{detailError || error}</p>
            <Button
              size="small"
              variant="secondary"
              onClick={detailError ? () => selectedItem && onOpenItem(selectedItem) : onRetry}
            >
              <RotateCw className="h-4 w-4" aria-hidden="true" />
              {t('musicHub.retry')}
            </Button>
          </div>
        </SurfacePanel>
      ) : null}

      {loading || detailLoading ? (
        <SurfacePanel>
          <div
            className={`flex min-h-52 flex-col items-center justify-center gap-3 ${surface.textMuted}`}
          >
            <Loader2
              className="h-6 w-6 animate-spin motion-reduce:animate-none"
              aria-hidden="true"
            />
            <p className="text-sm">
              {submittedQuery ? t('musicHub.searching') : t('musicHub.libraryLoading')}
            </p>
          </div>
        </SurfacePanel>
      ) : sections.length ? (
        sections.map((section) => (
          <MusicShelf
            key={`${section.sourceId}:${section.id}`}
            section={section}
            sourceById={sourceById}
            playingKey={playingKey}
            favoriteBusyKey={favoriteBusyKey}
            pageBusyKey={pageBusyKey}
            canEnqueue={canEnqueue}
            canAddToPlaylist={canAddToPlaylist}
            onOpenItem={onOpenItem}
            onPlay={onPlay}
            onEnqueue={onEnqueue}
            onAddToPlaylist={onAddToPlaylist}
            onToggleFavorite={onToggleFavorite}
            onLoadMore={onLoadMore}
            scope={selectedItem ? 'detail' : 'library'}
          />
        ))
      ) : (
        <SurfacePanel>
          <div
            className={`flex min-h-52 flex-col items-center justify-center gap-3 text-center ${surface.textMuted}`}
          >
            <Library className="h-7 w-7" aria-hidden="true" />
            <p className="max-w-md text-sm">
              {submittedQuery ? t('musicHub.noResults') : t('musicHub.emptySearch')}
            </p>
          </div>
        </SurfacePanel>
      )}
    </section>
  );
}
