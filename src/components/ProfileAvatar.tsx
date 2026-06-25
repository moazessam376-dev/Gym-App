// A profile avatar that renders a private `avatar`-kind media object via a short-lived
// signed URL (Phase 19) when one is set, and falls back to the deterministic
// gradient-initials Avatar otherwise. Keeps avatars on the private-bucket + signed-URL
// path (§7) — there is no public bucket. Used by the public profile screens + the editor.
import { View } from 'react-native';
import { Avatar, SignedImage } from './ui';
import { theme } from '@/theme';

export type ProfileAvatarProps = {
  name?: string | null;
  avatarMediaId?: string | null;
  size?: number;
  /** Bump to re-mint the signed URL (signed URLs are short-lived). */
  refreshKey?: number;
};

export function ProfileAvatar({ name, avatarMediaId, size = 84, refreshKey = 0 }: ProfileAvatarProps) {
  if (avatarMediaId) {
    return (
      <View style={{ width: size, height: size, borderRadius: size / 2, overflow: 'hidden', backgroundColor: theme.colors.surface }}>
        <SignedImage mediaId={avatarMediaId} refreshKey={refreshKey} style={{ width: size, height: size }} />
      </View>
    );
  }
  return <Avatar name={name} size={size} />;
}
