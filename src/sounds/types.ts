import { VibeState } from '../detector/StateMachine.js';

/** Per-state sound configuration */
export interface SoundEntry {
  /** Sound file reference: 'builtin:chime-high' or 'custom:<filename>' */
  soundId: string;
  /** Volume 0–100 */
  volume: number;
  /** Whether this state's sound is enabled */
  enabled: boolean;
}

/** 5 user-facing states */
export interface SimpleSoundPackStates {
  idle: SoundEntry;
  thinking: SoundEntry;
  editing: SoundEntry;
  waitingForInput: SoundEntry;
  completion: SoundEntry;
}

/** Stored in globalState */
export interface CustomSoundPackConfig {
  id: string;
  name: string;
  states: SimpleSoundPackStates;
}

/** Full 10-state internal format */
export interface SoundPack {
  id: string;
  name: string;
  states: Record<VibeState, SoundEntry>;
}

/** Built-in sound library entry */
export interface BuiltinSound {
  id: string;
  label: string;
  filename: string;
}

export const BUILTIN_SOUNDS: BuiltinSound[] = [
  // ── Silent ──
  { id: 'none', label: 'None (silent)', filename: '' },

  // ── Original synth sounds ──
  { id: 'chime-high', label: 'High Chime', filename: 'chime-high.wav' },
  { id: 'chime-low', label: 'Low Chime', filename: 'chime-low.wav' },
  { id: 'beep-soft', label: 'Soft Beep', filename: 'beep-soft.wav' },
  { id: 'beep-alert', label: 'Alert Beep', filename: 'beep-alert.wav' },
  { id: 'click', label: 'Click', filename: 'click.wav' },
  { id: 'ding', label: 'Ding', filename: 'ding.wav' },
  { id: 'whoosh', label: 'Whoosh', filename: 'whoosh.wav' },
  { id: 'pop', label: 'Pop', filename: 'pop.wav' },

  // ── Meme classics ──
  { id: 'vine-boom', label: 'Vine Boom', filename: 'vine-boom-sound-effect.mp3' },
  { id: 'emotional-damage', label: 'Emotional Damage', filename: 'emotional-damage.mp3' },
  { id: 'bing-bong', label: 'Bing Bong', filename: 'bing-bong.mp3' },
  { id: 'sad-violin', label: 'Sad Violin', filename: 'sad-violin.mp3' },
  { id: 'two-hours-later', label: 'Two Hours Later', filename: 'two-hours-later.mp3' },
  { id: 'giga-chad', label: 'Giga Chad', filename: 'giga-chad-perfect.mp3' },
  { id: 'ah-shit', label: 'Ah Shit Here We Go', filename: 'ah-shit-here-we-go-again.mp3' },
  { id: 'fuck-this', label: 'F*ck This Shit I\'m Out', filename: 'fuck-this-shit-im-out.mp3' },
  { id: 'heh-yeah-boy', label: 'Heh Heh Yeah Boy', filename: 'heh-heh-yeah-boy.mp3' },
  { id: 'gulp', label: 'Gulp Gulp Gulp', filename: 'gulp-gulp-gulp.mp3' },
  { id: 'uwu', label: 'UwU', filename: 'uwu.mp3' },
  { id: 'no-no-no', label: 'No No No (Punisher)', filename: 'punisher-no-no-no-meme.mp3' },
  { id: 'volume-up', label: 'Volume All The Way Up', filename: 'volume-all-the-way-up.mp3' },

  // ── Hindi memes ──
  { id: 'maja-ayega', label: 'Abhi Maja Ayega Bhidu', filename: 'abhi-maja-ayega-na-bhidu.mp3' },
  { id: 'moj-kardi', label: 'Moj Kardi', filename: 'moj-kardi.mp3' },
  { id: 'moye-moye', label: 'Moye Moye', filename: 'moye-more.mp3' },
  { id: 'paisa-hi-paisa', label: 'Paisa Hi Paisa', filename: 'paisa-hi-paisa.mp3' },
  { id: 'ye-karke-dikhao', label: 'Ye Karke Dikhao', filename: 'ye-karke-dikhao.mp3' },
  { id: 'gajab-bejjati', label: 'Gajab Bejjati', filename: 'gajab-bejjati.mp3' },
  { id: 'maka-bhosda', label: 'Maka Bhosda (Amitabh)', filename: 'maka-bhosda-aag.mp3' },
  { id: 'indian-meme', label: 'Indian Meme', filename: 'indian-memememew-memew.mp3' },
  { id: 'meme-generic', label: 'Meme Sound', filename: 'meme.mp3' },

  // ── Anime ──
  { id: 'baka', label: 'Baka Baka Baka', filename: 'baka-baka-baka.mp3' },
  { id: 'vegeta-scream', label: 'Vegeta Scream', filename: 'vegeta-s-scream.mp3' },
  { id: 'vegeta-sob', label: 'Vegeta Son of a...', filename: 'vegeta-son-of-a-bitch.mp3' },
  { id: 'demon-slayer', label: 'Demon Slayer (Opening)', filename: 'demon-slayer-mugen-train-opening.mp3' },
  { id: 'yoshi-garden', label: 'Yoshi Flower Garden', filename: 'yoshi-s-island-flower-garden.mp3' },
  { id: 'kare-kano', label: 'Kare Kano Theme', filename: 'his-and-her-circumstances-song-english-version.mp3' },

  // ── Reactions ──
  { id: 'hello-runt', label: 'Hello Little Red Runt', filename: 'hello-little-red-runt.mp3' },
  { id: 'shut-up-money', label: 'Shut Up Take My Money', filename: 'shut-up-take-my-money.mp3' },
  { id: 'fuck-u-all', label: 'F*ck U All Little Asses', filename: 'fuck-u-all-little-asses.mp3' },
  { id: 'shinde', label: 'Shinde', filename: 'shinde.mp3' },
  { id: 'makeit', label: 'Make It', filename: 'makeit.mp3' },
];

