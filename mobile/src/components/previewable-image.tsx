import { Image, type ImageContentFit } from 'expo-image';
import { router } from 'expo-router';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { PressableScale } from '@/components/pressable-scale';

import { useAuth } from '@/providers/auth-provider';
import { protectedImageSource } from '@/services/api-client';

type PreviewableImageProps = {
  uri: string;
  title?: string;
  style?: StyleProp<ViewStyle>;
  contentFit?: ImageContentFit;
  transition?: number;
};

export function PreviewableImage({
  uri,
  title = 'Xem ảnh',
  style,
  contentFit = 'contain',
  transition,
}: PreviewableImageProps) {
  const { session } = useAuth();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={() => router.push({ pathname: '/image-viewer', params: { uri, title } })}
      scaleTo={0.95}
      style={[style, { overflow: 'hidden' }]}
    >
      <Image
        source={protectedImageSource(uri, session?.access_token)}
        style={StyleSheet.absoluteFill}
        contentFit={contentFit}
        transition={transition}
      />
    </PressableScale>
  );
}
