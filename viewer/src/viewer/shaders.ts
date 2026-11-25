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

  // City lights after dark: warm architectural windows + streetlamp pools along decks & roads
  if (u_nightIntensity > 0.02) {
    if (surfaceKind == 4 || surfaceKind == 5) {
      float wx = mod(floor(v_imgPx.x * 0.28), 5.0);
      float wy = mod(floor(v_imgPx.y * 0.28), 4.0);
      float seed = fract(sin(dot(floor(v_imgPx * 0.28), vec2(12.9898, 78.233))) * 43758.5453);
      if (wx < 1.4 && wy < 1.2 && seed > 0.44) {
        vec3 warmGlow = surfaceKind == 5 ? vec3(1.0, 0.88, 0.62) : vec3(1.0, 0.80, 0.44);
        vec4 lightCol = vec4(warmGlow, 0.66 * u_nightIntensity);
        colOut = mix(colOut, lightCol, 0.82);
      }
    } else if (surfaceKind == 3 || surfaceKind == 7) {
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

out vec2 v_imgPx;
out float v_depthM;
out vec3 v_color;

void main() {
  float s = sin(u_headingRad);
  float c = cos(u_headingRad);

  vec3 scaledPos = a_posLocalM * u_meshScale;

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
  float ndcZ = ((depthM - u_nearM) / (u_farM - u_nearM)) * 2.0 - 1.0;

  gl_Position = vec4(ndc, ndcZ, 1.0);
  v_imgPx = vec2(px, py);
  v_depthM = depthM;

  vec3 sunDir = normalize(vec3(-0.55, -0.35, 0.76));
  float diff = 0.62 + 0.38 * max(0.0, dot(normalize(nWorld), sunDir));
  v_color = a_color * diff * u_tint;
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
    if (u_isSelected > 0.5) {
      outColor = vec4(v_color, 0.28 * u_alpha);
      return;
    }
    discard;
  }

  outColor = vec4(v_color, u_alpha);
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
