import type { Lang } from "../i18n.js";

export type WeatherMode = "live" | "rain" | "clear" | "fog";

export interface LiveWeatherPayload {
  ok: boolean;
  fetchedAt: string;
  tempC: number | null;
  weatherCode: number;
  precipitationMm: number;
  windSpeedKmh: number;
  cloudCover: number;
  condition: "clear" | "cloudy" | "mist" | "rain" | "storm";
  rainIntensity: number;
  labelJa: string;
  labelEn: string;
}

export interface ResolvedWeatherState {
  rainIntensity: number;
  windSlope: number;
  isRaining: boolean;
  cloudCover: number;
  mistIntensity: number;
  windSpeedKmh: number;
  statusText: string;
}

const DIRECT_OPEN_METEO_URL =
  "https://api.open-meteo.com/v1/forecast?latitude=35.4437&longitude=139.6380&current=temperature_2m,weather_code,precipitation,rain,showers,wind_speed_10m,cloud_cover&timezone=Asia%2FTokyo";
const WEATHER_REQUEST_TIMEOUT_MS = 5_000;

async function fetchWeatherJson<T>(url: string): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), WEATHER_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { cache: "no-store", signal: controller.signal });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function classifyFallbackWmo(
  code: number,
  precipMm: number,
  windKmh: number,
): Pick<LiveWeatherPayload, "condition" | "rainIntensity" | "labelJa" | "labelEn"> {
  const raining =
    precipMm >= 0.1 ||
    (code >= 51 && code <= 67) ||
    (code >= 80 && code <= 82) ||
    (code >= 95 && code <= 99);
  const heavy = precipMm >= 3.0 || code === 65 || code === 82 || code >= 95;
  const moderate = precipMm >= 0.8 || code === 63 || code === 81 || code === 55;
  const breezy = windKmh >= 18;

  if (raining) {
    const rainIntensity = heavy ? 1.0 : moderate ? 0.78 : 0.56;
    const isThunder = code >= 95;
    return {
      condition: isThunder ? "storm" : "rain",
      rainIntensity,
      labelJa: isThunder ? "雷雨の横浜港" : heavy ? "本降りの横浜港" : "雨の横浜港",
      labelEn: isThunder ? "thunderstorm" : breezy ? "raining, breezy" : "raining",
    };
  }
  if (code === 45 || code === 48) {
    return { condition: "mist", rainIntensity: 0, labelJa: "霧の横浜港", labelEn: "misty harbor" };
  }
  if (code >= 2 && code <= 3) {
    return {
      condition: "cloudy",
      rainIntensity: 0,
      labelJa: breezy ? "風のある曇りの横浜港" : "曇りの横浜港",
      labelEn: breezy ? "cloudy, breezy" : "overcast",
    };
  }
  return {
    condition: "clear",
    rainIntensity: 0,
    labelJa: breezy ? "潮風の横浜港" : "晴れの横浜港",
    labelEn: breezy ? "clear, breezy" : "clear",
  };
}

export async function fetchYokohamaWeather(): Promise<LiveWeatherPayload | null> {
  const payload = await fetchWeatherJson<LiveWeatherPayload>("/api/weather");
  if (payload && typeof payload.weatherCode === "number") return payload;

  // Fall back to Open-Meteo directly (e.g. local Vite dev).
  const raw = await fetchWeatherJson<{
    current?: {
      temperature_2m?: number;
      weather_code?: number;
      precipitation?: number;
      wind_speed_10m?: number;
      cloud_cover?: number;
    };
  }>(DIRECT_OPEN_METEO_URL);
  if (!raw) return null;
  const cur = raw.current ?? {};
  const tempC = typeof cur.temperature_2m === "number" ? cur.temperature_2m : null;
  const weatherCode = typeof cur.weather_code === "number" ? cur.weather_code : 0;
  const precipitationMm = typeof cur.precipitation === "number" ? cur.precipitation : 0;
  const windSpeedKmh = typeof cur.wind_speed_10m === "number" ? cur.wind_speed_10m : 0;
  const cloudCover = typeof cur.cloud_cover === "number" ? cur.cloud_cover : 0;
  return {
    ok: true,
    fetchedAt: new Date().toISOString(),
    tempC,
    weatherCode,
    precipitationMm,
    windSpeedKmh,
    cloudCover,
    ...classifyFallbackWmo(weatherCode, precipitationMm, windSpeedKmh),
  };
}

export function resolveWeatherState(
  mode: WeatherMode,
  liveWeather: LiveWeatherPayload | null,
  skyDescription: string,
  lang: Lang,
): ResolvedWeatherState {
  const tempPrefix =
    liveWeather?.tempC !== null && liveWeather?.tempC !== undefined
      ? `${Math.round(liveWeather.tempC)}°C `
      : "";

  if (mode === "rain") {
    const rainIntensity = Math.max(0.75, liveWeather?.rainIntensity ?? 0.78);
    const windKmh = Math.max(12, liveWeather?.windSpeedKmh ?? 14);
    const label = lang === "en" ? "raining, breezy" : "雨の横浜港";
    return {
      rainIntensity,
      windSlope: Math.min(0.28, 0.08 + windKmh * 0.006),
      isRaining: true,
      cloudCover: clamp(Math.max(0.85, (liveWeather?.cloudCover ?? 88) / 100), 0, 1),
      mistIntensity: 0.28,
      windSpeedKmh: windKmh,
      statusText: `${tempPrefix}${label}`.trim(),
    };
  }

  if (mode === "fog") {
    const label = lang === "en" ? "harbor fog" : "霧の横浜港";
    return {
      rainIntensity: 0,
      windSlope: 0.05,
      isRaining: false,
      cloudCover: 0.72,
      mistIntensity: 0.85,
      windSpeedKmh: 9,
      statusText: `${tempPrefix}${label}`.trim(),
    };
  }

  if (mode === "clear") {
    return {
      rainIntensity: 0,
      windSlope: 0.06,
      isRaining: false,
      cloudCover: 0.08,
      mistIntensity: 0,
      windSpeedKmh: liveWeather?.windSpeedKmh ?? 8,
      statusText: `${tempPrefix}${skyDescription}`.trim(),
    };
  }

  // Live weather from Open-Meteo
  if (liveWeather && liveWeather.ok) {
    const isRaining = liveWeather.rainIntensity >= 0.1;
    const isMist = liveWeather.condition === "mist";
    const label =
      lang === "en"
        ? liveWeather.labelEn
        : isRaining
          ? liveWeather.labelJa
          : liveWeather.condition === "cloudy" || isMist
            ? liveWeather.labelJa
            : skyDescription;
    return {
      rainIntensity: liveWeather.rainIntensity,
      windSlope: Math.min(0.3, 0.06 + liveWeather.windSpeedKmh * 0.006),
      isRaining,
      cloudCover: clamp(liveWeather.cloudCover / 100, 0, 1),
      mistIntensity: isMist ? 0.78 : isRaining ? 0.22 : 0,
      windSpeedKmh: liveWeather.windSpeedKmh,
      statusText: `${tempPrefix}${label}`.trim(),
    };
  }

  return {
    rainIntensity: 0,
    windSlope: 0.08,
    isRaining: false,
    cloudCover: 0.2,
    mistIntensity: 0,
    windSpeedKmh: 10,
    statusText: skyDescription,
  };
}
