## CuteVisualizer

**[Demo Website](https://cuteday.github.io/CuteVisualizer/)**

CuteVisualizer is a static web app for comparing image outputs from multiple methods.

### Features

- compares any number of methods with automatic layouts
- supports `Grids`, `Switch`, and `Data` modes for image comparison and metadata inspection
- keeps zoom and pan synchronized across every visible image panel and stores the current view in a shareable URL
- supports optional per-method `metadata.json` files, shown in the Info drawer and in `Data` mode tables
- supports a cute, clean theme with a default blossom-pink accent and a persistent custom color picker
- runs as plain static files with no backend

## Folder Convention

Put one folder per method under:

```text
public/data/methods/
```

Example:

```text
public/data/methods/
  method_a/
    scene_001.png
    scene_002.png
    details/closeup.png
  method_b/
    scene_001.png
    scene_002.png
```

The folder name becomes the default method name in the UI.

By default, images are matched across methods using their relative path inside each method folder. That means `details/closeup.png` is treated as the same comparison key in every method that contains it.

## Optional Metadata

Each method folder may also include a `metadata.json` file:

```text
public/data/methods/
  method_a/
    metadata.json
    scene_001.png
    details/closeup.png
```

Supported shape:

```json
{
  "label": "Friendly Method Name",
  "method": {
    "Checkpoint": "demo://checkpoints/method_a/snapshot-001.pkl",
    "Mood": "calm but caffeinated"
  },
  "scene_001.png": {
    "MSE (Full Image)": 0.00123,
    "Tea Rating": "surprisingly cozy"
  },
  "details/closeup.png": {
    "Sparkle Drift": 0.05432
  }
}
```

- top-level `method` entries become method-level metadata
- object entries keyed by image path become image-method metadata
- optional top-level `label` and `id` override the default method name and slug

These values appear in the Info drawer and in `Data` mode.

## Build The Manifest

The page does not scan directories live in the browser. Instead, run the manifest builder after adding, removing, or renaming method folders:

```bash
python tools/build_manifest.py
```

This updates:

```text
public/data/manifest.json
```

Optional flags:

```bash
python tools/build_manifest.py --match basename
python tools/build_manifest.py --methods-dir /path/to/methods --output /path/to/manifest.json
```

`--match basename` is useful when method folders have mostly the same filenames but different subdirectory layouts. If a single method contains duplicate basenames, the script will stop and ask you to use relative-path matching instead.

## Demo Sample Data

Generate the demo PNGs and matching demo metadata:

```bash
python tools/generate_sample_data.py
python tools/build_manifest.py
```

The sample-data generator writes deterministic `demo-*` method folders, including `metadata.json`, so CI and GitHub Pages builds can exercise `Switch`, `Data`, and metadata-driven UI paths.

## Usage Notes

- Use the top checkbox row to choose which methods are visible.
- Use the left sidebar to select the image key being compared.
- `Grids` shows all selected methods at once.
- `Switch` shows one selected method at a time; press `Space` to cycle.
- `Data` shows method-level and image-level metadata tables for the current image.
- Scroll inside any comparison panel to zoom.
- Drag with the left mouse button to pan once zoomed in.
- Use `Reset View` to return to the fit-to-panel view.
- Click a method label in a panel or a method column in `Data` mode to open the Info drawer.
- Reload the page or click `Reload Manifest` after regenerating the manifest.

## License

I don't license this repository so feel free to use it for any purpose. Credit or citation is not required.