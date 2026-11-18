import { Image } from 'expo-image';
import { useRef, useState, type ReactNode } from 'react';
import {
  Animated,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  useWindowDimensions,
  View,
} from 'react-native';

import { useAuth } from '@/providers/auth-provider';
import { protectedImageSource } from '@/services/api-client';
import { haptic } from '@/services/haptics';
import { colors, radius } from '@/theme';

type Angle = 'front' | 'back';
/** Tỉ lệ ảnh máy chủ tạo mặc định (4:5); ảnh thật tự đo lại khi tải xong. */
const DEFAULT_RATIO = 4 / 5;

/**
 * Ảnh outfit hiện trọn (không cắt) theo đúng tỉ lệ ảnh, căn giữa hoàn toàn.
 * Có 2 góc Trước / Sau: Vuốt trượt mượt mà (gesture swipe với realtime dot interpolation),
 * Khung chỉ báo hình bầu dục (capsule tròn 2 đầu) thanh lịch, thẩm mỹ cao.
 */
export function OutfitAngles({
  front,
  back,
  maxHeight,
  onPressImage,
  overlay,
  compact = false,
}: {
  front: string;
  back?: string | null;
  maxHeight?: number;
  onPressImage?: (uri: string, angle: Angle) => void;
  overlay?: ReactNode;
  compact?: boolean;
}) {
  const { session } = useAuth();
  const { width: winWidth } = useWindowDimensions();
  const [angleIndex, setAngleIndex] = useState<0 | 1>(0);
  const [containerWidth, setContainerWidth] = useState(0);
  const [ratios, setRatios] = useState<Record<string, number>>({});
  const scrollRef = useRef<any>(null);
  // Tạo một lần cho mỗi lần mount; dùng useState thay cho ref để React Compiler không phải bỏ qua component.
  const [scrollX] = useState(() => new Animated.Value(0));

  const hasBack = Boolean(back);
  const showing: Angle = angleIndex === 1 && back ? 'back' : 'front';
  const uri = showing === 'back' && back ? back : front;
  const ratio = ratios[uri] ?? DEFAULT_RATIO;

  // Chiều rộng của từng trang ảnh
  const fallbackWidth = compact ? Math.round(winWidth * 0.42) : Math.min(winWidth - 32, 380);
  const cardWidth = containerWidth > 0 ? containerWidth : fallbackWidth;

  // Realtime interpolation cho 2 chấm tròn theo độ lệch scroll
  const dot1Width = scrollX.interpolate({
    inputRange: [0, cardWidth],
    outputRange: [16, 6],
    extrapolate: 'clamp',
  });
  const dot1Opacity = scrollX.interpolate({
    inputRange: [0, cardWidth],
    outputRange: [1, 0.4],
    extrapolate: 'clamp',
  });

  const dot2Width = scrollX.interpolate({
    inputRange: [0, cardWidth],
    outputRange: [6, 16],
    extrapolate: 'clamp',
  });
  const dot2Opacity = scrollX.interpolate({
    inputRange: [0, cardWidth],
    outputRange: [0.4, 1],
    extrapolate: 'clamp',
  });

  // Một chạm mở ảnh. Trước đây chạm đôi gọi onPressImage hai lần nên trình xem ảnh mở chồng hai lớp.
  const handlePress = (targetUri: string, targetAngle: Angle) => {
    onPressImage?.(targetUri, targetAngle);
  };

  const handleMomentumScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetX = e.nativeEvent.contentOffset.x;
    const nextIndex = Math.round(offsetX / (cardWidth || 1)) >= 1 ? 1 : 0;
    if (nextIndex !== angleIndex) {
      haptic.select();
      setAngleIndex(nextIndex);
    }
  };

  const scrollToAngle = (nextIndex: 0 | 1) => {
    haptic.select();
    setAngleIndex(nextIndex);
    scrollRef.current?.scrollTo({
      x: nextIndex * cardWidth,
      animated: true,
    });
  };

  const renderSingleImage = (imageUri: string, currentAngle: Angle) => {
    const imageEl = (
      <Image
        source={protectedImageSource(imageUri, session?.access_token, compact ? 320 : undefined)}
        style={{
          width: '100%',
          aspectRatio: ratio,
          maxHeight,
          borderRadius: compact ? radius.lg : radius.xl,
          backgroundColor: colors.groupedBackground,
        }}
        contentFit="contain"
        transition={0}
        onLoad={(event) => {
          const { width, height } = event.source;
          if (width > 0 && height > 0) {
            setRatios((current) => (current[imageUri] ? current : { ...current, [imageUri]: width / height }));
          }
        }}
      />
    );

    return (
      <View style={{ width: cardWidth, alignItems: 'center', justifyContent: 'center' }}>
        {onPressImage ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={currentAngle === 'back' ? 'Xem góc sau' : 'Xem góc trước'}
            onPress={() => handlePress(imageUri, currentAngle)}
            style={{ width: '100%', alignItems: 'center' }}
          >
            {imageEl}
          </Pressable>
        ) : (
          imageEl
        )}
      </View>
    );
  };

  return (
    <View
      onLayout={(e) => {
        const measuredWidth = Math.round(e.nativeEvent.layout.width);
        if (measuredWidth > 0 && measuredWidth !== containerWidth) {
          setContainerWidth(measuredWidth);
        }
      }}
      style={{
        width: '100%',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
      }}
    >
      <View
        style={{
          width: cardWidth,
          maxWidth: '100%',
          borderRadius: compact ? radius.lg : radius.xl,
          overflow: 'hidden',
          backgroundColor: colors.groupedBackground,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {hasBack && back ? (
          <Animated.ScrollView
            ref={scrollRef}
            horizontal
            pagingEnabled
            nestedScrollEnabled
            snapToInterval={cardWidth}
            snapToAlignment="start"
            decelerationRate="fast"
            disableIntervalMomentum={true}
            showsHorizontalScrollIndicator={false}
            bounces={false}
            overScrollMode="never"
            removeClippedSubviews={false}
            scrollEventThrottle={16}
            onScroll={Animated.event(
              [{ nativeEvent: { contentOffset: { x: scrollX } } }],
              {
                useNativeDriver: false,
                listener: (e: any) => {
                  const offsetX = e?.nativeEvent?.contentOffset?.x ?? 0;
                  const nextIndex = Math.round(offsetX / (cardWidth || 1)) >= 1 ? 1 : 0;
                  if (nextIndex !== angleIndex) {
                    setAngleIndex(nextIndex);
                  }
                },
              }
            )}
            onMomentumScrollEnd={handleMomentumScrollEnd}
            style={{ width: cardWidth }}
            contentContainerStyle={{ width: cardWidth * 2 }}
          >
            {renderSingleImage(front, 'front')}
            {renderSingleImage(back, 'back')}
          </Animated.ScrollView>
        ) : (
          renderSingleImage(front, 'front')
        )}

        {/* Khung hình bầu dục (capsule bo tròn 2 đầu hoàn hảo) chứa 2 chấm chỉ báo */}
        {hasBack && (
          <View
            style={{
              position: 'absolute',
              bottom: compact ? 8 : 12,
              alignSelf: 'center',
              flexDirection: 'row',
              justifyContent: 'center',
              alignItems: 'center',
              gap: 6,
              height: 24,
              paddingHorizontal: 10,
              borderRadius: 12,
              backgroundColor: 'rgba(18, 22, 34, 0.42)',
              borderWidth: 0.8,
              borderColor: 'rgba(255, 255, 255, 0.28)',
            }}
          >
            <Pressable
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Xem góc trước"
              onPress={() => scrollToAngle(0)}
              style={{ height: '100%', justifyContent: 'center', alignItems: 'center' }}
            >
              <Animated.View
                style={{
                  width: dot1Width,
                  height: 5,
                  borderRadius: 2.5,
                  backgroundColor: '#FFFFFF',
                  opacity: dot1Opacity,
                }}
              />
            </Pressable>
            <Pressable
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Xem góc sau"
              onPress={() => scrollToAngle(1)}
              style={{ height: '100%', justifyContent: 'center', alignItems: 'center' }}
            >
              <Animated.View
                style={{
                  width: dot2Width,
                  height: 5,
                  borderRadius: 2.5,
                  backgroundColor: '#FFFFFF',
                  opacity: dot2Opacity,
                }}
              />
            </Pressable>
          </View>
        )}
      </View>

      {overlay}
    </View>
  );
}
