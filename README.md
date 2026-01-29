# ⚡ RSVP Reader

A modern, feature-rich speed reading application using Rapid Serial Visual Presentation (RSVP) technology. Read faster, retain more.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![PWA Ready](https://img.shields.io/badge/PWA-ready-brightgreen.svg)
![No Dependencies](https://img.shields.io/badge/dependencies-none-success.svg)

## 🎯 What is RSVP?

RSVP (Rapid Serial Visual Presentation) displays text one word at a time at a fixed point, eliminating eye movement and allowing you to read significantly faster than traditional reading methods. Studies show readers can achieve 2-3x their normal reading speed with practice.

## ✨ Features

### Core Reading
- **Adjustable WPM** — Read from 100 to 1000+ words per minute
- **ORP Highlighting** — Optimal Recognition Point highlights the focus letter in each word
- **Bionic Reading Mode** — Bold the first portion of words for faster recognition
- **Peripheral Preview** — See previous/next words faded alongside the current word
- **Chunk Reading** — Display 1-3 words at a time

### Customization
- **14 Color Themes** — Dark and light themes with multiple accent colors
- **Custom Accent Colors** — Pick any color you like
- **Multiple Fonts** — Serif, sans-serif, monospace, and OpenDyslexic for accessibility
- **Adjustable Font Size** — Comfortable reading at any screen size

### Smart Features
- **Warmup Mode** — Gradually increase speed at the start of each session
- **Punctuation Pauses** — Automatic pauses at sentence endings for natural rhythm
- **Comprehension Checks** — Periodic quizzes to ensure retention
- **Speed Training** — Progressive speed increases to push your limits

### Reading Management
- **Library** — Save texts and track reading progress
- **Import Options** — Paste text, fetch from URL, or upload files (TXT, PDF, EPUB, DOCX, HTML)
- **Progress Tracking** — Statistics on words read, time spent, and reading streaks
- **Focus Mode** — Fullscreen distraction-free reading

### Accessibility
- **Keyboard Shortcuts** — Full keyboard navigation
- **Customizable Keybindings** — Remap any shortcut
- **Screen Reader Support** — Proper ARIA labels throughout
- **OpenDyslexic Font** — Improved readability for dyslexic readers

### Technical
- **Works Offline** — Full PWA support, install on any device
- **No Account Required** — All data stored locally in your browser
- **No Dependencies** — Pure vanilla JavaScript, fast and lightweight
- **Privacy First** — No tracking, no analytics sent anywhere

## 🚀 Quick Start

1. **Paste or import text** — Use the text area, fetch a URL, or upload a file
2. **Click "Start Reading"** — Begin your speed reading session
3. **Press Space** — Play/pause at any time
4. **Adjust WPM** — Use arrow keys or the controls to find your sweet spot

## ⌨️ Keyboard Shortcuts

| Action | Default Key |
|--------|-------------|
| Play / Pause | `Space` |
| Previous Word | `←` |
| Next Word | `→` |
| Increase Speed | `↑` |
| Decrease Speed | `↓` |
| Reset to Beginning | `R` |
| Show Help | `?` |
| Toggle Focus Mode | `F` |
| Skip Comprehension | `Escape` |

All shortcuts can be customized in Settings.

## 📱 Installation

### Use Online
Simply visit the hosted version — no installation required!

### Install as App (PWA)
1. Open the site in Chrome, Edge, or Safari
2. Click the install icon in the address bar (or "Add to Home Screen" on mobile)
3. The app will work offline and feel like a native application

### Run Locally
```bash
# Clone the repository
git clone https://github.com/YOUR-USERNAME/rsvp-reader.git

# Navigate to the folder
cd rsvp-reader

# Start a local server (Python 3)
python -m http.server 8080

# Or with Node.js
npx serve .

# Open http://localhost:8080 in your browser
```

## 🛠️ Technologies

- **Vanilla JavaScript** — No frameworks, no build step
- **ES6 Modules** — Clean, maintainable code architecture
- **CSS Custom Properties** — Dynamic theming
- **Web APIs** — Service Workers, LocalStorage, File API
- **PDF.js** — PDF parsing (loaded on demand)
- **JSZip** — EPUB/DOCX parsing (loaded on demand)

## 📂 Project Structure

```
rsvp-reader/
├── index.html          # Main HTML file
├── app.js              # Application entry point
├── app.css             # All styles
├── sw.js               # Service worker for offline support
├── manifest.json       # PWA manifest
│
├── config.js           # Configuration and defaults
├── state-manager.js    # Reactive state management
├── storage.js          # LocalStorage wrapper
├── event-bus.js        # Pub/sub event system
│
├── rsvp-engine.js      # Core reading engine
├── text-processor.js   # Text parsing and chunking
├── orp-calculator.js   # Optimal Recognition Point
├── timing-manager.js   # Word timing calculations
├── comprehension.js    # Comprehension check system
│
├── ui-manager.js       # UI orchestration
├── dom-cache.js        # DOM element caching
├── reader-display.js   # Word display updates
├── settings-ui.js      # Settings panel
├── panels.js           # Modal/panel management
├── theme.js            # Theme switching
├── toast.js            # Notifications
│
├── keyboard-manager.js # Keyboard shortcuts
├── sound-manager.js    # Audio feedback
├── analytics-manager.js# Reading statistics
├── library-manager.js  # Saved texts
├── profile-manager.js  # Reading profiles
└── file-import.js      # File import handling
```

## 🎨 Themes

| Dark Themes | Light Themes |
|-------------|--------------|
| Dark Orange (default) | Light Orange |
| Dark Blue | Light Blue |
| Dark Green | Light Green |
| Dark Purple | Light Purple |
| Dark Pink | Light Pink |
| Dark Teal | Light Teal |

Plus custom accent color support!

## 🤝 Contributing

Contributions are welcome! Feel free to:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- [PDF.js](https://mozilla.github.io/pdf.js/) by Mozilla for PDF parsing
- [JSZip](https://stuk.github.io/jszip/) for EPUB/DOCX support
- [OpenDyslexic](https://opendyslexic.org/) font for accessibility
- The speed reading research community

---

<p align="center">
  Made with ❤️ for faster reading
</p>
