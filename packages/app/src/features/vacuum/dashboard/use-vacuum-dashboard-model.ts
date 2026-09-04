import {
  useProviderEntityModel,
  useProviderEntityRegistryEntries,
  useProviderEntitySnapshots,
} from '@navet/app/hooks';
import { useIntegrationStore } from '@navet/app/hooks/use-integration-store';
import type { IntegrationProviderId } from '@navet/app/types/provider';
import { parseProviderScopedId } from '@navet/app/utils/provider-ids';
import { useMemo } from 'react';
import { buildVacuumDashboardModel, type VacuumDashboardModel } from './vacuum-dashboard-model';

export function useVacuumDashboardModel({
  deviceId,
  fallbackName,
  providerId,
}: {
  deviceId: string;
  fallbackName?: string;
  providerId?: IntegrationProviderId;
}): {
  model: VacuumDashboardModel | null;
  nativeEntityId: string;
  providerId: IntegrationProviderId;
  isHomeAssistant: boolean;
} {
  const providerEntity = useProviderEntityModel(deviceId);
  const currentProviderId = useIntegrationStore((state) => state.currentProviderId);
  const resolvedProviderId =
    providerEntity?.providerId ??
    providerId ??
    parseProviderScopedId(deviceId)?.providerId ??
    currentProviderId;
  const isHomeAssistant = resolvedProviderId === 'home_assistant';
  const nativeEntityId = parseProviderScopedId(deviceId)?.nativeId ?? deviceId;
  const entities = useProviderEntitySnapshots({
    providerId: resolvedProviderId,
    enabled: isHomeAssistant,
  });
  const entityRegistry = useProviderEntityRegistryEntries({
    providerId: resolvedProviderId,
    enabled: isHomeAssistant,
  });

  const model = useMemo(() => {
    if (!isHomeAssistant) return null;
    return buildVacuumDashboardModel({
      vacuumEntityId: nativeEntityId,
      entities,
      entityRegistry,
      fallbackName,
    });
  }, [entities, entityRegistry, fallbackName, isHomeAssistant, nativeEntityId]);

  return { model, nativeEntityId, providerId: resolvedProviderId, isHomeAssistant };
}
