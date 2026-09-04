import type {
  PlatformEntityRegistryEntry,
  PlatformEntitySnapshot,
  PlatformEntitySnapshotMap,
} from '@navet/core/provider-feature-models';
import { normalizeVacuumStatus, type VacuumStatus } from '../components/vacuum/vacuum-utils';

/**
 * Rich, integration-aware telemetry model for one robot vacuum and every
 * sibling entity Home Assistant exposes for it (robot + dock).
 *
 * Built to be a pure function so it can be unit-tested against registry /
 * snapshot fixtures. It understands the Roborock core integration and the
 * Tasshack dreame_vacuum custom integration, and degrades to a generic
 * keyword classifier for anything else.
 */

export type VacuumTone = 'neutral' | 'ok' | 'warn' | 'bad' | 'active';

export interface VacuumDashboardConsumable {
  key: string;
  label: string;
  entityId: string;
  remainingSeconds?: number;
  remainingPercent?: number;
  isWarning: boolean;
  resetEntityId?: string;
}

export interface VacuumDashboardFlag {
  key: string;
  label: string;
  entityId: string;
  isOn: boolean;
  deviceClass?: string;
  tone: VacuumTone;
  /** Human readable state, e.g. "Attached" / "Full" / "OK". */
  valueLabel: string;
}

export interface VacuumDashboardToggle {
  entityId: string;
  label: string;
  isOn: boolean;
  isRunning: boolean;
  group: 'dock' | 'robot';
}

export interface VacuumDashboardSelect {
  entityId: string;
  label: string;
  value: string;
  options: string[];
  group: 'clean' | 'dock' | 'other';
}

export interface VacuumDashboardNumber {
  entityId: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
}

export interface VacuumDashboardAction {
  entityId: string;
  label: string;
  kind: 'routine' | 'maintenance';
}

export interface VacuumDashboardMap {
  entityId: string;
  label: string;
  url: string;
  updatedAt?: string;
  isUnavailable: boolean;
}

export interface VacuumDashboardMetric {
  key: string;
  label: string;
  value: string;
  tone?: VacuumTone;
}

export interface VacuumDashboardDnd {
  switchEntityId?: string;
  isOn?: boolean;
  beginEntityId?: string;
  endEntityId?: string;
  begin?: string;
  end?: string;
}

export interface VacuumDashboardModel {
  vacuumEntityId: string;
  name: string;
  platform: 'roborock' | 'dreame_vacuum' | 'generic';
  platformLabel: string;
  model?: string;
  manufacturer?: string;
  deviceIds: string[];
  rawStatus?: string;
  status: VacuumStatus | 'unavailable';
  statusText: string;
  battery?: number;
  isCharging?: boolean;
  cleaningProgress?: number;
  currentRoom?: string;
  error?: string;
  dockError?: string;
  hasProblem: boolean;
  session: {
    beginIso?: string;
    endIso?: string;
    durationSeconds?: number;
    areaSqm?: number;
  };
  totals: {
    count?: number;
    timeSeconds?: number;
    areaSqm?: number;
  };
  consumables: VacuumDashboardConsumable[];
  flags: VacuumDashboardFlag[];
  toggles: VacuumDashboardToggle[];
  selects: VacuumDashboardSelect[];
  numbers: VacuumDashboardNumber[];
  actions: VacuumDashboardAction[];
  maps: VacuumDashboardMap[];
  mapSelect?: VacuumDashboardSelect;
  dnd: VacuumDashboardDnd;
  dryingRemainingSeconds?: number;
  firmware?: {
    entityId: string;
    installed?: string;
    latest?: string;
    updateAvailable: boolean;
  };
  extras: VacuumDashboardMetric[];
}

interface BuildVacuumDashboardModelOptions {
  vacuumEntityId: string;
  entities: PlatformEntitySnapshotMap | null | undefined;
  entityRegistry: PlatformEntityRegistryEntry[] | null | undefined;
  fallbackName?: string;
}

