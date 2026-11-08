# Compatibility test record

Date: 2026-11-08. Plugin version: 0.4.3.

## Environment

| Component | Version |
| --- | --- |
| macOS | 15.7.9 |
| Obsidian application and installer | 1.15.0 |
| Electron | 43.8.4 |
| PDF++ | 0.40.31 |
| Excalidraw | 2.29.1 |
| Node.js for unit tests and build | 25.8.1 |

## Method

The application-level checks ran inside a real, already-running Obsidian development vault through the official Obsidian CLI `eval` interface. They used the installed plugins, real PDF.js rendering, actual Markdown editor instances, the vault filesystem and actual Excalidraw views. They were not mocked unit tests.

A dedicated QA folder contained only synthetic data: a two-page PDF with an unrotated and a 90-degree page, a note with two identical region links and a rotated-page link, and a separate Excalidraw drawing with a native PDF crop inside an independent frame. Existing research notes and drawings were not edited by the test scripts.

The scripts invoked commands, edit/save/undo handlers, a context-menu event and an Escape key event, then asserted editor content, scene data and persisted files. The PDF and the real editor dialog were also visually inspected from screenshots. This does not constitute a full physical-mouse, keyboard-accessibility or cross-platform interaction test.

## Results

All 28 distinct application-level assertions passed. The individual results are in [compatibility-results.json](compatibility-results.json).

| Area | Verified behavior |
| --- | --- |
| Markdown | Real PDF loads in the dialog; saving changes only the selected occurrence; editor undo restores the source; cancellation makes no change |
| Rotation | Preview rotates 90 degrees and saves correct PDF coordinates; a PDF page with native 90-degree rotation loads |
| Concurrency | A changed Markdown note or moved Excalidraw image refuses a stale save |
| PDF viewer | All fixture links are discovered; edit mode activates; resize saves; duplicate links and colors are preserved; undo restores the source; Escape exits without saving |
| Closed note | Saving and undo work through the vault filesystem when no note editor is open |
| Excalidraw | Native PDF crop opens in the editor; crop dimensions, display size, link and frame update together; changes persist on disk; undo restores the crop and frame |
| Closed drawing | A drawing closed while its edit dialog is open reopens for saving; undo restores the source |
| Context menu | Existing menu items remain present and the region-edit action is added |
| Lifecycle | Unload removes overlays and restores the menu method; reload succeeds |

The existing 18 unit tests additionally cover coordinate conversion, all eight resize handles, link/color preservation, shared-frame rejection, rotated-element rejection, save failure rollback and concurrent-edit protection. Build and JavaScript syntax checks also passed.

## Observations and limits

- Excalidraw normalizes short PDF paths into full vault-relative paths when serializing. The drawing fixture was adjusted to its canonical storage format before the final save/reopen checks.
- Opening the PDF initially emitted `Failed to initialize pdf navigator: TypeError: Cannot read properties of null (reading 'eventBus')`. The viewer subsequently loaded, and the region-editing checks passed. The cause of this initial navigator message was not established; it is not claimed as fixed by this release.
- No captured application errors or console errors were reported in the final checked run after debugger capture was enabled.
- This was one existing development vault with other installed plugins, not a clean-vault or multi-device matrix.
- Windows, Linux, mobile, old Obsidian builds, external/dummy PDFs, encrypted PDFs, very large files and multiwindow interactions were not tested.
- Version 0.4.3 conservatively requires Obsidian 1.15.0. The old 0.4.2 version mapping is retained as release history, not evidence that 1.6.5 was tested.
