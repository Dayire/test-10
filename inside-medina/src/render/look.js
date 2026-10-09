import * as THREE from 'three';

// Art direction constants, measured from the reference render:
// deep teal-blue plaster in shade, warm brown shadows, lavender sky,
// golden back-light spilling through arches, hazy peach aerial perspective.
// LOOK is the golden-hour preset in its original shape (dev views read it);
// PRESETS holds every time of day the LookDirector can apply or blend.
export const LOOK = {
  sunDir: new THREE.Vector3(0.6, 0.72, -0.34).normalize(),
  sunColor: '#ffcf96',
  sunIntensity: 7.0,
  hemiSky: '#9fb0cf',
  hemiGround: '#8a6546',
  hemiIntensity: 0.95,
  zenith: '#5d7cb4',
  horizon: '#dcc8bb',
  groundCol: '#5e4a3a',
  cloudLit: '#fff1e2',
  cloudShade: '#9ea4bf',
  skyExposure: 1.15,
  fogColor: '#b9a594',
  fogSunColor: '#f7c58c',
  fogDensity: 0.022,
  fogFalloff: 0.075,
  fogStart: 6,
  envIntensity: 0.55,
  post: {
    exposure: 1.05,
    bloom: 0.28,
    bloomThreshold: 1.6,
    vignette: 0.5,
    grain: 0.018,
    saturation: 1.02,
    contrast: 0.14,
    shadowTint: [0.92, 0.95, 1.06],
    highlightTint: [1.04, 1.0, 0.92],
    lift: [0.018, 0.014, 0.016],
  },
};

// Preset schema (every field is blendable; colours are sRGB hex, vectors arrays).
const GOLDEN = {
  sunDir: [0.6, 0.72, -0.34], sunColor: '#ffcf96', sunIntensity: 7.0, sunDisk: 1,
  hemiSky: '#9fb0cf', hemiGround: '#8a6546', hemiIntensity: 0.95,
  zenith: '#5d7cb4', horizon: '#dcc8bb', groundCol: '#5e4a3a', cloudLit: '#fff1e2', cloudShade: '#9ea4bf', skyExposure: 1.15,
  night: 0, stars: 0, moon: 0, moonDir: [-0.12, 0.86, -0.5], moonColor: '#dfe6ff', moonSize: 1,
  fogColor: '#b9a594', fogSunColor: '#f7c58c', fogDensity: 0.022, fogFalloff: 0.075, fogStart: 6, wind: 1,
  exposure: 1.05, bloom: 0.28, bloomThreshold: 1.6, vignette: 0.5, grain: 0.018, saturation: 1.02, contrast: 0.14,
  shadowTint: [0.92, 0.95, 1.06], highlightTint: [1.04, 1.0, 0.92], lift: [0.018, 0.014, 0.016],
  rays: 0.35, rayColor: [1.0, 0.78, 0.52],
  lanternPool: 1, lanternGlow: 1, glassGlow: 1, poolColor: '#ffa550',
  envIntensity: 0.55,
  shadowBias: -0.00025, shadowNormalBias: 0.035,
};

const preset = (o) => ({ ...GOLDEN, ...o });

