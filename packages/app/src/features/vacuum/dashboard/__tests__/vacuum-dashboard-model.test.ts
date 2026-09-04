import type {
  PlatformEntityRegistryEntry,
  PlatformEntitySnapshotMap,
} from '@navet/core/provider-feature-models';
import { describe, expect, it } from 'vitest';
import {
  buildVacuumDashboardModel,
  formatVacuumArea,
  formatVacuumDuration,
} from '../vacuum-dashboard-model';

const ROBOT = 'robot-device';
const DOCK = 'dock-device';

function snap(
  entityId: string,
  state: string,
  attributes: Record<string, unknown> = {}
): PlatformEntitySnapshotMap[string] {
  return { entityId, state, attributes };
}

function reg(
  entityId: string,
  deviceId: string,
  name: string | null,
  platform = 'roborock'
): PlatformEntityRegistryEntry {
  return { entityId, deviceId, name, platform, areaId: 'office' };
}

const roborockEntities: PlatformEntitySnapshotMap = {
  'vacuum.wilma': snap('vacuum.wilma', 'docked', {
    friendly_name: 'Wilma',
    fan_speed: 'max',
    fan_speed_list: ['quiet', 'balanced', 'turbo', 'max'],
    supported_features: 30524,
  }),
  'sensor.wilma_battery': snap('sensor.wilma_battery', '100', {
    friendly_name: 'Wilma Battery',
    unit_of_measurement: '%',
    device_class: 'battery',
  }),
  'sensor.wilma_status': snap('sensor.wilma_status', 'charging', {
    friendly_name: 'Wilma Status',
    device_class: 'enum',
  }),
  'sensor.wilma_main_brush_time_left': snap('sensor.wilma_main_brush_time_left', '572154', {
    friendly_name: 'Wilma Main brush time left',
    unit_of_measurement: 's',
    device_class: 'duration',
  }),
  'sensor.wilma_filter_time_left': snap('sensor.wilma_filter_time_left', '32154', {
    friendly_name: 'Wilma Filter time left',
    unit_of_measurement: 's',
    device_class: 'duration',
  }),
  'sensor.wilma_cleaning_time': snap('sensor.wilma_cleaning_time', '6240', {
    friendly_name: 'Wilma Cleaning time',
    unit_of_measurement: 's',
    device_class: 'duration',
  }),
  'sensor.wilma_total_cleaning_time': snap('sensor.wilma_total_cleaning_time', '1724106', {
    friendly_name: 'Wilma Total cleaning time',
    unit_of_measurement: 's',
    device_class: 'duration',
  }),
  'sensor.wilma_total_cleaning_count': snap('sensor.wilma_total_cleaning_count', '308', {
    friendly_name: 'Wilma Total cleaning count',
  }),
  'sensor.wilma_cleaning_area': snap('sensor.wilma_cleaning_area', '69.0', {
    friendly_name: 'Wilma Cleaning area',
    unit_of_measurement: 'm²',
  }),
  'sensor.wilma_total_cleaning_area': snap('sensor.wilma_total_cleaning_area', '17817.8', {
    friendly_name: 'Wilma Total cleaning area',
    unit_of_measurement: 'm²',
  }),
  'sensor.wilma_vacuum_error': snap('sensor.wilma_vacuum_error', 'none', {
    friendly_name: 'Wilma Vacuum error',
    device_class: 'enum',
  }),
  'sensor.wilma_last_clean_begin': snap(
    'sensor.wilma_last_clean_begin',
    '2026-08-27T23:33:40+00:00',
    {
      friendly_name: 'Wilma Last clean begin',
      device_class: 'timestamp',
    }
  ),
  'sensor.wilma_last_clean_end': snap('sensor.wilma_last_clean_end', '2026-08-28T01:56:07+00:00', {
    friendly_name: 'Wilma Last clean end',
    device_class: 'timestamp',
  }),
  'sensor.wilma_current_room': snap('sensor.wilma_current_room', 'unknown', {
    friendly_name: 'Wilma Current room',
  }),
  'binary_sensor.wilma_mop_attached': snap('binary_sensor.wilma_mop_attached', 'on', {
    friendly_name: 'Wilma Mop attached',
    device_class: 'connectivity',
  }),
  'binary_sensor.wilma_charging': snap('binary_sensor.wilma_charging', 'on', {
    friendly_name: 'Wilma Charging',
    device_class: 'battery_charging',
  }),
  'select.wilma_mop_mode': snap('select.wilma_mop_mode', 'standard', {
    friendly_name: 'Wilma Mop mode',
    options: ['standard', 'deep', 'deep_plus'],
  }),
  'select.wilma_selected_map': snap('select.wilma_selected_map', 'Map 2', {
    friendly_name: 'Wilma Selected map',
    options: ['The 408 - First Floor', '2nd Floor', 'Map 2'],
  }),
  'image.wilma_the_408_first_floor': snap(
    'image.wilma_the_408_first_floor',
    '2026-09-04T01:42:11+00:00',
    {
      friendly_name: 'Wilma The 408 - First Floor',
      entity_picture: '/api/image_proxy/image.wilma_the_408_first_floor?token=abc',
    }
  ),
  'image.wilma_the_408_second_floor': snap('image.wilma_the_408_second_floor', 'unavailable', {
    friendly_name: 'Wilma The 408 - Second Floor',
    entity_picture: '/api/image_proxy/image.wilma_the_408_second_floor?token=def',
  }),
  'number.wilma_volume': snap('number.wilma_volume', '45.0', {
    friendly_name: 'Wilma Volume',
    min: 0,
    max: 100,
    step: 1,
    unit_of_measurement: '%',
  }),
  'switch.wilma_do_not_disturb': snap('switch.wilma_do_not_disturb', 'off', {
    friendly_name: 'Wilma Do not disturb',
  }),
  'time.wilma_do_not_disturb_begin': snap('time.wilma_do_not_disturb_begin', '22:00:00', {
    friendly_name: 'Wilma Do not disturb begin',
  }),
  'time.wilma_do_not_disturb_end': snap('time.wilma_do_not_disturb_end', '07:00:00', {
    friendly_name: 'Wilma Do not disturb end',
  }),
  'button.wilma_deep': snap('button.wilma_deep', 'unknown', { friendly_name: 'Wilma Deep' }),
  'button.wilma_reset_main_brush_consumable': snap(
    'button.wilma_reset_main_brush_consumable',
    'unknown',
    {
      friendly_name: 'Wilma Reset main brush consumable',
    }
  ),
  // Dock device
  'switch.wilma_dock_mop_drying': snap('switch.wilma_dock_mop_drying', 'on', {
    friendly_name: 'Wilma Dock Mop drying',
  }),
  'sensor.wilma_dock_mop_drying_remaining_time': snap(
    'sensor.wilma_dock_mop_drying_remaining_time',
    '5400',
    {
      friendly_name: 'Wilma Dock Mop drying remaining time',
      unit_of_measurement: 's',
      device_class: 'duration',
    }
  ),
  'binary_sensor.wilma_dock_dirty_water_box': snap(
    'binary_sensor.wilma_dock_dirty_water_box',
    'on',
    {
      friendly_name: 'Wilma Dock Dirty water box',
      device_class: 'problem',
    }
  ),
  'sensor.wilma_dock_dock_error': snap('sensor.wilma_dock_dock_error', 'ok', {
    friendly_name: 'Wilma Dock Dock error',
    device_class: 'enum',
  }),
  'sensor.wilma_dock_strainer_time_left': snap('sensor.wilma_dock_strainer_time_left', '-21', {
    friendly_name: 'Wilma Dock Strainer time left',
    unit_of_measurement: 'h',
    device_class: 'duration',
  }),
  'select.wilma_dock_empty_mode': snap('select.wilma_dock_empty_mode', 'max', {
    friendly_name: 'Wilma Dock Empty mode',
    options: ['unknown', 'smart', 'light', 'balanced', 'max'],
  }),
  // Unrelated device on the same platform must be ignored
  'sensor.other_bot_battery': snap('sensor.other_bot_battery', '50', {
    friendly_name: 'Other Bot Battery',
    unit_of_measurement: '%',
  }),
};

