/**
 * Theme Preview Studio palettes. Dev-only exploration: nothing here is imported by the app.
 *
 * Each theme is five seed colours per mode (bg, surface, primary, accent, text) plus four status hues. Every other token
 * the app uses (see src/index.css) is derived from those, and any token that carries text is nudged until it meets
 * WCAG AA (4.5:1) on the surface it sits on, so a palette can't be previewed with unreadable text.
 */

export interface Seed {
  bg: string
  surface: string
  /** Buttons, active nav, the watched part of progress. */
  primary: string
  /** Secondary highlight, used sparingly: spotlight eyebrows, chart highlights, "new" markers. */
  accent: string
  text: string
}

/** Status hues (completed, plan to watch, on hold, dropped). "Watching" always takes the primary. */
export interface StatusHues {
  success: string
  info: string
  warn: string
  danger: string
}

export interface Theme {
  id: string
  name: string
  mood: string
  personality: string
  /** True for the two palettes suggested in addition to the brief's eight. */
  suggested?: boolean
  dark: Seed
  light: Seed
  status: StatusHues
}

export type Mode = 'dark' | 'light'

export const THEMES: Theme[] = [
  {
    id: 'crimson',
    name: 'Cinematic Black & Crimson',
    mood: 'Premiere night',
    personality: 'Velvet-rope red on near-black with house-light amber. The boldest, most theatrical option; the red has to be rationed or it shouts.',
    dark: { bg: '#111111', surface: '#1B1B1B', primary: '#E5484D', accent: '#F2B36D', text: '#F5F5F5' },
    light: { bg: '#F6F2EE', surface: '#FCFAF7', primary: '#C8303A', accent: '#A86A22', text: '#1C1817' },
    // Dropped can't be red next to a red brand: it moves to raspberry.
    status: { success: '#5FBF8A', info: '#6FA8DC', warn: '#E0A458', danger: '#E86AA0' },
  },
  {
    id: 'copper',
    name: 'Charcoal & Burnt Copper',
    mood: 'Projection booth',
    personality: 'Warm metal on cool charcoal. Analogue and crafted, like film canisters and brass fittings; confident without being loud.',
    dark: { bg: '#121314', surface: '#1E2021', primary: '#C77B52', accent: '#E3B58C', text: '#F1EFEB' },
    light: { bg: '#F5F1EB', surface: '#FBF9F5', primary: '#A85C34', accent: '#93683F', text: '#1E1B18' },
    // On hold moves from amber to ochre-yellow so it doesn't read as copper.
    status: { success: '#6DBF8F', info: '#7AA7D9', warn: '#D6C25E', danger: '#E5666B' },
  },
  {
    id: 'burgundy',
    name: 'Graphite & Muted Burgundy',
    mood: 'Late screening',
    personality: 'Wine-dark and intimate: art-house cinema after the last trailer. The quietest primary of the set, so posters carry the colour.',
    dark: { bg: '#141314', surface: '#211D20', primary: '#A45D6B', accent: '#D2A0A5', text: '#F2EDEF' },
    light: { bg: '#F6F0F0', surface: '#FCF9F8', primary: '#8A3F4E', accent: '#9E6670', text: '#1F181B' },
    status: { success: '#6DBA8E', info: '#7FA6D6', warn: '#DDAA5E', danger: '#E8705A' },
  },
  {
    id: 'gold',
    name: 'Obsidian & Antique Gold',
    mood: 'Awards season',
    personality: "A collector's shelf: aged gold leaf on obsidian. Premium and archival; it flatters posters but needs a deeper bronze in daylight.",
    dark: { bg: '#111210', surface: '#20211D', primary: '#B99A57', accent: '#DCC58C', text: '#F1EFE7' },
    light: { bg: '#F5F2E9', surface: '#FBFAF4', primary: '#86692A', accent: '#9C7F3A', text: '#1D1C17' },
    // Amber on hold would vanish into the gold: it becomes terracotta.
    status: { success: '#79B88E', info: '#7DA5D4', warn: '#D98C5F', danger: '#E26D6D' },
  },
  {
    id: 'coral',
    name: 'Slate & Soft Coral',
    mood: 'Golden hour',
    personality: 'Cool slate warmed by a soft coral. Friendly and approachable, the most "lifestyle" option; less cinematic, very easy to live with.',
    dark: { bg: '#131719', surface: '#202729', primary: '#D17C70', accent: '#E6B2A5', text: '#F0F2F1' },
    light: { bg: '#F2F2EF', surface: '#FAFAF7', primary: '#AD5246', accent: '#9A6658', text: '#182022' },
    status: { success: '#6CBF94', info: '#7AA9DA', warn: '#E2BD62', danger: '#E66A8A' },
  },
  {
    id: 'navy',
    name: 'Midnight Navy & Electric Blue',
    mood: 'Broadcast control',
    personality: 'Crisp, technical and trustworthy. Very legible and calm, but blue-on-navy is the most familiar dashboard combination of the set.',
    dark: { bg: '#0D1522', surface: '#172438', primary: '#3987E8', accent: '#55C6D9', text: '#F1F5F9' },
    light: { bg: '#EEF2F6', surface: '#F8FAFC', primary: '#2468C4', accent: '#1B7F8F', text: '#0F1A2A' },
    // Plan to watch can't be blue here: it becomes rose.
    status: { success: '#5FC28E', info: '#E39BC0', warn: '#E5B45A', danger: '#EE6E6E' },
  },
  {
    id: 'forest',
    name: 'Forest Green & Charcoal',
    mood: 'Film club',
    personality: 'Green baize and brass: a members-only screening room. Literary and calm, and rare for an entertainment app, so it stands apart.',
    dark: { bg: '#101714', surface: '#1B2721', primary: '#6DAB83', accent: '#C6A66B', text: '#EFF4EF' },
    light: { bg: '#F0F3EE', surface: '#F9FBF7', primary: '#3F7D57', accent: '#8A6D33', text: '#142019' },
    // Completed can't be green on a green brand: it becomes sky blue, and plan to watch takes orchid.
    status: { success: '#8DB9EC', info: '#C8A0DC', warn: '#E0A458', danger: '#E5736B' },
  },
  {
    id: 'teal',
    name: 'Deep Teal & Ice Blue',
    mood: 'Night swim',
    personality: 'Cool, clean and composed, like an underwater title sequence. Soothing and modern; leans a little toward wellness or fintech.',
    dark: { bg: '#10191B', surface: '#1A292B', primary: '#39AFA7', accent: '#A4DDE0', text: '#F0F6F5' },
    light: { bg: '#EDF3F2', surface: '#F8FBFA', primary: '#1C7A74', accent: '#2F7F86', text: '#122022' },
    status: { success: '#93CC6A', info: '#93A9F0', warn: '#E3B25E', danger: '#E8746E' },
  },
  {
    id: 'tangerine',
    name: 'Ink & Tangerine',
    mood: 'Festival poster',
    personality: 'Printing-ink blue-black with a screen-print orange and a steel-blue counterpoint. Editorial and energetic, like a film-festival programme.',
    suggested: true,
    dark: { bg: '#12141A', surface: '#1C1F27', primary: '#EE8547', accent: '#9DB4D8', text: '#F3F1EC' },
    light: { bg: '#F4F2EE', surface: '#FBFAF7', primary: '#B44F17', accent: '#4D6C99', text: '#171A21' },
    status: { success: '#6CC18F', info: '#86A9E6', warn: '#E2C65A', danger: '#EB6A78' },
  },
  {
    id: 'espresso',
    name: 'Espresso & Mint',
    mood: 'Matinee',
    personality: 'Coffee-brown warmth with a cool mint and honey trim: a vintage cinema lobby. Cosy and distinctive; nothing else in the category looks like it.',
    suggested: true,
    dark: { bg: '#15120F', surface: '#221D19', primary: '#7CC4A4', accent: '#E9B872', text: '#F3EEE7' },
    light: { bg: '#F4EFE9', surface: '#FBF8F4', primary: '#2F7D61', accent: '#90601F', text: '#221C17' },
    // Completed moves to leaf-lime and on hold to orange, away from the mint and honey.
    status: { success: '#A9CF6A', info: '#86A9E6', warn: '#E58E5A', danger: '#E36A6A' },
  },
]

