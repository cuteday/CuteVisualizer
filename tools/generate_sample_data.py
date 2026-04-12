#!/usr/bin/env python3
"""Generate demo PNG folders for CuteVisualizer.

The sample output is intentionally small, cute, and safe to overwrite because
it only touches method folders whose names start with ``demo-``.
"""

from __future__ import annotations

import argparse
import math
import pathlib
import shutil
import struct
import zlib
from dataclasses import dataclass
from typing import Iterable, Tuple


REPO_ROOT = pathlib.Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT_DIR = REPO_ROOT / "public" / "data" / "methods"


Color = Tuple[int, int, int]


@dataclass(frozen=True)
class SceneSpec:
    key: str
    size: Tuple[int, int]
    sky_top: Color
    sky_bottom: Color
    accent: Color
    detail: Color
    seed: int


@dataclass(frozen=True)
class MethodSpec:
    folder: str
    tint: Color
    brightness: float
    contrast: float
    sparkle: float


SCENES = (
    SceneSpec(
        key="blossom-bridge.png",
        size=(960, 540),
        sky_top=(255, 208, 223),
        sky_bottom=(255, 246, 250),
        accent=(196, 92, 134),
        detail=(108, 132, 210),
        seed=11,
    ),
    SceneSpec(
        key="cafe-window.png",
        size=(960, 540),
        sky_top=(247, 216, 194),
        sky_bottom=(255, 244, 226),
        accent=(189, 123, 88),
        detail=(99, 135, 160),
        seed=23,
    ),
    SceneSpec(
        key="garden-path.png",
        size=(900, 600),
        sky_top=(208, 234, 213),
        sky_bottom=(245, 255, 247),
        accent=(87, 154, 102),
        detail=(210, 118, 86),
        seed=37,
    ),
    SceneSpec(
        key="details/petal-lantern.png",
        size=(720, 720),
        sky_top=(233, 214, 255),
        sky_bottom=(250, 244, 255),
        accent=(152, 102, 198),
        detail=(255, 170, 132),
        seed=49,
    ),
    SceneSpec(
        key="portraits/tea-room.png",
        size=(840, 630),
        sky_top=(219, 225, 255),
        sky_bottom=(246, 247, 255),
        accent=(114, 108, 188),
        detail=(224, 138, 152),
        seed=61,
    ),
)


METHODS = (
    MethodSpec("demo-baseline", tint=(255, 255, 255), brightness=1.00, contrast=1.00, sparkle=0.12),
    MethodSpec("demo-rose-glow", tint=(255, 218, 232), brightness=1.04, contrast=0.96, sparkle=0.14),
    MethodSpec("demo-pearl-soft", tint=(250, 240, 255), brightness=1.03, contrast=0.94, sparkle=0.09),
    MethodSpec("demo-mint-balance", tint=(220, 255, 238), brightness=1.01, contrast=1.00, sparkle=0.11),
    MethodSpec("demo-violet-boost", tint=(228, 214, 255), brightness=1.02, contrast=1.08, sparkle=0.15),
    MethodSpec("demo-amber-detail", tint=(255, 233, 206), brightness=1.02, contrast=1.10, sparkle=0.16),
    MethodSpec("demo-cotton-matte", tint=(246, 243, 242), brightness=0.98, contrast=0.92, sparkle=0.07),
    MethodSpec("demo-silver-detail", tint=(232, 236, 248), brightness=0.99, contrast=1.12, sparkle=0.18),
    MethodSpec("demo-studio-contrast", tint=(255, 246, 252), brightness=1.00, contrast=1.16, sparkle=0.13),
)


MISSING_BY_METHOD = {
    "demo-pearl-soft": {"details/petal-lantern.png"},
    "demo-mint-balance": {"portraits/tea-room.png"},
    "demo-violet-boost": {"details/petal-lantern.png"},
    "demo-amber-detail": {"garden-path.png"},
    "demo-cotton-matte": {"portraits/tea-room.png"},
    "demo-silver-detail": {"details/petal-lantern.png"},
}


def clamp_channel(value: float) -> int:
    return max(0, min(255, int(round(value))))


def lerp_color(first: Color, second: Color, ratio: float) -> Color:
    return tuple(
        clamp_channel(a + (b - a) * ratio)
        for a, b in zip(first, second)
    )


def png_chunk(chunk_type: bytes, data: bytes) -> bytes:
    crc = zlib.crc32(chunk_type + data) & 0xFFFFFFFF
    return struct.pack(">I", len(data)) + chunk_type + data + struct.pack(">I", crc)


