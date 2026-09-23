import * as THREE from 'three';

// Art direction constants, measured from the reference render:
// deep teal-blue plaster in shade, warm brown shadows, lavender sky,
// golden back-light spilling through arches, hazy peach aerial perspective.
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

export const PALETTE = {
  sky: '#adb1c5', cloud: '#d5cfd8', skyDeep: '#98a2b8',
  plasterBlueShade: '#2d3e49', plasterBlue: '#76a0bb', ochrePeel: '#9d734c',
  golden: '#ca9b6a', courtyard: '#b9895c', limestone: '#d0cbc4',
  cobbleShade: '#3c3029', ivy: '#313627', domeGlaze: '#88855e', domeWhite: '#aaa3ad',
  minaret: '#9d7c62', peachShade: '#573d27', awningTan: '#a3693c', awningRed: '#2f1d19',
  eave: '#29190b', voussoirRed: '#8e2c1c', tunic: '#a3281e',
};
