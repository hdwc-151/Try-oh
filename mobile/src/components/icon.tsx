import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import type { ColorValue } from 'react-native';

type IconName = Exclude<SymbolViewProps['name'], string>;

/** SF Symbols trên iOS, Material Symbols trên Android/web. */
const icons = {
  bell: { ios: 'bell', android: 'notifications', web: 'notifications' },
  person: { ios: 'person.crop.circle', android: 'account_circle', web: 'account_circle' },
  hanger: { ios: 'hanger', android: 'apparel', web: 'apparel' },
  wardrobe: { ios: 'cabinet', android: 'door_sliding', web: 'door_sliding' },
  bag: { ios: 'bag', android: 'shopping_bag', web: 'shopping_bag' },
  check: { ios: 'checkmark', android: 'check', web: 'check' },
  arrow: { ios: 'arrow.right', android: 'arrow_forward', web: 'arrow_forward' },
  sparkles: { ios: 'sparkles', android: 'auto_awesome', web: 'auto_awesome' },
  plus: { ios: 'plus', android: 'add', web: 'add' },
  photo: { ios: 'person.crop.rectangle', android: 'add_photo_alternate', web: 'add_photo_alternate' },
  search: { ios: 'magnifyingglass', android: 'search', web: 'search' },
  close: { ios: 'xmark', android: 'close', web: 'close' },
  edit: { ios: 'pencil', android: 'edit', web: 'edit' },
  trash: { ios: 'trash', android: 'delete', web: 'delete' },
  checkboxOn: { ios: 'checkmark.square.fill', android: 'check_box', web: 'check_box' },
  checkboxOff: { ios: 'square', android: 'check_box_outline_blank', web: 'check_box_outline_blank' },
  shield: { ios: 'checkmark.shield', android: 'verified_user', web: 'verified_user' },
  lock: { ios: 'lock', android: 'lock', web: 'lock' },
  people: { ios: 'person.2', android: 'group', web: 'group' },
  gear: { ios: 'gearshape', android: 'settings', web: 'settings' },
  camera: { ios: 'camera', android: 'photo_camera', web: 'photo_camera' },
  gallery: { ios: 'photo.on.rectangle', android: 'photo_library', web: 'photo_library' },
  link: { ios: 'link', android: 'link', web: 'link' },
  qr: { ios: 'qrcode', android: 'qr_code_2', web: 'qr_code_2' },
  cloudOff: { ios: 'wifi.exclamationmark', android: 'cloud_off', web: 'cloud_off' },
  chevronRight: { ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' },
  minus: { ios: 'minus', android: 'remove', web: 'remove' },
} satisfies Record<string, IconName>;

export type AppIconName = keyof typeof icons;

export function AppIcon({ name, size = 22, color }: { name: AppIconName; size?: number; color: ColorValue }) {
  return <SymbolView name={icons[name] as IconName} size={size} tintColor={color} />;
}