def write_png(path: pathlib.Path, width: int, height: int, pixels: Iterable[bytes]) -> None:
    raw = bytearray()
    for row in pixels:
        raw.append(0)
        raw.extend(row)

    compressed = zlib.compress(bytes(raw), level=9)
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + png_chunk(b"IHDR", ihdr) + png_chunk(b"IDAT", compressed) + png_chunk(b"IEND", b"")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(png)


def blend(color_a: Color, color_b: Color, ratio: float) -> Color:
    return lerp_color(color_a, color_b, max(0.0, min(1.0, ratio)))


def color_math(base: Color, method: MethodSpec, detail_strength: float) -> Color:
    tinted = blend(base, method.tint, 0.18)
    contrasted = []
    for channel in tinted:
        contrasted.append((channel - 127.5) * method.contrast + 127.5)

    brightness_boost = 1.0 + detail_strength * method.sparkle
    return tuple(clamp_channel(channel * method.brightness * brightness_boost) for channel in contrasted)


def scene_pixel(scene: SceneSpec, method: MethodSpec, x: int, y: int, width: int, height: int) -> Color:
    nx = x / max(width - 1, 1)
    ny = y / max(height - 1, 1)

    sky = blend(scene.sky_top, scene.sky_bottom, ny)
    wave_a = 0.5 + 0.5 * math.sin((nx * 3.4 + scene.seed * 0.07) * math.pi)
    wave_b = 0.5 + 0.5 * math.cos((ny * 4.1 + scene.seed * 0.05) * math.pi)
    swirl = 0.5 + 0.5 * math.sin((nx + ny) * 7.0 * math.pi + scene.seed * 0.2)
    detail_mix = 0.18 * wave_a + 0.12 * wave_b + 0.1 * swirl
    color = blend(sky, scene.accent, detail_mix)

    focus_x = 0.2 + (scene.seed % 5) * 0.13
    focus_y = 0.28 + (scene.seed % 3) * 0.14
    distance = math.hypot(nx - focus_x, ny - focus_y)
    glow = max(0.0, 1.0 - distance / 0.22)
    color = blend(color, scene.detail, glow * 0.55)

    center_ring = abs(math.hypot(nx - 0.5, ny - 0.5) - 0.18) < 0.008
    center_cross = abs(nx - 0.5) < 0.002 or abs(ny - 0.5) < 0.002
    panel = 0.1 < nx < 0.9 and 0.16 < ny < 0.84
    frame = panel and (
        abs(nx - 0.1) < 0.004 or
        abs(nx - 0.9) < 0.004 or
        abs(ny - 0.16) < 0.004 or
        abs(ny - 0.84) < 0.004
    )
    path_band = 0.42 + 0.07 * math.sin(nx * math.pi * (1.6 + scene.seed * 0.01))
    walkway = ny > path_band and abs(nx - 0.5) < (ny - path_band) * 0.65 + 0.08

    if walkway:
        color = blend(color, scene.detail, 0.28)
    if frame:
        color = blend(color, (255, 255, 255), 0.65)
    if center_ring or center_cross:
        color = blend(color, (255, 255, 255), 0.8)

    sparkle = 0.5 + 0.5 * math.sin((nx * 14.0 + ny * 11.0 + scene.seed) * math.pi)
    return color_math(color, method, sparkle)


def render_scene(scene: SceneSpec, method: MethodSpec, output_path: pathlib.Path) -> None:
    width, height = scene.size
    rows = []
    for y in range(height):
        row = bytearray()
        for x in range(width):
            row.extend(scene_pixel(scene, method, x, y, width, height))
        rows.append(bytes(row))

    write_png(output_path, width, height, rows)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate CuteVisualizer demo PNG folders.")
    parser.add_argument(
        "--output-dir",
        type=pathlib.Path,
        default=DEFAULT_OUTPUT_DIR,
        help=f"Where demo method folders should be written. Default: {DEFAULT_OUTPUT_DIR}",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)

    for method in METHODS:
        method_dir = args.output_dir / method.folder
        if method_dir.exists():
            shutil.rmtree(method_dir)
        method_dir.mkdir(parents=True, exist_ok=True)

        missing = MISSING_BY_METHOD.get(method.folder, set())
        for scene in SCENES:
            if scene.key in missing:
                continue
            render_scene(scene, method, method_dir / scene.key)

    print(
        f"Generated {len(METHODS)} demo method folder(s) with {len(SCENES)} base image key(s) in {args.output_dir}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
