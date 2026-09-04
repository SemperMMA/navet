import { Badge, Slider, SurfacePanel, Switch, Tag } from '@navet/app/components/primitives';
import { InteractivePill } from '@navet/app/components/primitives/interactive-pill';
import { getThemeSurfaceTokens } from '@navet/app/components/shared/theme/theme-surface-tokens';
import { cn } from '@navet/app/components/ui/utils';
import { useI18n, useServiceActionHandler, useTheme } from '@navet/app/hooks';
import { useProviderResource } from '@navet/app/hooks/use-provider-resource';
import { homeAssistantService } from '@navet/app/services/home-assistant.service';
import { settingsSelectors } from '@navet/app/stores/selectors';
import { useSettingsStore } from '@navet/app/stores/settings-store';
import type { IntegrationProviderId } from '@navet/app/types/provider';
import {
  AlertTriangle,
  Battery,
  BatteryCharging,
  Bot,
  Clock3,
  Cpu,
  Droplets,
  EyeOff,
  History,
  Layers,
  Map as MapIcon,
  MoonStar,
  Play,
  RotateCcw,
  ScanSearch,
  Sparkles,
  Volume2,
  Wind,
  Wrench,
} from 'lucide-react';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import type { VacuumStatus } from '../components/vacuum/vacuum-utils';
import { VacuumCard } from '../components/vacuum-card/vacuum-card';
import { useVacuumDashboardModel } from './use-vacuum-dashboard-model';
import {
  formatVacuumArea,
  formatVacuumDuration,
  humanizeToken,
  type VacuumDashboardMap,
  type VacuumDashboardModel,
  type VacuumTone,
} from './vacuum-dashboard-model';

export interface VacuumDevicePanelDevice {
  id: string;
  name: string;
  room?: string;
  providerId?: IntegrationProviderId;
  rawStatus?: string;
  status: VacuumStatus;
  battery?: number;
  cleanedArea?: string;
  cleaningTime?: string;
}

interface VacuumDevicePanelProps {
  device: VacuumDevicePanelDevice;
  isEditMode: boolean;
  onHide?: (deviceId: string) => void;
}

const noop = () => {};

function toneTextClassName(tone: VacuumTone | undefined, theme: string): string {
  switch (tone) {
    case 'ok':
      return theme === 'light' ? 'text-emerald-600' : 'text-emerald-300';
    case 'warn':
      return theme === 'light' ? 'text-amber-600' : 'text-amber-300';
    case 'bad':
      return theme === 'light' ? 'text-rose-600' : 'text-rose-300';
    case 'active':
      return theme === 'light' ? 'text-sky-600' : 'text-sky-300';
    default:
      return '';
  }
}

function toneDotClassName(tone: VacuumTone | undefined): string {
  switch (tone) {
    case 'ok':
      return 'bg-emerald-400';
    case 'warn':
      return 'bg-amber-400';
    case 'bad':
      return 'bg-rose-500';
    case 'active':
      return 'bg-sky-400';
    default:
      return 'bg-zinc-500';
  }
}

function statusTagTone(
  status: VacuumDashboardModel['status'],
  hasProblem: boolean
): 'neutral' | 'accent' | 'success' | 'warning' | 'danger' {
  if (hasProblem || status === 'error') return 'danger';
  if (status === 'unavailable') return 'warning';
  if (status === 'cleaning' || status === 'mopping' || status === 'returning') return 'accent';
  if (status === 'charging-complete') return 'success';
  return 'neutral';
}

function formatTimestamp(iso: string | undefined, use24HourTime: boolean): string | undefined {
  if (!iso) return undefined;
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: !use24HourTime,
  }).format(date);
}

function formatClock(value: string | undefined, use24HourTime: boolean): string | undefined {
  if (!value) return undefined;
  const match = value.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return value;
  const date = new Date();
  date.setHours(Number(match[1]), Number(match[2]), 0, 0);
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: !use24HourTime,
  }).format(date);
}

function PanelTitle({
  icon: Icon,
  children,
  trailing,
  className,
}: {
  icon: typeof Bot;
  children: React.ReactNode;
  trailing?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-3 flex items-center justify-between gap-2', className)}>
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
        <Icon className="h-3.5 w-3.5 opacity-80" aria-hidden="true" />
        {children}
      </h3>
      {trailing}
    </div>
  );
}

