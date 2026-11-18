export type City = { id: string; name: string; latitude: number; longitude: number };

export const CITIES: City[] = [
  { id: 'hcm', name: 'TP. Hồ Chí Minh', latitude: 10.8231, longitude: 106.6297 },
  { id: 'hn', name: 'Hà Nội', latitude: 21.0285, longitude: 105.8542 },
  { id: 'dn', name: 'Đà Nẵng', latitude: 16.0544, longitude: 108.2022 },
  { id: 'hp', name: 'Hải Phòng', latitude: 20.8449, longitude: 106.6881 },
  { id: 'ct', name: 'Cần Thơ', latitude: 10.0452, longitude: 105.7469 },
  { id: 'hue', name: 'Huế', latitude: 16.4637, longitude: 107.5909 },
  { id: 'nt', name: 'Nha Trang', latitude: 12.2388, longitude: 109.1967 },
  { id: 'dl', name: 'Đà Lạt', latitude: 11.9404, longitude: 108.4583 },
];
export const DEFAULT_CITY = CITIES[0];

export type WeatherNow = {
  temperature: number;
  feelsLike: number;
  maxTemperature: number;
  rainChance: number;
  raining: boolean;
  code: number;
};

/** Mã thời tiết WMO (Open-Meteo) → mô tả ngắn và biểu tượng. */
export function describeWeather(code: number): { text: string; emoji: string } {
  if (code === 0) return { text: 'Trời quang', emoji: '☀️' };
  if (code <= 2) return { text: 'Có mây', emoji: '🌤️' };
  if (code === 3) return { text: 'Nhiều mây', emoji: '☁️' };
  if (code === 45 || code === 48) return { text: 'Sương mù', emoji: '🌫️' };
  if (code >= 51 && code <= 57) return { text: 'Mưa phùn', emoji: '🌦️' };
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return { text: 'Có mưa', emoji: '🌧️' };
  if (code >= 95) return { text: 'Giông', emoji: '⛈️' };
  return { text: 'Thay đổi', emoji: '🌥️' };
}

/** Open-Meteo: miễn phí, không cần khoá, gọi thẳng từ app (không qua máy chủ Try-oh). */
export async function fetchWeather(city: City, signal?: AbortSignal): Promise<WeatherNow> {
  const url = 'https://api.open-meteo.com/v1/forecast'
    + `?latitude=${city.latitude}&longitude=${city.longitude}`
    + '&current=temperature_2m,apparent_temperature,weather_code,precipitation'
    + '&daily=temperature_2m_max,precipitation_probability_max&forecast_days=1&timezone=Asia%2FBangkok';
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error('Không tải được thời tiết.');
  const body = await response.json() as {
    current?: { temperature_2m?: number; apparent_temperature?: number; weather_code?: number; precipitation?: number };
    daily?: { temperature_2m_max?: number[]; precipitation_probability_max?: (number | null)[] };
  };
  const current = body.current ?? {};
  const code = current.weather_code ?? 0;
  return {
    temperature: current.temperature_2m ?? 0,
    feelsLike: current.apparent_temperature ?? current.temperature_2m ?? 0,
    maxTemperature: body.daily?.temperature_2m_max?.[0] ?? current.temperature_2m ?? 0,
    rainChance: body.daily?.precipitation_probability_max?.[0] ?? 0,
    raining: (current.precipitation ?? 0) > 0 || (code >= 51 && code <= 82) || code >= 95,
    code,
  };
}
