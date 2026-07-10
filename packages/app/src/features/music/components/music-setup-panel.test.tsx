import { renderWithProviders } from '@navet/app/test/render';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MusicSetupPanel } from './music-setup-panel';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MusicSetupPanel', () => {
  it('shows and stores the hosted Spotify OAuth relay callback', async () => {
    const relayUri = 'https://navet.app/redirect/oauth';
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            spotify: {
              configured: false,
              source: 'none',
              clientIdHint: null,
              redirectUri: relayUri,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            spotify: {
              configured: true,
              source: 'stored',
              clientIdHint: '1234',
              redirectUri: relayUri,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );

    renderWithProviders(<MusicSetupPanel onClose={vi.fn()} onSaved={vi.fn()} />);

    expect(await screen.findByDisplayValue(relayUri)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Spotify Client ID'), {
      target: { value: 'spotify-client-1234' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save configuration' }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      method: 'PUT',
      body: JSON.stringify({
        spotifyClientId: 'spotify-client-1234',
        spotifyRedirectUri: relayUri,
      }),
    });
  });
});
