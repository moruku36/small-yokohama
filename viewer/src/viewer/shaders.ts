export const FULLSCREEN_VERT = /* glsl */ `#version 300 es
precision highp float;

const vec2 QUAD[6] = vec2[6](
  vec2(-1.0, -1.0),
  vec2( 1.0, -1.0),
  vec2(-1.0,  1.0),
  vec2(-1.0,  1.0),
  vec2( 1.0, -1.0),
  vec2( 1.0,  1.0)
);

uniform vec2 u_viewTopLeftPx;
uniform vec2 u_viewBottomRightPx;

out vec2 v_imgPx;

void main() {
  vec2 ndc = QUAD[gl_VertexID];
  gl_Position = vec4(ndc, 0.0, 1.0);
  float u = ndc.x * 0.5 + 0.5;
  float v = 0.5 - ndc.y * 0.5;
  v_imgPx = mix(u_viewTopLeftPx, u_viewBottomRightPx, vec2(u, v));
}
`;

export const OVERLAY_FRAG = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2DArray;

uniform sampler2DArray u_depthTiles;
uniform int u_imageWidth;
uniform int u_imageHeight;
uniform int u_dataTileSize;
uniform int u_cols;
uniform int u_rows;
uniform float u_nearM;
uniform float u_farM;
uniform float u_dataScale;

uniform vec4 u_glowTint;
uniform float u_nightIntensity;
uniform float u_showDepth;
uniform float u_showTileGrid;
uniform int u_workingTileSize;
uniform int u_workingOverlap;
uniform float u_simTimeSec;
uniform float u_sunAltitudeDeg;
uniform float u_reducedMotion;
uniform float u_cloudCover;
uniform float u_mistIntensity;
uniform float u_windSpeed;

in vec2 v_imgPx;
out vec4 outColor;