const roborockRegistry: PlatformEntityRegistryEntry[] = [
  reg('vacuum.wilma', ROBOT, null),
  reg('sensor.wilma_battery', ROBOT, 'Battery'),
  reg('sensor.wilma_status', ROBOT, 'Status'),
  reg('sensor.wilma_main_brush_time_left', ROBOT, 'Main brush time left'),
  reg('sensor.wilma_filter_time_left', ROBOT, 'Filter time left'),
  reg('sensor.wilma_cleaning_time', ROBOT, 'Cleaning time'),
  reg('sensor.wilma_total_cleaning_time', ROBOT, 'Total cleaning time'),
  reg('sensor.wilma_total_cleaning_count', ROBOT, 'Total cleaning count'),
  reg('sensor.wilma_cleaning_area', ROBOT, 'Cleaning area'),
  reg('sensor.wilma_total_cleaning_area', ROBOT, 'Total cleaning area'),
  reg('sensor.wilma_vacuum_error', ROBOT, 'Vacuum error'),
  reg('sensor.wilma_last_clean_begin', ROBOT, 'Last clean begin'),
  reg('sensor.wilma_last_clean_end', ROBOT, 'Last clean end'),
  reg('sensor.wilma_current_room', ROBOT, 'Current room'),
  reg('binary_sensor.wilma_mop_attached', ROBOT, 'Mop attached'),
  reg('binary_sensor.wilma_charging', ROBOT, 'Charging'),
  reg('select.wilma_mop_mode', ROBOT, 'Mop mode'),
  reg('select.wilma_selected_map', ROBOT, 'Selected map'),
  reg('image.wilma_the_408_first_floor', ROBOT, 'The 408 - First Floor'),
  reg('image.wilma_the_408_second_floor', ROBOT, 'The 408 - Second Floor'),
  reg('number.wilma_volume', ROBOT, 'Volume'),
  reg('switch.wilma_do_not_disturb', ROBOT, 'Do not disturb'),
  reg('time.wilma_do_not_disturb_begin', ROBOT, 'Do not disturb begin'),
  reg('time.wilma_do_not_disturb_end', ROBOT, 'Do not disturb end'),
  reg('button.wilma_deep', ROBOT, 'Deep'),
  reg('button.wilma_reset_main_brush_consumable', ROBOT, 'Reset main brush consumable'),
  reg('switch.wilma_dock_mop_drying', DOCK, 'Mop drying'),
  reg('sensor.wilma_dock_mop_drying_remaining_time', DOCK, 'Mop drying remaining time'),
  reg('binary_sensor.wilma_dock_dirty_water_box', DOCK, 'Dirty water box'),
  reg('sensor.wilma_dock_dock_error', DOCK, 'Dock error'),
  reg('sensor.wilma_dock_strainer_time_left', DOCK, 'Strainer time left'),
  reg('select.wilma_dock_empty_mode', DOCK, 'Empty mode'),
  reg('sensor.other_bot_battery', 'other-device', 'Battery'),
];

