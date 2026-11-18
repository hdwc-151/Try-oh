import { Stack, router, useLocalSearchParams } from 'expo-router';

import { ZoomableImage } from '@/components/image-zoom-viewer';

export default function ImageViewerRoute() {
  const params = useLocalSearchParams<{ uri?: string; title?: string }>();
  const uri = typeof params.uri === 'string' ? params.uri : '';
  const title = typeof params.title === 'string' ? params.title : 'Xem ảnh';
  return <>
    <Stack.Screen options={{ title }}/>
    <ZoomableImage uri={uri} title={title} onClose={() => { if (router.canGoBack()) router.back(); }}/>
  </>;
}
