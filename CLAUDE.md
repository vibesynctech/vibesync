# VibeSync — Project Context for AI Agents

## Overview
VS Code extension that syncs room lights, screen glow, sound effects, and mascot animations with AI coding assistant activity (currently Claude Code).

## Architecture

```
Claude Code Log (.jsonl) → ClaudeCodeSignal → StateMachine → LightOrchestrator
                                                               ├─ TapoController (physical lights)
                                                               ├─ ScreenGlowController (editor border)
                                                               ├─ SoundPlayer (audio effects)
                                                               └─ CalendarViewProvider (mascot animations)
```

### Signal Detection Flow
1. `ClaudeCodeSignal` tails the latest Claude Code `.jsonl` log file in `~/.claude/projects/`
2. It emits state events: `aiThinking`, `aiGenerating`, `aiNeedsInput`, `aiComplete`, `idle`
3. `StateMachine` debounces and validates state transitions
4. `LightOrchestrator` dispatches to all output controllers

### Key Pattern: 5-State → 10-State Expansion
Users configure **5 simple states** (idle, thinking, editing, waitingForInput, completion).
Internally these expand to **10 states** via `expandCustomTheme()` / `expandSoundPack()`:
- idle → idle, userCoding, userPrompting, userDeclined
- thinking → aiThinking
- editing → aiGenerating
- waitingForInput → aiWaitingForInput, aiNeedsInput
- completion → userAccepted, aiComplete

## Key Files

| File | Purpose |
|------|---------|
| `src/extension.ts` | Entry point, wires everything together |
| `src/detector/StateMachine.ts` | Core state machine with debouncing |
| `src/detector/ClaudeCodeSignal.ts` | Tails Claude Code log files |
| `src/lights/LightOrchestrator.ts` | Dispatches state changes to all outputs |
| `src/lights/TapoController.ts` | TP-Link Tapo light API client |
| `src/lights/ScreenGlowController.ts` | VS Code editor border glow |
| `src/sounds/SoundPlayer.ts` | Audio playback via VS Code webview |
| `src/sounds/types.ts` | Sound pack definitions, BUILTIN_SOUND_PACKS |
| `src/themes/index.ts` | Theme definitions, BUILTIN_THEMES, resolveTheme() |
| `src/tracker/CalendarViewProvider.ts` | Sidebar webview: calendar, timer, notes, mascot |
| `src/settings/SettingsViewProvider.ts` | Settings editor tab: full config UI (~1400 lines) |
| `src/guides/GuideViewProvider.ts` | Guide editor tab: static help page |
| `src/config/Settings.ts` | Settings wrapper over VS Code configuration |

## Build & Test

```bash
npm install          # Install dependencies
npm run compile      # Compile TypeScript
# Press F5 in VS Code to launch Extension Development Host
```

Package for distribution:
```bash
npx @vscode/vsce package   # Creates .vsix file
```

## Important Implementation Details

- **Webview CSP:** CalendarViewProvider uses `script-src ${cspSource} 'unsafe-inline'` to allow inline onclick handlers. Do NOT switch to nonce-only — it breaks all interactive elements except addEventListener-based ones.
- **Mascot stage:** Has `pointer-events: none` in CSS because it overlays the notes/timer section. The mascot is purely decorative.
- **Settings webview:** Uses `createWebviewPanel()` (editor tab), NOT `registerWebviewViewProvider` (sidebar). Same for Guide.
- **Auto-refresh:** CalendarViewProvider has a 60-second `setInterval` that rebuilds the HTML. `lastVibeState` is stored and re-sent after 300ms delay to restore the mascot animation.
- **Sound files:** All in `media/sounds/`. Referenced by ID in `BUILTIN_SOUNDS` array in `src/sounds/types.ts`.
- **Theme colors:** Stored as HSB (hue 0-360, saturation 0-100, brightness 0-100). Converted to Tapo API format or CSS hsl() as needed.
