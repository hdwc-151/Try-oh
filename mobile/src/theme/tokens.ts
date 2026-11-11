import type { TextStyle } from 'react-native';

import { colors } from './colors';

export const spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 } as const;
export const radius = { sm: 8, md: 12, lg: 18, xl: 24, full: 999 } as const;
export const shadows = {
  card: '0 1px 3px rgba(17, 23, 25, 0.06)',
  raised: '0 8px 24px rgba(17, 23, 25, 0.12)',
} as const;
export const type = {
  title: { fontSize: 24, fontWeight: '700', color: colors.label },
  headline: { fontSize: 17, fontWeight: '700', color: colors.label },
  body: { fontSize: 16, fontWeight: '400', color: colors.label },
  subhead: { fontSize: 14, fontWeight: '400', color: colors.secondaryLabel },
  caption: { fontSize: 12, fontWeight: '500', color: colors.secondaryLabel },
} as const satisfies Record<string, TextStyle>;
