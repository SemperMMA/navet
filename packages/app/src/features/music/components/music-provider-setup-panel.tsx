import { Button } from '@navet/app/components/primitives/button';
import { Input } from '@navet/app/components/primitives/input';
import { getThemeSurfaceTokens } from '@navet/app/components/shared/theme/theme-surface-tokens';
import {
  type MusicConfigurationPatch,
  type MusicConfigurationStatus,
  saveMusicConfiguration,
} from '@navet/app/features/music/music-endpoints';
import { useI18n, useTheme } from '@navet/app/hooks';
import type { MusicSourceAdapter, MusicSourceId } from '@navet/core/music';
import { ArrowLeft, KeyRound, ShieldCheck } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { getMusicSourceAccent, MusicSourceIcon } from './music-presentation';

type ConfigurableMusicSourceId = 'spotify' | 'apple_music' | 'soundcloud' | 'youtube_music';

interface MusicProviderSetupPanelProps {
  source: MusicSourceAdapter & { id: ConfigurableMusicSourceId };
  configuration: MusicConfigurationStatus;
  onBack: () => void;
  onSaved: (configuration: MusicConfigurationStatus) => Promise<void> | void;
}

function isConfigurableMusicSourceId(
  sourceId: MusicSourceId
): sourceId is ConfigurableMusicSourceId {
  return ['spotify', 'apple_music', 'soundcloud', 'youtube_music'].includes(sourceId);
}

export function isConfigurableMusicSource(
  source: MusicSourceAdapter
): source is MusicSourceAdapter & { id: ConfigurableMusicSourceId } {
  return isConfigurableMusicSourceId(source.id);
}

function getConfigurationStatus(
  configuration: MusicConfigurationStatus,
  sourceId: ConfigurableMusicSourceId
) {
  switch (sourceId) {
    case 'spotify':
      return configuration.spotify;
    case 'apple_music':
      return configuration.apple;
    case 'soundcloud':
      return configuration.soundcloud;
    case 'youtube_music':
      return configuration.youtube;
  }
}

function getConfigurationPatch(
  sourceId: ConfigurableMusicSourceId,
  clientId: string,
  secret: string,
  redirectUri: string
): MusicConfigurationPatch {
  switch (sourceId) {
    case 'spotify':
      return {
        ...(clientId ? { spotifyClientId: clientId } : {}),
        spotifyRedirectUri: redirectUri,
      };
    case 'apple_music':
      return { appleMusicDeveloperToken: secret };
    case 'soundcloud':
      return {
        ...(clientId ? { soundcloudClientId: clientId } : {}),
        ...(secret ? { soundcloudClientSecret: secret } : {}),
        soundcloudRedirectUri: redirectUri,
      };
    case 'youtube_music':
      return {
        ...(clientId ? { youtubeClientId: clientId } : {}),
        ...(secret ? { youtubeClientSecret: secret } : {}),
        youtubeRedirectUri: redirectUri,
      };
  }
}

function getRemovalPatch(sourceId: ConfigurableMusicSourceId): MusicConfigurationPatch {
  switch (sourceId) {
    case 'spotify':
      return { spotifyClientId: null, spotifyRedirectUri: null };
    case 'apple_music':
      return { appleMusicDeveloperToken: null };
    case 'soundcloud':
      return {
        soundcloudClientId: null,
        soundcloudClientSecret: null,
        soundcloudRedirectUri: null,
      };
    case 'youtube_music':
      return {
        youtubeClientId: null,
        youtubeClientSecret: null,
        youtubeRedirectUri: null,
      };
  }
}

function getRedirectUri(
  configuration: MusicConfigurationStatus,
  sourceId: ConfigurableMusicSourceId
) {
  if (sourceId === 'apple_music') return '';
  return sourceId === 'spotify'
    ? configuration.spotify.redirectUri
    : sourceId === 'soundcloud'
      ? configuration.soundcloud.redirectUri
      : configuration.youtube.redirectUri;
}

