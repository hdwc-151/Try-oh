import { Image } from 'expo-image';
import { useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';

import { SegmentedControl, type SegmentOption } from '@/components/segmented-control';
import { useAuth } from '@/providers/auth-provider';
import { protectedImageSource } from '@/services/api-client';
import { colors, radius, spacing, useBrandColors } from '@/theme';

type Angle = 'front' | 'back';
/** Tỉ lệ ảnh máy chủ tạo mặc định (4:5); ảnh thật tự đo lại khi tải xong. */
const DEFAULT_RATIO = 4 / 5;
const angleOptions: SegmentOption<Angle>[] = [
  { value: 'front', label: 'Trước', accessibilityLabel: 'Góc trước' },
  { value: 'back', label: 'Sau', accessibilityLabel: 'Góc sau' },
];

/**
 * Ảnh outfit hiện trọn (không cắt) theo đúng tỉ lệ ảnh. Có góc sau thì hiện công tắc "Trước | Sau".
 * `overlay` vẽ đè lên ảnh (ví dụ hiệu ứng đang tạo).
 */
export function OutfitAngles({ front, back, maxHeight, onPressImage, overlay, compact = false }: {
  front: string;
  back?: string | null;
  maxHeight?: number;
  onPressImage?: (uri: string, angle: Angle) => void;
  overlay?: ReactNode;
  compact?: boolean;
}) {
  const { session } = useAuth();
  const [angle, setAngle] = useState<Angle>('front');
  const [ratios, setRatios] = useState<Record<string, number>>({});
  const showing: Angle = angle === 'back' && back ? 'back' : 'front';
  const uri = showing === 'back' && back ? back : front;
  const ratio = ratios[uri] ?? DEFAULT_RATIO;

  const image = <Image
    source={protectedImageSource(uri, session?.access_token)}
    style={{ width: '100%', aspectRatio: ratio, maxHeight, borderRadius: compact ? radius.lg : radius.xl, backgroundColor: colors.groupedBackground }}
    contentFit="contain"
    transition={220}
    onLoad={(event) => {
      const { width, height } = event.source;
      if (width > 0 && height > 0) setRatios((current) => current[uri] ? current : { ...current, [uri]: width / height });
    }}
  />;

  return <View>
    {onPressImage
      ? <Pressable accessibilityRole="button" accessibilityLabel={showing === 'back' ? 'Xem góc sau' : 'Xem góc trước'} onPress={() => onPressImage(uri, showing)}>{image}</Pressable>
      : image}
    {overlay}
    {back && <AngleSwitch value={showing} onChange={setAngle} compact={compact}/>}
  </View>;
}

function AngleSwitch({ value, onChange, compact }: { value: Angle; onChange: (value: Angle) => void; compact: boolean }) {
  const brand = useBrandColors();
  return <View pointerEvents="box-none" style={{ position: 'absolute', top: compact ? spacing.xs : spacing.sm, left: 0, right: 0, alignItems: 'center' }}>
    <SegmentedControl
      options={angleOptions}
      value={value}
      onChange={onChange}
      size="compact"
      trackColor="rgba(255, 255, 255, 0.92)"
      indicatorColor={brand.primary}
      inactiveColor={brand.primary}
      trackStyle={{ boxShadow: '0 2px 8px rgba(20, 26, 60, 0.15)' }}
      labelStyle={compact ? { fontSize: 11 } : undefined}
    />
  </View>;
}