function MetricTile({
  label,
  value,
  sub,
  tone,
  theme,
  surface,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: VacuumTone;
  theme: string;
  surface: ReturnType<typeof getThemeSurfaceTokens>;
}) {
  return (
    <div className={cn('rounded-2xl border px-3 py-2.5', surface.border, surface.panelMuted)}>
      <div className={cn('text-[11px] font-medium uppercase tracking-wide', surface.textMuted)}>
        {label}
      </div>
      <div
        className={cn(
          'mt-0.5 truncate text-lg font-semibold leading-tight',
          surface.textPrimary,
          toneTextClassName(tone, theme)
        )}
        title={value}
      >
        {value}
      </div>
      {sub ? <div className={cn('mt-0.5 truncate text-xs', surface.textSubtle)}>{sub}</div> : null}
    </div>
  );
}

function ProgressBar({
  percent,
  tone,
  accentColor,
  className,
}: {
  percent: number;
  tone?: VacuumTone;
  accentColor: string;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, percent));
  const barStyle =
    tone === 'warn'
      ? { backgroundColor: '#f59e0b' }
      : tone === 'bad'
        ? { backgroundColor: '#f43f5e' }
        : { backgroundColor: accentColor };
  return (
    <div className={cn('h-1.5 w-full overflow-hidden rounded-full bg-zinc-500/25', className)}>
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{ width: `${clamped}%`, ...barStyle }}
      />
    </div>
  );
}

