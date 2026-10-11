// Sunwork, the game's light mechanic (FULL_GAME §6): one import for chapters.
export { LightSystem, physicsWorld } from './system.js';
export { LightSource, SunRay, MoonRay, BeamLamp, SearchlightSource } from './sources.js';
export { Mirror, Crank, Capstan } from './mirror.js';
export { SunLock, Photocell, LampEye, Sensor, BurnRope, Occluder } from './targets.js';
export { Terminator, SunClock, Hatch } from './time.js';
export { LightWorld, reflect, wrapAlpha, notchOf, alphaFor, angleOf, NOTCH } from './trace.js';
export { chargeLevel, heatStep, keyed, magnet, liftClamp, crossAt } from './logic.js';
