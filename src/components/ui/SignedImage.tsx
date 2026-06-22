import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, View, type ImageStyle, type StyleProp } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getSignedUrl } from '@/lib/media';
import { theme } from '@/theme';

export type SignedImageProps = {
  /** The `public.media` row id. The URL is minted server-side under the caller's RLS. */
  mediaId: string;
  style?: StyleProp<ImageStyle>;
  resizeMode?: 'cover' | 'contain';
  /** Re-mint trigger (e.g. bump on pull-to-refresh) — signed URLs are short-lived. */
  refreshKey?: number;
};

// Signed URLs live ~60s server-side; cache the minted URL just long enough to
// dedupe re-renders/re-mounts within a screen without serving an expired link.
const TTL_MS = 45_000;
const cache = new Map<string, { url: string; at: number }>();

/**
 * Renders a private media object via a short-lived signed URL (the only way bytes
 * are served — no public bucket). Shows a spinner while resolving and a fallback
 * glyph if the row is unreadable/expired (the Edge Function 404s an unauthorized id).
 */
export function SignedImage({ mediaId, style, resizeMode = 'cover', refreshKey = 0 }: SignedImageProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setFailed(false);

    const cached = cache.get(mediaId);
    if (cached && Date.now() - cached.at < TTL_MS && refreshKey === 0) {
      setUrl(cached.url);
      return;
    }
    setUrl(null);
    getSignedUrl(mediaId)
      .then((u) => {
        cache.set(mediaId, { url: u, at: Date.now() });
        if (active) setUrl(u);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [mediaId, refreshKey]);

  if (failed) {
    return (
      <View style={[styleToCenter(style)]}>
        <Ionicons name="image-outline" size={28} color={theme.colors.textMuted} />
      </View>
    );
  }

  if (!url) {
    return (
      <View style={[styleToCenter(style)]}>
        <ActivityIndicator color={theme.colors.primary} />
      </View>
    );
  }

  // onError covers a URL that resolved but failed to load (e.g. expired before the
  // Image fetched it) — without it the box would stay blank forever.
  return (
    <Image
      source={{ uri: url }}
      style={style}
      resizeMode={resizeMode}
      onError={() => setFailed(true)}
    />
  );
}

// Reuse the caller's box dimensions for the placeholder states, centered.
function styleToCenter(style: StyleProp<ImageStyle>): StyleProp<ImageStyle> {
  return [
    style,
    {
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.surface,
    } as ImageStyle,
  ];
}
