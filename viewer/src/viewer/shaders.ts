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

in vec2 v_imgPx;
out vec4 outColor;

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

  vec4 colOut = vec4(0.0);

  // Soft horizon glow during golden hour & dusk
  if (u_glowTint.a > 0.005) {
    float waterBoost = surfaceKind == 1 ? 1.15 : 0.85;
    colOut = vec4(u_glowTint.rgb, clamp(u_glowTint.a * waterBoost, 0.0, 0.28));
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
        colOut = vec4(mix(colOut.rgb, lamp.rgb, lamp.a), max(colOut.a, lamp.a));
      }
    }
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

out vec2 v_uv;
out vec2 v_imgPx;
out float v_depthM;
out float v_style;

void main() {
  v_uv = a_corner * 0.5 + 0.5;
  v_imgPx = a_pedData.xy;
  v_depthM = a_pedData.z;
  v_style = a_pedData.w;

  vec2 viewSpan = max(u_viewBottomRightPx - u_viewTopLeftPx, vec2(1.0));
  vec2 halfSizeImg = vec2(2.6, 3.8);
  vec2 imgPos = a_pedData.xy + vec2(a_corner.x * halfSizeImg.x, (a_corner.y - 0.72) * halfSizeImg.y);
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

in vec2 v_uv;
in vec2 v_imgPx;
in float v_depthM;
in float v_style;

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

  // Normalized coordinates: x in -0.5..0.5, y in 0..1 (0=top of head, 1=feet)
  float x = v_uv.x - 0.5;
  float y = v_uv.y;
  vec2 p = vec2(x, y);

  // Soft 45-degree cast shadow onto sidewalk
  vec2 sh = vec2((x - 0.11) * 1.4, (y - 0.86) * 4.4);
  float shadow = exp(-dot(sh, sh) * 6.5) * 0.44;

  float stride = poseIdx == 1 ? 0.075 : (poseIdx == 2 ? -0.075 : (poseIdx == 3 ? 0.045 : 0.015));
  float swing = poseIdx == 1 ? 0.045 : (poseIdx == 2 ? -0.045 : 0.01);

  float dHead = length(vec2(x * 1.15, (y - 0.19) * 1.05)) - 0.105;
  float dTorso = sdCapsule(p, vec2(0.0, 0.35), vec2(0.0, 0.54), 0.115);
  float dArmL = sdCapsule(p, vec2(-0.105, 0.36), vec2(-0.165 - swing, 0.56), 0.040);
  float dArmR = sdCapsule(p, vec2(0.105, 0.36), vec2(0.165 + swing, 0.56), 0.040);
  float dLegL = sdCapsule(p, vec2(-0.052, 0.58), vec2(-0.062 - stride, 0.85), 0.044);
  float dLegR = sdCapsule(p, vec2(0.052, 0.58), vec2(0.062 + stride, 0.85), 0.044);
  float dBody = min(min(dHead, dTorso), min(min(dArmL, dArmR), min(dLegL, dLegR)));

  vec3 ink = vec3(0.09, 0.09, 0.09);
  vec3 pantsCol = (colIdx & 1) == 0 ? vec3(0.16, 0.19, 0.25) : vec3(0.24, 0.22, 0.20);
  vec3 fillCol = pantsCol;
  if (dHead <= dTorso && dHead <= dArmL && dHead <= dArmR) {
    fillCol = y < 0.17 ? vec3(0.14, 0.12, 0.11) : vec3(0.89, 0.77, 0.67);
  } else if (min(dTorso, min(dArmL, dArmR)) < min(dLegL, dLegR)) {
    fillCol = coatColor(colIdx);
  }

  float aa = clamp(fwidth(dBody) * 1.25, 0.012, 0.036);
  float outlineBand = smoothstep(0.038 + aa, 0.018, dBody);
  float innerFill = smoothstep(0.008, -aa, dBody);
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
  vec2 drift = vec2(u_simTimeSec * 0.0022, u_simTimeSec * 0.0008);
  vec2 uvBig = p / 950.0 + drift;
  vec2 warp = vec2(fbm(uvBig + vec2(3.1, 7.4)), fbm(uvBig + vec2(11.3, 2.9)));
  float nCoarse = fbm(uvBig + warp * 0.65);
  float nPuff = fbm(p / 340.0 + drift * 1.4 + warp * 0.45);
  float cumulus = nCoarse * 0.68 + nPuff * 0.32;

  // Smooth rim feather along strict rectangular border (~230 imgPx inward + full opacity outside)
  float rimCover = smoothstep(-230.0, 110.0, edgeOutsidePx + (cumulus - 0.46) * 260.0);

  // Zoom-out cumulus bank over non-landmark outer corners & suburbs
  float suburbCloud = smoothstep(0.06, 0.56, dLand + (cumulus - 0.48) * 0.62) * zoomOut;

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
