import { Button } from '@navet/app/components/primitives/button';
import { Input } from '@navet/app/components/primitives/input';
import { getThemeSurfaceTokens } from '@navet/app/components/shared/theme/theme-surface-tokens';
import {
  getSpotifyRedirectUriIssue,
  loadMusicConfiguration,
  type MusicConfigurationStatus,
  resolveMusicEndpoint,
  saveMusicConfiguration,
} from '@navet/app/features/music/music-endpoints';
import { useI18n, useTheme } from '@navet/app/hooks';
import { ArrowRight, Check, Disc3, KeyRound, Loader2, ShieldCheck, X } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { toast } from 'sonner';

interface MusicSetupPanelProps {
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}

function configurationHint(hint: string | null) {
  return hint ? `••••${hint}` : '';
}

export function MusicSetupPanel({ onClose, onSaved }: MusicSetupPanelProps) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const surface = getThemeSurfaceTokens(theme);
  const [configuration, setConfiguration] = useState<MusicConfigurationStatus | null>(null);
  const [value, setValue] = useState('');
  const [spotifyRedirectUri, setSpotifyRedirectUri] = useState(() =>
    resolveMusicEndpoint('/spotify/callback')
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const serviceStatus = configuration?.spotify;
  const spotifyRedirectIssue = getSpotifyRedirectUriIssue(spotifyRedirectUri.trim());
  const canSave =
    spotifyRedirectIssue === null && Boolean(value.trim() || configuration?.spotify.configured);
  const sourceColor = '#1DB954';

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    void loadMusicConfiguration(controller.signal)
      .then((next) => {
        setConfiguration(next);
        setSpotifyRedirectUri(next.spotify.redirectUri);
      })
      .catch((error) => {
        if (!controller.signal.aborted) {
          toast.error(error instanceof Error ? error.message : t('musicHub.setup.loadFailed'));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [t]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = value.trim();
    if (!canSave) return;
    setSaving(true);
    try {
      const next = await saveMusicConfiguration({
        ...(trimmed ? { spotifyClientId: trimmed } : {}),
        spotifyRedirectUri: spotifyRedirectUri.trim(),
      });
      setConfiguration(next);
      setSpotifyRedirectUri(next.spotify.redirectUri);
      setValue('');
      await onSaved();
      toast.success(t('musicHub.setup.saved'));
      setSaving(false);
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('musicHub.setup.saveFailed'));
      setSaving(false);
    }
  };

  const removeStoredConfiguration = async () => {
    setSaving(true);
    try {
      const next = await saveMusicConfiguration({
        spotifyClientId: null,
        spotifyRedirectUri: null,
      });
      setConfiguration(next);
      setSpotifyRedirectUri(next.spotify.redirectUri);
      setValue('');
      await onSaved();
      toast.success(t('musicHub.setup.removed'));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('musicHub.setup.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className={`relative overflow-hidden rounded-[1.75rem] border ${surface.panelMuted} ${surface.border}`}
    >
      <div
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-1"
        style={{ backgroundColor: sourceColor }}
      />
      <div className="space-y-5 p-4 pl-5 md:p-5 md:pl-6">
        <div className="flex items-start gap-3">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl text-white"
            style={{ backgroundColor: sourceColor }}
          >
            <Disc3 className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <p className={`text-sm font-semibold ${surface.textPrimary}`}>
              {t('musicHub.setup.spotifyTitle')}
            </p>
            <p className={`mt-1 text-xs leading-5 ${surface.textSecondary}`}>
              {t('musicHub.setup.spotifyDescription')}
            </p>
          </div>
          <Button iconOnly label={t('common.close')} size="small" variant="ghost" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] md:items-center">
          {[
            {
              icon: KeyRound,
              label: t('musicHub.setup.spotifyStepCredentials'),
            },
            { icon: ShieldCheck, label: t('musicHub.setup.stepStored') },
            { icon: Check, label: t('musicHub.setup.stepConnect') },
          ].map((step, index) => (
            <div key={step.label} className="contents">
              <div className={`flex items-center gap-2 rounded-2xl p-3 ${surface.subtleBg}`}>
                <step.icon className="h-4 w-4 shrink-0" style={{ color: sourceColor }} />
                <span className={`text-xs font-medium ${surface.textSecondary}`}>{step.label}</span>
              </div>
              {index < 2 ? (
                <ArrowRight
                  className={`hidden h-4 w-4 md:block ${surface.textMuted}`}
                  aria-hidden="true"
                />
              ) : null}
            </div>
          ))}
        </div>

        {loading ? (
          <div className={`flex items-center gap-2 text-sm ${surface.textMuted}`}>
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('common.loading')}
          </div>
        ) : (
          <form className="space-y-4" onSubmit={save}>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-2">
                <label
                  htmlFor="music-spotify-client-id"
                  className={`text-xs font-semibold uppercase tracking-[0.14em] ${surface.textMuted}`}
                >
                  {t('musicHub.setup.spotifyClientId')}
                </label>
                <Input
                  id="music-spotify-client-id"
                  autoComplete="off"
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  placeholder={
                    configuration?.spotify.configured
                      ? configurationHint(configuration.spotify.clientIdHint)
                      : t('musicHub.setup.spotifyClientIdPlaceholder')
                  }
                  leading={<KeyRound className="h-4 w-4" />}
                />
                <p className={`text-xs leading-5 ${surface.textMuted}`}>
                  {t('musicHub.setup.spotifyClientIdHelp')}
                </p>
              </div>
              <div className="space-y-2">
                <label
                  htmlFor="music-spotify-callback"
                  className={`text-xs font-semibold uppercase tracking-[0.14em] ${surface.textMuted}`}
                >
                  {t('musicHub.setup.spotifyCallback')}
                </label>
                <Input
                  id="music-spotify-callback"
                  type="url"
                  value={spotifyRedirectUri}
                  invalid={spotifyRedirectIssue !== null}
                  onChange={(event) => setSpotifyRedirectUri(event.target.value)}
                />
                <p
                  className={`text-xs leading-5 ${
                    spotifyRedirectIssue ? 'text-red-400' : surface.textMuted
                  }`}
                >
                  {spotifyRedirectIssue === 'localhost'
                    ? t('musicHub.setup.spotifyCallbackLocalhost')
                    : spotifyRedirectIssue === 'https-required'
                      ? t('musicHub.setup.spotifyCallbackHttps')
                      : spotifyRedirectIssue === 'invalid'
                        ? t('musicHub.setup.spotifyCallbackInvalid')
                        : t('musicHub.setup.spotifyCallbackHelp')}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className={`text-xs ${surface.textMuted}`}>
                {serviceStatus?.source === 'stored'
                  ? t('musicHub.setup.storedInData')
                  : serviceStatus?.source === 'environment'
                    ? t('musicHub.setup.environmentConfigured')
                    : t('musicHub.setup.notConfigured')}
              </p>
              <div className="flex items-center gap-2">
                {serviceStatus?.source === 'stored' ? (
                  <Button
                    type="button"
                    size="small"
                    variant="ghost"
                    disabled={saving}
                    onClick={() => void removeStoredConfiguration()}
                  >
                    {t('musicHub.setup.remove')}
                  </Button>
                ) : null}
                <Button type="submit" size="small" disabled={!canSave} loading={saving}>
                  {t('musicHub.setup.save')}
                </Button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
