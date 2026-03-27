/** The effect types supported by the light orchestrator */
export type EffectType = 'static' | 'pulse' | 'flash' | 'colorCycle' | 'colorShift';

/** Describes a single light state */
export interface LightEffect {
  type: EffectType;
  /** Hue 0–360. Required for colored (non-white) states. */
  hue?: number;
  /** Saturation 0–100. Required for colored states. */
  saturation?: number;
  /** Brightness 10–100 */
  brightness: number;
  /** Color temperature 2500–6500K. Used for white states (overrides hue/sat). */
  colorTemp?: number;
  /** For pulse: cycle duration in ms */
  cycleMs?: number;
  /** For pulse: minimum brightness at the dim end */
  minBrightness?: number;
  /** For flash: how long the flash color holds before reverting to idle (ms) */
  flashDurationMs?: number;
  /** For colorShift: second hue to alternate with (0-360) */
  hue2?: number;
}

/** The 5 user-facing states for custom themes */
export interface SimpleThemeStates {
  idle: LightEffect;
  thinking: LightEffect;
  editing: LightEffect;
  waitingForInput: LightEffect;
  completion: LightEffect;
}

/** User-created custom theme (5 states) */
export interface CustomThemeConfig {
  id: string;
  name: string;
  states: SimpleThemeStates;
}

/** Full 10-state theme used internally by the orchestrator */
export interface VibeTheme {
  id: string;
  name: string;
  description: string;
  states: {
    idle: LightEffect;
    userCoding: LightEffect;
    userPrompting: LightEffect;
    aiThinking: LightEffect;
    aiGenerating: LightEffect;
    aiWaitingForInput: LightEffect;
    aiNeedsInput: LightEffect;
    userAccepted: LightEffect;
    userDeclined: LightEffect;
    aiComplete: LightEffect;
  };
}

/** Built-in theme metadata for Settings UI */
export interface BuiltinThemeInfo {
  id: string;
  name: string;
  description: string;
  /** Key state colors as [hue, saturation] pairs: [idle, thinking, editing, alert, complete] */
  colors: [number, number][];
}

// ─── Built-in Themes ─────────────────────────────────────────────────────────

