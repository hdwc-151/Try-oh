import { authStorage } from '@/services/auth-storage';

/** Lưu nhỏ trên máy (SecureStore trên native, localStorage trên web). */

const outfitTitleKey = (id: string) => 'fitsy.outfit-title.' + id;
const PENDING_EXTRACT_KEY = 'fitsy.pending-extract';
/** Quá thời gian này coi như lần tách đồ đã kết thúc (máy chủ đã xong hoặc đã hoàn lượt). */
export const PENDING_EXTRACT_TTL_MS = 4 * 60_000;

export async function readOutfitTitles(ids: string[]): Promise<Record<string, string>> {
  const entries = await Promise.all(ids.map(async (id) => [id, await authStorage.getItem(outfitTitleKey(id)).catch(() => null)] as const));
  return Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => Boolean(entry[1])));
}

export async function writeOutfitTitle(id: string, title: string) {
  const trimmed = title.trim();
  if (trimmed) await authStorage.setItem(outfitTitleKey(id), trimmed.slice(0, 60));
  else await authStorage.removeItem(outfitTitleKey(id));
}

export async function removeOutfitTitle(id: string) {
  await authStorage.removeItem(outfitTitleKey(id)).catch(() => undefined);
}

export type PendingExtract = { startedAt: number; baseTotal: number };

export async function readPendingExtract(): Promise<PendingExtract | null> {
  const raw = await authStorage.getItem(PENDING_EXTRACT_KEY).catch(() => null);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as PendingExtract;
    if (Date.now() - value.startedAt > PENDING_EXTRACT_TTL_MS) {
      await authStorage.removeItem(PENDING_EXTRACT_KEY);
      return null;
    }
    return value;
  } catch {
    await authStorage.removeItem(PENDING_EXTRACT_KEY);
    return null;
  }
}

export async function markPendingExtract(baseTotal: number) {
  await authStorage.setItem(PENDING_EXTRACT_KEY, JSON.stringify({ startedAt: Date.now(), baseTotal } satisfies PendingExtract));
}

export async function clearPendingExtract() {
  await authStorage.removeItem(PENDING_EXTRACT_KEY).catch(() => undefined);
}

const WEATHER_CITY_KEY = 'fitsy.weather-city';

export async function readWeatherCity(): Promise<string | null> {
  return authStorage.getItem(WEATHER_CITY_KEY).catch(() => null);
}

export async function writeWeatherCity(id: string) {
  await authStorage.setItem(WEATHER_CITY_KEY, id).catch(() => undefined);
}