export const PRESETS = {
  goldenHour: GOLDEN,
  sunset: preset({
    sunDir: [0.8, 0.21, -0.56], sunColor: '#ff9a52', sunIntensity: 5.5,
    hemiSky: '#8a8fb8', hemiGround: '#6a4030', hemiIntensity: 0.8,
    zenith: '#4d5f96', horizon: '#f0a477', groundCol: '#4a3428', cloudLit: '#ffd0a8', cloudShade: '#8a7896', skyExposure: 1.12,
    fogColor: '#b48a7a', fogSunColor: '#ff9e62', fogDensity: 0.026,
    exposure: 1.08, bloom: 0.32, bloomThreshold: 1.4, contrast: 0.16, saturation: 1.06,
    rays: 0.5, rayColor: [1.0, 0.66, 0.4], envIntensity: 0.5,
    shadowBias: -0.0004, shadowNormalBias: 0.05,
  }),
  dusk: preset({
    sunDir: [0.82, 0.0, -0.57], sunColor: '#ff6a3a', sunIntensity: 0.4, sunDisk: 0.6,
    hemiSky: '#5a6a9a', hemiGround: '#3a2c30', hemiIntensity: 0.6,
    zenith: '#2a3360', horizon: '#c4705a', groundCol: '#2a2026', cloudLit: '#e8907a', cloudShade: '#4a4466', skyExposure: 1.05,
    night: 0.4, stars: 0.3,
    fogColor: '#6b5466', fogSunColor: '#c4705a', fogDensity: 0.03,
    exposure: 1.2, bloom: 0.38, bloomThreshold: 1.0, contrast: 0.15, saturation: 0.95,
    rays: 0, rayColor: [1.0, 0.6, 0.45], lift: [0.016, 0.014, 0.022],
    lanternPool: 1.8, lanternGlow: 1.6, glassGlow: 1.4, envIntensity: 0.35,
    shadowBias: -0.0004, shadowNormalBias: 0.05,
  }),
  night: preset({
    sunDir: [-0.12, 0.86, -0.5], sunColor: '#9fb4ff', sunIntensity: 0.9, sunDisk: 0.15,
    hemiSky: '#23304f', hemiGround: '#1a1612', hemiIntensity: 0.35,
    zenith: '#070b1a', horizon: '#1c2540', groundCol: '#0a0a10', cloudLit: '#4a5878', cloudShade: '#141a2a', skyExposure: 1.0,
    night: 1, stars: 1, moon: 1,
    fogColor: '#1a2236', fogSunColor: '#4a5a8a', fogDensity: 0.03,
    exposure: 1.35, bloom: 0.45, bloomThreshold: 0.9, contrast: 0.18, saturation: 0.85, grain: 0.024,
    shadowTint: [0.9, 0.96, 1.1], highlightTint: [1.0, 1.0, 1.02], lift: [0.012, 0.014, 0.024],
    rays: 0, rayColor: [0.62, 0.72, 1.0],
    lanternPool: 2.2, lanternGlow: 2.0, glassGlow: 1.7, envIntensity: 0.25,
    shadowBias: -0.0003, shadowNormalBias: 0.04,
  }),
  dawn: preset({
    sunDir: [0.86, -0.05, -0.5], sunColor: '#ffb08a', sunIntensity: 0.0, sunDisk: 0,
    hemiSky: '#6f7fb0', hemiGround: '#5a4a4a', hemiIntensity: 0.6,
    zenith: '#3a4f86', horizon: '#e8a6a0', groundCol: '#3a3036', cloudLit: '#ffc8c0', cloudShade: '#7a7898', skyExposure: 1.1,
    night: 0.3, stars: 0.4,
    fogColor: '#c9a9b2', fogSunColor: '#f0a088', fogDensity: 0.03, fogFalloff: 0.035,
    exposure: 1.15, bloom: 0.3, bloomThreshold: 1.3, contrast: 0.14, saturation: 0.95,
    rays: 0.3, rayColor: [1.0, 0.7, 0.62],
    lanternPool: 1.4, lanternGlow: 1.2, glassGlow: 1.2, envIntensity: 0.4,
    shadowBias: -0.0005, shadowNormalBias: 0.06,
  }),
  sunrise: preset({
    sunDir: [0.86, 0.06, -0.5], sunColor: '#ffd9a8', sunIntensity: 6.5,
    hemiSky: '#a8b8d8', hemiGround: '#8a6a50', hemiIntensity: 0.9,
    zenith: '#6d8fc7', horizon: '#ffd2a0', groundCol: '#5e4a3a', cloudLit: '#fff0dc', cloudShade: '#a8a8c4', skyExposure: 1.15,
    fogColor: '#c9b8a8', fogSunColor: '#ffc890', fogDensity: 0.02,
    exposure: 1.0, bloom: 0.36, bloomThreshold: 1.5, contrast: 0.15, saturation: 1.05,
    rays: 1.2, rayColor: [1.0, 0.82, 0.6],
    lanternPool: 0.6, lanternGlow: 0.5, glassGlow: 0.5, envIntensity: 0.6,
    shadowBias: -0.0005, shadowNormalBias: 0.06,
  }),
};
export const PRESET_NAMES = Object.keys(PRESETS);

// The fields that shape the sky (and so the PMREM environment map).
export const SKY_FIELDS = ['zenith', 'horizon', 'groundCol', 'cloudLit', 'cloudShade', 'skyExposure', 'sunColor', 'sunDir', 'night', 'stars', 'moon'];

export const PALETTE = {
  sky: '#adb1c5', cloud: '#d5cfd8', skyDeep: '#98a2b8',
  plasterBlueShade: '#2d3e49', plasterBlue: '#76a0bb', ochrePeel: '#9d734c',
  golden: '#ca9b6a', courtyard: '#b9895c', limestone: '#d0cbc4',
  cobbleShade: '#3c3029', ivy: '#313627', domeGlaze: '#88855e', domeWhite: '#aaa3ad',
  minaret: '#9d7c62', peachShade: '#573d27', awningTan: '#a3693c', awningRed: '#2f1d19',
  eave: '#29190b', voussoirRed: '#8e2c1c', tunic: '#a3281e',
};
