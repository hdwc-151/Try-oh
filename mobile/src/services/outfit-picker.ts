import type { Garment, GarmentCategory } from '@/types/api';
import type { WeatherNow } from '@/services/weather';

/** Bộ sinh số ngẫu nhiên có hạt giống: cùng ngày, cùng thành phố thì gợi ý giữ nguyên. */
export function seededRandom(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T,>(items: T[], random: () => number): T | undefined => items[Math.floor(random() * items.length)];

export type PickedOutfit = { ids: string[]; reason: string | null };

/**
 * Ghép một bộ từ tủ đồ: luôn cố có áo + quần/váy + giày; áo khoác và phụ kiện tuỳ thời tiết/ngẫu nhiên.
 * Chỉ dựa vào loại món đồ (tủ đồ chưa có chất liệu/màu), nên lời giải thích nói về thời tiết, không bịa chi tiết.
 */
export function pickOutfit(garments: Garment[], options: { random: () => number; maxItems: number; weather?: WeatherNow | null }): PickedOutfit {
  const byCategory = (category: GarmentCategory) => garments.filter((item) => item.category === category);
  const { random, weather } = options;
  const hot = weather ? weather.feelsLike >= 30 : false;
  const cold = weather ? weather.temperature < 20 : false;
  const rainy = weather ? weather.rainChance >= 50 || weather.raining : false;
  const wantOuterwear = weather ? cold || (rainy && !hot) : random() < 0.35;

  const chosen: Garment[] = [];
  const add = (item: Garment | undefined) => { if (item && chosen.length < options.maxItems) chosen.push(item); };
  add(pick(byCategory('tops'), random));
  add(pick(byCategory('bottoms'), random));
  if (wantOuterwear) add(pick(byCategory('outerwear'), random));
  add(pick(byCategory('shoes'), random));
  if (random() < 0.4) add(pick(byCategory('accessories'), random));
  // Tủ đồ lệch loại (ví dụ toàn áo): vẫn trả ít nhất 2 món để có gì mà thử.
  if (chosen.length < 2) {
    for (const item of [...garments].sort(() => random() - 0.5)) {
      if (!chosen.includes(item)) add(item);
      if (chosen.length >= 2) break;
    }
  }

  let reason: string | null = null;
  if (weather) {
    if (rainy && !hot) reason = `Khả năng mưa ${weather.rainChance}% — thêm áo khoác cho chắc.`;
    else if (rainy) reason = `Nóng mà có thể mưa (${weather.rainChance}%) — đồ nhẹ, mang theo áo mưa.`;
    else if (hot) reason = `Cảm giác như ${Math.round(weather.feelsLike)}°C — ưu tiên đồ thoáng, bỏ áo khoác.`;
    else if (cold) reason = `Trời ${Math.round(weather.temperature)}°C hơi lạnh — khoác thêm một lớp.`;
    else reason = 'Thời tiết dễ chịu — mặc gì cũng hợp, thử phối mới xem sao.';
  }
  return { ids: chosen.map((item) => item.id), reason };
}