/** Typical rated lifetime (hours) used to derive a percentage when the integration only reports time left. */
const CONSUMABLE_LIFETIME_HOURS: Array<{ match: RegExp; hours: number }> = [
  { match: /main\s*brush|roller/, hours: 300 },
  { match: /side\s*brush/, hours: 200 },
  { match: /tank\s*filter|strainer/, hours: 300 },
  { match: /filter/, hours: 150 },
  { match: /sensor/, hours: 30 },
  { match: /maintenance\s*brush|cleaning\s*brush/, hours: 300 },
  { match: /mop\s*pad|mop/, hours: 180 },
  { match: /detergent|cleaning\s*fluid/, hours: 100 },
  { match: /dust\s*bag/, hours: 500 },
];

const CONSUMABLE_WARNING_HOURS = 12;
const CONSUMABLE_WARNING_PERCENT = 10;

function parseNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) return undefined;
    const parsed = Number.parseFloat(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function isKnownState(state: string | undefined): state is string {
  if (typeof state !== 'string') return false;
  const lower = state.trim().toLowerCase();
  return lower.length > 0 && lower !== 'unknown' && lower !== 'unavailable' && lower !== 'none';
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function readStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0)
    : [];
}

export function humanizeToken(value: string): string {
  const normalized = value.trim().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  if (normalized.length === 0) return value;
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function durationToSeconds(value: number, unit: string | undefined): number {
  switch ((unit ?? 's').toLowerCase()) {
    case 'h':
    case 'hr':
    case 'hrs':
    case 'hours':
      return value * 3600;
    case 'min':
    case 'm':
    case 'minutes':
      return value * 60;
    case 'd':
    case 'days':
      return value * 86400;
    default:
      return value;
  }
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Strip the device name (and the vacuum name) from a friendly_name so
 * "Wilma Dock Mop drying" becomes "Mop drying".
 */
function stripDevicePrefix(label: string, prefixes: string[]): string {
  let result = label.trim();
  for (const prefix of prefixes.sort((a, b) => b.length - a.length)) {
    if (prefix.length > 0 && result.toLowerCase().startsWith(prefix.toLowerCase())) {
      const stripped = result.slice(prefix.length).trim();
      if (stripped.length > 0) {
        result = stripped;
        break;
      }
    }
  }
  return result;
}

function detectPlatform(value: string | null | undefined): VacuumDashboardModel['platform'] {
  const normalized = (value ?? '').toLowerCase();
  if (normalized.includes('roborock')) return 'roborock';
  if (normalized.includes('dreame')) return 'dreame_vacuum';
  return 'generic';
}

function platformLabelFor(
  platform: VacuumDashboardModel['platform'],
  manufacturer?: string
): string {
  if (platform === 'roborock') return 'Roborock';
  if (platform === 'dreame_vacuum') return 'Dreame';
  return manufacturer ?? 'Vacuum';
}

interface ClassifiedEntity {
  entityId: string;
  domain: string;
  objectId: string;
  label: string;
  searchable: string;
  snapshot: PlatformEntitySnapshot;
  registry?: PlatformEntityRegistryEntry;
  isDockDevice: boolean;
}

function deriveDeviceName(
  snapshot: PlatformEntitySnapshot | undefined,
  registryEntry: PlatformEntityRegistryEntry | undefined
): string | undefined {
  const friendly = readString(snapshot?.attributes?.friendly_name);
  if (!friendly) return undefined;
  const explicit = readString(registryEntry?.deviceName);
  if (explicit) return explicit;
  const entityName = readString(registryEntry?.name);
  if (entityName && friendly.toLowerCase().endsWith(entityName.toLowerCase())) {
    const prefix = friendly.slice(0, friendly.length - entityName.length).trim();
    return prefix.length > 0 ? prefix : friendly;
  }
  return friendly;
}

function collectDeviceEntities({
  vacuumEntityId,
  entities,
  entityRegistry,
}: BuildVacuumDashboardModelOptions): {
  vacuumRegistry?: PlatformEntityRegistryEntry;
  deviceIds: string[];
  classified: ClassifiedEntity[];
  namePrefixes: string[];
} {
  const registry = entityRegistry ?? [];
  const snapshots = entities ?? {};
  const vacuumRegistry = registry.find((entry) => entry.entityId === vacuumEntityId);
  const vacuumSnapshot = snapshots[vacuumEntityId];
  const vacuumName =
    readString(vacuumSnapshot?.attributes?.friendly_name) ??
    readString(vacuumRegistry?.deviceName) ??
    readString(vacuumRegistry?.name) ??
    vacuumEntityId.split('.')[1] ??
    vacuumEntityId;
  const primaryDeviceId = vacuumRegistry?.deviceId ?? null;
  const primaryDeviceName =
    deriveDeviceName(vacuumSnapshot, vacuumRegistry) ??
    readString(vacuumRegistry?.deviceName) ??
    vacuumName;
  const platform = vacuumRegistry?.platform ?? null;

  // Sibling devices (e.g. the Roborock "Wilma Dock") share the platform and
  // carry the robot's device name as a prefix of their own device name.
  const siblingDeviceIds = new Set<string>();
  const dockDeviceIds = new Set<string>();
  const deviceNames = new Map<string, string>();
  if (primaryDeviceId) {
    siblingDeviceIds.add(primaryDeviceId);
    deviceNames.set(primaryDeviceId, primaryDeviceName);
  }
  const primaryLower = primaryDeviceName.toLowerCase();
  for (const entry of registry) {
    if (!entry.deviceId || entry.deviceId === primaryDeviceId) continue;
    if (siblingDeviceIds.has(entry.deviceId)) continue;
    if (platform && entry.platform && entry.platform !== platform) continue;
    const deviceName = deriveDeviceName(snapshots[entry.entityId], entry);
    if (!deviceName) continue;
    const lower = deviceName.toLowerCase();
    if (lower !== primaryLower && lower.startsWith(`${primaryLower} `)) {
      siblingDeviceIds.add(entry.deviceId);
      dockDeviceIds.add(entry.deviceId);
      deviceNames.set(entry.deviceId, deviceName);
    }
  }

  const namePrefixes = Array.from(
    new Set(
      [...deviceNames.values(), vacuumName, primaryDeviceName].filter((value) => value.length > 0)
    )
  );

  const classified: ClassifiedEntity[] = [];
  const seen = new Set<string>();
  const consider = (entityId: string, registryEntry?: PlatformEntityRegistryEntry) => {
    if (seen.has(entityId) || entityId === vacuumEntityId) return;
    const snapshot = snapshots[entityId];
    if (!snapshot) return;
    seen.add(entityId);
    const [domain, objectId = ''] = entityId.split('.', 2);
    const friendly = readString(snapshot.attributes?.friendly_name) ?? humanizeToken(objectId);
    const label = stripDevicePrefix(friendly, [...namePrefixes]);
    classified.push({
      entityId,
      domain,
      objectId,
      label,
      searchable: `${objectId} ${label}`.toLowerCase().replace(/[_-]+/g, ' '),
      snapshot,
      registry: registryEntry,
      isDockDevice: registryEntry?.deviceId ? dockDeviceIds.has(registryEntry.deviceId) : false,
    });
  };

  if (siblingDeviceIds.size > 0) {
    for (const entry of registry) {
      if (entry.deviceId && siblingDeviceIds.has(entry.deviceId)) {
        consider(entry.entityId, entry);
      }
    }
  }

  // Fallback when there is no registry: match by entity id slug.
  if (classified.length === 0) {
    const slug = slugify(vacuumName);
    for (const entityId of Object.keys(snapshots)) {
      const objectId = entityId.split('.')[1] ?? '';
      if (slug.length > 0 && objectId.includes(slug)) {
        consider(entityId);
      }
    }
  }

  return {
    vacuumRegistry,
    deviceIds: Array.from(siblingDeviceIds),
    classified,
    namePrefixes,
  };
}

function includesAny(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

function humanizeBinaryState({
  isOn,
  deviceClass,
  searchable,
}: {
  isOn: boolean;
  deviceClass?: string;
  searchable: string;
}): { valueLabel: string; tone: VacuumTone } {
  if (deviceClass === 'problem') {
    return isOn ? { valueLabel: 'Attention', tone: 'bad' } : { valueLabel: 'OK', tone: 'ok' };
  }
  if (deviceClass === 'connectivity' || includesAny(searchable, ['attached', 'installed'])) {
    return isOn
      ? { valueLabel: 'Attached', tone: 'ok' }
      : { valueLabel: 'Detached', tone: 'neutral' };
  }
  if (deviceClass === 'battery_charging' || searchable.includes('charging')) {
    return isOn
      ? { valueLabel: 'Charging', tone: 'active' }
      : { valueLabel: 'Idle', tone: 'neutral' };
  }
  if (deviceClass === 'running' || includesAny(searchable, ['cleaning', 'drying', 'washing'])) {
    return isOn
      ? { valueLabel: 'Running', tone: 'active' }
      : { valueLabel: 'Idle', tone: 'neutral' };
  }
  return isOn ? { valueLabel: 'On', tone: 'active' } : { valueLabel: 'Off', tone: 'neutral' };
}

export function buildVacuumDashboardModel(
  options: BuildVacuumDashboardModelOptions
): VacuumDashboardModel {
  const { vacuumEntityId, entities, fallbackName } = options;
  const snapshots = entities ?? {};
  const vacuumSnapshot = snapshots[vacuumEntityId];
  const vacuumAttrs = (vacuumSnapshot?.attributes ?? {}) as Record<string, unknown>;
  const { vacuumRegistry, deviceIds, classified } = collectDeviceEntities(options);
  const platform = detectPlatform(vacuumRegistry?.platform);
  const manufacturer = readString(vacuumRegistry?.manufacturer);
  const name =
    readString(vacuumAttrs.friendly_name) ??
    readString(vacuumRegistry?.deviceName) ??
    fallbackName ??
    vacuumEntityId;

  const model: VacuumDashboardModel = {
    vacuumEntityId,
    name,
    platform,
    platformLabel: platformLabelFor(platform, manufacturer),
    model: readString(vacuumRegistry?.model),
    manufacturer,
    deviceIds,
    rawStatus: undefined,
    status: 'idle',
    statusText: '',
    hasProblem: false,
    session: {},
    totals: {},
    consumables: [],
    flags: [],
    toggles: [],
    selects: [],
    numbers: [],
    actions: [],
    maps: [],
    dnd: {},
    extras: [],
  };

  // --- Robot-level status from the vacuum entity itself ---
  const vacuumState = readString(vacuumSnapshot?.state);
  const attrStatus = readString(vacuumAttrs.status);
  if (vacuumState?.toLowerCase() === 'unavailable' || !vacuumSnapshot) {
    model.status = 'unavailable';
  } else {
    model.status = normalizeVacuumStatus(vacuumState, 'idle');
  }
  model.battery =
    parseNumber(vacuumAttrs.battery_level) ??
    parseNumber(vacuumAttrs.battery) ??
    parseNumber(vacuumAttrs.battery_percent);

  const consumableBuckets = new Map<
    string,
    { label: string; entityId: string; seconds?: number; percent?: number; searchable: string }
  >();
  const resetButtons: Array<{ entityId: string; searchable: string }> = [];

  for (const entity of classified) {
    const { domain, label, searchable, snapshot } = entity;
    const attrs = (snapshot.attributes ?? {}) as Record<string, unknown>;
    const state = snapshot.state;
    const unit = readString(attrs.unit_of_measurement);
    const deviceClass = readString(attrs.device_class);
    const known = isKnownState(state);

    switch (domain) {
      case 'sensor': {
        const numeric = parseNumber(state);
        const isDuration = deviceClass === 'duration' || ['s', 'h', 'min'].includes(unit ?? '');
        const isTimeLeft =
          includesAny(searchable, ['time left', 'left', 'remaining']) &&
          !includesAny(searchable, ['drying', 'cleaning progress']);

        if (searchable.includes('drying') && includesAny(searchable, ['remaining', 'left'])) {
          if (numeric !== undefined && numeric > 0) {
            model.dryingRemainingSeconds = durationToSeconds(numeric, unit);
          }
          break;
        }

        if (isTimeLeft && (isDuration || unit === '%')) {
          const baseLabel = label.replace(/\s*(time left|left|remaining)\s*$/i, '').trim() || label;
          const base = baseLabel.toLowerCase().replace(/[_-]+/g, ' ');
          const key = slugify(base);
          const bucket = consumableBuckets.get(key) ?? {
            label: humanizeToken(baseLabel),
            entityId: entity.entityId,
            searchable: base,
          };
          if (unit === '%') {
            bucket.percent = numeric;
          } else if (numeric !== undefined) {
            bucket.seconds = durationToSeconds(numeric, unit);
          }
          consumableBuckets.set(key, bucket);
          break;
        }

        if (
          searchable.includes('battery') &&
          numeric !== undefined &&
          model.battery === undefined
        ) {
          model.battery = numeric;
          break;
        }
        if (searchable.includes('cleaning progress') || searchable === 'progress') {
          if (numeric !== undefined) model.cleaningProgress = numeric;
          break;
        }
        if (searchable.includes('current room')) {
          if (known) model.currentRoom = humanizeToken(state);
          break;
        }
        if (searchable.includes('dock error') || searchable.includes('station error')) {
          if (known && state !== 'ok') {
            model.dockError = humanizeToken(state);
            model.hasProblem = true;
          }
          break;
        }
        if (searchable.includes('error') || searchable.includes('fault')) {
          if (known && state !== 'ok' && state !== 'no_error') {
            model.error = humanizeToken(state);
            model.hasProblem = true;
          }
          break;
        }
        if (
          searchable === 'status' ||
          (searchable.endsWith(' status') &&
            !searchable.includes('tank') &&
            !searchable.includes('bag') &&
            !searchable.includes('detergent') &&
            !searchable.includes('base') &&
            !searchable.includes('empty') &&
            !searchable.includes('drain') &&
            !searchable.includes('task'))
        ) {
          if (known && !model.rawStatus) model.rawStatus = state;
          break;
        }
        if (searchable.includes('last clean begin') || searchable.includes('last clean start')) {
          if (known) model.session.beginIso = state;
          break;
        }
        if (searchable.includes('last clean end') || searchable.includes('last clean finish')) {
          if (known) model.session.endIso = state;
          break;
        }
        if (searchable.includes('total') && searchable.includes('count')) {
          if (numeric !== undefined) model.totals.count = numeric;
          break;
        }
        if (searchable.includes('total') && searchable.includes('time')) {
          if (numeric !== undefined) model.totals.timeSeconds = durationToSeconds(numeric, unit);
          break;
        }
        if (searchable.includes('total') && searchable.includes('area')) {
          if (numeric !== undefined) model.totals.areaSqm = numeric;
          break;
        }
        if (searchable.includes('cleaning count') || searchable.includes('clean count')) {
          if (numeric !== undefined && model.totals.count === undefined)
            model.totals.count = numeric;
          break;
        }
        if (
          (searchable.includes('cleaning time') || searchable.includes('clean time')) &&
          !searchable.includes('total')
        ) {
          if (numeric !== undefined)
            model.session.durationSeconds = durationToSeconds(numeric, unit);
          break;
        }
        if (
          (searchable.includes('cleaning area') || searchable.includes('cleaned area')) &&
          !searchable.includes('total')
        ) {
          if (numeric !== undefined) model.session.areaSqm = numeric;
          break;
        }
        if (searchable.includes('firmware')) {
          if (known) model.extras.push({ key: entity.entityId, label, value: state });
          break;
        }
        if (known) {
          const isStatusLike = deviceClass === 'enum' || numeric === undefined;
          const value = isStatusLike ? humanizeToken(state) : `${numeric}${unit ? ` ${unit}` : ''}`;
          const lower = state.toLowerCase();
          const tone: VacuumTone = includesAny(lower, [
            'full',
            'empty',
            'error',
            'low',
            'missing',
            'blocked',
          ])
            ? 'warn'
            : includesAny(lower, ['ok', 'normal', 'installed', 'idle'])
              ? 'ok'
              : 'neutral';
          model.extras.push({ key: entity.entityId, label, value, tone });
        }
        break;
      }
      case 'binary_sensor': {
        if (!known) break;
        const isOn = state === 'on';
        if (deviceClass === 'battery_charging' || searchable.includes('charging')) {
          model.isCharging = isOn;
        }
        if (deviceClass === 'running' && searchable.includes('cleaning')) {
          // Redundant with the vacuum state; skip as a flag.
          break;
        }
        const { valueLabel, tone } = humanizeBinaryState({ isOn, deviceClass, searchable });
        if (deviceClass === 'problem' && isOn) model.hasProblem = true;
        model.flags.push({
          key: entity.entityId,
          label,
          entityId: entity.entityId,
          isOn,
          deviceClass,
          tone,
          valueLabel,
        });
        break;
      }
      case 'switch': {
        if (!known) break;
        const isOn = state === 'on';
        if (
          searchable.includes('do not disturb') ||
          searchable === 'dnd' ||
          searchable.includes('dnd')
        ) {
          model.dnd.switchEntityId = entity.entityId;
          model.dnd.isOn = isOn;
          break;
        }
        const isDockAction = includesAny(searchable, [
          'dust emptying',
          'mop washing',
          'mop drying',
          'drying',
          'washing',
          'emptying',
          'self clean',
        ]);
        model.toggles.push({
          entityId: entity.entityId,
          label,
          isOn,
          isRunning: isDockAction && isOn,
          group:
            entity.isDockDevice || isDockAction || searchable.includes('child lock')
              ? 'dock'
              : 'robot',
        });
        break;
      }
      case 'select': {
        const options = readStringList(attrs.options);
        const select: VacuumDashboardSelect = {
          entityId: entity.entityId,
          label,
          value: known ? state : '',
          options,
          group: includesAny(searchable, ['map'])
            ? 'other'
            : entity.isDockDevice || includesAny(searchable, ['empty', 'wash', 'dry'])
              ? 'dock'
              : 'clean',
        };
        if (searchable.includes('selected map') || searchable === 'map') {
          model.mapSelect = select;
          break;
        }
        model.selects.push(select);
        break;
      }
      case 'number': {
        const value = parseNumber(state);
        if (value === undefined) break;
        model.numbers.push({
          entityId: entity.entityId,
          label,
          value,
          min: parseNumber(attrs.min) ?? 0,
          max: parseNumber(attrs.max) ?? 100,
          step: parseNumber(attrs.step) ?? 1,
          unit,
        });
        break;
      }
      case 'time': {
        if (!known) break;
        if (searchable.includes('disturb') || searchable.includes('dnd')) {
          if (searchable.includes('begin') || searchable.includes('start')) {
            model.dnd.beginEntityId = entity.entityId;
            model.dnd.begin = state;
          } else if (searchable.includes('end')) {
            model.dnd.endEntityId = entity.entityId;
            model.dnd.end = state;
          }
        }
        break;
      }
      case 'button': {
        if (
          searchable.includes('reset') &&
          includesAny(searchable, [
            'consumable',
            'brush',
            'filter',
            'sensor',
            'mop',
            'strainer',
            'detergent',
          ])
        ) {
          resetButtons.push({ entityId: entity.entityId, searchable });
          break;
        }
        if (includesAny(searchable, ['reload shortcuts', 'backup saved map'])) break;
        const isMaintenance = includesAny(searchable, [
          'self clean',
          'base station',
          'empty water',
          'drain',
          'manual drying',
          'dust bag',
          'auto empty',
          'mapping',
          'clear warning',
        ]);
        model.actions.push({
          entityId: entity.entityId,
          label,
          kind: isMaintenance ? 'maintenance' : 'routine',
        });
        break;
      }
      case 'image':
      case 'camera': {
        const url = readString(attrs.entity_picture_local) ?? readString(attrs.entity_picture);
        if (!url) break;
        const isUnavailable = state === 'unavailable';
        if (domain === 'camera' && !includesAny(searchable, ['map'])) break;
        model.maps.push({
          entityId: entity.entityId,
          label,
          url,
          updatedAt: known ? state : undefined,
          isUnavailable,
        });
        break;
      }
      case 'update': {
        const installed = readString(attrs.installed_version);
        const latest = readString(attrs.latest_version);
        model.firmware = {
          entityId: entity.entityId,
          installed,
          latest,
          updateAvailable: state === 'on',
        };
        break;
      }
      default:
        break;
    }
  }

  // --- Consumables: merge percent + time, estimate percent when needed ---
  for (const [key, bucket] of consumableBuckets) {
    let percent = bucket.percent;
    if (percent === undefined && bucket.seconds !== undefined) {
      const lifetime = CONSUMABLE_LIFETIME_HOURS.find((entry) =>
        entry.match.test(bucket.searchable)
      );
      if (lifetime) {
        percent = Math.max(
          0,
          Math.min(100, Math.round((bucket.seconds / 3600 / lifetime.hours) * 100))
        );
      }
    }
    const remainingHours = bucket.seconds !== undefined ? bucket.seconds / 3600 : undefined;
    const isWarning =
      (remainingHours !== undefined && remainingHours <= CONSUMABLE_WARNING_HOURS) ||
      (percent !== undefined && percent <= CONSUMABLE_WARNING_PERCENT);
    const reset = resetButtons.find((button) => {
      const needle = bucket.searchable.split(' ').filter((part) => part.length > 2);
      return needle.length > 0 && needle.every((part) => button.searchable.includes(part));
    });
    model.consumables.push({
      key,
      label: bucket.label,
      entityId: bucket.entityId,
      remainingSeconds: bucket.seconds,
      remainingPercent: percent,
      isWarning,
      resetEntityId: reset?.entityId,
    });
  }
  model.consumables.sort((a, b) => (a.remainingPercent ?? 101) - (b.remainingPercent ?? 101));

  // --- Status text ---
  const rawStatus = model.rawStatus ?? attrStatus ?? vacuumState;
  model.rawStatus = rawStatus;
  if (model.status === 'unavailable') {
    model.statusText = 'Unavailable';
  } else if (model.error) {
    model.statusText = model.error;
    model.status = 'error';
  } else if (rawStatus && rawStatus !== 'docked') {
    model.statusText = humanizeToken(rawStatus);
    const inferred = normalizeVacuumStatus(rawStatus, model.status);
    if (inferred !== 'idle') model.status = inferred;
  } else {
    model.statusText = humanizeToken(vacuumState ?? 'idle');
  }
  if (model.status === 'docked' || model.status === 'charging') {
    if (typeof model.battery === 'number' && model.battery >= 100) {
      model.status = 'charging-complete';
      if (!model.rawStatus || model.rawStatus === 'docked' || model.rawStatus === 'charging') {
        model.statusText = 'Charged';
      }
    }
  }

  // Order actions: routines first, then maintenance; stable by label.
  model.actions.sort((a, b) =>
    a.kind === b.kind ? a.label.localeCompare(b.label) : a.kind === 'routine' ? -1 : 1
  );
  model.flags.sort((a, b) => (a.tone === 'bad' ? -1 : b.tone === 'bad' ? 1 : 0));
  model.maps = model.maps
    .filter((map) => !map.isUnavailable)
    .concat(model.maps.filter((map) => map.isUnavailable));

  return model;
}

export function formatVacuumDuration(seconds: number | undefined): string | undefined {
  if (seconds === undefined || !Number.isFinite(seconds)) return undefined;
  const total = Math.max(0, Math.round(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (hours >= 48) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return `${total}s`;
}

export function formatVacuumArea(
  sqm: number | undefined,
  unit: 'm²' | 'ft²' = 'm²'
): string | undefined {
  if (sqm === undefined || !Number.isFinite(sqm)) return undefined;
  const value = unit === 'ft²' ? sqm * 10.7639 : sqm;
  const rounded = value >= 100 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded.toLocaleString()} ${unit}`;
}