float ovHash21(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

float ovNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(ovHash21(i), ovHash21(i + vec2(1.0, 0.0)), f.x),
    mix(ovHash21(i + vec2(0.0, 1.0)), ovHash21(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

float ovFbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    s += a * ovNoise(p);
    p = p * 2.02 + vec2(13.7, 29.1);
    a *= 0.5;
  }
  return s;
}

vec4 blendOver(vec4 dst, vec4 src) {
  if (src.a <= 0.001) return dst;
  float a = src.a + dst.a * (1.0 - src.a);
  vec3 rgb = (src.rgb * src.a + dst.rgb * dst.a * (1.0 - src.a)) / max(a, 1e-4);
  return vec4(rgb, a);
}

void main() {
  if (
    v_imgPx.x < 0.0 ||
    v_imgPx.y < 0.0 ||
    v_imgPx.x >= float(u_imageWidth) ||
    v_imgPx.y >= float(u_imageHeight)
  ) {
    outColor = vec4(0.0);
    return;
  }

  ivec2 gFull = clamp(ivec2(floor(v_imgPx)), ivec2(0), ivec2(u_imageWidth - 1, u_imageHeight - 1));
  ivec2 dataDim = ivec2(int(floor(float(u_imageWidth) * u_dataScale)), int(floor(float(u_imageHeight) * u_dataScale)));
  ivec2 g = clamp(ivec2(floor(v_imgPx * u_dataScale)), ivec2(0), dataDim - ivec2(1));
  int col = min(u_cols - 1, g.x / u_dataTileSize);
  int row = min(u_rows - 1, g.y / u_dataTileSize);
  ivec2 local = ivec2(g.x - col * u_dataTileSize, g.y - row * u_dataTileSize);
  vec4 depthTex = texelFetch(u_depthTiles, ivec3(local, row * u_cols + col), 0);

  float q16 = floor(depthTex.r * 255.0 + 0.5) * 256.0 + floor(depthTex.g * 255.0 + 0.5);
  float depthM = u_nearM + (q16 / 65535.0) * (u_farM - u_nearM);
  int surfaceKind = int(floor(depthTex.b * 255.0 + 0.5));
  float t = u_reducedMotion > 0.5 ? 0.0 : u_simTimeSec;

  vec4 colOut = vec4(0.0);

  // Soft horizon glow during golden hour & dusk
  if (u_glowTint.a > 0.005) {
    float waterBoost = surfaceKind == 1 ? 1.15 : 0.85;
    colOut = vec4(u_glowTint.rgb, clamp(u_glowTint.a * waterBoost, 0.0, 0.28));
  }

  // Harbor water shimmer & nighttime waterfront reflections (strictly masked to surfaceKind == 1)
  if (surfaceKind == 1 && u_showDepth < 0.5) {
    float w1 = sin(v_imgPx.x * 0.055 + v_imgPx.y * 0.19 - t * 1.45);
    float w2 = cos(v_imgPx.x * 0.032 - v_imgPx.y * 0.14 + t * 0.95);
    float ripple = clamp(w1 * 0.5 + w2 * 0.5, -1.0, 1.0);
    float patchMask = ovNoise(v_imgPx * 0.0065 + vec2(t * 0.03, -t * 0.02));

    float clearSun = clamp(1.0 - u_cloudCover * 0.65, 0.15, 1.0) * (1.0 - u_mistIntensity * 0.75);
    if (u_nightIntensity < 0.65) {
      float glint = pow(max(0.0, ripple), 5.0) * smoothstep(0.45, 0.82, patchMask) * clearSun;
      float golden = smoothstep(22.0, 1.0, u_sunAltitudeDeg);
      vec3 sunCol = mix(vec3(0.92, 0.98, 1.0), vec3(1.0, 0.84, 0.55), golden);
      float dayA = glint * (1.0 - u_nightIntensity) * (0.20 + 0.12 * golden);
      colOut = blendOver(colOut, vec4(sunCol, clamp(dayA, 0.0, 0.28)));
    }

    if (u_nightIntensity > 0.12) {
      float band = ovNoise(vec2(v_imgPx.x * 0.0038 + ripple * 0.18, floor(v_imgPx.y * 0.0022) + t * 0.05));
      float streak = smoothstep(0.56, 0.88, band) * pow(max(0.0, ripple * 0.5 + 0.5), 2.4);
      float colorMix = fract(sin(floor(v_imgPx.x * 0.008) * 91.7) * 43758.5);
      vec3 reflCol = colorMix < 0.48
        ? vec3(1.0, 0.78, 0.36)
        : (colorMix < 0.82 ? vec3(0.28, 0.84, 0.96) : vec3(1.0, 0.42, 0.48));
      colOut = blendOver(colOut, vec4(reflCol, clamp(streak * u_nightIntensity * 0.28, 0.0, 0.28)));
    }
  }

  // Streetlamp pools on roads and quays. Leave roofs and facades as drawn in the map tiles.
  if (u_nightIntensity > 0.02 && (surfaceKind == 3 || surfaceKind == 7)) {
    vec2 cell = floor(v_imgPx / 44.0);
    vec2 cellCenter = (cell + 0.5) * 44.0;
    float seed = fract(sin(dot(cell, vec2(41.23, 19.71))) * 23456.78);
    if (seed > 0.35) {
      float dist = length(v_imgPx - cellCenter);
      float halo = max(0.0, 1.0 - dist / 16.0);
      if (halo > 0.01) {
        vec4 lamp = vec4(1.0, 0.78, 0.42, halo * halo * 0.42 * u_nightIntensity);
        colOut = blendOver(colOut, lamp);
      }
    }
  }

  // Live Open-Meteo drifting cloud shadows across city and harbor during daylight
  if (u_cloudCover > 0.26 && u_nightIntensity < 0.6 && u_showDepth < 0.5) {
    vec2 drift = vec2(t * (0.04 + u_windSpeed * 0.003), t * 0.018);
    float cField = ovFbm(v_imgPx / 920.0 + drift);
    float cMask = smoothstep(0.48, 0.74, cField) * smoothstep(0.26, 0.94, u_cloudCover) * (1.0 - u_nightIntensity);
    colOut = blendOver(colOut, vec4(0.07, 0.13, 0.22, clamp(cMask * 0.16, 0.0, 0.16)));
  }

  // Drifting harbor sea fog & mist wisps (denser over bay & canals, softer inland)
  if (u_mistIntensity > 0.04 && u_showDepth < 0.5) {
    vec2 fogDrift = vec2(t * 0.022, -t * 0.011);
    float wisp = ovFbm(v_imgPx / 520.0 + fogDrift);
    float fine = ovNoise(v_imgPx / 185.0 - fogDrift * 1.4);
    float fogDensity = smoothstep(0.28, 0.80, wisp * 0.72 + fine * 0.28);
    float waterBias = surfaceKind == 1 ? 1.18 : (surfaceKind == 4 ? 0.62 : 0.88);
    float fogAlpha = clamp(fogDensity * u_mistIntensity * waterBias * 0.54, 0.0, 0.58);
    vec3 dayFog = mix(vec3(0.84, 0.88, 0.92), vec3(0.92, 0.82, 0.74), smoothstep(18.0, 0.0, u_sunAltitudeDeg));
    vec3 fogRgb = mix(dayFog, vec3(0.24, 0.31, 0.40), u_nightIntensity);
    colOut = blendOver(colOut, vec4(fogRgb, fogAlpha));
  }

  if (u_showDepth > 0.5) {
    float normD = clamp((depthM - 650.0) / 700.0, 0.0, 1.0);
    vec3 heat = vec3(1.0 - normD, 0.45 + 0.5 * sin(normD * 3.14159), normD);
    if (surfaceKind == 5) heat = vec3(0.95, 0.72, 0.18); // highlight bridge decks
    if (surfaceKind == 1) heat *= 0.45; // darken harbor water
    colOut = vec4(heat, 0.72);
  }

  if (u_showTileGrid > 0.5) {
    int stride = u_workingTileSize - u_workingOverlap;
    int rx = gFull.x % stride;
    int ry = gFull.y % stride;
    bool inVertBand = gFull.x >= stride && gFull.x < (u_imageWidth - u_workingOverlap) && rx < u_workingOverlap;
    bool inHorizBand = gFull.y >= stride && gFull.y < (u_imageHeight - u_workingOverlap) && ry < u_workingOverlap;
    if (inVertBand || inHorizBand) {
      colOut = mix(colOut, vec4(0.95, 0.55, 0.15, 0.24), 0.75);
    }
    bool onVertEdge = gFull.x >= stride && gFull.x <= (u_imageWidth - u_workingOverlap) && (rx <= 1 || abs(rx - u_workingOverlap) <= 1);
    bool onHorizEdge = gFull.y >= stride && gFull.y <= (u_imageHeight - u_workingOverlap) && (ry <= 1 || abs(ry - u_workingOverlap) <= 1);
    if (onVertEdge || onHorizEdge) {
      colOut = vec4(1.0, 0.82, 0.25, 0.92);
    }
  }

  outColor = colOut;
}
`;

export const VEHICLE_VERT = /* glsl */ `#version 300 es
precision highp float;

layout(location = 0) in vec3 a_posLocalM; // x=right, y=forward(length), z=up
layout(location = 1) in vec3 a_color;
layout(location = 2) in vec3 a_normalLocal;

uniform vec3 u_vehicleOriginLocalM;
uniform float u_headingRad; // clockwise from North (+Y)
uniform vec3 u_meshScale;   // local (x, y, z) scale in meters
uniform vec3 u_cameraOriginLocalM;
uniform vec3 u_camRight;
uniform vec3 u_camUp;
uniform vec3 u_camForward;
uniform vec2 u_imageOriginPx;
uniform float u_metersPerPixel;
uniform vec2 u_viewTopLeftPx;
uniform vec2 u_viewBottomRightPx;
uniform float u_nearM;
uniform float u_farM;
uniform vec3 u_tint;
uniform float u_outlineExpandM;
uniform float u_isOutline;

out vec2 v_imgPx;
out float v_depthM;
out vec3 v_color;

void main() {
  float s = sin(u_headingRad);
  float c = cos(u_headingRad);

  vec3 nLocalSafe = length(a_normalLocal) > 1e-4 ? normalize(a_normalLocal) : vec3(0.0, 0.0, 1.0);
  vec3 scaledPos = a_posLocalM * u_meshScale + (u_isOutline > 0.5 ? nLocalSafe * u_outlineExpandM : vec3(0.0));

  // Rotate vehicle local (right, forward, up) to EPSG:6677 local (east, north, up)
  vec3 worldOffset = vec3(
    scaledPos.x * c + scaledPos.y * s,
    -scaledPos.x * s + scaledPos.y * c,
    scaledPos.z
  );
  vec3 worldPos = u_vehicleOriginLocalM + worldOffset;

  vec3 nScaled = a_normalLocal / max(u_meshScale, vec3(0.01));
  vec3 nWorld = vec3(
    nScaled.x * c + nScaled.y * s,
    -nScaled.x * s + nScaled.y * c,
    nScaled.z
  );

  vec3 d = worldPos - u_cameraOriginLocalM;
  float cx = dot(d, u_camRight);
  float cy = dot(d, u_camUp);
  float depthM = dot(d, u_camForward);

  float px = u_imageOriginPx.x + cx / u_metersPerPixel;
  float py = u_imageOriginPx.y - cy / u_metersPerPixel;

  vec2 uv = (vec2(px, py) - u_viewTopLeftPx) / (u_viewBottomRightPx - u_viewTopLeftPx);
  vec2 ndc = vec2(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  float ndcZ = clamp(((depthM - u_nearM) / (u_farM - u_nearM)) * 2.0 - 1.0, -0.995, 0.995);
  if (u_isOutline > 0.5) {
    ndcZ = min(0.995, ndcZ + 0.00045);
  }

  gl_Position = vec4(ndc, ndcZ, 1.0);
  v_imgPx = vec2(px, py);
  v_depthM = depthM;

  vec3 sunDir = normalize(vec3(-0.55, -0.35, 0.76));
  float diff = 0.62 + 0.38 * max(0.0, dot(normalize(nWorld), sunDir));
  v_color = u_isOutline > 0.5 ? vec3(0.06, 0.07, 0.09) : a_color * diff * u_tint;
}
`;

export const VEHICLE_FRAG = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2DArray;

uniform sampler2DArray u_depthTiles;
uniform int u_imageWidth;
uniform int u_imageHeight;
uniform int u_dataTileSize;
uniform int u_cols;
uniform int u_rows;
uniform float u_nearM;
uniform float u_farM;
uniform float u_dataScale;
uniform float u_depthBiasM;
uniform float u_xrayMode;
uniform float u_isSelected;
uniform float u_occludedGhostAlpha;
uniform float u_alpha;

in vec2 v_imgPx;
in float v_depthM;
in vec3 v_color;

out vec4 outColor;

void main() {
  if (
    v_imgPx.x < 0.0 ||
    v_imgPx.y < 0.0 ||
    v_imgPx.x >= float(u_imageWidth) ||
    v_imgPx.y >= float(u_imageHeight)
  ) {
    discard;
  }

  ivec2 dataDim = ivec2(int(floor(float(u_imageWidth) * u_dataScale)), int(floor(float(u_imageHeight) * u_dataScale)));
  ivec2 g = clamp(ivec2(floor(v_imgPx * u_dataScale)), ivec2(0), dataDim - ivec2(1));
  int col = min(u_cols - 1, g.x / u_dataTileSize);
  int row = min(u_rows - 1, g.y / u_dataTileSize);
  ivec2 local = ivec2(g.x - col * u_dataTileSize, g.y - row * u_dataTileSize);
  vec4 depthTex = texelFetch(u_depthTiles, ivec3(local, row * u_cols + col), 0);

  float q16 = floor(depthTex.r * 255.0 + 0.5) * 256.0 + floor(depthTex.g * 255.0 + 0.5);
  float sceneDepthM = u_nearM + (q16 / 65535.0) * (u_farM - u_nearM);

  bool occluded = v_depthM > (sceneDepthM + u_depthBiasM);
  if (occluded) {
    if (u_xrayMode > 0.5) {
      float checker = mod(floor(gl_FragCoord.x * 0.25) + floor(gl_FragCoord.y * 0.25), 2.0);
      if (checker < 0.5) discard;
      outColor = vec4(0.28, 0.85, 1.0, 0.48 * u_alpha);
      return;
    }
    float ghost = max(u_occludedGhostAlpha, u_isSelected > 0.5 ? 0.30 : 0.0);
    if (ghost > 0.01) {
      outColor = vec4(v_color, ghost * u_alpha);
      return;
    }
    discard;
  }

  outColor = vec4(v_color, u_alpha);
}
`;

export const CARLIGHT_VERT = /* glsl */ `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_corner;   // -1..1 quad
layout(location = 1) in vec4 a_lightPos; // x=imgPxX, y=imgPxY, z=depthM, w=intensity
layout(location = 2) in vec4 a_lightDir; // x=dirImgX, y=dirImgY, z=pxPerM, w=kind (0=headlight, 1=taillight)

uniform vec2 u_viewTopLeftPx;
uniform vec2 u_viewBottomRightPx;

out vec2 v_uv;
out vec2 v_anchorImgPx;
out float v_depthM;
out float v_intensity;
out float v_kind;

void main() {
  v_anchorImgPx = a_lightPos.xy;
  v_depthM = a_lightPos.z;
  v_intensity = a_lightPos.w;
  v_kind = a_lightDir.w;

  vec2 dir = normalize(a_lightDir.xy + vec2(1e-5, 0.0));
  vec2 perp = vec2(-dir.y, dir.x);
  float pxPerM = max(1.0, a_lightDir.z);

  vec2 imgPos;
  if (v_kind < 0.5) {
    // Soft diverging warm headlight cone forward along road surface
    float along = a_corner.y * 0.5 + 0.5;
    float halfW = (0.85 + along * 1.95) * pxPerM;
    float fwdLen = along * 6.8 * pxPerM;
    imgPos = a_lightPos.xy + dir * fwdLen + perp * (a_corner.x * halfW);
    v_uv = vec2(a_corner.x, along);
  } else {
    // Soft twin red taillight / brake glow behind trunk
    float halfW = 1.6 * pxPerM;
    float halfL = 1.45 * pxPerM;
    imgPos = a_lightPos.xy + dir * (a_corner.y * halfL) + perp * (a_corner.x * halfW);
    v_uv = a_corner;
  }

  vec2 viewSpan = max(u_viewBottomRightPx - u_viewTopLeftPx, vec2(1.0));
  vec2 uv = (imgPos - u_viewTopLeftPx) / viewSpan;
  vec2 ndc = vec2(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  gl_Position = v_intensity > 0.01 ? vec4(ndc, 0.0, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
}
`;

export const CARLIGHT_FRAG = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2DArray;

uniform sampler2DArray u_depthTiles;
uniform int u_imageWidth;
uniform int u_imageHeight;
uniform int u_dataTileSize;
uniform int u_cols;
uniform int u_rows;
uniform float u_nearM;
uniform float u_farM;
uniform float u_dataScale;

in vec2 v_uv;
in vec2 v_anchorImgPx;
in float v_depthM;
in float v_intensity;
in float v_kind;

out vec4 outColor;

void main() {
  if (v_intensity <= 0.01) discard;
  ivec2 dataDim = ivec2(int(floor(float(u_imageWidth) * u_dataScale)), int(floor(float(u_imageHeight) * u_dataScale)));
  ivec2 g = clamp(ivec2(floor(v_anchorImgPx * u_dataScale)), ivec2(0), dataDim - ivec2(1));
  int col = min(u_cols - 1, g.x / u_dataTileSize);
  int row = min(u_rows - 1, g.y / u_dataTileSize);
  ivec2 local = ivec2(g.x - col * u_dataTileSize, g.y - row * u_dataTileSize);
  vec4 depthTex = texelFetch(u_depthTiles, ivec3(local, row * u_cols + col), 0);
  float q16 = floor(depthTex.r * 255.0 + 0.5) * 256.0 + floor(depthTex.g * 255.0 + 0.5);
  float sceneDepthM = u_nearM + (q16 / 65535.0) * (u_farM - u_nearM);
  if (v_depthM > sceneDepthM + 2.8) discard;

  if (v_kind < 0.5) {
    float across = exp(-v_uv.x * v_uv.x * 2.6);
    float alongFade = smoothstep(0.0, 0.14, v_uv.y) * pow(max(0.0, 1.0 - v_uv.y), 1.45);
    float a = clamp(across * alongFade * v_intensity * 0.54, 0.0, 0.62);
    if (a < 0.01) discard;
    outColor = vec4(1.0, 0.94, 0.68, a);
    return;
  }

  float dL = length(vec2((v_uv.x + 0.40) * 1.4, v_uv.y * 1.65));
  float dR = length(vec2((v_uv.x - 0.40) * 1.4, v_uv.y * 1.65));
  float glow = exp(-dL * dL * 3.8) + exp(-dR * dR * 3.8);
  float a = clamp(glow * v_intensity * 0.62, 0.0, 0.78);
  if (a < 0.01) discard;
  outColor = vec4(1.0, 0.22, 0.14, a);
}
`;

export const STREETLAMP_VERT = /* glsl */ `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_corner;      // -1..1 quad
layout(location = 1) in vec4 a_lampData;    // x=imgPxX, y=imgPxY, z=depthM, w=warmWeight

uniform vec2 u_viewTopLeftPx;
uniform vec2 u_viewBottomRightPx;
uniform float u_nightIntensity;

out vec2 v_corner;
out vec2 v_imgPx;
out float v_depthM;
out float v_warmWeight;

void main() {
  v_corner = a_corner;
  v_imgPx = a_lampData.xy;
  v_depthM = a_lampData.z;
  v_warmWeight = a_lampData.w;

  vec2 viewSpan = max(u_viewBottomRightPx - u_viewTopLeftPx, vec2(1.0));
  vec2 uv = (a_lampData.xy - u_viewTopLeftPx) / viewSpan;
  float pxPerImgPx = 1280.0 / viewSpan.x;
  float radiusImgPx = (7.5 + a_lampData.w * 5.0) * clamp(1.0 / max(0.2, pxPerImgPx * 0.65), 0.75, 1.35);
  vec2 uvCorner = (a_lampData.xy + a_corner * radiusImgPx - u_viewTopLeftPx) / viewSpan;
  vec2 ndc = vec2(uvCorner.x * 2.0 - 1.0, 1.0 - uvCorner.y * 2.0);
  gl_Position = u_nightIntensity > 0.05 ? vec4(ndc, 0.0, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
}
`;

export const STREETLAMP_FRAG = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2DArray;

uniform sampler2DArray u_depthTiles;
uniform int u_imageWidth;
uniform int u_imageHeight;
uniform int u_dataTileSize;
uniform int u_cols;
uniform int u_rows;
uniform float u_nearM;
uniform float u_farM;
uniform float u_dataScale;
uniform float u_nightIntensity;

in vec2 v_corner;
in vec2 v_imgPx;
in float v_depthM;
in float v_warmWeight;

out vec4 outColor;

void main() {
  float d = length(v_corner);
  if (d >= 1.0 || u_nightIntensity <= 0.05) discard;

  ivec2 dataDim = ivec2(int(floor(float(u_imageWidth) * u_dataScale)), int(floor(float(u_imageHeight) * u_dataScale)));
  ivec2 g = clamp(ivec2(floor(v_imgPx * u_dataScale)), ivec2(0), dataDim - ivec2(1));
  int col = min(u_cols - 1, g.x / u_dataTileSize);
  int row = min(u_rows - 1, g.y / u_dataTileSize);
  ivec2 local = ivec2(g.x - col * u_dataTileSize, g.y - row * u_dataTileSize);
  vec4 depthTex = texelFetch(u_depthTiles, ivec3(local, row * u_cols + col), 0);
  float q16 = floor(depthTex.r * 255.0 + 0.5) * 256.0 + floor(depthTex.g * 255.0 + 0.5);
  float sceneDepthM = u_nearM + (q16 / 65535.0) * (u_farM - u_nearM);
  if (v_depthM > sceneDepthM + 5.5) discard;

  float halo = pow(max(0.0, 1.0 - d), 2.1);
  float core = exp(-d * d * 12.0);
  vec3 warmCol = mix(vec3(1.0, 0.74, 0.34), vec3(1.0, 0.96, 0.78), core);
  float alpha = clamp((halo * 0.34 + core * 0.58) * u_nightIntensity * (0.65 + v_warmWeight * 0.35), 0.0, 0.85);
  outColor = vec4(warmCol, alpha);
}
`;

export const MARKER_VERT = /* glsl */ `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_cornerOffsetPx;

uniform vec2 u_anchorImgPx;
uniform float u_anchorDepthM;
uniform float u_radiusCssPx;
uniform vec2 u_viewTopLeftPx;
uniform vec2 u_viewBottomRightPx;
uniform vec2 u_viewportCssSize;

out vec2 v_localCoord;

void main() {
  vec2 uv = (u_anchorImgPx - u_viewTopLeftPx) / (u_viewBottomRightPx - u_viewTopLeftPx);
  vec2 ndcCenter = vec2(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  vec2 ndcOffset = (a_cornerOffsetPx * u_radiusCssPx * 2.0) / max(u_viewportCssSize, vec2(1.0));
  gl_Position = vec4(ndcCenter + vec2(ndcOffset.x, -ndcOffset.y), 0.0, 1.0);
  v_localCoord = a_cornerOffsetPx;
}
`;

export const MARKER_FRAG = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2DArray;

uniform sampler2DArray u_depthTiles;
uniform vec2 u_anchorImgPx;
uniform float u_anchorDepthM;
uniform int u_imageWidth;
uniform int u_imageHeight;
uniform int u_dataTileSize;
uniform int u_cols;
uniform int u_rows;
uniform float u_nearM;
uniform float u_farM;
uniform float u_dataScale;
uniform float u_checkDepth;
uniform vec4 u_fillColor;
uniform vec4 u_ringColor;

in vec2 v_localCoord;
out vec4 outColor;

void main() {
  float dist = length(v_localCoord);
  if (dist > 1.0) discard;

  if (u_checkDepth > 0.5) {
    ivec2 dataDim = ivec2(int(floor(float(u_imageWidth) * u_dataScale)), int(floor(float(u_imageHeight) * u_dataScale)));
    ivec2 g = clamp(ivec2(floor(u_anchorImgPx * u_dataScale)), ivec2(0), dataDim - ivec2(1));
    int col = min(u_cols - 1, g.x / u_dataTileSize);
    int row = min(u_rows - 1, g.y / u_dataTileSize);
    ivec2 local = ivec2(g.x - col * u_dataTileSize, g.y - row * u_dataTileSize);
    vec4 depthTex = texelFetch(u_depthTiles, ivec3(local, row * u_cols + col), 0);
    float q16 = floor(depthTex.r * 255.0 + 0.5) * 256.0 + floor(depthTex.g * 255.0 + 0.5);
    float sceneDepthM = u_nearM + (q16 / 65535.0) * (u_farM - u_nearM);
    if (u_anchorDepthM > sceneDepthM + 0.35) {
      discard;
    }
  }

  outColor = dist > 0.65 ? u_ringColor : u_fillColor;
}
`;

export const PEDESTRIAN_VERT = /* glsl */ `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_corner;   // -1..1 quad
layout(location = 1) in vec4 a_pedData;  // x=imgPxX, y=imgPxY, z=depthM, w=packedStyle

uniform vec2 u_viewTopLeftPx;
uniform vec2 u_viewBottomRightPx;
uniform float u_pedAlpha;
uniform float u_simTimeSec;
uniform float u_reducedMotion;

out vec2 v_uv;
out vec2 v_imgPx;
out float v_depthM;
out float v_style;
out float v_walkPhase;
out float v_seed;

void main() {
  v_uv = a_corner * 0.5 + 0.5;
  v_depthM = a_pedData.z;
  v_style = a_pedData.w;

  float seed = fract(sin(dot(a_pedData.xy, vec2(12.9898, 78.233))) * 43758.5453);
  v_seed = seed;
  float freq = 1.65 + seed * 1.15;
  float phase = (u_reducedMotion > 0.5 ? 0.0 : u_simTimeSec * freq) + seed * 6.28318;
  v_walkPhase = phase;

  // Gentle micro-stroll within safe sidewalk buffer (<= 1.25 imgPx) + slight step bob
  float axisAng = seed * 3.14159;
  float strollAmp = u_reducedMotion > 0.5 ? 0.0 : sin(u_simTimeSec * 0.42 + seed * 12.56) * 1.15;
  vec2 walkOffset = vec2(cos(axisAng) * strollAmp, sin(axisAng) * strollAmp * 0.55 - abs(sin(phase * 2.0)) * (u_reducedMotion > 0.5 ? 0.0 : 0.28));
  v_imgPx = a_pedData.xy;

  vec2 viewSpan = max(u_viewBottomRightPx - u_viewTopLeftPx, vec2(1.0));
  vec2 halfSizeImg = vec2(2.7, 4.0);
  vec2 imgPos = a_pedData.xy + walkOffset + vec2(a_corner.x * halfSizeImg.x, (a_corner.y - 0.72) * halfSizeImg.y);
  vec2 uv = (imgPos - u_viewTopLeftPx) / viewSpan;
  vec2 ndc = vec2(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  gl_Position = u_pedAlpha > 0.01 ? vec4(ndc, 0.0, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
}
`;

export const PEDESTRIAN_FRAG = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2DArray;

uniform sampler2DArray u_depthTiles;
uniform int u_imageWidth;
uniform int u_imageHeight;
uniform int u_dataTileSize;
uniform int u_cols;
uniform int u_rows;
uniform float u_nearM;
uniform float u_farM;
uniform float u_dataScale;
uniform float u_pedAlpha;
uniform vec3 u_skyTintRgb;
uniform float u_rainIntensity;
uniform float u_reducedMotion;

in vec2 v_uv;
in vec2 v_imgPx;
in float v_depthM;
in float v_style;
in float v_walkPhase;
in float v_seed;

out vec4 outColor;

vec3 coatColor(int idx) {
  if (idx == 0) return vec3(0.68, 0.24, 0.22); // crimson coat
  if (idx == 1) return vec3(0.20, 0.30, 0.48); // navy jacket
  if (idx == 2) return vec3(0.76, 0.56, 0.24); // ochre trench
  if (idx == 3) return vec3(0.28, 0.44, 0.34); // sage coat
  if (idx == 4) return vec3(0.32, 0.36, 0.42); // slate suit
  if (idx == 5) return vec3(0.74, 0.39, 0.30); // terracotta
  if (idx == 6) return vec3(0.84, 0.81, 0.75); // cream sweater
  return vec3(0.56, 0.44, 0.32);               // camel jacket
}

vec3 umbrellaColor(int idx) {
  if (idx == 0) return vec3(0.86, 0.92, 0.97); // clear vinyl umbrella
  if (idx == 1) return vec3(0.86, 0.24, 0.22); // coral red
  if (idx == 2) return vec3(0.18, 0.34, 0.58); // harbour navy
  if (idx == 3) return vec3(0.92, 0.72, 0.20); // warm yellow
  if (idx == 4) return vec3(0.24, 0.58, 0.52); // seafoam green
  if (idx == 5) return vec3(0.62, 0.44, 0.72); // lavender
  if (idx == 6) return vec3(0.28, 0.62, 0.84); // sky blue
  return vec3(0.90, 0.86, 0.78);               // cream
}

float sdCapsule(vec2 p, vec2 a, vec2 b, float r) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-5), 0.0, 1.0);
  return length(pa - ba * h) - r;
}

void main() {
  if (u_pedAlpha <= 0.01) discard;

  ivec2 dataDim = ivec2(int(floor(float(u_imageWidth) * u_dataScale)), int(floor(float(u_imageHeight) * u_dataScale)));
  ivec2 g = clamp(ivec2(floor(v_imgPx * u_dataScale)), ivec2(0), dataDim - ivec2(1));
  int col = min(u_cols - 1, g.x / u_dataTileSize);
  int row = min(u_rows - 1, g.y / u_dataTileSize);
  ivec2 local = ivec2(g.x - col * u_dataTileSize, g.y - row * u_dataTileSize);
  vec4 depthTex = texelFetch(u_depthTiles, ivec3(local, row * u_cols + col), 0);
  float q16 = floor(depthTex.r * 255.0 + 0.5) * 256.0 + floor(depthTex.g * 255.0 + 0.5);
  float sceneDepthM = u_nearM + (q16 / 65535.0) * (u_farM - u_nearM);
  if (v_depthM > sceneDepthM + 3.0) discard;

  int packedStyle = int(floor(v_style + 0.5));
  int colIdx = packedStyle & 7;
  int poseIdx = (packedStyle >> 3) & 3;

  // Normalized coordinates: x in -0.5..0.5, y in 0..1 (0=top, 1=feet)
  float x = v_uv.x - 0.5;
  float y = v_uv.y;
  vec2 p = vec2(x, y);

  // Soft 45-degree cast shadow onto sidewalk
  vec2 sh = vec2((x - 0.11) * 1.4, (y - 0.86) * 4.4);
  float shadow = exp(-dot(sh, sh) * 6.5) * 0.44;

  float stride = u_reducedMotion > 0.5
    ? (poseIdx == 1 ? 0.075 : (poseIdx == 2 ? -0.075 : (poseIdx == 3 ? 0.045 : 0.015)))
    : sin(v_walkPhase) * 0.082;
  float swing = u_reducedMotion > 0.5
    ? (poseIdx == 1 ? 0.045 : (poseIdx == 2 ? -0.045 : 0.01))
    : cos(v_walkPhase) * 0.052;

  float dHead = length(vec2(x * 1.15, (y - 0.21) * 1.05)) - 0.098;
  float dTorso = sdCapsule(p, vec2(0.0, 0.36), vec2(0.0, 0.55), 0.11);
  float dArmL = sdCapsule(p, vec2(-0.105, 0.37), vec2(-0.165 - swing, 0.56), 0.039);
  float dArmR = sdCapsule(p, vec2(0.105, 0.37), vec2(0.165 + swing, 0.56), 0.039);
  float dLegL = sdCapsule(p, vec2(-0.052, 0.58), vec2(-0.062 - stride, 0.85), 0.043);
  float dLegR = sdCapsule(p, vec2(0.052, 0.58), vec2(0.062 + stride, 0.85), 0.043);
  float dBody = min(min(dHead, dTorso), min(min(dArmL, dArmR), min(dLegL, dLegR)));

  // Rainy day miniature illustrated umbrellas carried by ~82% of pedestrians
  float dUmbrella = 1.0;
  bool hasUmbrella = u_rainIntensity > 0.25 && fract(v_seed * 19.3) < 0.82;
  if (hasUmbrella) {
    vec2 uCenter = vec2(0.0, 0.24);
    float dDome = length(vec2(x * 0.82, (y - uCenter.y) * 1.12)) - 0.24;
    float dCut = 0.165 - y; // keep upper arched canopy (y <= 0.165)
    dUmbrella = max(dDome, dCut);
    float dTip = sdCapsule(p, vec2(0.0, 0.025), vec2(0.0, 0.055), 0.016);
    dUmbrella = min(dUmbrella, dTip);
  }

  float dTotal = min(dBody, dUmbrella);

  vec3 ink = vec3(0.09, 0.09, 0.09);
  vec3 pantsCol = (colIdx & 1) == 0 ? vec3(0.16, 0.19, 0.25) : vec3(0.24, 0.22, 0.20);
  vec3 fillCol = pantsCol;
  if (dUmbrella < dBody && dUmbrella <= 0.03) {
    int umbIdx = int(floor(v_seed * 8.0)) & 7;
    fillCol = umbrellaColor(umbIdx);
  } else if (dHead <= dTorso && dHead <= dArmL && dHead <= dArmR) {
    fillCol = y < 0.19 ? vec3(0.14, 0.12, 0.11) : vec3(0.89, 0.77, 0.67);
  } else if (min(dTorso, min(dArmL, dArmR)) < min(dLegL, dLegR)) {
    fillCol = coatColor(colIdx);
  }

  float aa = clamp(fwidth(dTotal) * 1.25, 0.012, 0.036);
  float outlineBand = smoothstep(0.038 + aa, 0.018, dTotal);
  float innerFill = smoothstep(0.008, -aa, dTotal);
  vec3 figureRgb = mix(ink, fillCol, innerFill) * u_skyTintRgb;
  float figAlpha = outlineBand;

  float totalAlpha = clamp(max(shadow * (1.0 - figAlpha * 0.75), figAlpha), 0.0, 1.0) * u_pedAlpha;
  if (totalAlpha < 0.02) discard;

  vec3 outRgb = mix(vec3(0.06, 0.07, 0.09), figureRgb, smoothstep(0.12, 0.62, figAlpha));
  outColor = vec4(outRgb, totalAlpha);
}
`;

export const CLOUD_FRAG = /* glsl */ `#version 300 es
precision highp float;

uniform int u_imageWidth;
uniform int u_imageHeight;
uniform float u_imgPxPerCssPx;
uniform float u_simTimeSec;
uniform float u_cloudCover;
uniform float u_reducedMotion;
uniform vec3 u_cloudShadowRgb;
uniform vec3 u_cloudBaseRgb;
uniform vec3 u_cloudHighlightRgb;

in vec2 v_imgPx;
out vec4 outColor;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * noise2(p);
    p = p * 2.03 + vec2(17.1, 31.7);
    a *= 0.5;
  }
  return s;
}

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

float ovalSdf(vec2 p, vec2 c, vec2 r) {
  return length((p - c) / r) - 1.0;
}

void main() {
  float w = float(u_imageWidth);
  float h = float(u_imageHeight);
  vec2 p = v_imgPx;

  // Signed distance outside [0..W] x [0..H] canvas (positive outside canvas)
  vec2 center = vec2(w * 0.5, h * 0.5);
  vec2 halfDim = vec2(w * 0.5, h * 0.5);
  vec2 q = abs(p - center) - halfDim;
  float edgeOutsidePx = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);

  // Soft 7-oval core clear zone over Yokohama hubs (Yokohama Sta., MM, Shinko, Osanbashi/Yamashita, Kannai/Chinatown, Noge, Harbor)
  float dLand = ovalSdf(p, vec2(12550.0, 3600.0), vec2(2050.0, 1550.0));
  dLand = smin(dLand, ovalSdf(p, vec2(9750.0, 2900.0), vec2(2500.0, 1750.0)), 0.35);
  dLand = smin(dLand, ovalSdf(p, vec2(6350.0, 3200.0), vec2(2400.0, 1700.0)), 0.35);
  dLand = smin(dLand, ovalSdf(p, vec2(4350.0, 4050.0), vec2(2450.0, 1550.0)), 0.35);
  dLand = smin(dLand, ovalSdf(p, vec2(3450.0, 2400.0), vec2(2500.0, 1450.0)), 0.35);
  dLand = smin(dLand, ovalSdf(p, vec2(7600.0, 1450.0), vec2(2250.0, 1150.0)), 0.35);
  dLand = smin(dLand, ovalSdf(p, vec2(7800.0, 4450.0), vec2(3300.0, 1200.0)), 0.35);

  float zoomOut = smoothstep(3.0, 9.5, u_imgPxPerCssPx);

  // Cumulus billow noise anchored in world image pixels
  float cloudT = u_reducedMotion > 0.5 ? 0.0 : u_simTimeSec;
  vec2 drift = vec2(cloudT * 0.0022, cloudT * 0.0008);
  vec2 uvBig = p / 950.0 + drift;
  vec2 warp = vec2(fbm(uvBig + vec2(3.1, 7.4)), fbm(uvBig + vec2(11.3, 2.9)));
  float nCoarse = fbm(uvBig + warp * 0.65);
  float nPuff = fbm(p / 340.0 + drift * 1.4 + warp * 0.45);
  float cumulus = nCoarse * 0.68 + nPuff * 0.32;

  float coverBias = (u_cloudCover - 0.35) * 0.24;
  // Smooth rim feather along strict rectangular border (~230 imgPx inward + full opacity outside)
  float rimCover = smoothstep(-230.0, 110.0, edgeOutsidePx + (cumulus + coverBias * 0.35 - 0.46) * 260.0);

  // Zoom-out cumulus bank over non-landmark outer corners & suburbs
  float suburbCloud = smoothstep(0.06, 0.56, dLand + (cumulus + coverBias * 0.45 - 0.48) * 0.62) * zoomOut;

  float cloudAlpha = clamp(max(rimCover, suburbCloud), 0.0, 1.0);
  if (cloudAlpha < 0.01) discard;

  // Directional soft cumulus shading (brighter top-left ridges, softer creases underneath)
  float nShade = fbm((p + vec2(-90.0, -90.0)) / 360.0 + drift);
  float slope = clamp((cumulus - nShade) * 3.8 + 0.5, 0.0, 1.0);
  vec3 col = mix(u_cloudShadowRgb, u_cloudBaseRgb, smoothstep(0.18, 0.62, cumulus));
  col = mix(col, u_cloudHighlightRgb, smoothstep(0.50, 0.88, slope) * 0.72);

  // Blend smoothly into solid ambient cloud sky far outside canvas so there's zero seam
  float farOutside = smoothstep(40.0, 480.0, edgeOutsidePx);
  col = mix(col, mix(u_cloudBaseRgb, col, 0.42), farOutside);
  cloudAlpha = mix(cloudAlpha, 1.0, farOutside);

  outColor = vec4(col, cloudAlpha);
}
`;

export const RAIN_VERT = /* glsl */ `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_corner; // -1..1

uniform vec2 u_viewportCssSize;
uniform float u_simTimeSec;
uniform float u_rainIntensity;
uniform float u_windSlope;
uniform float u_reducedMotion;

out vec2 v_uv;
out float v_dropAlpha;

float hash1(float n) {
  return fract(sin(n * 127.1 + 31.7) * 43758.5453123);
}

void main() {
  v_uv = a_corner * 0.5 + 0.5;
  if (u_rainIntensity <= 0.05) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    v_dropAlpha = 0.0;
    return;
  }

  float id = float(gl_InstanceID);
  float rx = hash1(id * 1.13 + 1.0);
  float ry = hash1(id * 2.37 + 5.0);
  float rLayer = hash1(id * 3.71 + 9.0);
  float speed = 0.95 + rLayer * 0.85;
  float t = u_reducedMotion > 0.5 ? 0.15 : u_simTimeSec * speed;

  float xNorm = fract(rx - t * u_windSlope * 0.65);
  float yNorm = fract(ry + t);

  vec2 centerPx = vec2(xNorm * u_viewportCssSize.x, yNorm * (u_viewportCssSize.y + 80.0) - 40.0);
  float lenPx = (14.0 + rLayer * 20.0) * (0.65 + u_rainIntensity * 0.45);
  float halfW = 0.72 + rLayer * 0.42;

  vec2 dir = normalize(vec2(-u_windSlope, 1.0));
  vec2 perp = vec2(-dir.y, dir.x);
  vec2 posPx = centerPx + dir * (a_corner.y * lenPx * 0.5) + perp * (a_corner.x * halfW);
  vec2 uvScreen = posPx / max(u_viewportCssSize, vec2(1.0));
  vec2 ndc = vec2(uvScreen.x * 2.0 - 1.0, 1.0 - uvScreen.y * 2.0);

  gl_Position = vec4(ndc, 0.0, 1.0);
  v_dropAlpha = (0.28 + rLayer * 0.36) * u_rainIntensity;
}
`;

export const RAIN_FRAG = /* glsl */ `#version 300 es
precision highp float;

in vec2 v_uv;
in float v_dropAlpha;

out vec4 outColor;

void main() {
  if (v_dropAlpha <= 0.01) discard;
  float across = 1.0 - abs(v_uv.x * 2.0 - 1.0);
  float along = smoothstep(0.0, 0.3, v_uv.y) * smoothstep(1.0, 0.15, v_uv.y);
  float alpha = clamp(across * along * v_dropAlpha, 0.0, 0.68);
  if (alpha < 0.015) discard;
  outColor = vec4(0.82, 0.90, 0.98, alpha);
}
`;

export const COSMO_VERT = /* glsl */ `#version 300 es
precision highp float;

layout(location = 0) in vec2 a_uv; // -1..1 across wheel diameter

uniform vec3 u_centerLocalM;
uniform vec3 u_wheelRightLocal;
uniform float u_radiusM;
uniform vec3 u_cameraOriginLocalM;
uniform vec3 u_camRight;
uniform vec3 u_camUp;
uniform vec3 u_camForward;
uniform vec2 u_imageOriginPx;
uniform float u_metersPerPixel;
uniform vec2 u_viewTopLeftPx;
uniform vec2 u_viewBottomRightPx;
uniform float u_nearM;
uniform float u_farM;

out vec2 v_uv;
out vec2 v_imgPx;
out float v_depthM;

void main() {
  v_uv = a_uv;
  vec3 worldPos =
    u_centerLocalM +
    u_wheelRightLocal * (a_uv.x * u_radiusM) +
    vec3(0.0, 0.0, a_uv.y * u_radiusM);

  vec3 d = worldPos - u_cameraOriginLocalM;
  float cx = dot(d, u_camRight);
  float cy = dot(d, u_camUp);
  float depthM = dot(d, u_camForward);

  float px = u_imageOriginPx.x + cx / u_metersPerPixel;
  float py = u_imageOriginPx.y - cy / u_metersPerPixel;

  vec2 uv = (vec2(px, py) - u_viewTopLeftPx) / (u_viewBottomRightPx - u_viewTopLeftPx);
  vec2 ndc = vec2(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  float ndcZ = clamp(((depthM - u_nearM) / (u_farM - u_nearM)) * 2.0 - 1.0, -0.995, 0.995);

  gl_Position = vec4(ndc, ndcZ, 1.0);
  v_imgPx = vec2(px, py);
  v_depthM = depthM;
}
`;

export const COSMO_FRAG = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2DArray;

uniform sampler2DArray u_depthTiles;
uniform int u_imageWidth;
uniform int u_imageHeight;
uniform int u_dataTileSize;
uniform int u_cols;
uniform int u_rows;
uniform float u_nearM;
uniform float u_farM;
uniform float u_dataScale;
uniform float u_nightIntensity;
uniform float u_xrayMode;
uniform float u_simTimeSec;
uniform float u_wheelAngleRad;
uniform float u_showMode;
uniform ivec4 u_clockDigits;
uniform float u_colonOn;

in vec2 v_uv;
in vec2 v_imgPx;
in float v_depthM;

out vec4 outColor;

float cSegDist(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-5), 0.0, 1.0);
  return length(pa - ba * h);
}

int sevenSegMask(int d) {
  if (d == 0) return 63;
  if (d == 1) return 6;
  if (d == 2) return 91;
  if (d == 3) return 79;
  if (d == 4) return 102;
  if (d == 5) return 109;
  if (d == 6) return 125;
  if (d == 7) return 7;
  if (d == 8) return 127;
  return 111;
}

float sampleDigit7(vec2 p, int digit) {
  int mask = sevenSegMask(digit);
  float d = 1.0;
  float hw = 0.017;
  float hh = 0.028;
  if ((mask & 1) != 0) d = min(d, cSegDist(p, vec2(-hw, hh), vec2(hw, hh)));
  if ((mask & 2) != 0) d = min(d, cSegDist(p, vec2(hw, hh), vec2(hw, 0.0)));
  if ((mask & 4) != 0) d = min(d, cSegDist(p, vec2(hw, 0.0), vec2(hw, -hh)));
  if ((mask & 8) != 0) d = min(d, cSegDist(p, vec2(-hw, -hh), vec2(hw, -hh)));
  if ((mask & 16) != 0) d = min(d, cSegDist(p, vec2(-hw, 0.0), vec2(-hw, -hh)));
  if ((mask & 32) != 0) d = min(d, cSegDist(p, vec2(-hw, hh), vec2(-hw, 0.0)));
  if ((mask & 64) != 0) d = min(d, cSegDist(p, vec2(-hw, 0.0), vec2(hw, 0.0)));
  return smoothstep(0.0085, 0.0025, d);
}

vec3 cosmoPalette(float theta, float r, float t, float mode) {
  if (mode < 0.5) {
    // 0: Emerald & Bay Cyan sweep
    float wave = 0.5 + 0.5 * sin(theta * 2.0 - t * 1.8);
    return mix(vec3(0.08, 0.92, 0.68), vec3(0.20, 0.72, 1.0), wave);
  }
  if (mode < 1.5) {
    // 1: Rainbow Pinwheel
    float h = theta / 6.283185 + t * 0.14;
    return 0.55 + 0.45 * cos(6.283185 * (h + vec3(0.0, 0.33, 0.67)));
  }
  if (mode < 2.5) {
    // 2: Harbor Fireworks burst
    float pulse = pow(0.5 + 0.5 * sin(r * 16.0 - t * 3.8), 2.0);
    vec3 warm = mix(vec3(1.0, 0.42, 0.32), vec3(1.0, 0.90, 0.36), pulse);
    return mix(vec3(0.18, 0.78, 0.98), warm, smoothstep(0.32, 0.92, r));
  }
  // 3: Minato Mirai Sakura & Azure Wave
  float sWave = 0.5 + 0.5 * sin(theta * 3.0 + r * 8.0 - t * 2.2);
  return mix(vec3(0.98, 0.48, 0.74), vec3(0.24, 0.88, 0.88), sWave);
}

void main() {
  if (
    v_imgPx.x < 0.0 ||
    v_imgPx.y < 0.0 ||
    v_imgPx.x >= float(u_imageWidth) ||
    v_imgPx.y >= float(u_imageHeight)
  ) {
    discard;
  }

  ivec2 dataDim = ivec2(int(floor(float(u_imageWidth) * u_dataScale)), int(floor(float(u_imageHeight) * u_dataScale)));
  ivec2 g = clamp(ivec2(floor(v_imgPx * u_dataScale)), ivec2(0), dataDim - ivec2(1));
  int col = min(u_cols - 1, g.x / u_dataTileSize);
  int row = min(u_rows - 1, g.y / u_dataTileSize);
  ivec2 local = ivec2(g.x - col * u_dataTileSize, g.y - row * u_dataTileSize);
  vec4 depthTex = texelFetch(u_depthTiles, ivec3(local, row * u_cols + col), 0);

  float q16 = floor(depthTex.r * 255.0 + 0.5) * 256.0 + floor(depthTex.g * 255.0 + 0.5);
  float sceneDepthM = u_nearM + (q16 / 65535.0) * (u_farM - u_nearM);
  // Generous 38m bias ensures foreground towers occlude Cosmo Clock without colliding with its own footprint behind
  if (u_xrayMode < 0.5 && v_depthM > sceneDepthM + 38.0) {
    discard;
  }

  vec2 p = v_uv;
  float r = length(p);
  if (r > 1.06) discard;

  float theta = atan(p.y, p.x);
  float rotTheta = theta - u_wheelAngleRad;
  vec3 ledCol = cosmoPalette(theta, r, u_simTimeSec, u_showMode);

  // Support A-frame legs (visible in lower half)
  float dLegL = cSegDist(p, vec2(-0.08, 0.02), vec2(-0.50, -0.96), 0.022);
  float dLegR = cSegDist(p, vec2(0.08, 0.02), vec2(0.50, -0.96), 0.022);
  float legMask = smoothstep(0.015, 0.0, min(dLegL, dLegR) - 0.016);

  // Outer & inner wheel truss rings + 24 radial spokes + 24 gondolas
  float outerRing = smoothstep(0.026, 0.010, abs(r - 0.90));
  float innerRing = smoothstep(0.020, 0.008, abs(r - 0.80));
  float hubRim = smoothstep(0.018, 0.006, abs(r - 0.25));
  float spokeAng = fract((rotTheta / 6.2831853) * 24.0);
  float spokeDist = abs(spokeAng - 0.5) * (6.2831853 / 24.0) * max(r, 0.15);
  float spokes = smoothstep(0.013, 0.004, spokeDist) * step(0.24, r) * step(r, 0.91);

  // Gondola pods hanging around the 0.94 rim radius
  float gongCell = floor((rotTheta / 6.2831853) * 24.0 + 0.5);
  float gongAng = gongCell * (6.2831853 / 24.0) + u_wheelAngleRad;
  vec2 gongCenter = vec2(cos(gongAng), sin(gongAng)) * 0.955;
  float gondolas = smoothstep(0.032, 0.016, length((p - gongCenter) * vec2(1.15, 0.95)));

  // Hub clock casing (r <= 0.24) + live 7-segment JST digits (HH:MM)
  float hubMask = smoothstep(0.245, 0.232, r);
  float digitsMask = 0.0;
  if (r < 0.24) {
    digitsMask = max(digitsMask, sampleDigit7(p - vec2(-0.115, 0.0), u_clockDigits.x));
    digitsMask = max(digitsMask, sampleDigit7(p - vec2(-0.048, 0.0), u_clockDigits.y));
    digitsMask = max(digitsMask, sampleDigit7(p - vec2(0.048, 0.0), u_clockDigits.z));
    digitsMask = max(digitsMask, sampleDigit7(p - vec2(0.115, 0.0), u_clockDigits.w));
    if (u_colonOn > 0.5) {
      float dotTop = smoothstep(0.011, 0.004, length(p - vec2(0.0, 0.018)));
      float dotBot = smoothstep(0.011, 0.004, length(p - vec2(0.0, -0.018)));
      digitsMask = max(digitsMask, max(dotTop, dotBot));
    }
  }

  // Combine daytime steel architecture & nighttime vivid Cosmo Clock LED show
  float structAlpha = clamp(max(max(outerRing, innerRing), max(spokes, max(gondolas, legMask))), 0.0, 1.0);
  vec3 dayStructRgb = mix(vec3(0.76, 0.80, 0.84), vec3(0.14, 0.18, 0.22), 0.25 * (1.0 - max(outerRing, legMask)));
  vec3 hubDayBg = vec3(0.08, 0.26, 0.30);
  vec3 digitRgb = mix(vec3(0.78, 0.98, 0.88), vec3(0.45, 1.0, 0.82), u_nightIntensity);

  float haloGlow = u_nightIntensity * exp(-abs(r - 0.88) * 18.0) * 0.42;
  float ledActive = clamp(max(max(outerRing, innerRing), max(spokes * 0.9, max(gondolas, hubRim))), 0.0, 1.0);

  vec3 nightWheelRgb = mix(dayStructRgb * 0.45, ledCol * 1.25, ledActive);
  vec3 wheelRgb = mix(dayStructRgb, nightWheelRgb, u_nightIntensity);
  float wheelAlpha = clamp(max(structAlpha * mix(0.68, 0.96, u_nightIntensity), haloGlow), 0.0, 0.98);

  if (hubMask > 0.05) {
    vec3 hubBg = mix(hubDayBg, vec3(0.03, 0.07, 0.11), u_nightIntensity);
    vec3 hubRgb = mix(hubBg, digitRgb, digitsMask);
    wheelRgb = mix(wheelRgb, hubRgb, hubMask);
    wheelAlpha = max(wheelAlpha, hubMask * mix(0.92, 0.98, u_nightIntensity));
  }

  if (wheelAlpha < 0.02) discard;
  outColor = vec4(wheelRgb, wheelAlpha);
}
`;
