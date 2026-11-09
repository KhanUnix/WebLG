precision highp float;

varying vec2 vUv;
uniform sampler2D tMap;
uniform vec2 uResolution;
uniform float uTime;
uniform vec2 uLightDirection;

#define MAX_LENSES 16
uniform int uLensCount;
uniform vec4 uLensRects[MAX_LENSES];
uniform vec4 uLensParams0[MAX_LENSES]; // smoothness, edgeSpread, frosted, pinch
uniform vec4 uLensParams1[MAX_LENSES]; // chroma, turbulence, liquidity, reserved

const float TAU = 6.28318530718;

// Dithered 32-sample golden-spiral blur. Each sample rotates by a constant
// angle; only the initial per-pixel orientation requires trigonometry.
vec4 frostedBlur(sampler2D tex, vec2 uv, float blurAmount) {
#ifdef WEBLG_CLEAR_ONLY
    return texture2D(tex, uv);
#else
    if (blurAmount <= 0.01) return texture2D(tex, uv);

    vec4 color = vec4(0.0);
    float total = 0.0;
    vec2 radius = vec2(blurAmount * 5.0) / uResolution;
    float noise = fract(sin(dot(uv, vec2(12.9898, 78.233))) * 43758.5453);
    float angle = noise * TAU;
    vec2 direction = vec2(cos(angle), sin(angle));
    const mat2 golden = mat2(-0.737368857997, 0.675490316183, -0.675490316183, -0.737368857997);

    for (float i = 0.0; i < 32.0; i++) {
        float r = (i + 1.0) / 32.0;
        float weight = exp(-r * r * 2.0);
        color += texture2D(tex, uv + direction * r * radius) * weight;
        total += weight;
        direction = golden * direction;
    }

    return color / total;
#endif
}

// Simplex noise
vec3 permute(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }

float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                        -0.577350269189626, 0.024390243902439);
    vec2 i  = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod(i, 289.0);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0))
                             + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy),
                             dot(x12.zw, x12.zw)), 0.0);
    m = m * m;
    m = m * m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
    vec3 g;
    g.x  = a0.x  * x0.x  + h.x  * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
}

float pNorm4(vec2 v) {
    vec2 v2 = v * v;
    return sqrt(sqrt(v2.x * v2.x + v2.y * v2.y));
}

float sdLensShape(vec2 p, vec2 b, float r, float roundBlend) {
    vec2 q = abs(p) - b + r;
    vec2 outside = max(q, 0.0);
    float cornerDist = mix(pNorm4(outside), length(outside), roundBlend);
    return min(max(q.x, q.y), 0.0) + cornerDist - r;
}

vec2 lensNormal(vec2 p, vec2 b, float r, float roundBlend) {
    // Numerical SDF gradient gives a stable edge direction across flat sides and curved corners.
    float eps = 0.75;
    float dx = sdLensShape(p + vec2(eps, 0.0), b, r, roundBlend)
             - sdLensShape(p - vec2(eps, 0.0), b, r, roundBlend);
    float dy = sdLensShape(p + vec2(0.0, eps), b, r, roundBlend)
             - sdLensShape(p - vec2(0.0, eps), b, r, roundBlend);
    vec2 g = vec2(dx, dy);
    float gl = length(g);
    if (gl < 1e-4) return vec2(0.0, 1.0);
    return g / gl;
}

vec4 shadeLens(vec2 uv, vec2 pixelCoord, vec2 local, vec2 halfSize,
               float corner, float roundness, float d, vec4 params0, vec4 params1) {
    float edgeSpread = params0.y;
    float frosted    = params0.z;
    float pinch      = params0.w;
    float chroma     = params1.x;
    float turbulence = params1.y;
    float liquidity  = params1.z;



    // Centre: frosted blur only
    if (d > edgeSpread
#ifndef WEBLG_CLEAR_ONLY
        || pinch == 0.0 || edgeSpread == 0.0
#endif
    ) {
        return frostedBlur(tMap, uv, frosted);
    }

    // Edge: pinch compression + chroma + turbulence
    float t           = d / max(edgeSpread, 1.0);
    float compression = pow(1.0 - t, 2.0);

    vec2 dir = lensNormal(local, halfSize, corner, roundness);

    if (turbulence > 0.0) {
        float timeOff = uTime * liquidity;
        vec2  noiseUV = pixelCoord / uResolution.y;
        dir += vec2(
            snoise(noiseUV * turbulence + timeOff),
            snoise(noiseUV * turbulence + timeOff + 100.0)
        ) * 0.1;
    }
    float dirLen = length(dir);
    dir = (dirLen > 1e-4) ? (dir / dirLen) : vec2(0.0, 1.0);

    float dispPx = compression * edgeSpread * pinch;

    vec2 dispR = (-dir * dispPx * (1.0 - chroma * 0.1)) / uResolution;
    vec2 dispG = (-dir * dispPx)                         / uResolution;
    vec2 dispB = (-dir * dispPx * (1.0 + chroma * 0.1)) / uResolution;

#ifndef WEBLG_CLEAR_ONLY
    // Keep clear glass in mixed scenes out of the blur function altogether.
    if (frosted <= 0.01) {
        vec4 colR = texture2D(tMap, uv + dispR);
        vec4 colG = texture2D(tMap, uv + dispG);
        vec4 colB = texture2D(tMap, uv + dispB);
        return vec4(colR.r, colG.g, colB.b, (colR.a + colG.a + colB.a) / 3.0);
    }

    // All three channels sample the same image when dispersion is disabled.
    if (chroma == 0.0) {
        return frostedBlur(tMap, uv + dispG, frosted);
    }
#endif

    vec4 colR = frostedBlur(tMap, uv + dispR, frosted);
    vec4 colG = frostedBlur(tMap, uv + dispG, frosted);
    vec4 colB = frostedBlur(tMap, uv + dispB, frosted);

    float finalAlpha = (colR.a + colG.a + colB.a) / 3.0;
    vec3  finalRGB   = vec3(colR.r, colG.g, colB.b);

    return vec4(finalRGB, finalAlpha);
}

