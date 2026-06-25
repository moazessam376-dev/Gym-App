// Audio player for a chat voice note (Phase 18). Lazily fetches a short-lived signed
// URL on first play (the media bytes live in a private bucket, §7), then plays/pauses
// via expo-audio. The signed URL is only minted on demand so it never expires before
// use. Colors adapt to whether the bubble is mine (on-primary) or theirs.
import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { getSignedUrl } from '../lib/media';
import { Text } from './ui';
import { theme } from '../theme';

function fmt(seconds: number): string {
  const s = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}

export function VoiceNoteBubble({ mediaId, mine }: { mediaId: string; mine: boolean }) {
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);

  const tint = mine ? theme.colors.onPrimary : theme.colors.text;
  const track = mine ? 'rgba(255,255,255,0.35)' : theme.colors.glassBorder;
  const fill = mine ? theme.colors.onPrimary : theme.colors.primary;

  async function onToggle() {
    if (loading) return;
    if (!loaded) {
      setLoading(true);
      try {
        const url = await getSignedUrl(mediaId);
        player.replace(url);
        setLoaded(true);
        player.play();
      } catch {
        /* leaves a non-playing state; another tap retries */
      } finally {
        setLoading(false);
      }
      return;
    }
    if (status.playing) {
      player.pause();
    } else {
      // Restart from the beginning once it has played to the end.
      if (status.didJustFinish || (status.duration > 0 && status.currentTime >= status.duration)) {
        await player.seekTo(0);
      }
      player.play();
    }
  }

  const progress = status.duration > 0 ? Math.min(status.currentTime / status.duration, 1) : 0;
  const busy = loading || (loaded && status.isBuffering && !status.playing);

  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm, minWidth: 168 }}>
      <Pressable onPress={onToggle} hitSlop={8}>
        {busy ? (
          <ActivityIndicator size="small" color={tint} />
        ) : (
          <Ionicons name={status.playing ? 'pause-circle' : 'play-circle'} size={30} color={tint} />
        )}
      </Pressable>

      <View style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: track, overflow: 'hidden' }}>
        <View style={{ width: `${progress * 100}%`, height: 3, backgroundColor: fill }} />
      </View>

      {loaded && status.duration > 0 ? (
        <Text variant="caption" color={tint} style={{ fontSize: 11, opacity: 0.9, minWidth: 32, textAlign: 'right' }}>
          {fmt(status.playing || status.currentTime > 0 ? status.currentTime : status.duration)}
        </Text>
      ) : (
        <Ionicons name="mic" size={14} color={tint} style={{ opacity: 0.9 }} />
      )}
    </View>
  );
}
