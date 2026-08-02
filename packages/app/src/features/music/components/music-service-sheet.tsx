import { Button, SheetSurface, SheetSurfaceHeader } from '@navet/app/components/primitives';
import { getThemeSurfaceTokens } from '@navet/app/components/shared/theme/theme-surface-tokens';
import { useI18n, useTheme } from '@navet/app/hooks';
import type { MusicAccountStatus, MusicSourceAdapter, MusicSourceId } from '@navet/core/music';
import { KeyRound, Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { loadMusicConfiguration, type MusicConfigurationStatus } from '../music-endpoints';
import { getMusicSourceAccent, MusicSourceIcon } from './music-presentation';
import { isConfigurableMusicSource, MusicProviderSetupPanel } from './music-provider-setup-panel';

interface MusicServiceSheetProps {
  open: boolean;
  sources: MusicSourceAdapter[];
  statuses: Partial<Record<MusicSourceId, MusicAccountStatus>>;
  loading: boolean;
  busySourceId: MusicSourceId | null;
  onOpenChange: (open: boolean) => void;
  onAccountAction: (source: MusicSourceAdapter, connect: boolean) => void;
  onConfigurationChanged: () => Promise<void> | void;
}

function MusicAccountRow({
  source,
  status,
  loading,
  busy,
  onAction,
  onSetup,
}: {
  source: MusicSourceAdapter;
  status?: MusicAccountStatus;
  loading: boolean;
  busy: boolean;
  onAction: (connect: boolean) => void;
  onSetup?: () => void;
}) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const surface = getThemeSurfaceTokens(theme);
  const connected = status?.state === 'connected';
  const unavailable = status?.state === 'unavailable';
  const cannotConnect = unavailable && status.canConnect === false;
  const helper = loading
    ? t('common.loading')
    : connected
      ? status.displayName || t('musicHub.connected')
      : unavailable
        ? status.reason
        : t('musicHub.connect');

  return (
    <div
      className={`flex min-w-0 items-center gap-3 rounded-3xl border p-3 ${surface.panelMuted} ${surface.border}`}
    >
      <div
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-white"
        style={{ backgroundColor: getMusicSourceAccent(source) }}
      >
        <MusicSourceIcon source={source} className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm font-semibold ${surface.textPrimary}`}>{source.name}</p>
        <p className={`line-clamp-2 text-xs leading-5 ${surface.textMuted}`}>{helper}</p>
      </div>
      <Button
        size="small"
        variant={connected ? 'ghost' : 'secondary'}
        disabled={loading || busy || (cannotConnect && !onSetup)}
        loading={busy}
        onClick={() => {
          if (cannotConnect && onSetup) onSetup();
          else onAction(!connected);
        }}
      >
        {connected
          ? t('musicHub.disconnect')
          : cannotConnect && onSetup
            ? t('musicHub.setup.action')
            : cannotConnect
              ? t('musicHub.unavailable')
              : source.id === 'apple_music'
                ? t('musicHub.authenticate')
                : t('musicHub.connect')}
      </Button>
    </div>
  );
}

export function MusicServiceSheet({
  open,
  sources,
  statuses,
  loading,
  busySourceId,
  onOpenChange,
  onAccountAction,
  onConfigurationChanged,
}: MusicServiceSheetProps) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const surface = getThemeSurfaceTokens(theme);
  const [configuration, setConfiguration] = useState<MusicConfigurationStatus | null>(null);
  const [setupSource, setSetupSource] = useState<
    (MusicSourceAdapter & { id: 'spotify' | 'apple_music' | 'soundcloud' | 'youtube_music' }) | null
  >(null);
  const connectedCount = sources.filter(
    (source) => statuses[source.id]?.state === 'connected'
  ).length;

  useEffect(() => {
    if (!open) {
      setSetupSource(null);
      return;
    }
    const controller = new AbortController();
    void loadMusicConfiguration(controller.signal)
      .then(setConfiguration)
      .catch((error) => {
        if (!controller.signal.aborted) {
          toast.error(error instanceof Error ? error.message : t('musicHub.setup.loadFailed'));
        }
      });
    return () => controller.abort();
  }, [open, t]);

  return (
    <SheetSurface
      isOpen={open}
      onOpenChange={onOpenChange}
      title={t('musicHub.accounts')}
      description={t('musicHub.servicesDescription')}
      mobileOnly={false}
      contentClassName="sm:max-w-2xl"
      bodyClassName="min-h-0 overflow-y-auto px-4 pb-5 sm:px-5"
    >
      <SheetSurfaceHeader
        title={t('musicHub.accounts')}
        description={
          loading
            ? t('common.loading')
            : connectedCount
              ? `${connectedCount} · ${t('musicHub.connected')}`
              : t('musicHub.noServicesConnected')
        }
        closeLabel={t('common.close')}
        onClose={() => onOpenChange(false)}
        className="px-4 pt-3 pb-4 sm:px-5"
        endAccessory={loading ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}
      />
      {setupSource && configuration ? (
        <MusicProviderSetupPanel
          source={setupSource}
          configuration={configuration}
          onBack={() => setSetupSource(null)}
          onSaved={async (next) => {
            setConfiguration(next);
            await onConfigurationChanged();
          }}
        />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {sources.map((source) => (
              <MusicAccountRow
                key={source.id}
                source={source}
                status={statuses[source.id]}
                loading={loading}
                busy={busySourceId === source.id}
                onAction={(connect) => onAccountAction(source, connect)}
                onSetup={
                  configuration && isConfigurableMusicSource(source)
                    ? () => setSetupSource(source)
                    : undefined
                }
              />
            ))}
          </div>
          {configuration ? (
            <div className={`flex flex-wrap items-center gap-2 border-t pt-4 ${surface.border}`}>
              <span className={`mr-auto flex items-center gap-2 text-xs ${surface.textMuted}`}>
                <KeyRound className="h-4 w-4" aria-hidden="true" />
                {t('musicHub.setupServices')}
              </span>
              {sources.filter(isConfigurableMusicSource).map((source) => (
                <Button
                  key={source.id}
                  size="small"
                  variant="ghost"
                  onClick={() => setSetupSource(source)}
                >
                  {source.name}
                </Button>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </SheetSurface>
  );
}
