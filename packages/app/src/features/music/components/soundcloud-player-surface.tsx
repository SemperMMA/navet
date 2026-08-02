import { useI18n } from '@navet/app/hooks';
import { SOUNDCLOUD_PLAYER_FRAME_ID } from '../adapters/soundcloud-music-adapter';

export function SoundCloudPlayerSurface() {
  const { t } = useI18n();
  return (
    <iframe
      id={SOUNDCLOUD_PLAYER_FRAME_ID}
      title={t('media.type.player')}
      className="hidden h-[166px] w-full rounded-2xl border-0"
      allow="autoplay"
      loading="lazy"
      referrerPolicy="strict-origin-when-cross-origin"
    />
  );
}