// ---------- Colour maths (sRGB, WCAG 2.x) ----------

const rgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const toHex = (c: number[]) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`.toUpperCase()

/** a moved toward b by t (0 = a, 1 = b). */
export const mix = (a: string, b: string, t: number) => {
  const [x, y] = [rgb(a), rgb(b)]
  return toHex(x.map((v, i) => v + (y[i] - v) * t))
}
const rgba = (hex: string, alpha: number) => `rgb(${rgb(hex).join(' ')} / ${alpha})`

const luminance = (hex: string) => {
  const [r, g, b] = rgb(hex).map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** Moves colour toward `toward` in small steps until it reaches `target` contrast on `on`. Unchanged if it already does. */
export function fit(colour: string, on: string, toward: string, target = 4.5) {
  let c = colour
  for (let t = 0.04; contrast(c, on) < target && t <= 1; t += 0.04) c = mix(colour, toward, t)
  return c
}

// ---------- Tokens ----------

/** The full token set for one theme in one mode: the same variable names src/index.css defines, plus studio-only --accent-2. */
export function tokens(theme: Theme, mode: Mode): Record<string, string> {
  const s = theme[mode]
  const dark = mode === 'dark'
  const { bg, surface, primary, accent, text } = s
  const ink = [theme.dark.bg, theme.light.surface].sort((a, b) => contrast(b, primary) - contrast(a, primary))[0]
  const accentSoft = mix(surface, primary, dark ? 0.16 : 0.12)
  const status = Object.fromEntries(Object.entries(theme.status).map(([k, hue]) => [k, fit(dark ? hue : mix(hue, text, 0.35), surface, text)]))
  return {
    '--bg': bg,
    '--bg-2': dark ? mix(bg, surface, 0.35) : mix(bg, text, 0.035),
    '--surface': surface,
    '--surface-2': mix(surface, text, dark ? 0.06 : 0.045),
    '--overlay': dark ? mix(surface, text, 0.03) : mix(surface, '#FFFFFF', 0.4),
    '--border': mix(surface, text, dark ? 0.12 : 0.11),
    '--divider': mix(bg, text, 0.08),
    '--border-strong': mix(surface, primary, 0.55),
    '--text': text,
    '--text-2': mix(text, bg, 0.25),
    '--muted': fit(mix(text, bg, 0.42), surface, text),
    '--faint': mix(text, bg, 0.62),
    '--accent': primary,
    '--accent-hover': dark ? mix(primary, text, 0.14) : mix(primary, '#000000', 0.12),
    '--accent-strong': mix(primary, '#000000', 0.2),
    '--accent-soft': accentSoft,
    '--accent-line': mix(surface, primary, dark ? 0.38 : 0.3),
    '--accent-text': fit(primary, accentSoft, text),
    '--on-accent': ink,
    '--accent-2': fit(accent, surface, text),
    '--accent-2-soft': mix(surface, accent, dark ? 0.14 : 0.16),
    '--danger': status.danger,
    '--success': status.success,
    '--warn': status.warn,
    '--info': status.info,
    '--shadow-card': dark ? '0 1px 0 rgb(255 255 255 / 0.025) inset, 0 8px 24px -12px rgb(0 0 0 / 0.7)' : `0 1px 2px ${rgba(text, 0.05)}, 0 4px 14px -6px ${rgba(text, 0.1)}`,
    '--shadow-pop': dark ? '0 24px 60px -16px rgb(0 0 0 / 0.8), 0 0 0 1px rgb(255 255 255 / 0.02)' : `0 1px 3px ${rgba(text, 0.06)}, 0 18px 48px -14px ${rgba(text, 0.24)}`,
    '--glow': rgba(primary, dark ? 0.08 : 0.06),
    '--accent-glow': dark ? mix(primary, '#000000', 0.2) : rgba(primary, 0.45),
    '--backdrop': dark ? rgba(mix(bg, '#000000', 0.5), 0.72) : rgba(text, 0.32),
  }
}

/** Contrast pairs worth showing (and testing): each is text the app actually draws on that background. */
export function checks(t: Record<string, string>) {
  return [
    { label: 'Text on background', fg: t['--text'], bg: t['--bg'] },
    { label: 'Muted on surface', fg: t['--muted'], bg: t['--surface'] },
    { label: 'Button label', fg: t['--on-accent'], bg: t['--accent'] },
    { label: 'Active nav', fg: t['--accent-text'], bg: t['--accent-soft'] },
    { label: 'Accent text', fg: t['--accent-2'], bg: t['--surface'] },
    ...(['success', 'info', 'warn', 'danger'] as const).map((k) => ({ label: `Status: ${k}`, fg: t[`--${k}`], bg: t['--surface'] })),
  ].map((c) => ({ ...c, ratio: contrast(c.fg, c.bg) }))
}
