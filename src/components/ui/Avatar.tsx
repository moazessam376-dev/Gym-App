import { Image, type ImageStyle, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { gradientFor, theme } from '@/theme';
import { Text } from './Text';

export type AvatarProps = {
  name?: string | null;
  uri?: string | null;
  size?: number;
  style?: ViewStyle;
};

function initials(name?: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.charAt(0).toUpperCase();
  return (parts[0]!.charAt(0) + parts[parts.length - 1]!.charAt(0)).toUpperCase();
}

/**
 * Profile avatar. Renders the photo if `uri` is given, otherwise a deterministic
 * gradient with the person's initials. No avatar_url exists in the schema yet, so
 * gradient-initials is the default everywhere today.
 */
export function Avatar({ name, uri, size = 44, style }: AvatarProps) {
  const radius = size / 2;

  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={
          [{ width: size, height: size, borderRadius: radius }, style] as StyleProp<ImageStyle>
        }
      />
    );
  }

  const [from, to] = gradientFor(name ?? 'seed');
  return (
    <LinearGradient
      colors={[from, to]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={[
        {
          width: size,
          height: size,
          borderRadius: radius,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      <Text
        variant="title"
        color={theme.colors.white}
        style={{ fontSize: size * 0.4, lineHeight: size * 0.46 }}
      >
        {initials(name)}
      </Text>
    </LinearGradient>
  );
}