describe('buildVacuumDashboardModel', () => {
  const model = buildVacuumDashboardModel({
    vacuumEntityId: 'vacuum.wilma',
    entities: roborockEntities,
    entityRegistry: roborockRegistry,
  });

  it('identifies the platform and pulls the dock device in as a sibling', () => {
    expect(model.platform).toBe('roborock');
    expect(model.platformLabel).toBe('Roborock');
    expect(model.deviceIds).toEqual(expect.arrayContaining([ROBOT, DOCK]));
    expect(model.deviceIds).not.toContain('other-device');
  });

  it('derives status, battery and charging from the robot entities', () => {
    expect(model.battery).toBe(100);
    expect(model.isCharging).toBe(true);
    expect(model.status).toBe('charging-complete');
    expect(model.hasProblem).toBe(true); // dirty water box problem flag
    expect(model.error).toBeUndefined();
    expect(model.dockError).toBeUndefined();
  });

  it('collects session and lifetime statistics', () => {
    expect(model.session.durationSeconds).toBe(6240);
    expect(model.session.areaSqm).toBe(69);
    expect(model.session.beginIso).toBe('2026-08-27T23:33:40+00:00');
    expect(model.session.endIso).toBe('2026-08-28T01:56:07+00:00');
    expect(model.totals.count).toBe(308);
    expect(model.totals.timeSeconds).toBe(1724106);
    expect(model.totals.areaSqm).toBe(17817.8);
  });

  it('builds consumables with estimated percentages, warnings and reset buttons', () => {
    const byKey = new Map(model.consumables.map((item) => [item.key, item]));
    const mainBrush = byKey.get('main brush'.replace(' ', '_'));
    expect(mainBrush).toBeDefined();
    expect(mainBrush?.remainingSeconds).toBe(572154);
    expect(mainBrush?.remainingPercent).toBe(53);
    expect(mainBrush?.isWarning).toBe(false);
    expect(mainBrush?.resetEntityId).toBe('button.wilma_reset_main_brush_consumable');

    const filter = byKey.get('filter');
    expect(filter?.remainingPercent).toBe(6);
    expect(filter?.isWarning).toBe(true);

    const strainer = byKey.get('strainer');
    expect(strainer?.remainingSeconds).toBe(-21 * 3600);
    expect(strainer?.isWarning).toBe(true);

    // Worst consumable is listed first.
    expect(model.consumables[0]?.key).toBe('strainer');
  });

  it('treats the drying countdown as dock status rather than a consumable', () => {
    expect(model.dryingRemainingSeconds).toBe(5400);
    expect(model.consumables.some((item) => item.key.includes('drying'))).toBe(false);
  });

  it('classifies dock toggles, flags, selects and maps', () => {
    expect(model.toggles).toEqual([
      expect.objectContaining({
        entityId: 'switch.wilma_dock_mop_drying',
        label: 'Mop drying',
        isOn: true,
        isRunning: true,
        group: 'dock',
      }),
    ]);
    expect(model.flags.map((flag) => flag.label)).toEqual(
      expect.arrayContaining(['Mop attached', 'Dirty water box'])
    );
    expect(model.flags.find((flag) => flag.label === 'Dirty water box')?.tone).toBe('bad');
    expect(model.flags.find((flag) => flag.label === 'Mop attached')?.valueLabel).toBe('Attached');
    expect(model.selects.map((select) => select.label)).toEqual(
      expect.arrayContaining(['Mop mode', 'Empty mode'])
    );
    expect(model.mapSelect?.value).toBe('Map 2');
    expect(model.maps[0]?.entityId).toBe('image.wilma_the_408_first_floor');
    expect(model.maps[0]?.isUnavailable).toBe(false);
    expect(model.maps[1]?.isUnavailable).toBe(true);
  });

  it('wires do-not-disturb, volume and routine buttons', () => {
    expect(model.dnd).toEqual({
      switchEntityId: 'switch.wilma_do_not_disturb',
      isOn: false,
      beginEntityId: 'time.wilma_do_not_disturb_begin',
      begin: '22:00:00',
      endEntityId: 'time.wilma_do_not_disturb_end',
      end: '07:00:00',
    });
    expect(model.numbers).toEqual([
      expect.objectContaining({ entityId: 'number.wilma_volume', value: 45, max: 100, unit: '%' }),
    ]);
    expect(model.actions).toEqual([
      expect.objectContaining({ entityId: 'button.wilma_deep', label: 'Deep', kind: 'routine' }),
    ]);
  });

  it('degrades gracefully without a registry by matching entity id slugs', () => {
    const fallback = buildVacuumDashboardModel({
      vacuumEntityId: 'vacuum.wilma',
      entities: roborockEntities,
      entityRegistry: [],
    });
    expect(fallback.platform).toBe('generic');
    expect(fallback.battery).toBe(100);
    expect(fallback.consumables.length).toBeGreaterThan(0);
    expect(fallback.deviceIds).toEqual([]);
  });

  it('marks an unavailable vacuum', () => {
    const offline = buildVacuumDashboardModel({
      vacuumEntityId: 'vacuum.wilma',
      entities: { 'vacuum.wilma': snap('vacuum.wilma', 'unavailable', { friendly_name: 'Wilma' }) },
      entityRegistry: [reg('vacuum.wilma', ROBOT, null)],
    });
    expect(offline.status).toBe('unavailable');
    expect(offline.statusText).toBe('Unavailable');
  });

  it('surfaces a robot error as the headline status', () => {
    const errored = buildVacuumDashboardModel({
      vacuumEntityId: 'vacuum.wilma',
      entities: {
        ...roborockEntities,
        'sensor.wilma_vacuum_error': snap('sensor.wilma_vacuum_error', 'main_brush_jammed', {
          friendly_name: 'Wilma Vacuum error',
          device_class: 'enum',
        }),
      },
      entityRegistry: roborockRegistry,
    });
    expect(errored.status).toBe('error');
    expect(errored.statusText).toBe('Main brush jammed');
    expect(errored.hasProblem).toBe(true);
  });
});

describe('vacuum formatters', () => {
  it('formats durations compactly', () => {
    expect(formatVacuumDuration(45)).toBe('45s');
    expect(formatVacuumDuration(6240)).toBe('1h 44m');
    expect(formatVacuumDuration(1724106)).toBe('19d 22h');
    expect(formatVacuumDuration(undefined)).toBeUndefined();
  });

  it('formats areas', () => {
    expect(formatVacuumArea(69)).toBe('69 m²');
    expect(formatVacuumArea(17817.8)).toBe('17,818 m²');
    expect(formatVacuumArea(undefined)).toBeUndefined();
  });
});
