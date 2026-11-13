# Security Policy

## Supported Versions

NeuroMirror is a client-side web application. Security updates and patches are continuously applied to the latest `main` branch.

| Version | Supported |
| :--- | :--- |
| `main` | :white_check_mark: Active |

## Camera & Vision Privacy

- **Local Processing**: All video streaming, facial landmark estimation, and 3D rendering take place entirely within the user's browser sandbox using WebAssembly and WebGL.
- **Zero Ingestion**: NeuroMirror transmits zero camera images, video frames, or landmark coordinates over any network.

## Reporting a Vulnerability

If you discover a security flaw or vulnerability within NeuroMirror, please report it privately via GitHub Security Advisories or by emailing:
`116977270+ATLURI0001@users.noreply.github.com`.

Please provide:
1. Description of the issue
2. Steps to reproduce
3. Potential impact

We appreciate responsible disclosure and will respond promptly to investigate and resolve issues.
