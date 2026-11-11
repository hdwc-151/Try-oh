export const colors = {
  label: '#141A3C',
  secondaryLabel: '#6B6F85',
  separator: '#E7E4EE',
  background: '#FBF8F6',
  groupedBackground: '#F3F1F6',
  surface: '#FFFFFF',
  destructive: '#C93434',
  destructiveBackground: '#FFF0F0',
  success: '#26734D',
  successBackground: '#EDF8F1',
  onBrand: '#FFFFFF',
} as const;

/** Fitsy: navy chủ đạo, tím nhấn, hồng cho dấu lấp lánh của logo. */
const brand = {
  primary: '#141A3C',
  secondary: '#EFEAFF',
  accent: '#6E4BF2',
  sparkle: '#FF5A6E',
} as const;

export function useBrandColors() {
  return brand;
}
