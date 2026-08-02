import { renderWithProviders } from '@navet/app/test/render';
import type { MusicSourceAdapter } from '@navet/core/music';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MusicConfigurationStatus } from '../music-endpoints';
import { MusicProviderSetupPanel } from './music-provider-setup-panel';

const youtubeSource: MusicSourceAdapter & { id: 'youtube_music' } = {
  id: 'youtube_music',
  name: 'YouTube Music',
  capabilities: {
    search: true,
    library: true,
    itemDetails: true,
    queue: true,
    favorites: true,
    favoriteMutation: true,
    browserPlayback: true,
    playbackHandoff: false,
  },
  getAccountStatus: vi.fn(async () => ({ state: 'disconnected' })),
  connect: vi.fn(async () => undefined),
  disconnect: vi.fn(async () => undefined),
  search: vi.fn(async () => []),
};

const configuration: MusicConfigurationStatus = {
  spotify: {
    configured: true,
    source: 'environment',
    clientIdHint: '1234',
    redirectUri: 'https://navet.app/redirect/oauth',
  },
  apple: { configured: false, source: 'hosted' },
  soundcloud: {
    configured: false,
    source: 'none',
    clientIdHint: null,
    secretConfigured: false,
    redirectUri: 'https://navet.app/redirect/oauth',
  },
  youtube: {
    configured: false,
    source: 'none',
    clientIdHint: null,
    secretConfigured: false,
    redirectUri: 'https://navet.app/redirect/oauth',
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MusicProviderSetupPanel', () => {
  it('saves provider application credentials server-side and returns to OAuth services', async () => {
    const onBack = vi.fn();
    const onSaved = vi.fn();
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({
        ...configuration,
        youtube: {
          ...configuration.youtube,
          configured: true,
          source: 'stored',
          clientIdHint: '7890',
          secretConfigured: true,
        },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    renderWithProviders(
      <MusicProviderSetupPanel
        source={youtubeSource}
        configuration={configuration}
        onBack={onBack}
        onSaved={onSaved}
      />
    );

    fireEvent.change(screen.getByLabelText('Client ID'), {
      target: { value: 'youtube-client-7890' },
    });
    fireEvent.change(screen.getByLabelText('Client secret'), {
      target: { value: 'youtube-secret' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save configuration' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, request] = fetchMock.mock.calls[0] ?? [];
    expect(request).toMatchObject({ method: 'PUT' });
    expect(JSON.parse(String(request?.body))).toEqual({
      youtubeClientId: 'youtube-client-7890',
      youtubeClientSecret: 'youtube-secret',
      youtubeRedirectUri: 'https://navet.app/redirect/oauth',
    });
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(expect.any(Object)));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('never prefills a stored client secret and can retain it during client ID rotation', () => {
    renderWithProviders(
      <MusicProviderSetupPanel
        source={youtubeSource}
        configuration={{
          ...configuration,
          youtube: {
            ...configuration.youtube,
            configured: true,
            source: 'stored',
            clientIdHint: '7890',
            secretConfigured: true,
          },
        }}
        onBack={vi.fn()}
        onSaved={vi.fn()}
      />
    );

    expect(screen.getByLabelText('Client secret')).toHaveValue('');
    expect(
      screen.getByText('A secret is already stored. Leave this blank to keep it.')
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save configuration' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Client ID'), {
      target: { value: 'youtube-client-replacement' },
    });
    expect(screen.getByRole('button', { name: 'Save configuration' })).toBeEnabled();
  });
});
