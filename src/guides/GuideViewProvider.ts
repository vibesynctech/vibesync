import * as vscode from 'vscode';

export class GuideViewProvider {
  private panel: vscode.WebviewPanel | null = null;

  show(): void {
    if (this.panel) {
      this.panel.reveal();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'vibeSync.guide',
      'VibeSync — Guide',
      vscode.ViewColumn.One,
      { enableScripts: false },
    );

    this.panel.webview.html = this.buildHtml();
    this.panel.onDidDispose(() => { this.panel = null; });
  }

  private buildHtml(): string {
    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, sans-serif);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    padding: 24px 32px 48px;
    line-height: 1.7;
    max-width: 720px;
    margin: 0 auto;
  }
  h1 {
    font-size: 22px;
    font-weight: 700;
    margin-bottom: 6px;
  }
  .subtitle {
    font-size: 13px;
    opacity: 0.55;
    margin-bottom: 28px;
  }
  .card {
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 10px;
    padding: 18px 20px;
    margin-bottom: 16px;
  }
  .card-title {
    font-size: 14px;
    font-weight: 700;
    margin-bottom: 10px;
    color: #3dacff;
  }
  .card p {
    font-size: 12.5px;
    margin-bottom: 8px;
    opacity: 0.85;
  }
  .card p:last-child { margin-bottom: 0; }
  .card ul, .card ol {
    font-size: 12.5px;
    padding-left: 18px;
    margin-bottom: 8px;
    opacity: 0.85;
  }
  .card li { margin-bottom: 4px; }
  .card li:last-child { margin-bottom: 0; }
  .card code {
    background: rgba(255,255,255,0.06);
    padding: 1px 5px;
    border-radius: 4px;
    font-size: 11.5px;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
    margin-top: 8px;
  }
  th {
    text-align: left;
    padding: 6px 10px;
    border-bottom: 1px solid rgba(255,255,255,0.1);
    font-weight: 600;
    opacity: 0.7;
    font-size: 11px;
  }
  td {
    padding: 6px 10px;
    border-bottom: 1px solid rgba(255,255,255,0.04);
    opacity: 0.8;
  }
  .emoji { font-size: 14px; margin-right: 4px; }
  .highlight { color: #4ec94e; font-weight: 600; }
  .warn { color: #e8a848; }
  a { color: #3dacff; text-decoration: none; }
  a:hover { text-decoration: underline; }
  .footer {
    margin-top: 24px;
    font-size: 11px;
    opacity: 0.4;
    text-align: center;
  }
</style>
</head>
<body>

<h1>\u{1F3AE} VibeSync — Guide</h1>
<p class="subtitle">Everything you need to know to get started.</p>

<!-- 1. Welcome -->
<div class="card">
  <div class="card-title">\u{1F44B} What is VibeSync?</div>
  <p>VibeSync is a VS Code extension that <strong>syncs your coding environment with AI activity</strong>. When your AI assistant (like Claude Code) is thinking, writing code, or waiting for your input — your room lights change color, sound effects play, your screen glows, and a cute mascot animates!</p>
  <p>It turns coding into an <strong>immersive, multi-sensory experience</strong>. Here's what it can do:</p>
  <ul>
    <li><strong>Smart Lights</strong> — Your desk/room lights change color based on what the AI is doing</li>
    <li><strong>Screen Glow</strong> — A colored border appears around your editor</li>
    <li><strong>Sound Effects</strong> — Fun sounds play for different AI states</li>
    <li><strong>Mascot</strong> — An animated character reacts to AI activity</li>
    <li><strong>Time Tracker</strong> — Track your coding hours and daily notes</li>
  </ul>
</div>

<!-- 2. Light Sync -->
<div class="card">
  <div class="card-title">\u{1F4A1} Getting Started — Light Sync</div>
  <p>Light sync makes your physical lights change color when the AI is thinking, editing, etc. Here's how to set it up:</p>
  <ol>
    <li><strong>Find your light's IP address</strong> — Open the Tapo app on your phone, go to your light strip's settings, and find the IP address (usually something like <code>192.168.1.xxx</code>)</li>
    <li><strong>Open Settings</strong> — Click the <strong>gear icon (\u2699\uFE0F)</strong> in the VibeSync sidebar</li>
    <li>Under <strong>Light Setup</strong>, enter your Tapo light's IP, your Tapo account email, and password</li>
    <li>Click <strong>Test Connection</strong> — if your light flashes, you're good to go!</li>
    <li>Make sure <strong>Light Enabled</strong> is toggled on</li>
  </ol>
  <p class="warn"><strong>Note:</strong> Currently only tested with <strong>TP-Link Tapo L900-5</strong> light strips. Support for other brands like Philips Hue, LIFX, etc. is planned for the future — they might already work if they follow a similar API structure as Tapo.</p>
</div>

<!-- 3. Screen Glow -->
<div class="card">
  <div class="card-title">\u{1F7E2} Screen Glow</div>
  <p>Screen Glow adds a <strong>colored border around your VS Code editor</strong> that changes based on AI activity. It's like having smart lights but on your screen!</p>
  <ul>
    <li>Open <strong>Settings</strong> (gear icon) and find the <strong>Screen Glow</strong> toggle</li>
    <li>Turn it <strong>on</strong> — you'll see a subtle colored glow around your editor</li>
    <li>The glow color follows your active <strong>theme</strong> — each AI state has its own color</li>
    <li>This works even without physical lights, so everyone can enjoy the vibe!</li>
  </ul>
</div>

<!-- 4. Sound Effects -->
<div class="card">
  <div class="card-title">\u{1F50A} Sound Effects</div>
  <p>Sound effects play when the AI changes state — like a fun notification system.</p>
  <ul>
    <li>Open <strong>Settings</strong> and scroll to <strong>Sound Packs</strong></li>
    <li>Choose from built-in packs: <strong>Default</strong>, <strong>My Money</strong>, <strong>Anime</strong>, or <strong>Clean & Minimal</strong></li>
    <li>Each pack assigns different sounds to each AI state (thinking, editing, waiting, complete)</li>
    <li>Want to customize? Click the <strong>edit button (\u270E)</strong> on any pack to create your own copy</li>
    <li>Or click <strong>+ Create New</strong> to build a sound pack from scratch</li>
    <li>You can even <strong>upload your own .wav or .mp3 files</strong> as custom sounds!</li>
  </ul>
</div>

<!-- 5. Themes -->
<div class="card">
  <div class="card-title">\u{1F3A8} Themes (Light Colors)</div>
  <p>Themes control <strong>what colors your lights and glow show</strong> for each AI state.</p>
  <ul>
    <li>Open <strong>Settings</strong> and scroll to <strong>Theme</strong></li>
    <li>Pick from built-in themes: <strong>Default</strong>, <strong>Theme 1</strong>, <strong>Theme 2</strong>, <strong>Theme 3</strong>, or <strong>Theme 4</strong></li>
    <li>Each theme has colored dots showing you the colors at a glance</li>
    <li>Click <strong>edit (\u270E)</strong> on any theme to create an editable copy — the original stays untouched</li>
    <li>In the editor you can change the <strong>hue, brightness, effect type</strong> (static, pulse, flash) and timing for each state</li>
    <li>Click <strong>+ Create New</strong> to design a theme completely from scratch</li>
  </ul>
</div>

<!-- 6. Mascot -->
<div class="card">
  <div class="card-title">\u{1F43E} Mascot Animations</div>
  <p>The mascot is a cute <strong>animated character</strong> that appears at the bottom of the sidebar and reacts to AI activity.</p>
  <ul>
    <li>Open <strong>Settings</strong> and scroll to <strong>Mascot Animations</strong></li>
    <li>Toggle <strong>Mascot Enabled</strong> on</li>
    <li>The mascot will animate when the AI is thinking, waiting for input, or has completed a task</li>
    <li>You can choose from animation packs or upload your own <strong>Lottie JSON</strong> animations</li>
  </ul>
</div>

<!-- 7. Time Tracker -->
<div class="card">
  <div class="card-title">\u{23F1}\uFE0F Time Tracker & Calendar</div>
  <p>The sidebar shows a <strong>time tracker</strong> that automatically logs your coding activity.</p>
  <ul>
    <li><strong>Calendar heatmap</strong> — darker squares = more coding that day. Click any day to see details</li>
    <li><strong>Hours / Commits toggle</strong> — switch between viewing coding hours or commit counts</li>
    <li><strong>Daily totals</strong> — see time spent today, this week, and this month</li>
    <li><strong>Notes</strong> — click <strong>Edit</strong> to jot down what you worked on each day (supports basic markdown!)</li>
    <li><strong>Eye icon</strong> — click to collapse/expand the timer section</li>
    <li>Sign in with <strong>GitHub</strong> to see your commit counts alongside hours</li>
  </ul>
</div>

<!-- 8. AI States -->
<div class="card">
  <div class="card-title">\u{1F916} AI States Explained</div>
  <p>The extension detects <strong>5 states</strong> from your AI tool and responds with lights, sounds, glow, and mascot animations:</p>
  <table>
    <thead>
      <tr><th>State</th><th>What's Happening</th><th>What You'll See</th></tr>
    </thead>
    <tbody>
      <tr>
        <td><strong>Idle</strong></td>
        <td>Nothing is happening — AI is not active</td>
        <td>Calm, static light color. No sounds. Mascot hidden.</td>
      </tr>
      <tr>
        <td><strong>Thinking</strong></td>
        <td>AI is reasoning and processing your request</td>
        <td>Pulsing light, thinking sound plays, mascot animates.</td>
      </tr>
      <tr>
        <td><strong>Editing</strong></td>
        <td>AI is actively writing or modifying code</td>
        <td>Flash or color change, editing sound plays.</td>
      </tr>
      <tr>
        <td><strong>Waiting for Input</strong></td>
        <td>AI needs your attention or approval</td>
        <td>Alert-colored pulse (usually red), attention sound, mascot reacts.</td>
      </tr>
      <tr>
        <td><strong>Complete</strong></td>
        <td>AI has finished its task</td>
        <td>Green pulse, completion sound, mascot celebrates.</td>
      </tr>
    </tbody>
  </table>
</div>

<!-- 9. Known Limitations -->
<div class="card">
  <div class="card-title">\u{26A0}\uFE0F Known Limitations</div>
  <ul>
    <li><strong>Light sync</strong> currently only works with <strong>TP-Link Tapo</strong> lights (tested on Tapo L900-5). Support for Philips Hue, LIFX, and others is coming soon.</li>
    <li><strong>Sync isn't 100% perfect</strong> — sometimes the complete state may briefly show while the AI is still thinking, and the complete state can take a few seconds to reflect after the AI finishes.</li>
    <li><strong>AI tool support</strong> currently only works with <strong>Claude Code</strong>. Support for Cursor, Antigravity, GitHub Copilot, and others is planned if there's demand.</li>
  </ul>
</div>

<!-- 10. Contribute & Contact -->
<div class="card">
  <div class="card-title">\u{1F91D} Contribute & Contact</div>
  <p>This is an <strong>open-source project</strong> and anyone is welcome to contribute, fork, or build upon it!</p>
  <ul>
    <li><strong>GitHub:</strong> <a href="https://github.com/vibesynctech/vibesync">github.com/vibesynctech/vibesync</a> — report bugs, suggest features, or submit PRs</li>
    <li><strong>Contact:</strong> <a href="mailto:himmu1144@gmail.com">himmu1144@gmail.com</a> — for collaboration, hiring, or just to say hi</li>
  </ul>
  <p>If you enjoy the extension, consider starring the repo \u{2B50} — it helps a lot!</p>
</div>

<div class="footer">VibeSync \u{1F3AE} — Made with love</div>

</body>
</html>`;
  }
}
