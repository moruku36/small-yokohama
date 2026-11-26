import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchYokohamaWeather, resolveWeatherState } from "../data/weatherFeed.js";

function waitForAbort(_url: string, { signal }: RequestInit): Promise<Response> {
  return new Promise((_, reject) => {
    signal!.addEventListener("abort", () => reject(signal!.reason), { once: true });
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("weather endpoint timeouts", () => {
  it("aborts a stalled primary response body and still applies the direct forecast", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockImplementationOnce(async (_url, options) => new Response(new ReadableStream({
        start(body) {
          options!.signal!.addEventListener("abort", () => body.error(options!.signal!.reason));
        },
      })))
      .mockResolvedValueOnce(Response.json({ current: { temperature_2m: 14, weather_code: 61 } }));
    vi.stubGlobal("fetch", fetch);

    const result = fetchYokohamaWeather();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(fetch.mock.calls[0]?.[0]).toBe("/api/weather");
    expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(fetch.mock.calls[1]?.[0]).toContain("https://api.open-meteo.com/");
    await expect(result).resolves.toMatchObject({ tempC: 14, condition: "rain" });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts both stalled endpoints and falls back to the sky description", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(waitForAbort);
    vi.stubGlobal("fetch", fetch);

    const result = fetchYokohamaWeather();
    await vi.advanceTimersByTimeAsync(10_000);

    const weather = await result;
    expect(weather).toBeNull();
    expect(fetch.mock.calls.map(([, options]) => options.signal?.aborted)).toEqual([true, true]);
    expect(resolveWeatherState("live", weather, "blue sky", "en").statusText).toBe("blue sky");
    expect(vi.getTimerCount()).toBe(0);
  });
});
