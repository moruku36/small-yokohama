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

uniform vec4 u_sunTint; // rgb + alpha
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

  ivec2 g = clamp(ivec2(floor(v_imgPx)), ivec2(0), ivec2(u_imageWidth - 1, u_imageHeight - 1));
  int col = min(u_cols - 1, g.x / u_dataTileSize);
  int row = min(u_rows - 1, g.y / u_dataTileSize);
  ivec2 local = ivec2(g.x - col * u_dataTileSize, g.y - row * u_dataTileSize);
  vec4 depthTex = texelFetch(u_depthTiles, ivec3(local, row * u_cols + col), 0);

  float q16 = floor(depthTex.r * 255.0 + 0.5) * 256.0 + floor(depthTex.g * 255.0 + 0.5);
  float depthM = u_nearM + (q16 / 65535.0) * (u_farM - u_nearM);
  int surfaceKind = int(floor(depthTex.b * 255.0 + 0.5));

  vec4 colOut = vec4(0.0);

  // Subtle Yokohama sun lighting tint + warm evening/night window glow on buildings & bridges
  if (u_sunTint.a > 0.001) {
    float waterBoost = surfaceKind == 1 ? 1.15 : 0.85;
    colOut = vec4(u_sunTint.rgb, clamp(u_sunTint.a * waterBoost, 0.0, 0.65));
    if (u_sunTint.a > 0.16 && u_sunTint.b > u_sunTint.r && (surfaceKind == 4 || surfaceKind == 5)) {
      float wx = mod(floor(v_imgPx.x * 0.25), 5.0);
      float wy = mod(floor(v_imgPx.y * 0.25), 4.0);
      float seed = fract(sin(dot(floor(v_imgPx * 0.25), vec2(12.9898, 78.233))) * 43758.5453);
      if (wx < 1.5 && wy < 1.2 && seed > 0.42) {
        vec3 warmGlow = surfaceKind == 5 ? vec3(1.0, 0.88, 0.62) : vec3(1.0, 0.82, 0.46);
        colOut = mix(colOut, vec4(warmGlow, 0.55), 0.72);
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
    bool inVertOverlap = g.x >= stride && g.x < u_workingTileSize;
    bool inHorizOverlap = g.y >= stride && g.y < u_workingTileSize;
    if (inVertOverlap || inHorizOverlap) {
      colOut = mix(colOut, vec4(0.95, 0.55, 0.15, 0.24), 0.75);
    }
    if (
      abs(g.x - stride) <= 1 ||
      abs(g.x - u_workingTileSize) <= 1 ||
      abs(g.y - stride) <= 1 ||
      abs(g.y - u_workingTileSize) <= 1
    ) {
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

  // Rotate vehicle local (right, forward, up) to EPSG:6677 local (east, north, up)
  vec3 worldOffset = vec3(
    a_posLocalM.x * c + a_posLocalM.y * s,
    -a_posLocalM.x * s + a_posLocalM.y * c,
    a_posLocalM.z
  );
  vec3 worldPos = u_vehicleOriginLocalM + worldOffset;

  vec3 nWorld = vec3(
    a_normalLocal.x * c + a_normalLocal.y * s,
    -a_normalLocal.x * s + a_normalLocal.y * c,
    a_normalLocal.z
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
uniform float u_depthBiasM;
uniform float u_xrayMode;
uniform float u_isSelected;

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

  ivec2 g = clamp(ivec2(floor(v_imgPx)), ivec2(0), ivec2(u_imageWidth - 1, u_imageHeight - 1));
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
      outColor = vec4(0.28, 0.85, 1.0, 0.48);
      return;
    }
    if (u_isSelected > 0.5) {
      outColor = vec4(v_color, 0.28);
      return;
    }
    discard;
  }

  outColor = vec4(v_color, 1.0);
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
uniform float u_checkDepth;
uniform vec4 u_fillColor;
uniform vec4 u_ringColor;

in vec2 v_localCoord;
out vec4 outColor;

void main() {
  float dist = length(v_localCoord);
  if (dist > 1.0) discard;

  if (u_checkDepth > 0.5) {
    ivec2 g = clamp(ivec2(floor(u_anchorImgPx)), ivec2(0), ivec2(u_imageWidth - 1, u_imageHeight - 1));
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