export function MusicProviderSetupPanel({
  source,
  configuration,
  onBack,
  onSaved,
}: MusicProviderSetupPanelProps) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const surface = getThemeSurfaceTokens(theme);
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const status = getConfigurationStatus(configuration, source.id);
  const redirectUri = getRedirectUri(configuration, source.id);
  const needsClientId = source.id !== 'apple_music';
  const needsSecret = source.id !== 'spotify';
  const isInitialSetup = !status.configured;
  const secretAlreadyConfigured =
    source.id === 'soundcloud'
      ? configuration.soundcloud.secretConfigured === true
      : source.id === 'youtube_music'
        ? configuration.youtube.secretConfigured === true
        : status.configured;
  const appleTokenValid =
    source.id !== 'apple_music' ||
    (secret.trim().length >= 100 && secret.trim().split('.').length === 3);
  const canSave =
    !saving &&
    appleTokenValid &&
    (clientId.trim().length > 0 || secret.trim().length > 0) &&
    (!isInitialSetup ||
      ((!needsClientId || clientId.trim().length > 0) &&
        (!needsSecret || secretAlreadyConfigured || secret.trim().length > 0)));

  useEffect(() => {
    setClientId('');
    setSecret('');
  }, [source.id]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSave) return;
    setSaving(true);
    try {
      const next = await saveMusicConfiguration(
        getConfigurationPatch(source.id, clientId.trim(), secret.trim(), redirectUri)
      );
      setClientId('');
      setSecret('');
      await onSaved(next);
      toast.success(t('musicHub.setup.saved'));
      onBack();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('musicHub.setup.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const removeStoredConfiguration = async () => {
    setSaving(true);
    try {
      const next = await saveMusicConfiguration(getRemovalPatch(source.id));
      setClientId('');
      setSecret('');
      await onSaved(next);
      toast.success(t('musicHub.setup.removed'));
      onBack();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('musicHub.setup.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <Button
          iconOnly
          label={t('musicHub.setup.backToServices')}
          size="small"
          variant="ghost"
          onClick={onBack}
        >
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-white"
          style={{ backgroundColor: getMusicSourceAccent(source) }}
        >
          <MusicSourceIcon source={source} className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className={`text-base font-semibold ${surface.textPrimary}`}>
            {t('musicHub.setup.providerTitle', { provider: source.name })}
          </h3>
          <p className={`mt-1 text-xs leading-5 ${surface.textSecondary}`}>
            {t('musicHub.setup.providerDescription')}
          </p>
        </div>
      </div>

      <div className={`flex items-start gap-3 rounded-2xl p-3 ${surface.subtleBg}`}>
        <ShieldCheck
          className="mt-0.5 h-4 w-4 shrink-0"
          style={{ color: getMusicSourceAccent(source) }}
          aria-hidden="true"
        />
        <p className={`text-xs leading-5 ${surface.textSecondary}`}>
          {t('musicHub.setup.oauthNotice')}
        </p>
      </div>

      <form className="space-y-4" onSubmit={save}>
        {needsClientId ? (
          <div className="space-y-2">
            <label
              htmlFor={`music-${source.id}-client-id`}
              className={`text-xs font-semibold ${surface.textSecondary}`}
            >
              {t('musicHub.setup.clientId')}
            </label>
            <Input
              id={`music-${source.id}-client-id`}
              autoComplete="off"
              spellCheck={false}
              value={clientId}
              onChange={(event) => setClientId(event.target.value)}
              placeholder={
                'clientIdHint' in status && status.clientIdHint
                  ? `••••${status.clientIdHint}`
                  : t('musicHub.setup.clientIdPlaceholder')
              }
              leading={<KeyRound className="h-4 w-4" />}
            />
          </div>
        ) : null}

        {needsSecret ? (
          <div className="space-y-2">
            <label
              htmlFor={`music-${source.id}-secret`}
              className={`text-xs font-semibold ${surface.textSecondary}`}
            >
              {source.id === 'apple_music'
                ? t('musicHub.setup.developerToken')
                : t('musicHub.setup.clientSecret')}
            </label>
            <Input
              id={`music-${source.id}-secret`}
              type="password"
              autoComplete="new-password"
              spellCheck={false}
              value={secret}
              invalid={source.id === 'apple_music' && secret.length > 0 && !appleTokenValid}
              onChange={(event) => setSecret(event.target.value)}
              placeholder={
                source.id === 'apple_music'
                  ? t('musicHub.setup.developerTokenPlaceholder')
                  : t('musicHub.setup.clientSecretPlaceholder')
              }
              leading={<KeyRound className="h-4 w-4" />}
            />
            <p
              className={`text-xs leading-5 ${
                source.id === 'apple_music' && secret.length > 0 && !appleTokenValid
                  ? 'text-red-400'
                  : surface.textMuted
              }`}
            >
              {source.id === 'apple_music'
                ? secret.length > 0 && !appleTokenValid
                  ? t('musicHub.setup.invalidDeveloperToken')
                  : t('musicHub.setup.appleTokenHelp')
                : secretAlreadyConfigured
                  ? t('musicHub.setup.secretStored')
                  : t('musicHub.setup.clientSecretHelp')}
            </p>
          </div>
        ) : null}

        {redirectUri ? (
          <div className="space-y-2">
            <label
              htmlFor={`music-${source.id}-redirect-uri`}
              className={`text-xs font-semibold ${surface.textSecondary}`}
            >
              {t('musicHub.setup.oauthRedirect')}
            </label>
            <Input
              id={`music-${source.id}-redirect-uri`}
              value={redirectUri}
              readOnly
              spellCheck={false}
            />
            <p className={`text-xs leading-5 ${surface.textMuted}`}>
              {t('musicHub.setup.oauthRedirectHelp')}
            </p>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <p className={`text-xs ${surface.textMuted}`}>
            {status.source === 'stored'
              ? t('musicHub.setup.storedInData')
              : status.source === 'environment'
                ? t('musicHub.setup.environmentConfigured')
                : status.source === 'hosted'
                  ? t('musicHub.setup.hostedConfigured')
                  : t('musicHub.setup.notConfigured')}
          </p>
          <div className="flex items-center gap-2">
            {status.source === 'stored' ? (
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
    </div>
  );
}
