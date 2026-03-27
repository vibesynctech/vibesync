# Contributing to VibeSync

Thanks for your interest in contributing! Here's how you can help.

## Reporting Bugs

Open a [GitHub Issue](https://github.com/vibesynctech/vibesync/issues) with:
- Steps to reproduce
- Expected vs actual behavior
- Your VS Code version and OS
- Screenshots if applicable

## Suggesting Features

Open a [GitHub Issue](https://github.com/vibesynctech/vibesync/issues) with the "feature request" label. Describe the feature and why it would be useful.

## Development Setup

1. **Clone the repo:**
   ```bash
   git clone https://github.com/vibesynctech/vibesync.git
   cd vibesync
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Compile:**
   ```bash
   npm run compile
   ```

4. **Run in VS Code:**
   - Open the project in VS Code
   - Press `F5` to launch the Extension Development Host
   - The extension will be active in the new window

5. **Test with sample data:**
   - Open Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`)
   - Run `VibeSync: Seed Test Data` to populate the calendar with 60 days of sample data
   - Run `VibeSync: Clear Test Data` to reset

## Project Structure

```
src/
  detector/     State machine & signal detection (Claude Code log tailing)
  lights/       Light control (Tapo API, screen glow)
  tracker/      Activity tracking, calendar, GitHub integration
  settings/     Settings UI webview
  sounds/       Sound playback & pack management
  themes/       Light effect themes & definitions
  guides/       User guide page
  config/       Settings storage
  utils/        Logging utilities
media/
  sounds/       Built-in sound effect files (.mp3, .wav)
  mascot/       Lottie animations, mascot CSS/JS
```

## Pull Request Guidelines

1. **Fork** the repo and create a branch from `main`
2. Keep PRs focused — one feature or fix per PR
3. Follow existing code patterns and style
4. Test your changes with `npm run compile` (must compile cleanly)
5. Write a clear PR description explaining what changed and how to test

## Code Style

- TypeScript with ES modules (`.js` extension in imports)
- Follow existing patterns — check how similar features are implemented before adding new ones
- Keep the webview HTML/CSS/JS inline in the provider files (no separate bundler)

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
