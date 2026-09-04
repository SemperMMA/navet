import type { DeviceWithType } from '@navet/app/types/device.types';
import { getDeviceRoomLabel } from '@navet/app/utils/device-location';

export type ClimateDashboardGroupKey =
  | 'climate'
  | 'fans'
  | 'blinds'
  | 'temperature'
  | 'humidity'
  | 'airQuality'
  | 'pressure';

const BLIND_COVER_DEVICE_CLASSES = new Set(['blind', 'shade', 'shutter', 'curtain', 'awning']);
const NON_BLIND_COVER_DEVICE_CLASSES = new Set([
  'door',
  'garage',
  'garage_door',
  'gate',
  'window',
  'damper',
]);

function isBlindLikeCover(device: DeviceWithType): boolean {
  if (device.type !== 'covers') return false;
  const deviceClass = String(device.deviceClass ?? '').toLowerCase();
  if (deviceClass) {
    return (
      BLIND_COVER_DEVICE_CLASSES.has(deviceClass) ||
      !NON_BLIND_COVER_DEVICE_CLASSES.has(deviceClass)
    );
  }
  // Cover groups carry no device class - go by name (blinds/shades/curtains) and never doors/gates.
  const text = `${device.id} ${device.name ?? ''}`.toLowerCase();
  if (/\b(door|garage|gate|window|frunk|trunk|hood|port)\b/.test(text)) return false;
  return /\b(blind|blinds|shade|shades|shutter|shutters|curtain|curtains|awning)\b/.test(text);
}

export function getClimateDashboardGroup(device: DeviceWithType): ClimateDashboardGroupKey | null {
  if (device.type === 'fans') {
    return 'fans';
  }

  if (isBlindLikeCover(device)) {
    return 'blinds';
  }

  if (device.type === 'climate' || device.type === 'hvac') {
    return 'climate';
  }

  if (
    device.type === 'switches' &&
    (device.serviceDomain === 'humidifier' ||
      String(device.entityType ?? '').toLowerCase() === 'humidifier' ||
      String(device.entityType ?? '').toLowerCase() === 'dehumidifier')
  ) {
    return 'humidity';
  }

  if (device.type !== 'sensors') {
    return null;
  }

  switch (String(device.deviceClass ?? '').toLowerCase()) {
    case 'temperature':
      return 'temperature';
    case 'humidity':
      return 'humidity';
    case 'air_quality':
    case 'carbon_dioxide':
      return 'airQuality';
    case 'pressure':
      return 'pressure';
    default:
      return null;
  }
}

function getClimateSortRank(device: DeviceWithType): number {
  if (device.type === 'climate' || device.type === 'hvac') {
    const modes = (device.supportedHvacModes ?? []).map((mode) => String(mode).toLowerCase());
    // Whole-home thermostats (heat capable) ahead of room air conditioners.
    return modes.includes('heat') || modes.includes('heat_cool') || modes.includes('auto') ? 0 : 1;
  }
  if (device.type === 'covers') {
    const members = (device as { groupMembers?: unknown }).groupMembers;
    const memberCount = Array.isArray(members) ? members.length : 0;
    // Bigger groups first (All -> floors -> rooms), then individual blinds.
    return memberCount > 0 ? -memberCount : 1;
  }
  return 0;
}

/** Stable order inside a climate group: kind rank, then room, then name. */
export function compareClimateDashboardDevices(left: DeviceWithType, right: DeviceWithType) {
  const rankDelta = getClimateSortRank(left) - getClimateSortRank(right);
  if (rankDelta !== 0) return rankDelta;
  const roomDelta = getDeviceRoomLabel(left).localeCompare(getDeviceRoomLabel(right));
  if (roomDelta !== 0) return roomDelta;
  return (left.name ?? left.id).localeCompare(right.name ?? right.id);
}
