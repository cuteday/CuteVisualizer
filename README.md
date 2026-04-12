## CuteVisualizer

**[Demo Website](https://cuteday.github.io/CuteVisualizer/)**

CuteVisualizer is a static web app for comparing image outputs from multiple methods side by side. It is designed for model-output validation, but it stays general-purpose: the app only cares about folders of images and a generated manifest.

### Features

- compares up to 9 methods at once with an automatic `1x1` to `3x3` layout
- keeps zoom and pan synchronized across every visible panel
- shows a left-side image browser and a top method selector with disabled states for missing images
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

## Usage Notes

- Use the top checkbox row to choose which methods are visible.
- Use the left sidebar to select the image key being compared.
- Scroll inside any comparison panel to zoom.
- Drag with the left mouse button to pan once zoomed in.
- Use `Reset View` to return to the fit-to-panel view.
- Reload the page or click `Reload Manifest` after regenerating the manifest.

## License

I don't license this repository so feel free to use it for any purpose. Credit or citation is not required.