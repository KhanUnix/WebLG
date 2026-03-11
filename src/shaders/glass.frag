precision highp float;

varying vec2 vUv;
uniform sampler2D tMap;
uniform vec2 uResolution;
uniform float uTime;

#define MAX_LENSES 16
uniform int uLensCount;
uniform vec4 uLensRects[MAX_LENSES];
uniform vec4 uLensParams0[MAX_LENSES]; // smoothness, edgeSpread, frosted, pinch
uniform vec4 uLensParams1[MAX_LENSES]; // chroma, turbulence, liquidity, reserved

const float TAU = 6.28318530718;

// Golden-spiral frosted blur (32 samples, dithered)
vec4 frostedBlur(sampler2D tex, vec2 uv, float blurAmount) {
    if (blurAmount <= 0.01) return texture2D(tex, uv);

    vec4 color = vec4(0.0);
    float total = 0.0;
    vec2 radius = vec2(blurAmount * 5.0) / uResolution;
    float noise = fract(sin(dot(uv, vec2(12.9898, 78.233))) * 43758.5453);

    for (float i = 0.0; i < 32.0; i++) {
        float r = (i + 1.0) / 32.0;
        float theta = i * 2.3999632 + (noise * TAU);
        vec2 offset = vec2(cos(theta), sin(theta)) * r * radius;
        float weight = exp(-r * r * 2.0);
        color += texture2D(tex, uv + offset) * weight;
        total += weight;
    }

    return color / total;
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

        // Auto-circle when roughly square
        if (abs(rect.z - rect.w) < 5.0) {
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
    if (minDist > 0.0) {
        gl_FragColor = texture2D(tMap, uv);
        return;
    }

    float edgeSpread = activeP0.y;
    float frosted    = activeP0.z;
    float pinch      = activeP0.w;
    float chroma     = activeP1.x;
    float turbulence = activeP1.y;
    float liquidity  = activeP1.z;

    float d = abs(minDist);

    // Centre: frosted blur only
    if (d > edgeSpread) {
        gl_FragColor = frostedBlur(tMap, uv, frosted);
        return;
    }

    // Edge: pinch compression + chroma + turbulence
    float t           = d / max(edgeSpread, 1.0);
    float compression = pow(1.0 - t, 2.0);

    vec2 dir = lensNormal(pixelCoord - activeCenter, activeHalfSize, activeCorner, activeRound);

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

    vec4 colR = frostedBlur(tMap, uv + dispR, frosted);
    vec4 colG = frostedBlur(tMap, uv + dispG, frosted);
    vec4 colB = frostedBlur(tMap, uv + dispB, frosted);

    float finalAlpha = (colR.a + colG.a + colB.a) / 3.0;
    vec3  finalRGB   = vec3(colR.r, colG.g, colB.b);

    gl_FragColor = vec4(finalRGB, finalAlpha);
}