// ─── Built-in Sound Packs ────────────────────────────────────────────────────

export const BUILTIN_SOUND_PACKS: CustomSoundPackConfig[] = [
  {
    id: 'default',
    name: 'Default',
    states: {
      idle:            { soundId: 'builtin:none',        volume: 50, enabled: false },
      thinking:        { soundId: 'builtin:ah-shit',     volume: 60, enabled: true },
      editing:         { soundId: 'builtin:uwu',         volume: 50, enabled: true },
      waitingForInput: { soundId: 'builtin:maka-bhosda', volume: 80, enabled: true },
      completion:      { soundId: 'builtin:kare-kano',   volume: 70, enabled: true },
    },
  },
  {
    id: 'meme-lord',
    name: 'My Money',
    states: {
      idle:            { soundId: 'builtin:none',             volume: 50, enabled: false },
      thinking:        { soundId: 'builtin:shut-up-money',    volume: 90, enabled: true },
      editing:         { soundId: 'builtin:vine-boom',        volume: 50, enabled: true },
      waitingForInput: { soundId: 'builtin:baka',             volume: 80, enabled: true },
      completion:      { soundId: 'builtin:fuck-u-all',       volume: 70, enabled: true },
    },
  },
  {
    id: 'anime',
    name: 'Anime',
    states: {
      idle:            { soundId: 'builtin:none',          volume: 50, enabled: false },
      thinking:        { soundId: 'builtin:demon-slayer',  volume: 55, enabled: true },
      editing:         { soundId: 'builtin:uwu',            volume: 50, enabled: true },
      waitingForInput: { soundId: 'builtin:baka',           volume: 80, enabled: true },
      completion:      { soundId: 'builtin:yoshi-garden',  volume: 70, enabled: true },
    },
  },
  {
    id: 'clean',
    name: 'Clean & Minimal',
    states: {
      idle:            { soundId: 'builtin:none',       volume: 50, enabled: false },
      thinking:        { soundId: 'builtin:whoosh',     volume: 55, enabled: true },
      editing:         { soundId: 'builtin:chime-high',  volume: 40, enabled: true },
      waitingForInput: { soundId: 'builtin:vine-boom',   volume: 75, enabled: true },
      completion:      { soundId: 'builtin:yoshi-garden', volume: 65, enabled: true },
    },
  },
];

export const defaultSoundPack = BUILTIN_SOUND_PACKS[0];

/** 5 → 10 state expansion (same mapping as expandCustomTheme) */
export function expandSoundPack(custom: CustomSoundPackConfig): SoundPack {
  return {
    id: custom.id,
    name: custom.name,
    states: {
      idle: custom.states.idle,
      userCoding: custom.states.idle,
      userPrompting: custom.states.idle,
      aiThinking: custom.states.thinking,
      aiGenerating: custom.states.editing,
      aiWaitingForInput: custom.states.waitingForInput,
      aiNeedsInput: custom.states.waitingForInput,
      userAccepted: custom.states.completion,
      userDeclined: custom.states.idle,
      aiComplete: custom.states.completion,
    },
  };
}

export function resolveSoundPack(id: string, customPacks: CustomSoundPackConfig[]): SoundPack {
  // Check built-in packs first
  const builtin = BUILTIN_SOUND_PACKS.find(p => p.id === id);
  if (builtin) return expandSoundPack(builtin);

  // Check custom packs
  const custom = customPacks.find(p => p.id === id);
  if (custom) return expandSoundPack(custom);

  // Fallback to default
  return expandSoundPack(defaultSoundPack);
}
