# PDF++ Region Editor 0.4.3

- Add the MIT license, copyright attribution and license metadata.
- Validate Markdown link editing, PDF viewer editing, Excalidraw crop/frame synchronization, disk persistence, undo, concurrent-edit protection and plugin reload in the running Obsidian application.
- Set the minimum Obsidian version to 1.15.0, the version actually tested, replacing the unverified 1.6.5 minimum for this release.
- Add a compatibility record documenting 28 application-level checks and 18 unit tests.

Tested on macOS 15.7.9 with Obsidian 1.15.0, PDF++ 0.40.31 and Excalidraw 2.29.1. Windows, Linux, mobile and older Obsidian versions have not been tested. Interface language: Chinese.

This is an independent companion to PDF++. It updates note links and Excalidraw crops; it does not modify the original PDF.

Install the individual `main.js`, `manifest.json` and `styles.css` assets into `<vault>/.obsidian/plugins/pdf-rect-editor/` and enable **PDF++ Region Editor**. Enable PDF++ for in-viewer editing and Excalidraw for drawing integration.