export const BUILTIN_THEMES: VibeTheme[] = [
  // ── Default — Teal/Orange/Violet/Red/Green ──────────────────────────────────
  {
    id: 'default',
    name: 'Default',
    description: 'Teal idle, orange thinking, violet flash, red alert, green complete.',
    states: {
      idle:              { type: 'static', hue: 185, saturation: 100, brightness: 76 },
      userCoding:        { type: 'static', hue: 185, saturation: 100, brightness: 76 },
      userPrompting:     { type: 'static', hue: 185, saturation: 100, brightness: 76 },
      aiThinking:        { type: 'pulse', hue: 39, saturation: 100, brightness: 90, minBrightness: 19, cycleMs: 800 },
      aiGenerating:      { type: 'flash', hue: 280, saturation: 100, brightness: 100, flashDurationMs: 2000 },
      aiWaitingForInput: { type: 'pulse', hue: 359, saturation: 100, brightness: 100, minBrightness: 19, cycleMs: 500 },
      aiNeedsInput:      { type: 'pulse', hue: 359, saturation: 100, brightness: 100, minBrightness: 19, cycleMs: 500 },
      userAccepted:      { type: 'pulse', hue: 120, saturation: 100, brightness: 100, minBrightness: 40, cycleMs: 1200 },
      userDeclined:      { type: 'static', hue: 185, saturation: 100, brightness: 76 },
      aiComplete:        { type: 'pulse', hue: 120, saturation: 100, brightness: 100, minBrightness: 40, cycleMs: 1200 },
    },
  },

  // ── Theme 1 — Orange idle, blue thinking, yellow flash, purple alert, green complete ──
  {
    id: 'ocean',
    name: 'Theme 1',
    description: 'Orange idle, blue thinking, yellow flash, purple alert, green complete.',
    states: {
      idle:              { type: 'static', hue: 30, saturation: 100, brightness: 76 },
      userCoding:        { type: 'static', hue: 30, saturation: 100, brightness: 76 },
      userPrompting:     { type: 'static', hue: 30, saturation: 100, brightness: 76 },
      aiThinking:        { type: 'pulse', hue: 202, saturation: 100, brightness: 90, minBrightness: 19, cycleMs: 800 },
      aiGenerating:      { type: 'flash', hue: 51, saturation: 100, brightness: 100, flashDurationMs: 2000 },
      aiWaitingForInput: { type: 'pulse', hue: 306, saturation: 100, brightness: 100, minBrightness: 19, cycleMs: 500 },
      aiNeedsInput:      { type: 'pulse', hue: 306, saturation: 100, brightness: 100, minBrightness: 19, cycleMs: 500 },
      userAccepted:      { type: 'pulse', hue: 120, saturation: 100, brightness: 100, minBrightness: 40, cycleMs: 1200 },
      userDeclined:      { type: 'static', hue: 30, saturation: 100, brightness: 76 },
      aiComplete:        { type: 'pulse', hue: 120, saturation: 100, brightness: 100, minBrightness: 40, cycleMs: 1200 },
    },
  },

  // ── Theme 2 — Purple idle, yellow thinking, magenta flash, red alert, green complete ──
  {
    id: 'sunset',
    name: 'Theme 2',
    description: 'Purple idle, yellow thinking, magenta flash, red alert, green complete.',
    states: {
      idle:              { type: 'static', hue: 247, saturation: 100, brightness: 76 },
      userCoding:        { type: 'static', hue: 247, saturation: 100, brightness: 76 },
      userPrompting:     { type: 'static', hue: 247, saturation: 100, brightness: 76 },
      aiThinking:        { type: 'pulse', hue: 54, saturation: 100, brightness: 90, minBrightness: 19, cycleMs: 800 },
      aiGenerating:      { type: 'flash', hue: 310, saturation: 100, brightness: 100, flashDurationMs: 2000 },
      aiWaitingForInput: { type: 'pulse', hue: 359, saturation: 100, brightness: 100, minBrightness: 19, cycleMs: 500 },
      aiNeedsInput:      { type: 'pulse', hue: 359, saturation: 100, brightness: 100, minBrightness: 19, cycleMs: 500 },
      userAccepted:      { type: 'pulse', hue: 120, saturation: 100, brightness: 100, minBrightness: 40, cycleMs: 1200 },
      userDeclined:      { type: 'static', hue: 247, saturation: 100, brightness: 76 },
      aiComplete:        { type: 'pulse', hue: 120, saturation: 100, brightness: 100, minBrightness: 40, cycleMs: 1200 },
    },
  },

  // ── Theme 3 — High-contrast cyberpunk ────────────────────────────────────
  {
    id: 'neon',
    name: 'Theme 3',
    description: 'Cyberpunk vibes — hot pink, electric blue, neon lime.',
    states: {
      idle:              { type: 'static', hue: 270, saturation: 80, brightness: 15 },
      userCoding:        { type: 'static', hue: 270, saturation: 80, brightness: 15 },
      userPrompting:     { type: 'static', hue: 270, saturation: 80, brightness: 15 },
      aiThinking:        { type: 'pulse', hue: 330, saturation: 100, brightness: 100, minBrightness: 30, cycleMs: 900 },
      aiGenerating:      { type: 'flash', hue: 200, saturation: 100, brightness: 100, flashDurationMs: 1500 },
      aiWaitingForInput: { type: 'pulse', hue: 55, saturation: 100, brightness: 100, minBrightness: 25, cycleMs: 500 },
      aiNeedsInput:      { type: 'pulse', hue: 55, saturation: 100, brightness: 100, minBrightness: 25, cycleMs: 500 },
      userAccepted:      { type: 'pulse', hue: 90, saturation: 100, brightness: 100, minBrightness: 35, cycleMs: 1100 },
      userDeclined:      { type: 'static', hue: 270, saturation: 80, brightness: 15 },
      aiComplete:        { type: 'pulse', hue: 90, saturation: 100, brightness: 100, minBrightness: 35, cycleMs: 1100 },
    },
  },

  // ── Pastel — Soft, low-saturation ─────────────────────────────────────────
  {
    id: 'pastel',
    name: 'Theme 4',
    description: 'Soft lavender, peach, rose, mint — easy on the eyes.',
    states: {
      idle:              { type: 'static', hue: 0, saturation: 0, brightness: 20 },
      userCoding:        { type: 'static', hue: 0, saturation: 0, brightness: 20 },
      userPrompting:     { type: 'static', hue: 0, saturation: 0, brightness: 20 },
      aiThinking:        { type: 'pulse', hue: 260, saturation: 50, brightness: 80, minBrightness: 30, cycleMs: 1600 },
      aiGenerating:      { type: 'static', hue: 20, saturation: 50, brightness: 85 },
      aiWaitingForInput: { type: 'pulse', hue: 345, saturation: 55, brightness: 90, minBrightness: 35, cycleMs: 700 },
      aiNeedsInput:      { type: 'pulse', hue: 345, saturation: 55, brightness: 90, minBrightness: 35, cycleMs: 700 },
      userAccepted:      { type: 'pulse', hue: 150, saturation: 50, brightness: 85, minBrightness: 35, cycleMs: 1300 },
      userDeclined:      { type: 'static', hue: 0, saturation: 0, brightness: 20 },
      aiComplete:        { type: 'pulse', hue: 150, saturation: 50, brightness: 85, minBrightness: 35, cycleMs: 1300 },
    },
  },
];