function VacuumMapHero({
  model,
  providerId,
  surface,
  accentColor,
  onSelectMap,
}: {
  model: VacuumDashboardModel;
  providerId: IntegrationProviderId;
  surface: ReturnType<typeof getThemeSurfaceTokens>;
  accentColor: string;
  onSelectMap: (option: string) => void;
}) {
  const { t } = useI18n();
  const availableMaps = model.maps.filter((map) => !map.isUnavailable);
  const preferredMap = useMemo<VacuumDashboardMap | undefined>(() => {
    const selectedName = model.mapSelect?.value?.toLowerCase();
    if (selectedName) {
      const match = availableMaps.find((map) => map.label.toLowerCase() === selectedName);
      if (match) return match;
    }
    return availableMaps[0];
  }, [availableMaps, model.mapSelect?.value]);
  const [activeMapId, setActiveMapId] = useState<string | undefined>(preferredMap?.entityId);
  useEffect(() => {
    if (!availableMaps.some((map) => map.entityId === activeMapId)) {
      setActiveMapId(preferredMap?.entityId);
    }
  }, [activeMapId, availableMaps, preferredMap?.entityId]);
  const activeMap = availableMaps.find((map) => map.entityId === activeMapId) ?? preferredMap;
  const resource = useProviderResource({
    deviceId: activeMap ? `home_assistant:${activeMap.entityId}` : '',
    kind: 'primary_image',
    attrs: activeMap ? { entity_picture: activeMap.url } : undefined,
    fallbackPicture: activeMap?.url,
    providerId,
    requestKey: activeMap ? `${activeMap.url}::${activeMap.updatedAt ?? ''}` : undefined,
  });
  const imageUrl = resource?.kind === 'image' ? (resource.url ?? undefined) : undefined;
  const isActive =
    model.status === 'cleaning' || model.status === 'mopping' || model.status === 'returning';

  return (
    <SurfacePanel padding="none" className="relative h-full min-h-[18rem] overflow-hidden">
      <div className="relative flex h-full flex-col">
        <div className="flex items-center justify-between gap-2 px-4 pt-3">
          <PanelTitle icon={MapIcon} className="mb-0">
            {t('vacuumDashboard.map')}
          </PanelTitle>
          {availableMaps.length > 1 ? (
            <div className="flex flex-wrap justify-end gap-1.5">
              {availableMaps.map((map) => (
                <InteractivePill
                  key={map.entityId}
                  size="compact"
                  active={map.entityId === activeMap?.entityId}
                  accentColor={accentColor}
                  onClick={() => {
                    setActiveMapId(map.entityId);
                    if (
                      model.mapSelect?.options.some(
                        (option) => option.toLowerCase() === map.label.toLowerCase()
                      )
                    ) {
                      onSelectMap(map.label);
                    }
                  }}
                >
                  {map.label}
                </InteractivePill>
              ))}
            </div>
          ) : null}
        </div>
        <div className="relative m-3 mt-2 flex min-h-[14rem] flex-1 items-center justify-center overflow-hidden rounded-2xl bg-black/20">
          {imageUrl ? (
            <img
              src={imageUrl}
              alt={activeMap?.label ?? t('vacuumDashboard.map')}
              className={cn(
                'max-h-[26rem] w-full object-contain transition-opacity duration-500',
                model.status === 'unavailable' && 'opacity-50 grayscale'
              )}
              draggable={false}
            />
          ) : (
            <div className={cn('flex flex-col items-center gap-2 p-6 text-sm', surface.textMuted)}>
              <MapIcon className="h-6 w-6 opacity-60" aria-hidden="true" />
              {t('vacuumDashboard.noMap')}
            </div>
          )}
          <div className="pointer-events-none absolute inset-x-3 bottom-3 flex flex-wrap items-end justify-between gap-2">
            <div className="flex flex-wrap gap-1.5">
              <Tag tone={statusTagTone(model.status, model.hasProblem)} size="small">
                {model.statusText}
              </Tag>
              {model.currentRoom ? (
                <Tag tone="neutral" size="small">
                  {model.currentRoom}
                </Tag>
              ) : null}
              {typeof model.battery === 'number' ? (
                <Tag tone={model.battery <= 15 ? 'warning' : 'neutral'} size="small">
                  {model.isCharging ? (
                    <BatteryCharging className="mr-1 inline h-3 w-3" aria-hidden="true" />
                  ) : (
                    <Battery className="mr-1 inline h-3 w-3" aria-hidden="true" />
                  )}
                  {model.battery}%
                </Tag>
              ) : null}
            </div>
            {isActive && typeof model.cleaningProgress === 'number' ? (
              <div className="w-40 rounded-full bg-black/40 px-2 py-1 backdrop-blur">
                <div className="mb-1 flex justify-between text-[10px] text-white/80">
                  <span>{t('vacuumDashboard.progress')}</span>
                  <span>{Math.round(model.cleaningProgress)}%</span>
                </div>
                <ProgressBar percent={model.cleaningProgress} accentColor={accentColor} />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </SurfacePanel>
  );
}

export const VacuumDevicePanel = memo(function VacuumDevicePanel({
  device,
  isEditMode,
  onHide,
}: VacuumDevicePanelProps) {
  const { t } = useI18n();
  const { theme, accentColor } = useTheme();
  const surface = getThemeSurfaceTokens(theme);
  const use24HourTime = useSettingsStore(settingsSelectors.use24HourTime);
  const runAction = useServiceActionHandler();
  const { model, nativeEntityId, providerId, isHomeAssistant } = useVacuumDashboardModel({
    deviceId: device.id,
    fallbackName: device.name,
    providerId: device.providerId,
  });
  const [pendingNumbers, setPendingNumbers] = useState<Record<string, number>>({});

  const callService = useCallback(
    (domain: string, service: string, data: Record<string, unknown>, entityId: string) => {
      void runAction(async () => {
        await homeAssistantService.callService(domain, service, data, { entity_id: entityId });
      }, t('vacuumDashboard.feedback.actionFailed'));
    },
    [runAction, t]
  );
  const handleToggle = useCallback(
    (entityId: string, isOn: boolean) => {
      callService('switch', isOn ? 'turn_off' : 'turn_on', {}, entityId);
    },
    [callService]
  );
  const handleSelect = useCallback(
    (entityId: string, option: string) => {
      callService('select', 'select_option', { option }, entityId);
    },
    [callService]
  );
  const handlePress = useCallback(
    (entityId: string) => {
      callService('button', 'press', {}, entityId);
    },
    [callService]
  );
  const handleNumberCommit = useCallback(
    (entityId: string, value: number) => {
      setPendingNumbers((current) => {
        const next = { ...current };
        delete next[entityId];
        return next;
      });
      callService('number', 'set_value', { value }, entityId);
    },
    [callService]
  );

  const vacuumCard = (
    <VacuumCard
      id={device.id}
      name={device.name}
      providerId={device.providerId}
      room={device.room}
      rawStatus={device.rawStatus}
      status={device.status}
      battery={device.battery}
      cleanedArea={device.cleanedArea}
      cleaningTime={device.cleaningTime}
      size="medium"
      onSizeChange={noop}
      isEditMode={false}
    />
  );

  const hideButton =
    isEditMode && onHide ? (
      <InteractivePill size="small" icon={EyeOff} onClick={() => onHide(device.id)}>
        {t('vacuumDashboard.hide')}
      </InteractivePill>
    ) : null;

  if (!isHomeAssistant || !model) {
    return (
      <section
        data-vacuum-panel={nativeEntityId}
        className="scroll-mt-24 space-y-3"
        aria-label={device.name}
      >
        <div className="flex items-center justify-between gap-2 px-1">
          <h2 className={cn('text-base font-semibold', surface.textPrimary)}>{device.name}</h2>
          {hideButton}
        </div>
        <div className="max-w-xl">{vacuumCard}</div>
      </section>
    );
  }

  const lastCleanBegin = formatTimestamp(model.session.beginIso, use24HourTime);
  const lastCleanEnd = formatTimestamp(model.session.endIso, use24HourTime);
  const sessionDuration =
    formatVacuumDuration(model.session.durationSeconds) ??
    (model.session.beginIso && model.session.endIso
      ? formatVacuumDuration(
          (new Date(model.session.endIso).getTime() - new Date(model.session.beginIso).getTime()) /
            1000
        )
      : undefined);
  const routines = model.actions.filter((action) => action.kind === 'routine');
  const maintenance = model.actions.filter((action) => action.kind === 'maintenance');
  const dockToggles = model.toggles.filter((toggle) => toggle.group === 'dock');
  const robotToggles = model.toggles.filter((toggle) => toggle.group === 'robot');
  const cleanSelects = model.selects.filter((select) => select.group !== 'other');
  const otherSelects = model.selects.filter((select) => select.group === 'other');
  const hasDock = dockToggles.length > 0 || model.flags.length > 0 || model.dockError !== undefined;
  const hasSettings =
    robotToggles.length > 0 ||
    model.numbers.length > 0 ||
    model.dnd.switchEntityId !== undefined ||
    model.firmware !== undefined ||
    model.extras.length > 0 ||
    otherSelects.length > 0;

  return (
    <section
      data-vacuum-panel={nativeEntityId}
      className="scroll-mt-24 space-y-3"
      aria-label={model.name}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 px-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2
            className={cn('flex items-center gap-2 text-base font-semibold', surface.textPrimary)}
          >
            <Bot className="h-4 w-4 opacity-80" aria-hidden="true" />
            {model.name}
          </h2>
          <Badge tone="neutral" size="small">
            {model.platformLabel}
            {model.model ? ` · ${model.model}` : ''}
          </Badge>
          <Badge tone={statusTagTone(model.status, model.hasProblem)} size="small">
            {model.statusText}
          </Badge>
          {model.hasProblem ? (
            <Badge tone="danger" size="small">
              <AlertTriangle className="mr-1 inline h-3 w-3" aria-hidden="true" />
              {model.error ?? model.dockError}
            </Badge>
          ) : null}
          {model.firmware?.updateAvailable ? (
            <Badge tone="warning" size="small">
              {t('vacuumDashboard.updateAvailable')}
            </Badge>
          ) : null}
        </div>
        {hideButton}
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <div className="lg:col-span-7">
          <VacuumMapHero
            model={model}
            providerId={providerId}
            surface={surface}
            accentColor={accentColor}
            onSelectMap={(option) => {
              if (model.mapSelect) handleSelect(model.mapSelect.entityId, option);
            }}
          />
        </div>

        <div className="flex flex-col gap-4 lg:col-span-5">
          <div className="min-h-[13rem]">{vacuumCard}</div>
          {routines.length > 0 || maintenance.length > 0 ? (
            <SurfacePanel padding="sm">
              <PanelTitle icon={Play}>{t('vacuumDashboard.routines')}</PanelTitle>
              <div className="flex flex-wrap gap-2">
                {routines.map((action) => (
                  <InteractivePill
                    key={action.entityId}
                    size="small"
                    icon={Sparkles}
                    accentColor={accentColor}
                    disabled={model.status === 'unavailable'}
                    onClick={() => handlePress(action.entityId)}
                  >
                    {action.label}
                  </InteractivePill>
                ))}
                {maintenance.map((action) => (
                  <InteractivePill
                    key={action.entityId}
                    size="small"
                    icon={Wrench}
                    disabled={model.status === 'unavailable'}
                    onClick={() => handlePress(action.entityId)}
                  >
                    {action.label}
                  </InteractivePill>
                ))}
              </div>
            </SurfacePanel>
          ) : null}
        </div>

        <SurfacePanel padding="sm" className="lg:col-span-4">
          <PanelTitle icon={History}>{t('vacuumDashboard.lastClean')}</PanelTitle>
          <div className="grid grid-cols-2 gap-2">
            <MetricTile
              label={t('vacuumDashboard.duration')}
              value={sessionDuration ?? '—'}
              sub={lastCleanBegin}
              theme={theme}
              surface={surface}
            />
            <MetricTile
              label={t('vacuumDashboard.area')}
              value={formatVacuumArea(model.session.areaSqm) ?? '—'}
              sub={lastCleanEnd}
              theme={theme}
              surface={surface}
            />
          </div>
          <PanelTitle icon={Layers} className="mt-4">
            {t('vacuumDashboard.lifetime')}
          </PanelTitle>
          <div className="grid grid-cols-3 gap-2">
            <MetricTile
              label={t('vacuumDashboard.runs')}
              value={model.totals.count !== undefined ? model.totals.count.toLocaleString() : '—'}
              theme={theme}
              surface={surface}
            />
            <MetricTile
              label={t('vacuumDashboard.duration')}
              value={formatVacuumDuration(model.totals.timeSeconds) ?? '—'}
              theme={theme}
              surface={surface}
            />
            <MetricTile
              label={t('vacuumDashboard.area')}
              value={formatVacuumArea(model.totals.areaSqm) ?? '—'}
              theme={theme}
              surface={surface}
            />
          </div>
        </SurfacePanel>

        <SurfacePanel padding="sm" className="lg:col-span-4">
          <PanelTitle icon={Wrench}>{t('vacuumDashboard.consumables')}</PanelTitle>
          {model.consumables.length === 0 ? (
            <div className={cn('text-sm', surface.textMuted)}>—</div>
          ) : (
            <ul className="space-y-3">
              {model.consumables.map((consumable) => {
                const remaining = formatVacuumDuration(consumable.remainingSeconds);
                const tone: VacuumTone = consumable.isWarning ? 'warn' : 'ok';
                return (
                  <li key={consumable.key} className="space-y-1">
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className={cn('truncate', surface.textPrimary)}>
                        {consumable.label}
                      </span>
                      <span
                        className={cn(
                          'shrink-0 text-xs tabular-nums',
                          consumable.isWarning
                            ? toneTextClassName('warn', theme)
                            : surface.textSubtle
                        )}
                      >
                        {consumable.remainingPercent !== undefined
                          ? `${consumable.remainingPercent}%`
                          : ''}
                        {consumable.remainingPercent !== undefined && remaining ? ' · ' : ''}
                        {remaining ? t('vacuumDashboard.remaining', { value: remaining }) : ''}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <ProgressBar
                        percent={consumable.remainingPercent ?? 100}
                        tone={tone}
                        accentColor={accentColor}
                      />
                      {consumable.resetEntityId ? (
                        <button
                          type="button"
                          className={cn(
                            'shrink-0 rounded-full p-1 transition-colors',
                            surface.hoverBg,
                            surface.textMuted
                          )}
                          title={t('vacuumDashboard.reset')}
                          aria-label={`${t('vacuumDashboard.reset')} ${consumable.label}`}
                          onClick={() => handlePress(consumable.resetEntityId as string)}
                        >
                          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      ) : null}
                    </div>
                    {consumable.isWarning ? (
                      <div className={cn('text-[11px]', toneTextClassName('warn', theme))}>
                        {t('vacuumDashboard.replaceSoon')}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </SurfacePanel>

        {hasDock ? (
          <SurfacePanel padding="sm" className="lg:col-span-4">
            <PanelTitle icon={Droplets}>{t('vacuumDashboard.dock')}</PanelTitle>
            {model.dockError ? (
              <div
                className={cn(
                  'mb-2 flex items-center gap-2 text-sm',
                  toneTextClassName('bad', theme)
                )}
              >
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                {t('vacuumDashboard.dockError')}: {model.dockError}
              </div>
            ) : null}
            {model.dryingRemainingSeconds ? (
              <div
                className={cn(
                  'mb-2 flex items-center gap-2 text-sm',
                  toneTextClassName('active', theme)
                )}
              >
                <Wind className="h-4 w-4" aria-hidden="true" />
                {t('vacuumDashboard.drying')} ·{' '}
                {t('vacuumDashboard.remaining', {
                  value: formatVacuumDuration(model.dryingRemainingSeconds) ?? '',
                })}
              </div>
            ) : null}
            {model.flags.length > 0 ? (
              <ul className="mb-3 grid grid-cols-2 gap-x-3 gap-y-1.5">
                {model.flags.map((flag) => (
                  <li key={flag.key} className="flex min-w-0 items-center gap-2 text-xs">
                    <span
                      className={cn('h-2 w-2 shrink-0 rounded-full', toneDotClassName(flag.tone))}
                      aria-hidden="true"
                    />
                    <span className={cn('truncate', surface.textSubtle)} title={flag.label}>
                      {flag.label}
                    </span>
                    <span
                      className={cn(
                        'ml-auto shrink-0 font-medium',
                        toneTextClassName(flag.tone, theme) || surface.textPrimary
                      )}
                    >
                      {flag.valueLabel}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            {dockToggles.length > 0 ? (
              <ul className={cn('divide-y', surface.divider)}>
                {dockToggles.map((toggle) => (
                  <li
                    key={toggle.entityId}
                    className="flex items-center justify-between gap-3 py-2"
                  >
                    <span className={cn('flex items-center gap-2 text-sm', surface.textPrimary)}>
                      {toggle.label}
                      {toggle.isRunning ? (
                        <Tag tone="accent" size="small">
                          {t('vacuum.status.cleaning')}
                        </Tag>
                      ) : null}
                    </span>
                    <Switch
                      size="compact"
                      checked={toggle.isOn}
                      aria-label={toggle.label}
                      disabled={model.status === 'unavailable'}
                      onCheckedChange={() => handleToggle(toggle.entityId, toggle.isOn)}
                    />
                  </li>
                ))}
              </ul>
            ) : null}
          </SurfacePanel>
        ) : null}

        {cleanSelects.length > 0 ? (
          <SurfacePanel
            padding="sm"
            className={cn(hasSettings ? 'lg:col-span-7' : 'lg:col-span-12')}
          >
            <PanelTitle icon={ScanSearch}>{t('vacuumDashboard.modes')}</PanelTitle>
            <div className="space-y-3">
              {cleanSelects.map((select) => (
                <div key={select.entityId}>
                  <div className={cn('mb-1.5 text-xs font-medium', surface.textSubtle)}>
                    {select.label}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {select.options
                      .filter((option) => option !== 'unknown')
                      .map((option) => (
                        <InteractivePill
                          key={option}
                          size="compact"
                          active={option === select.value}
                          accentColor={accentColor}
                          disabled={model.status === 'unavailable'}
                          onClick={() => handleSelect(select.entityId, option)}
                        >
                          {humanizeToken(option)}
                        </InteractivePill>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          </SurfacePanel>
        ) : null}

        {hasSettings ? (
          <SurfacePanel
            padding="sm"
            className={cn(cleanSelects.length > 0 ? 'lg:col-span-5' : 'lg:col-span-12')}
          >
            <PanelTitle icon={Cpu}>{t('vacuumDashboard.settings')}</PanelTitle>
            <ul className={cn('divide-y', surface.divider)}>
              {model.dnd.switchEntityId ? (
                <li className="flex items-center justify-between gap-3 py-2">
                  <span
                    className={cn('flex min-w-0 items-center gap-2 text-sm', surface.textPrimary)}
                  >
                    <MoonStar className="h-4 w-4 shrink-0 opacity-70" aria-hidden="true" />
                    <span className="truncate">{t('vacuumDashboard.doNotDisturb')}</span>
                    {model.dnd.begin && model.dnd.end ? (
                      <span className={cn('shrink-0 text-xs', surface.textMuted)}>
                        {formatClock(model.dnd.begin, use24HourTime)} –{' '}
                        {formatClock(model.dnd.end, use24HourTime)}
                      </span>
                    ) : null}
                  </span>
                  <Switch
                    size="compact"
                    checked={Boolean(model.dnd.isOn)}
                    aria-label={t('vacuumDashboard.doNotDisturb')}
                    onCheckedChange={() =>
                      handleToggle(model.dnd.switchEntityId as string, Boolean(model.dnd.isOn))
                    }
                  />
                </li>
              ) : null}
              {robotToggles.map((toggle) => (
                <li key={toggle.entityId} className="flex items-center justify-between gap-3 py-2">
                  <span className={cn('truncate text-sm', surface.textPrimary)}>
                    {toggle.label}
                  </span>
                  <Switch
                    size="compact"
                    checked={toggle.isOn}
                    aria-label={toggle.label}
                    onCheckedChange={() => handleToggle(toggle.entityId, toggle.isOn)}
                  />
                </li>
              ))}
              {model.numbers.map((control) => {
                const value = pendingNumbers[control.entityId] ?? control.value;
                const isVolume = /volume/i.test(control.label);
                return (
                  <li key={control.entityId} className="py-2">
                    <div className="mb-1.5 flex items-center justify-between gap-2 text-sm">
                      <span className={cn('flex items-center gap-2', surface.textPrimary)}>
                        {isVolume ? (
                          <Volume2 className="h-4 w-4 opacity-70" aria-hidden="true" />
                        ) : null}
                        {control.label}
                      </span>
                      <span className={cn('text-xs tabular-nums', surface.textMuted)}>
                        {Math.round(value)}
                        {control.unit ?? ''}
                      </span>
                    </div>
                    <Slider
                      value={value}
                      min={control.min}
                      max={control.max}
                      step={control.step}
                      ariaLabel={control.label}
                      onValueChange={(next) =>
                        setPendingNumbers((current) => ({ ...current, [control.entityId]: next }))
                      }
                      onValueCommit={(next) => handleNumberCommit(control.entityId, next)}
                    />
                  </li>
                );
              })}
              {otherSelects.map((select) => (
                <li key={select.entityId} className="py-2">
                  <div className={cn('mb-1.5 text-xs font-medium', surface.textSubtle)}>
                    {select.label}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {select.options.map((option) => (
                      <InteractivePill
                        key={option}
                        size="compact"
                        active={option === select.value}
                        accentColor={accentColor}
                        onClick={() => handleSelect(select.entityId, option)}
                      >
                        {humanizeToken(option)}
                      </InteractivePill>
                    ))}
                  </div>
                </li>
              ))}
              {model.firmware ? (
                <li className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className={cn('flex items-center gap-2', surface.textPrimary)}>
                    <Cpu className="h-4 w-4 opacity-70" aria-hidden="true" />
                    {t('vacuumDashboard.firmware')}
                  </span>
                  <span className={cn('text-xs tabular-nums', surface.textMuted)}>
                    {model.firmware.installed ?? '—'}
                    {model.firmware.updateAvailable && model.firmware.latest
                      ? ` → ${model.firmware.latest}`
                      : ''}
                  </span>
                </li>
              ) : null}
              {model.extras.map((extra) => (
                <li
                  key={extra.key}
                  className="flex items-center justify-between gap-3 py-2 text-sm"
                >
                  <span className={cn('truncate', surface.textSubtle)}>{extra.label}</span>
                  <span
                    className={cn(
                      'shrink-0 text-xs font-medium',
                      toneTextClassName(extra.tone, theme) || surface.textPrimary
                    )}
                  >
                    {extra.value}
                  </span>
                </li>
              ))}
            </ul>
          </SurfacePanel>
        ) : null}
      </div>
      <div className={cn('flex items-center gap-3 px-1 text-[11px]', surface.textMuted)}>
        <Clock3 className="h-3 w-3" aria-hidden="true" />
        <span>{nativeEntityId}</span>
      </div>
    </section>
  );
});
