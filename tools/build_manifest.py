#!/usr/bin/env python3
"""Build a static manifest for CuteVisualizer.

The manifest describes which images exist under each method folder so the
browser-only app can populate its image list and comparison grid without any
server-side directory listing.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import pathlib
import re
import sys
from dataclasses import dataclass
from typing import Dict, Iterable, List


REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
DEFAULT_METHODS_DIR = REPO_ROOT / "public" / "data" / "methods"
DEFAULT_OUTPUT = REPO_ROOT / "public" / "data" / "manifest.json"
DEFAULT_WEB_ROOT = REPO_ROOT
DEFAULT_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".svg", ".avif")


@dataclass
class MethodRecord:
    method_id: str
    label: str
    relative_dir: str
    image_count: int
    preview_image_key: str | None


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "item"


def make_unique_slug(value: str, used: set[str]) -> str:
    candidate = slugify(value)
    if candidate not in used:
      used.add(candidate)
      return candidate

    index = 2
    while f"{candidate}-{index}" in used:
      index += 1

    unique = f"{candidate}-{index}"
    used.add(unique)
    return unique


def make_image_id(image_key: str) -> str:
    digest = hashlib.sha1(image_key.encode("utf-8")).hexdigest()[:8]
    return f"{slugify(pathlib.PurePosixPath(image_key).stem)}-{digest}"


def relative_to_root(path: pathlib.Path, root: pathlib.Path) -> str:
    return path.resolve().relative_to(root.resolve()).as_posix()


def is_hidden(path: pathlib.Path, root: pathlib.Path) -> bool:
    relative_parts = path.relative_to(root).parts
    return any(part.startswith(".") for part in relative_parts)


def iter_image_files(method_dir: pathlib.Path, extensions: Iterable[str]) -> List[pathlib.Path]:
    ext_set = {ext.lower() for ext in extensions}
    files = [
        path
        for path in method_dir.rglob("*")
        if path.is_file() and path.suffix.lower() in ext_set and not is_hidden(path, method_dir)
    ]
    return sorted(files, key=lambda path: path.relative_to(method_dir).as_posix())


def build_manifest(
    methods_dir: pathlib.Path,
    output_path: pathlib.Path,
    web_root: pathlib.Path,
    match_mode: str,
    extensions: Iterable[str],
) -> Dict[str, object]:
    methods_dir = methods_dir.resolve()
    output_path = output_path.resolve()
    web_root = web_root.resolve()

    methods_dir.mkdir(parents=True, exist_ok=True)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    if web_root not in methods_dir.parents and methods_dir != web_root:
        raise ValueError(f"Methods directory {methods_dir} must live under web root {web_root}.")

    method_dirs = sorted(
        [path for path in methods_dir.iterdir() if path.is_dir() and not path.name.startswith(".")],
        key=lambda path: path.name.lower(),
    )

    method_slug_cache: set[str] = set()
    methods: List[MethodRecord] = []
    image_map: Dict[str, Dict[str, object]] = {}

    for method_dir in method_dirs:
        method_id = make_unique_slug(method_dir.name, method_slug_cache)
        image_files = iter_image_files(method_dir, extensions)

        preview_key = None
        seen_keys: Dict[str, pathlib.Path] = {}
        for image_file in image_files:
            relative_path = image_file.relative_to(method_dir).as_posix()
            image_key = relative_path if match_mode == "relative" else image_file.name
            if image_key in seen_keys:
                previous_path = seen_keys[image_key].relative_to(method_dir).as_posix()
                current_path = image_file.relative_to(method_dir).as_posix()
                raise ValueError(
                    f"Duplicate key '{image_key}' inside method '{method_dir.name}' for "
                    f"{previous_path} and {current_path}. Consider using relative-path matching."
                )

            seen_keys[image_key] = image_file
            preview_key = preview_key or image_key

            image_entry = image_map.setdefault(
                image_key,
                {
                    "id": make_image_id(image_key),
                    "key": image_key,
                    "label": image_file.name,
                    "sortKey": image_key.lower(),
                    "availableIn": [],
                    "paths": {},
                },
            )
            image_entry["availableIn"].append(method_id)
            image_entry["paths"][method_id] = relative_to_root(image_file, web_root)

        methods.append(
            MethodRecord(
                method_id=method_id,
                label=method_dir.name,
                relative_dir=relative_to_root(method_dir, web_root),
                image_count=len(image_files),
                preview_image_key=preview_key,
            )
        )

    images = []
    for image_key in sorted(image_map, key=lambda key: image_map[key]["sortKey"]):
        image_entry = image_map[image_key]
        image_entry["availableIn"] = sorted(image_entry["availableIn"])
        images.append(image_entry)

    manifest = {
        "version": 1,
        "generatedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "methodsRoot": relative_to_root(methods_dir, web_root),
        "matchMode": match_mode,
        "supportedExtensions": list(extensions),
        "methods": [
            {
                "id": method.method_id,
                "label": method.label,
                "path": method.relative_dir,
                "imageCount": method.image_count,
                "previewImageKey": method.preview_image_key,
            }
            for method in methods
        ],
        "images": images,
    }

    output_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build a CuteVisualizer manifest from method folders.")
    parser.add_argument(
        "--methods-dir",
        type=pathlib.Path,
        default=DEFAULT_METHODS_DIR,
        help=f"Directory containing one folder per method. Default: {DEFAULT_METHODS_DIR}",
    )
    parser.add_argument(
        "--output",
        type=pathlib.Path,
        default=DEFAULT_OUTPUT,
        help=f"Output manifest path. Default: {DEFAULT_OUTPUT}",
    )
    parser.add_argument(
        "--web-root",
        type=pathlib.Path,
        default=DEFAULT_WEB_ROOT,
        help="Filesystem root that will be served by the static web server. Paths in the manifest are made relative to this root.",
    )
    parser.add_argument(
        "--match",
        choices=("relative", "basename"),
        default="relative",
        help="How images from different methods are matched together.",
    )
    parser.add_argument(
        "--extensions",
        nargs="+",
        default=list(DEFAULT_EXTENSIONS),
        help="Image extensions to index.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        manifest = build_manifest(
            methods_dir=args.methods_dir,
            output_path=args.output,
            web_root=args.web_root,
            match_mode=args.match,
            extensions=args.extensions,
        )
    except ValueError as error:
        print(f"Error: {error}", file=sys.stderr)
        return 1

    print(
        "Built manifest with "
        f"{len(manifest['methods'])} method(s) and {len(manifest['images'])} image key(s): {args.output}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
