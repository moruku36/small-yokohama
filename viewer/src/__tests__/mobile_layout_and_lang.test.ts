import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createFullYokohamaCamera } from "@small-yokohama/core";
import { getDict } from "../i18n.js";
import { createInitialViewerState, serializeShareUrl } from "../state.js";
import { rectIntersectsAny, type UiRect } from "../ui/LabelLayer.js";

const JA_REGEX = /[\u3040-\u30ff\u3400-\u9fff]/;

describe("Default English language, Japanese switcher & mobile UI obstacle collision", () => {
  const cam = createFullYokohamaCamera();

  it("defaults to English and round-trips Japanese override via ?lang=ja", () => {
    const def = createInitialViewerState(cam, "", false);
    expect(def.lang).toBe("en");

    const defUrl = new URL(serializeShareUrl(def, "https://small-yokohama.example/", cam));
    expect(defUrl.searchParams.has("lang")).toBe(false);

    const ja = createInitialViewerState(cam, "?lang=ja", false);
    expect(ja.lang).toBe("ja");
    const jaUrl = serializeShareUrl(ja, "https://small-yokohama.example/", cam);
    expect(jaUrl).toContain("lang=ja");

    const explicitEn = createInitialViewerState(cam, "?lang=en", false);
    expect(explicitEn.lang).toBe("en");

    expect(getDict("en").navLang).toBe("JA");
    expect(getDict("ja").navLang).toBe("EN");
    expect(JA_REGEX.test(JSON.stringify(getDict("en")))).toBe(false);
  });

  it("marks viewer/index.html as lang=en by default", () => {
    const html = fs.readFileSync(path.resolve(__dirname, "../../index.html"), "utf8");
    expect(html).toContain('<html lang="en"');
  });

  it("rejects map labels and badges colliding with mobile #bar, #sq, or #status chrome", () => {
    const mobileChrome: UiRect[] = [
      { l: 4, r: 326, t: 4, b: 84 }, // wrapped 2-row mobile #bar
      { l: 332, r: 390, t: 4, b: 274 }, // right-side #sq stack
      { l: 4, r: 386, t: 744, b: 840 }, // bottom mobile #status
    ];

    // Top bar overlap (e.g. "26" bus badge under top bar)
    expect(rectIntersectsAny({ l: 110, r: 150, t: 62, b: 82 }, mobileChrome)).toBe(true);
    // Right stack overlap
    expect(rectIntersectsAny({ l: 318, r: 360, t: 180, b: 202 }, mobileChrome)).toBe(true);
    // Bottom status bar overlap (e.g. Bay Breeze badge)
    expect(rectIntersectsAny({ l: 20, r: 120, t: 736, b: 756 }, mobileChrome)).toBe(true);
    // Center map area is clear
    expect(rectIntersectsAny({ l: 100, r: 240, t: 360, b: 390 }, mobileChrome)).toBe(false);
  });
});
