export type GoogleTravelMode = "walking" | "transit" | "driving";

export interface GoogleMapsTarget {
  lat: number;
  lon: number;
  label?: string;
  headingDeg?: number;
  allowStreetView?: boolean;
  allowDirections?: boolean;
  customMapsUrl?: string;
}

export interface ResolvedGoogleMapsLinks {
  placeUrl: string;
  streetViewUrl: string | null;
  streetViewEmbedUrl: string | null;
  directions: Record<GoogleTravelMode, string> | null;
}

function normalizeHeadingDeg(headingDeg: number): number {
  return Math.round(((headingDeg % 360) + 360) % 360) % 360;
}

export function buildGoogleMapsPlaceUrl(lat: number, lon: number, label?: string): string {
  const q = label
    ? `${label} ${lat.toFixed(6)},${lon.toFixed(6)}`
    : `${lat.toFixed(6)},${lon.toFixed(6)}`;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

export function buildGoogleStreetViewUrl(
  lat: number,
  lon: number,
  headingDeg?: number,
): string {
  let url = `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat.toFixed(6)},${lon.toFixed(6)}`;
  if (headingDeg !== undefined && Number.isFinite(headingDeg)) {
    url += `&heading=${normalizeHeadingDeg(headingDeg)}`;
  }
  return url;
}

export function buildGoogleDirectionsUrl(
  lat: number,
  lon: number,
  travelMode: GoogleTravelMode = "walking",
  origin?: string,
): string {
  let url = `https://www.google.com/maps/dir/?api=1&destination=${lat.toFixed(6)},${lon.toFixed(6)}&travelmode=${travelMode}`;
  if (origin && origin.trim()) {
    url += `&origin=${encodeURIComponent(origin.trim())}`;
  }
  return url;
}

export function buildGoogleStreetViewEmbedUrl(
  apiKey: string,
  lat: number,
  lon: number,
  headingDeg?: number,
  lang: "ja" | "en" = "ja",
): string {
  const key = apiKey.trim();
  if (!key) return "";
  let url = `https://www.google.com/maps/embed/v1/streetview?key=${encodeURIComponent(key)}&location=${lat.toFixed(6)},${lon.toFixed(6)}&language=${lang}`;
  if (headingDeg !== undefined && Number.isFinite(headingDeg)) {
    url += `&heading=${normalizeHeadingDeg(headingDeg)}`;
  }
  return url;
}

export function getGoogleMapsEmbedKey(): string {
  return (
    (import.meta as { env?: Record<string, string | undefined> }).env
      ?.VITE_GOOGLE_MAPS_EMBED_KEY?.trim() ?? ""
  );
}

export function resolveSelectedGoogleMapsLinks(
  target: GoogleMapsTarget,
  lang: "ja" | "en",
  embedKey = getGoogleMapsEmbedKey(),
): ResolvedGoogleMapsLinks {
  const placeUrl =
    target.customMapsUrl || buildGoogleMapsPlaceUrl(target.lat, target.lon, target.label);
  const allowSv = target.allowStreetView !== false;
  const allowDir = target.allowDirections !== false;
  const streetViewUrl = allowSv
    ? buildGoogleStreetViewUrl(target.lat, target.lon, target.headingDeg)
    : null;
  const streetViewEmbedUrl =
    allowSv && embedKey.trim()
      ? buildGoogleStreetViewEmbedUrl(embedKey, target.lat, target.lon, target.headingDeg, lang)
      : null;
  const directions = allowDir
    ? {
        walking: buildGoogleDirectionsUrl(target.lat, target.lon, "walking"),
        transit: buildGoogleDirectionsUrl(target.lat, target.lon, "transit"),
        driving: buildGoogleDirectionsUrl(target.lat, target.lon, "driving"),
      }
    : null;

  return {
    placeUrl,
    streetViewUrl,
    streetViewEmbedUrl,
    directions,
  };
}
