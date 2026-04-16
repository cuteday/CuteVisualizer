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
import os
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
    metadata: Dict[str, object]


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


def lexical_abspath(path: pathlib.Path) -> pathlib.Path:
    """Return an absolute path without dereferencing symlinks."""
    return pathlib.Path(os.path.abspath(os.fspath(path)))


def relative_to_root(path: pathlib.Path, root: pathlib.Path) -> str:
    return lexical_abspath(path).relative_to(lexical_abspath(root)).as_posix()


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


def load_existing_method_metadata(output_path: pathlib.Path) -> Dict[str, Dict[str, Dict[str, object]]]:
    if not output_path.exists():
        return {}

    try:
        manifest = json.loads(output_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}

    metadata_by_image: Dict[str, Dict[str, Dict[str, object]]] = {}

    for image_entry in manifest.get("images", []):
        image_key = image_entry.get("key")
        if not isinstance(image_key, str):
            continue

        method_metadata: Dict[str, Dict[str, object]] = {}

        methods_record = image_entry.get("methods")
        if isinstance(methods_record, dict):
            for method_id, method_entry in methods_record.items():
                if not isinstance(method_id, str) or not isinstance(method_entry, dict):
                    continue
                metadata = method_entry.get("metadata", {})
                if isinstance(metadata, dict):
                    method_metadata[method_id] = metadata

        legacy_metadata = image_entry.get("metadata")
        if isinstance(legacy_metadata, dict):
            for method_id, method_entry in legacy_metadata.items():
                if not isinstance(method_id, str) or method_id in method_metadata:
                    continue
                if not isinstance(method_entry, dict):
                    continue
                if "metadata" in method_entry and isinstance(method_entry["metadata"], dict):
                    method_metadata[method_id] = method_entry["metadata"]
                else:
                    method_metadata[method_id] = method_entry

        if method_metadata:
            metadata_by_image[image_key] = method_metadata

    return metadata_by_image


def load_existing_method_records(output_path: pathlib.Path) -> Dict[str, Dict[str, object]]:
    if not output_path.exists():
        return {}

    try:
        manifest = json.loads(output_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}

    method_records: Dict[str, Dict[str, object]] = {}
    for method_entry in manifest.get("methods", []):
        if not isinstance(method_entry, dict):
            continue
        method_id = method_entry.get("id")
        if not isinstance(method_id, str):
            continue
        metadata = method_entry.get("metadata")
        if isinstance(metadata, dict):
            method_records[method_id] = metadata
    return method_records


def merge_json_objects(base, override):
    if not isinstance(base, dict):
        return override
    if not isinstance(override, dict):
        return override

    merged = dict(base)
    for key, value in override.items():
        if key in merged and isinstance(merged[key], dict) and isinstance(value, dict):
            merged[key] = merge_json_objects(merged[key], value)
        else:
            merged[key] = value
    return merged


def load_method_metadata_file(method_dir: pathlib.Path):
    metadata_path = method_dir / "metadata.json"
    if not metadata_path.exists():
        return None, None, {}, {}

    try:
        payload = json.loads(metadata_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"Failed to parse metadata file {metadata_path}: {error}") from error

    if not isinstance(payload, dict):
        raise ValueError(f"Method metadata file must contain a JSON object: {metadata_path}")

    method_id_override = payload.get("id")
    if method_id_override is not None and not isinstance(method_id_override, str):
        raise ValueError(f"metadata.json field 'id' must be a string in {metadata_path}")

    method_label_override = payload.get("label")
    if method_label_override is not None and not isinstance(method_label_override, str):
        raise ValueError(f"metadata.json field 'label' must be a string in {metadata_path}")

    has_explicit_method_metadata = "method" in payload
    method_metadata = payload.get("method")
    if method_metadata is None:
        method_metadata = {}
    elif not isinstance(method_metadata, dict):
        raise ValueError(f"metadata.json field 'method' must be a JSON object in {metadata_path}")

    # Backward-compatibility path:
    # If there is no explicit "method" object, treat top-level scalar values
    # as method-level metadata. Object-valued keys remain reserved for
    # per-image metadata below.
    if not has_explicit_method_metadata:
        for key, value in payload.items():
            if key in {"id", "label", "method"}:
                continue
            if isinstance(value, (str, int, float, bool)) or value is None:
                method_metadata[key] = value

    image_metadata = {}
    for key, value in payload.items():
        if key in {"id", "label", "method"}:
            continue
        if isinstance(value, dict):
            image_metadata[key] = value

    return method_id_override, method_label_override, method_metadata, image_metadata


def build_manifest(
    methods_dir: pathlib.Path,
    output_path: pathlib.Path,
    web_root: pathlib.Path,
    match_mode: str,
    extensions: Iterable[str],
) -> Dict[str, object]:
    methods_dir = lexical_abspath(methods_dir)
    output_path = lexical_abspath(output_path)
    web_root = lexical_abspath(web_root)

    methods_dir.mkdir(parents=True, exist_ok=True)
    output_path.parent.mkdir(parents=True, exist_ok=True)

    if web_root not in methods_dir.parents and methods_dir != web_root:
        raise ValueError(f"Methods directory {methods_dir} must live under web root {web_root}.")

    existing_metadata = load_existing_method_metadata(output_path)
    existing_method_records = load_existing_method_records(output_path)
    method_dirs = sorted(
        [path for path in methods_dir.iterdir() if path.is_dir() and not path.name.startswith(".")],
        key=lambda path: path.name.lower(),
    )

    method_slug_cache: set[str] = set()
    methods: List[MethodRecord] = []
    image_map: Dict[str, Dict[str, object]] = {}

    for method_dir in method_dirs:
        method_id_override, method_label_override, method_metadata, image_metadata = load_method_metadata_file(method_dir)
        method_id = make_unique_slug(method_id_override or method_dir.name, method_slug_cache)
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
                    "methods": {},
                },
            )
            image_entry["methods"][method_id] = {
                "path": relative_to_root(image_file, web_root),
                "metadata": merge_json_objects(
                    existing_metadata.get(image_key, {}).get(method_id, {}),
                        image_metadata.get(image_key)
                        or image_metadata.get(relative_path)
                        or image_metadata.get(image_file.name)
                        or {},
                ),
            }

        methods.append(
            MethodRecord(
                method_id=method_id,
                label=method_label_override or method_dir.name,
                relative_dir=relative_to_root(method_dir, web_root),
                image_count=len(image_files),
                preview_image_key=preview_key,
                metadata=merge_json_objects(
                    existing_method_records.get(method_id, {}),
                    method_metadata,
                ),
            )
        )

    images = []
    for image_key in sorted(image_map, key=lambda key: image_map[key]["sortKey"]):
        image_entry = image_map[image_key]
        image_entry["methods"] = {
            method_id: image_entry["methods"][method_id]
            for method_id in sorted(image_entry["methods"])
        }
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
                "metadata": method.metadata,
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
