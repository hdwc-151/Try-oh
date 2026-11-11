import { Text, type TextProps } from 'react-native';

import { type } from '@/theme';

export function AppText({ variant = 'body', style, selectable, numberOfLines, ...props }: TextProps & { variant?: keyof typeof type }) {
  // Android không cắt "…" cho chữ selectable có numberOfLines (chữ bị cắt nửa dòng), nên tắt selectable khi giới hạn dòng.
  return <Text selectable={selectable ?? numberOfLines === undefined} numberOfLines={numberOfLines} style={[type[variant], style]} {...props} />;
}
