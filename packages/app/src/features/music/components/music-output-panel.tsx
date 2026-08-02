import { Button } from '@navet/app/components/primitives/button';
import { SurfacePanel } from '@navet/app/components/primitives/surface-panel';
import { getThemeSurfaceTokens } from '@navet/app/components/shared/theme/theme-surface-tokens';
import { SpeakerDestinationRow } from '@navet/app/features/media/components/media/speaker-destination-row';
import { useI18n, useTheme } from '@navet/app/hooks';
import { createMusicTargetKey, type MusicItem, type MusicPlaybackTarget } from '@navet/core/music';
import { CircleAlert, ListMusic, Speaker, Unlink, Unplug, Users, Volume2 } from 'lucide-react';
import { MusicArtwork } from './music-presentation';

export interface CollapsedMusicQueueEntry {
  item: MusicItem;
  count: number;
  startIndex: number;
  isCurrent: boolean;
}

interface MusicOutputPanelProps {
  targets: MusicPlaybackTarget[];
  selectedTargetKey: string | null;
  groupCoordinator: MusicPlaybackTarget | null;
  groupingAvailable: boolean;
  groupingOpen: boolean;
  groupBusy: boolean;
  error: string | null;
  queueEntries: CollapsedMusicQueueEntry[];
  hasConnectedServices: boolean;
  onSelectTarget: (targetId: string) => void;
  onToggleGrouping: () => void;
  onToggleGroupTarget: (target: MusicPlaybackTarget) => void;
  onUngroupTarget: (target: MusicPlaybackTarget) => void;
}