// Keep backward-compat reference
const defaultTheme = BUILTIN_THEMES[0];

// ─── Expand 5 simple states → 10 internal states ─────────────────────────────
export function expandCustomTheme(custom: CustomThemeConfig): VibeTheme {
  return {
    id: custom.id,
    name: custom.name,
    description: 'Custom theme',
    states: {
      idle: custom.states.idle,
      userCoding: custom.states.idle,           // same as idle
      userPrompting: custom.states.idle,           // same as idle
      aiThinking: custom.states.thinking,
      aiGenerating: custom.states.editing,
      aiWaitingForInput: custom.states.waitingForInput, // same as waitingForInput
      aiNeedsInput: custom.states.waitingForInput,
      userAccepted: custom.states.completion,     // same as completion
      userDeclined: custom.states.idle,           // same as idle
      aiComplete: custom.states.completion,
    },
  };
}

// ─── Theme Resolution ─────────────────────────────────────────────────────────
export function resolveTheme(id: string, customThemes: CustomThemeConfig[]): VibeTheme {
  // Check built-in themes first
  const builtin = BUILTIN_THEMES.find(t => t.id === id);
  if (builtin) return builtin;

  // Check custom themes
  const custom = customThemes.find(t => t.id === id);
  if (custom) return expandCustomTheme(custom);

  // Fallback to default
  return defaultTheme;
}

/** Get the default built-in theme */
export function getDefaultTheme(): VibeTheme {
  return defaultTheme;
}

/** Get built-in theme metadata for the Settings UI */
export function getBuiltinThemeInfos(): BuiltinThemeInfo[] {
  return BUILTIN_THEMES.map(t => ({
    id: t.id,
    name: t.name,
    description: t.description,
    colors: [
      [t.states.idle.hue ?? 0, t.states.idle.saturation ?? 0],
      [t.states.aiThinking.hue ?? 0, t.states.aiThinking.saturation ?? 100],
      [t.states.aiGenerating.hue ?? 0, t.states.aiGenerating.saturation ?? 100],
      [t.states.aiNeedsInput.hue ?? 0, t.states.aiNeedsInput.saturation ?? 100],
      [t.states.aiComplete.hue ?? 0, t.states.aiComplete.saturation ?? 100],
    ],
  }));
}

// ─── Mascot Animation Packs ──────────────────────────────────────────────────

export interface BuiltinMascotPack {
  id: string;
  name: string;
  description: string;
  directory: string; // folder name under media/mascot/animations/
}

export interface CustomMascotPackConfig {
  id: string;
  name: string;
  // Animation files stored in globalStorage/mascotPacks/{id}/
}

export const BUILTIN_MASCOT_PACKS: BuiltinMascotPack[] = [
  { id: 'default', name: 'Default', description: 'Playful character animations', directory: 'default' },
];

export { defaultTheme };
