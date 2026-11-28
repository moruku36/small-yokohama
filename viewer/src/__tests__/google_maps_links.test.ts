import { describe, expect, it } from "vitest";
import {
  buildGoogleDirectionsUrl,
  buildGoogleMapsPlaceUrl,
  buildGoogleStreetViewEmbedUrl,
  buildGoogleStreetViewUrl,
  resolveSelectedGoogleMapsLinks,
} from "../data/googleMapsLinks.js";
import { getDict } from "../i18n.js";

const JA_REGEX = /[\u3040-\u30ff\u3400-\u9fff]/;

describe("Free Google Maps Street View & Directions URL helpers", () => {
  it("builds official key-free Search, Street View panorama, and Directions links", () => {
    const placeUrl = buildGoogleMapsPlaceUrl(35.452612, 139.642911, "横浜赤レンガ倉庫");
    expect(placeUrl.startsWith("https://www.google.com/maps/search/?api=1&query=")).toBe(true);
    expect(decodeURIComponent(placeUrl)).toContain("横浜赤レンガ倉庫 35.452612,139.642911");

    const svNoHeading = buildGoogleStreetViewUrl(35.452612, 139.642911);
    expect(svNoHeading).toBe(
      "https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=35.452612,139.642911",
    );

    const svNegHeading = buildGoogleStreetViewUrl(35.452612, 139.642911, -45);
    expect(svNegHeading).toContain("&heading=315");

    const svWrapHeading = buildGoogleStreetViewUrl(35.452612, 139.642911, 725);
    expect(svWrapHeading).toContain("&heading=5");

    const dirWalk = buildGoogleDirectionsUrl(35.452612, 139.642911, "walking");
    expect(dirWalk).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=35.452612,139.642911&travelmode=walking",
    );

    const dirTransitWithOrigin = buildGoogleDirectionsUrl(
      35.452612,
      139.642911,
      "transit",
      "Yokohama Station",
    );
    expect(dirTransitWithOrigin).toContain("&travelmode=transit");
    expect(dirTransitWithOrigin).toContain("&origin=Yokohama%20Station");

    const dirDriving = buildGoogleDirectionsUrl(35.452612, 139.642911, "driving");
    expect(dirDriving).toContain("&travelmode=driving");
  });

  it("builds optional Street View Embed v1 URLs only when an API key is supplied", () => {
    expect(buildGoogleStreetViewEmbedUrl("", 35.4526, 139.6429, 90, "ja")).toBe("");
    expect(buildGoogleStreetViewEmbedUrl("   ", 35.4526, 139.6429, 90, "en")).toBe("");

    const embedEn = buildGoogleStreetViewEmbedUrl("test-key-123", 35.4526, 139.6429, -30, "en");
    expect(embedEn).toBe(
      "https://www.google.com/maps/embed/v1/streetview?key=test-key-123&location=35.452600,139.642900&language=en&heading=330",
    );
  });

  it("resolves card action links for buildings and disables street-level links for airborne aircraft", () => {
    const bldg = resolveSelectedGoogleMapsLinks(
      {
        lat: 35.45458,
        lon: 139.63148,
        label: "Yokohama Landmark Tower",
      },
      "en",
      "",
    );
    expect(bldg.placeUrl).toContain("Yokohama%20Landmark%20Tower");
    expect(bldg.streetViewUrl).toContain("map_action=pano&viewpoint=35.454580,139.631480");
    expect(bldg.streetViewEmbedUrl).toBeNull();
    expect(bldg.directions?.walking).toContain("travelmode=walking");
    expect(bldg.directions?.transit).toContain("travelmode=transit");
    expect(bldg.directions?.driving).toContain("travelmode=driving");

    const bldgWithKey = resolveSelectedGoogleMapsLinks(
      {
        lat: 35.45458,
        lon: 139.63148,
        label: "Yokohama Landmark Tower",
        headingDeg: 180,
      },
      "ja",
      "demo-embed-key",
    );
    expect(bldgWithKey.streetViewEmbedUrl).toContain("key=demo-embed-key");
    expect(bldgWithKey.streetViewEmbedUrl).toContain("&heading=180");

    const plane = resolveSelectedGoogleMapsLinks(
      {
        lat: 35.47,
        lon: 139.68,
        label: "JAL512",
        allowStreetView: false,
        allowDirections: false,
      },
      "en",
      "demo-embed-key",
    );
    expect(plane.placeUrl).toContain("JAL512");
    expect(plane.streetViewUrl).toBeNull();
    expect(plane.streetViewEmbedUrl).toBeNull();
    expect(plane.directions).toBeNull();
  });

  it("contains zero Japanese characters in EN Google Maps & Street View labels", () => {
    const en = getDict("en");
    expect(JA_REGEX.test(JSON.stringify(en))).toBe(false);
  });
});
