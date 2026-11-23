import { describe, expect, it } from "vitest";
import {
  createShinkoPilotCamera,
  dot3,
  imageToLocalOnPlane,
  localToImage,
  wgs84ToImage,
} from "@small-yokohama/core";

describe("Orthographic 45-degree camera & One Transform", () => {
  const cam = createShinkoPilotCamera();

  it("constructs an orthonormal basis looking SW at 45-degree depression", () => {
    const { right, up, forward } = cam.basis;
    expect(dot3(right, right)).toBeCloseTo(1, 10);
    expect(dot3(up, up)).toBeCloseTo(1, 10);
    expect(dot3(forward, forward)).toBeCloseTo(1, 10);
    expect(dot3(right, up)).toBeCloseTo(0, 10);
    expect(dot3(right, forward)).toBeCloseTo(0, 10);
    expect(dot3(up, forward)).toBeCloseTo(0, 10);

    // Offshore NE looking SW (-x, -y, -z)
    expect(forward[0]).toBeCloseTo(-0.5, 6);
    expect(forward[1]).toBeCloseTo(-0.5, 6);
    expect(forward[2]).toBeCloseTo(-Math.SQRT1_2, 6);
  });

  it("orders higher bridge decks strictly closer to camera than underlying road", () => {
    const roadImg = wgs84ToImage(cam, 139.6394, 35.4531, 2.2);
    const bridgeImg = wgs84ToImage(cam, 139.6394, 35.4531, 6.9);
    expect(bridgeImg.depthM).toBeLessThan(roadImg.depthM);
    // Moving vertically upward moves screen pixel upward (smaller py)
    expect(bridgeImg.py).toBeLessThan(roadImg.py);
  });

  it("round-trips localToImage <-> imageToLocalOnPlane accurately", () => {
    const sample: readonly [number, number, number] = [-142.3, 64.8, 6.9];
    const img = localToImage(cam, sample);
    const back = imageToLocalOnPlane(cam, img.px, img.py, 6.9);
    expect(back[0]).toBeCloseTo(sample[0], 6);
    expect(back[1]).toBeCloseTo(sample[1], 6);
    expect(back[2]).toBeCloseTo(sample[2], 6);
  });
});
