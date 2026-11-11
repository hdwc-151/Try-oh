import { File } from 'expo-file-system';
import type { ImagePickerAsset } from 'expo-image-picker';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const supportedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);

type ExpoMultipartFile = Blob & {
  name: string;
  type: string;
  bytes: () => Promise<Uint8Array<ArrayBuffer>>;
};

const mimeFromName = (name: string) => {
  const extension = name.split('.').pop()?.toLowerCase();
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg';
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  return '';
};

export function imageUploadFile(asset: ImagePickerAsset, fallbackName: string): ExpoMultipartFile {
  const localFile = new File(asset.uri);
  if (!localFile.exists) {
    throw new Error('Không thể đọc ảnh đã chọn. Vui lòng chọn lại ảnh.');
  }

  const rawMimeType = (asset.mimeType || localFile.type || mimeFromName(asset.fileName || localFile.name)).toLowerCase();
  const mimeType = rawMimeType === 'image/jpg' ? 'image/jpeg' : rawMimeType;
  if (!supportedMimeTypes.has(mimeType)) {
    throw new Error('Ảnh cần có định dạng JPG, PNG hoặc WebP.');
  }

  const size = asset.fileSize ?? localFile.size;
  if (typeof size === 'number' && size > MAX_UPLOAD_BYTES) {
    throw new Error('Ảnh vượt quá 10 MB. Vui lòng chọn ảnh nhỏ hơn.');
  }

  const sourceName = asset.fileName || localFile.name || fallbackName;
  const name = /\.(jpe?g|png|webp)$/i.test(sourceName) ? sourceName : fallbackName;
  return {
    name,
    type: mimeType,
    bytes: () => localFile.bytes(),
  } as ExpoMultipartFile;
}