void main() {
    vec2 uv = vUv;
    vec2 pixelCoord = uv * uResolution;

    float minDist = 99999.0;
    vec4  activeP0   = vec4(10.0, 30.0, 4.0, 12.0);
    vec4  activeP1   = vec4(1.0, 0.0, 0.0, 0.0);
    vec2  activeCenter   = vec2(0.0);
    vec2  activeHalfSize = vec2(0.0);
    float activeCorner   = 0.0;
    float activeRound    = 1.0;

    for (int i = 0; i < MAX_LENSES; i++) {
        if (i >= uLensCount) break;

        vec4 rect = uLensRects[i];
        if (rect.z < 1.0) continue;

        float smoothness = uLensParams0[i].x;
        vec2  halfSize   = rect.zw * 0.5;
        float roundBlend = smoothstep(8.0, 20.0, smoothness);

        float cr = smoothness * smoothness * min(rect.z, rect.w) * 0.01;
        cr = clamp(cr, 0.0, min(halfSize.x, halfSize.y));

        if (smoothness < 0.0) {
            cr = clamp(-smoothness - 1.0, 0.0, min(halfSize.x, halfSize.y));
            roundBlend = 1.0;
        }
        // Preserve legacy auto-circles unless an explicit radius was supplied.
        else if (abs(rect.z - rect.w) < 5.0) {
            cr = min(halfSize.x, halfSize.y);
            roundBlend = 1.0;
        }

        vec2  center = rect.xy + halfSize;
        vec2  p      = pixelCoord - center;
        float dist   = sdLensShape(p, halfSize, cr, roundBlend);

        if (dist < minDist) {
            minDist  = dist;
            activeP0 = uLensParams0[i];
            activeP1 = uLensParams1[i];
            activeCenter = center;
            activeHalfSize = halfSize;
            activeCorner = cr;
            activeRound = roundBlend;
        }
    }

    // Outside all lenses: passthrough background
    if (minDist >
#ifdef WEBLG_EDGE_AA
        0.75
#else
        0.0
#endif
    ) {
        gl_FragColor = texture2D(tMap, uv);
        return;
    }

#ifdef WEBLG_EDGE_AA
    float d = max(0.0, -minDist);
#else
    float d = abs(minDist);
#endif
    vec2 local = pixelCoord - activeCenter;
    vec4 colour = shadeLens(uv, pixelCoord, local, activeHalfSize, activeCorner,
                           activeRound, d, activeP0, activeP1);
    float rimWidth = floor(activeP1.w / 256.0) / 8.0;
    float rimStrength = mod(activeP1.w, 256.0) / 255.0;
    if (rimStrength > 0.0 && d < rimWidth) {
        vec2 normal = lensNormal(local, activeHalfSize, activeCorner, activeRound);
        float facing = dot(normal, uLightDirection);
        float light = max(facing, 0.0) + 0.55 * max(-facing, 0.0);
        float band = pow(max(0.0, 1.0 - d / max(rimWidth, 0.125)), 1.2);
        float shine = rimStrength * band * (0.18 + 0.82 * pow(light, 1.4));
        colour.rgb = mix(colour.rgb, vec3(1.0), shine);
    }
#ifdef WEBLG_EDGE_AA
    // Analytic subpixel coverage of the signed-distance contour. No MSAA,
    // extra framebuffer or derivative extension is required (WebGL 1 and 2).
    if (minDist > -0.75) {
        float coverage = 1.0 - smoothstep(-0.75, 0.75, minDist);
        colour = mix(texture2D(tMap, uv), colour, coverage);
    }
#endif
    gl_FragColor = colour;
}
