# VibeSync

**Sync your room lights, screen glow, sounds, and mascot animations with your AI coding assistant.**

![Version](https://img.shields.io/badge/version-1.0.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![VS Code](https://img.shields.io/badge/VS%20Code-Extension-purple)

---

## What is VibeSync?

VibeSync is a VS Code extension that turns AI-assisted coding into an immersive experience. When your AI assistant thinks, writes code, or needs your attention — your room lights change color, sound effects play, your screen glows, and a cute mascot reacts.

## Features

- **Smart Light Sync** — Physical lights (TP-Link Tapo) change color based on AI state
- **Screen Glow** — Colored border around your editor that follows the AI's activity
- **Sound Effects** — Fun sound packs (memes, anime, clean) with custom upload support
- **Themes** — 5 built-in color themes + create your own custom themes
- **Mascot Animations** — Animated Lottie character that reacts to AI states
- **Time Tracker** — Calendar heatmap, daily coding hours, commit counts, and notes
- **GitHub Integration** — Sign in to see commit counts alongside coding hours

## Install

- **VS Code:** Search `vibesync` in the Extensions panel (`Ctrl+Shift+X`) and look for **"VibeSync — AI Light Sync"** by `vibesynctech`
- **VS Code Marketplace:** [Install directly](https://marketplace.visualstudio.com/items?itemName=vibesynctech.vibesync-lights)
- **Antigravity / Cursor / Windsurf:** Search `vibesync` in Extensions — also available on [Open VSX](https://open-vsx.org/extension/vibesynctech/vibesync-lights)
- **Manual:** Download `.vsix` from [GitHub Releases](https://github.com/vibesynctech/vibesync/releases) → `Cmd+Shift+P` → "Install from VSIX"

Extensions auto-update by default. To make sure: Settings → search "auto update" → set **Extensions: Auto Update** to `true`.

## Quick Start

1. Open the **VibeSync** sidebar (flame icon in the activity bar)
3. Click the **gear icon** to open Settings
4. Configure your Tapo light (IP, email, password) and click **Test Connection**
5. Enable Screen Glow, Sound Effects, and Mascot as you like
6. Start coding with Claude Code — watch everything come alive!

New to the extension? Click the **book icon** in the sidebar for a full interactive Guide.

## Supported Hardware

| Brand | Status |
|-------|--------|
| TP-Link Tapo L900-5 | Tested and working |
| Philips Hue | Coming soon |
| LIFX | Coming soon |
| Other smart lights | Planned |

## AI States

The extension detects 5 states from your AI tool:

| State | Description | Response |
|-------|-------------|----------|
| **Idle** | Nothing happening | Calm static color |
| **Thinking** | AI is reasoning | Pulsing light + sound |
| **Editing** | AI is writing code | Flash/color change + sound |
| **Waiting for Input** | AI needs your attention | Alert pulse + attention sound |
| **Complete** | AI finished the task | Green pulse + completion sound |

## AI Tool Support

| Tool | Status |
|------|--------|
| Claude Code | Supported |
| Cursor | Planned |
| GitHub Copilot | Planned |
| Windsurf | Planned |
| Antigravity | Planned |

## Known Limitations

- **Light sync** only tested with TP-Link Tapo L900-5. Other Tapo models may work. Other brands are not yet supported.
- **Sync accuracy** is not 100% — the complete state may briefly show during thinking, and takes a few seconds to reflect after the AI finishes.
- **AI tool support** currently only works with Claude Code. Other tools are planned if there is demand.

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

[MIT](LICENSE)

## Contact

Have questions, want to collaborate, or interested in hiring? Reach out:

- **Email:** himmu1144@gmail.com
- **GitHub Issues:** [Report a bug or request a feature](https://github.com/vibesynctech/vibesync/issues)