export function MusicOutputPanel({
  targets,
  selectedTargetKey,
  groupCoordinator,
  groupingAvailable,
  groupingOpen,
  groupBusy,
  error,
  queueEntries,
  hasConnectedServices,
  onSelectTarget,
  onToggleGrouping,
  onToggleGroupTarget,
  onUngroupTarget,
}: MusicOutputPanelProps) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const surface = getThemeSurfaceTokens(theme);

  return (
    <SurfacePanel>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Speaker className={`h-4 w-4 ${surface.textMuted}`} aria-hidden="true" />
          <h2 className={`text-sm font-semibold ${surface.textPrimary}`}>
            {t('musicHub.outputs')}
          </h2>
        </div>
        {groupingAvailable ? (
          <Button size="small" variant="ghost" onClick={onToggleGrouping}>
            <Users className="h-4 w-4" aria-hidden="true" />
            {groupingOpen ? t('common.cancel') : t('musicHub.groupSpeakers')}
          </Button>
        ) : null}
      </div>

      {error ? (
        <div
          role="alert"
          className={`mb-4 flex items-start gap-2 rounded-xl border p-3 text-xs leading-5 ${surface.border} ${surface.textSecondary}`}
        >
          <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      ) : null}

      {groupingOpen && groupCoordinator ? (
        <div className={`mb-4 border-b pb-4 ${surface.border}`}>
          <p className={`text-xs font-semibold ${surface.textPrimary}`}>
            {t('musicHub.groupWith')} {groupCoordinator.name}
          </p>
          <p className={`mt-1 text-[11px] leading-5 ${surface.textMuted}`}>
            {t('musicHub.groupDescription')}
          </p>
          <div className="mt-3 space-y-2" aria-busy={groupBusy}>
            <SpeakerDestinationRow
              title={groupCoordinator.name}
              subtitle={t('musicHub.groupLeader')}
              active
              disabled
              isGlass={theme === 'glass'}
              icon={<Volume2 className="h-4 w-4" />}
              onClick={() => undefined}
              primaryTextClassName={surface.textPrimary}
              secondaryTextClassName={surface.textSecondary}
            />
            {targets
              .filter(
                (target) =>
                  target.adapterId === groupCoordinator.adapterId &&
                  target.id !== groupCoordinator.id &&
                  target.available &&
                  target.capabilities?.grouping !== false
              )
              .map((target) => {
                const attached = groupCoordinator.groupMemberIds?.includes(target.id) ?? false;
                return (
                  <SpeakerDestinationRow
                    key={target.id}
                    title={target.name}
                    subtitle={attached ? t('musicHub.grouped') : target.room}
                    active={attached}
                    disabled={groupBusy}
                    ariaLabel={`${attached ? t('media.group.detach') : t('media.group.attach')} ${target.name}`}
                    isGlass={theme === 'glass'}
                    icon={<Speaker className="h-4 w-4" />}
                    onClick={() => onToggleGroupTarget(target)}
                    primaryTextClassName={surface.textPrimary}
                    secondaryTextClassName={surface.textSecondary}
                  />
                );
              })}
          </div>
          {(groupCoordinator.groupMemberIds?.length ?? 0) > 1 ? (
            <Button
              className="mt-3 w-full"
              size="small"
              variant="ghost"
              disabled={groupBusy}
              onClick={() => onUngroupTarget(groupCoordinator)}
            >
              {groupBusy ? t('musicHub.updatingGroup') : t('musicHub.ungroup')}
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-2">
        {targets.length ? (
          targets.map((target) => {
            const selected = createMusicTargetKey(target) === selectedTargetKey;
            const grouped = (target.groupMemberIds?.length ?? 0) > 1;
            const subtitle = [
              grouped
                ? target.groupCoordinatorId === target.id
                  ? t('musicHub.groupLeader')
                  : t('musicHub.grouped')
                : null,
              target.detail ||
                (target.room && target.room !== target.name ? target.room : null) ||
                (target.kind === 'browser'
                  ? t('musicHub.appleBrowserOnly')
                  : t('musicHub.navetSpeaker')),
            ]
              .filter(Boolean)
              .join(' · ');
            return (
              <div key={`${target.adapterId}:${target.id}`} className="flex items-center gap-1">
                <div className="min-w-0 flex-1">
                  <SpeakerDestinationRow
                    title={target.name}
                    subtitle={subtitle}
                    active={selected}
                    disabled={!target.available}
                    ariaLabel={`${t('musicHub.outputs')}: ${target.name}`}
                    isGlass={theme === 'glass'}
                    icon={<Speaker className="h-4 w-4" />}
                    onClick={() => onSelectTarget(createMusicTargetKey(target))}
                    primaryTextClassName={surface.textPrimary}
                    secondaryTextClassName={surface.textSecondary}
                  />
                </div>
                {grouped ? (
                  <Button
                    iconOnly
                    label={`${t('musicHub.ungroup')} ${target.name}`}
                    variant="ghost"
                    size="small"
                    className="min-h-11 min-w-11 shrink-0"
                    disabled={groupBusy}
                    onClick={() => onUngroupTarget(target)}
                  >
                    <Unlink className="h-4 w-4" />
                  </Button>
                ) : null}
              </div>
            );
          })
        ) : (
          <div
            className={`flex items-center gap-3 rounded-2xl border p-3 ${surface.border} ${surface.textMuted}`}
          >
            <Unplug className="h-4 w-4" />
            <p className="text-xs">
              {hasConnectedServices
                ? t('musicHub.outputRequired')
                : t('musicHub.noServicesConnected')}
            </p>
          </div>
        )}
      </div>

      <div className={`my-5 border-t ${surface.border}`} />
      <div className="mb-4 flex items-center gap-2">
        <ListMusic className={`h-4 w-4 ${surface.textMuted}`} aria-hidden="true" />
        <h2 className={`text-sm font-semibold ${surface.textPrimary}`}>{t('musicHub.queue')}</h2>
      </div>
      {queueEntries.length ? (
        <ol className="max-h-[360px] touch-pan-y space-y-2 overflow-y-auto overscroll-contain pr-1">
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
                    <span className={`shrink-0 tabular-nums ${surface.textMuted}`}>×{count}</span>
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
    </SurfacePanel>
  );
}
