/**
 * Generates a visually-pleasing random gradient pair once per browser session.
 * The values are frozen at module load, so they stay consistent while the app
 * is open but change on every fresh page load / extension popup open.
 */

// Pairs of [hue-start, hue-end] chosen to always look good together.
const PALETTES: [number, number][] = [
  [210, 45],   // blue → amber
  [270, 340],  // violet → rose
  [160, 30],   // teal → orange
  [300, 60],   // magenta → yellow
  [190, 320],  // cyan → purple
  [20, 200],   // orange → sky
  [140, 260],  // green → indigo
  [0, 220],    // red → blue
  [50, 170],   // yellow → emerald
  [330, 100],  // pink → lime
]

function randomPalette(): [number, number] {
  return PALETTES[Math.floor(Math.random() * PALETTES.length)]
}

const [h1, h2] = randomPalette()

/** CSS gradient string ready to use as `background` or `backgroundImage`. */
export const SESSION_GRADIENT = `linear-gradient(135deg, hsl(${h1},80%,55%), hsl(${h2},85%,60%))`

/** Two individual CSS colour strings for more granular use. */
export const SESSION_COLOR_A = `hsl(${h1},80%,55%)`
export const SESSION_COLOR_B = `hsl(${h2},85%,60%)`
