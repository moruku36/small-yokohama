const OPEN_METEO_URL =
  "https://api.open-meteo.com/v1/forecast?latitude=35.4437&longitude=139.6380&current=temperature_2m,weather_code,precipitation,rain,showers,wind_speed_10m,cloud_cover&timezone=Asia%2FTokyo";

function classifyWmoWeather(code, precipMm, windKmh) {
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
      labelEn: isThunder
        ? "thunderstorm"
        : breezy
          ? "raining, breezy"
          : heavy
            ? "heavy rain"
            : "raining",
    };
  }

  if (code === 45 || code === 48) {
    return {
      condition: "mist",
      rainIntensity: 0,
      labelJa: "霧の横浜港",
      labelEn: "misty harbor",
    };
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

module.exports = async function handler(_req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");

  const fetchedAt = new Date().toISOString();
  try {
    const upstream = await fetch(OPEN_METEO_URL, {
      headers: { Accept: "application/json", "User-Agent": "SmallYokohama/1.0" },
      signal: AbortSignal.timeout(5000),
    });
    if (!upstream.ok) {
      throw new Error(`HTTP ${upstream.status}`);
    }
    const payload = await upstream.json();
    const cur = payload && payload.current ? payload.current : {};
    const tempC = typeof cur.temperature_2m === "number" ? cur.temperature_2m : null;
    const weatherCode = typeof cur.weather_code === "number" ? cur.weather_code : 0;
    const precipitationMm =
      typeof cur.precipitation === "number"
        ? cur.precipitation
        : (typeof cur.rain === "number" ? cur.rain : 0) +
          (typeof cur.showers === "number" ? cur.showers : 0);
    const windSpeedKmh = typeof cur.wind_speed_10m === "number" ? cur.wind_speed_10m : 0;
    const cloudCover = typeof cur.cloud_cover === "number" ? cur.cloud_cover : 0;
    const classified = classifyWmoWeather(weatherCode, precipitationMm, windSpeedKmh);

    res.statusCode = 200;
    res.end(
      JSON.stringify({
        ok: true,
        fetchedAt,
        tempC,
        weatherCode,
        precipitationMm,
        windSpeedKmh,
        cloudCover,
        ...classified,
      }),
    );
  } catch {
    res.statusCode = 200;
    res.end(
      JSON.stringify({
        ok: false,
        fetchedAt,
        tempC: null,
        weatherCode: 0,
        precipitationMm: 0,
        windSpeedKmh: 0,
        cloudCover: 0,
        condition: "clear",
        rainIntensity: 0,
        labelJa: "晴れの横浜港",
        labelEn: "clear",
      }),
    );
  }
};
