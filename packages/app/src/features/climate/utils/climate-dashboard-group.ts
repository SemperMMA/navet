import type { DeviceWithType } from '@navet/app/types/device.types';

export type ClimateDashboardGroupKey =
  | 'climate'
  | 'fans'
  | 'blinds'
  | 'temperature'
  | 'humidity'
  | 'airQuality'
  | 'pressure';

const BLIND_COVER_DEVICE_CLASSES = new Set(['blind', 'shade', 'shutter', 'curtain', 'awning']);
const NON_BLIND_COVER_DEVICE_CLASSES = new Set(['door', 'garage', 'garage_door', 'gate', 'window', 'damper']);

function isBlindLikeCover(device: DeviceWithType): boolean {
  if (device.type !== 'covers') return false;
  const deviceClass = String(device.deviceClass ?? '').toLowerCase();
  if (deviceClass) {
    return BLIND_COVER_DEVICE_CLASSES.has(deviceClass) || !NON_BLIND_COVER_DEVICE_CLASSES.has(deviceClass);
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
