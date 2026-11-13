# Contributing to NeuroMirror

Thank you for your interest in contributing to **NeuroMirror**! We welcome improvements, bug reports, and optimizations for real-time anatomical augmented reality.

---

## Getting Started

1. **Fork the Repository** to your own GitHub account.
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/<your-username>/NeuroMirror.git
   cd NeuroMirror
   ```
3. **Run a local test server**:
   NeuroMirror requires a local server or secure origin (HTTPS/localhost) to access webcam media streams:
   ```bash
   python -m http.server 8000
   # or with Node:
   npx serve .
   ```
4. Open `http://localhost:8000` or `http://localhost:8000/#demo` in your browser.

---

## Development Guidelines

- **Zero External Backend**: NeuroMirror runs entirely on the client side using WebAssembly and WebGL. Avoid adding server-side requirements.
- **Performance First**: Landmark tracking and shader passes must sustain 60 FPS on standard desktop and mobile hardware.
- **Anatomical Accuracy**: When adjusting mesh vertices, jaw pivot hinges, or landmark fit anchors, verify anatomical alignment against standard cranial coordinates.
- **Code Style**:
  - Keep JavaScript clean, modern, and modular.
  - Test UI responsiveness on both mobile viewports and desktop resolutions.
  - Verify offline test mode (`#demo`) remains functional.

---

## Submitting Pull Requests

1. Create a feature branch:
   ```bash
   git checkout -b feature/your-feature-name
   ```
2. Commit your changes with clear, descriptive commit messages:
   ```bash
   git commit -m "feat: optimize shader pass for mobile WebGL"
   ```
3. Push to your fork:
   ```bash
   git push origin feature/your-feature-name
   ```
4. Open a Pull Request against the `main` branch with details on what you changed and test results.
