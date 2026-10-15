"""Encode static originals without resizing; batch mode caches verified outputs."""
import argparse
import hashlib
import json
from concurrent.futures import ThreadPoolExecutor
import os
from pathlib import Path

import PIL
from PIL import Image, ImageOps, ImageFilter, features


def compress_avif(source: Path, destination: Path, quality: int = 50, subsampling: str = "4:2:0", sharpen: bool = False) -> None:
    if not features.check("avif"):
        raise RuntimeError("This Pillow installation does not support AVIF. Upgrade it: python -m pip install --upgrade Pillow")
    if source.resolve() == destination.resolve():
        raise ValueError("Source and destination must be different files.")
    if not 0 <= quality <= 100:
        raise ValueError("Quality must be between 0 and 100.")
    if subsampling not in ("4:2:0", "4:2:2", "4:4:4"):
        raise ValueError("Unsupported chroma subsampling.")
    original_size = source.stat().st_size
    with Image.open(source) as original:
        if getattr(original, "n_frames", 1) > 1:
            raise ValueError("This script only supports static images.")
        image = ImageOps.exif_transpose(original).convert("RGBA")
        if image.getchannel("A").getextrema() == (255, 255):
            image = image.convert("RGB")
        if sharpen:
            # Restore edge contrast lost while rasterizing transformed artwork.
            # Never sharpen alpha: transparent masks must retain their contours.
            alpha = image.getchannel("A") if image.mode == "RGBA" else None
            image = image.convert("RGB").filter(ImageFilter.UnsharpMask(radius=0.7, percent=100, threshold=2))
            if alpha is not None:
                image.putalpha(alpha)
        destination.parent.mkdir(parents=True, exist_ok=True)
        temporary = destination.with_name(destination.name + ".tmp")
        try:
            image.save(temporary, format="AVIF", quality=quality, speed=0,
                       subsampling=subsampling, max_threads=4)
            temporary.replace(destination)
        finally:
            temporary.unlink(missing_ok=True)
        width, height = image.size
    compressed_size = destination.stat().st_size
    print(f"Saved: {destination} | {width} x {height} | {original_size:,} -> {compressed_size:,} bytes | "
          f"reduction {(1-compressed_size/original_size)*100:.1f}% | {original_size/compressed_size:.2f}x", flush=True)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def compress_batch(manifest: Path, quality: int, subsampling: str = "4:2:0", sharpen: bool = False):
    cache_path = Path("private/image-compression-cache.json")
    legacy_cache = json.loads(cache_path.read_text()) if cache_path.exists() else {}
    cache_directory = Path("private/image-compression-cache")
    cache_directory.mkdir(parents=True, exist_ok=True)

    def encode(job):
        source, destination = Path(job["source"]), Path(job["destination"])
        job_quality = job.get("quality", quality)
        job_subsampling = job.get("subsampling", subsampling)
        job_sharpen = job.get("sharpen", sharpen)
        settings = f"Pillow {PIL.__version__};q={job_quality};speed=0;subsampling={job_subsampling};threads=4;exif=transpose"
        if job_sharpen:
            settings += ";sharpen=unsharp:0.7,100,2"
        key = destination.as_posix()
        entry_path = cache_directory / (hashlib.sha256(key.encode()).hexdigest() + ".json")
        source_hash = digest(source)
        previous = json.loads(entry_path.read_text()) if entry_path.exists() else legacy_cache.get(key, {})
        if (previous.get("sourceSha256") == source_hash and previous.get("settings") == settings
                and destination.exists() and previous.get("sha256") == digest(destination)):
            print(f"Cached: {destination}", flush=True)
            return
        compress_avif(source, destination, job_quality, job_subsampling, job_sharpen)
        entry = {"sourceSha256": source_hash, "sha256": digest(destination), "settings": settings}
        temporary = entry_path.with_suffix(f".{os.getpid()}.tmp")
        temporary.write_text(json.dumps(entry, indent=2) + "\n")
        temporary.replace(entry_path)

    # Independent files may encode concurrently; each encoder uses at most 4 threads.
    with ThreadPoolExecutor(max_workers=4) as workers:
        list(workers.map(encode, json.loads(manifest.read_text(encoding="utf-8"))))


def main():
    parser = argparse.ArgumentParser(description="Compress static images to AVIF without resizing.")
    parser.add_argument("source", type=Path, nargs="?")
    parser.add_argument("destination", type=Path, nargs="?")
    parser.add_argument("--batch", type=Path, help="JSON array of source/destination pairs")
    parser.add_argument("-q", "--quality", type=int, default=50, choices=range(101), metavar="0-100")
    parser.add_argument("--subsampling", default="4:2:0", choices=("4:2:0", "4:2:2", "4:4:4"))
    parser.add_argument("--sharpen", action="store_true", help="Restore rasterized artwork edge contrast without resizing")
    args = parser.parse_args()
    if args.batch:
        compress_batch(args.batch, args.quality, args.subsampling, args.sharpen)
    elif args.source:
        compress_avif(args.source, args.destination or args.source.with_suffix(".avif"), args.quality, args.subsampling, args.sharpen)
    else:
        parser.error("source or --batch is required")


if __name__ == "__main__":
    main()
