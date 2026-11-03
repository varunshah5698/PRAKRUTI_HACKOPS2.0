export type WeatherMood = 'rain' | 'hot' | 'humid' | 'windy' | 'cool' | 'settled';

export interface WeatherReading {
  temperature_c: number | null;
  relative_humidity: number | null;
  wind_speed_kmh: number | null;
  wind_direction_deg?: number | null;
  precipitation_mm: number | null;
  observed_at?: string | null;
}

export interface WeatherCondition {
  mood: WeatherMood;
  label: string;
}

const MUMBAI_HOUR = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Kolkata',
  hour: 'numeric',
  hourCycle: 'h23',
});

/** Conditions we can defend from the four values Open-Meteo gives us. */
export function weatherCondition(weather: WeatherReading | null | undefined): WeatherCondition {
  if (!weather || weather.temperature_c === null || !Number.isFinite(weather.temperature_c)) {
    return { mood: 'settled', label: 'Weather unavailable' };
  }
  const temperature = weather.temperature_c;
  const humidity = weather.relative_humidity ?? 0;
  const wind = weather.wind_speed_kmh ?? 0;
  const rain = weather.precipitation_mm ?? 0;

  if (rain > 0.2) return { mood: 'rain', label: 'Rain over Mumbai' };
  if (temperature >= 35) return { mood: 'hot', label: 'Very hot over Mumbai' };
  if (temperature >= 32 && humidity >= 60) return { mood: 'humid', label: 'Hot and humid' };
  if (temperature >= 32) return { mood: 'hot', label: 'Hot and dry' };
  if (humidity >= 78) return { mood: 'humid', label: 'Humid over Mumbai' };
  if (wind >= 25) return { mood: 'windy', label: 'Windy over Mumbai' };
  if (temperature <= 22) return { mood: 'cool', label: 'Cool for Mumbai' };
  return { mood: 'settled', label: 'Warm over Mumbai' };
}

/** Apparent temperature (BOM formula) from temperature, humidity and wind. */
export function feelsLikeC(weather: WeatherReading | null | undefined): number | null {
  if (!weather || weather.temperature_c === null || !Number.isFinite(weather.temperature_c)) return null;
  const temperature = weather.temperature_c;
  const humidity = Math.min(100, Math.max(0, weather.relative_humidity ?? 0));
  const windMs = Math.max(0, (weather.wind_speed_kmh ?? 0) / 3.6);
  const vapourPressure = (humidity / 100) * 6.105 * Math.exp((17.27 * temperature) / (237.7 + temperature));
  return Math.round((temperature + 0.33 * vapourPressure - 0.7 * windMs - 4) * 10) / 10;
}

export function isNightInMumbai(value?: string | null): boolean {
  if (!value) return false;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return false;
  const hour = Number(MUMBAI_HOUR.format(date));
  return hour < 6 || hour >= 19;
}
