import { DashboardGroupingNavigation } from '@navet/app/components/patterns';
import type { HomeStatusSummaryItem } from '@navet/app/features/sensors/components/home-status-summary-model';
import {
  SummaryBar,
  SummaryBarStack,
} from '@navet/app/features/sensors/components/info-badge-strip';
import { useI18n } from '@navet/app/hooks';
import type { DeviceWithType } from '@navet/app/types/device.types';
import { Bot } from 'lucide-react';
import { memo, useCallback, useMemo, useState } from 'react';
import { getVacuumStatusLabelKey, isLawnMowerEntityId } from '../components/vacuum/vacuum-utils';
import { VacuumDevicePanel, type VacuumDevicePanelDevice } from './vacuum-device-panel';

interface VacuumsDashboardProps {
  deviceMap: Map<string, DeviceWithType>;
  isEditMode: boolean;
  onRemoveEntity: (entityId: string) => void;
}

function toPanelDevice(device: DeviceWithType): VacuumDevicePanelDevice {
  const record = device as unknown as Record<string, unknown>;
  return {
    id: device.id,
    name: device.name,
    room: typeof record.room === 'string' ? record.room : undefined,
    providerId: device.providerId,
    rawStatus: typeof record.rawStatus === 'string' ? record.rawStatus : undefined,
    status: (record.status as VacuumDevicePanelDevice['status']) ?? 'idle',
    battery: typeof record.battery === 'number' ? record.battery : undefined,
    cleanedArea: typeof record.cleanedArea === 'string' ? record.cleanedArea : undefined,
    cleaningTime: typeof record.cleaningTime === 'string' ? record.cleaningTime : undefined,
  };
}

function statusIconColor(status: VacuumDevicePanelDevice['status']): string {
  if (status === 'error') return 'text-rose-400';
  if (status === 'cleaning' || status === 'mopping' || status === 'returning')
    return 'text-sky-400';
  if (status === 'charging-complete') return 'text-emerald-400';
  return 'text-zinc-400';
}

export const VacuumsDashboard = memo(function VacuumsDashboard({
  deviceMap,
  isEditMode,
  onRemoveEntity,
}: VacuumsDashboardProps) {
  const { t } = useI18n();
  const vacuums = useMemo(
    () =>
      Array.from(deviceMap.values())
        .filter((device) => device.type === 'vacuums' && !isLawnMowerEntityId(device.id))
        .map(toPanelDevice)
        .sort((left, right) => left.name.localeCompare(right.name)),
    [deviceMap]
  );
  const [selectedId, setSelectedId] = useState<string>('');
  const selected = vacuums.find((vacuum) => vacuum.id === selectedId) ?? vacuums[0] ?? null;
  const summaryItems = useMemo<HomeStatusSummaryItem[]>(
    () =>
      vacuums.map((vacuum) => ({
        id: `vacuum-${vacuum.id}`,
        title: vacuum.name,
        value: [
          vacuum.rawStatus ?? t(getVacuumStatusLabelKey(vacuum.status)),
          typeof vacuum.battery === 'number' ? `${vacuum.battery}%` : undefined,
        ]
          .filter(Boolean)
          .join(' · '),
        icon: Bot,
        iconColor: statusIconColor(vacuum.status),
        onSelect: () => {
          document
            .getElementById(`vacuum-group-panel-${vacuum.id}`)
            ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        },
      })),
    [t, vacuums]
  );
  const handleSelect = useCallback((id: string) => {
    setSelectedId(id);
    if (typeof document === 'undefined') return;
    document
      .getElementById(`vacuum-group-panel-${id}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  return (
    <div className="space-y-6 md:space-y-7" data-testid="vacuums-dashboard">
      <SummaryBarStack>
        <SummaryBar
          items={summaryItems}
          ariaLabel={t('homeSummary.vacuums')}
          className="ios-pwa-scroll-repaint"
        />
      </SummaryBarStack>
      {vacuums.length > 1 && selected ? (
        <DashboardGroupingNavigation
          ariaLabel={t('homeSummary.vacuums')}
          groupingLabel={t('dashboard.roomNav.grouping.label')}
          idPrefix="vacuum-group"
          items={vacuums.map((vacuum) => ({
            id: vacuum.id,
            label: vacuum.name,
            indicatorTone: vacuum.status === 'error' ? 'critical' : undefined,
          }))}
          modes={[{ id: 'device', label: t('sections.vacuums.title') }]}
          selectedItemId={selected.id}
          selectedModeId="device"
          onModeChange={() => {}}
          onItemChange={handleSelect}
        />
      ) : null}
      <div className="space-y-8">
        {vacuums.map((vacuum) => (
          <div key={vacuum.id} id={`vacuum-group-panel-${vacuum.id}`} className="scroll-mt-24">
            <VacuumDevicePanel device={vacuum} isEditMode={isEditMode} onHide={onRemoveEntity} />
          </div>
        ))}
      </div>
    </div>
  );
});
