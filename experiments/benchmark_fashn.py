"""Reproducible, opt-in GPU benchmark. Dry runs do not load models or images."""
from __future__ import annotations

import argparse
import hashlib
import inspect
import json
import math
from pathlib import Path
import re
import statistics
import time

PROFILES = {"fast": 20, "balanced": 30, "quality": 50}
CATEGORIES = {"tops", "bottoms", "one-pieces"}


def load_cases(manifest: Path, check_files: bool) -> list[dict]:
    data = json.loads(manifest.read_text(encoding="utf-8"))
    cases = data.get("cases", [])
    if not cases or len(cases) > 200:
        raise ValueError("Provide between 1 and 200 consented evaluation cases.")
    seen = set()
    for case in cases:
        name = case.get("id", "")
        if not re.fullmatch(r"[a-zA-Z0-9_-]{1,64}", name) or name in seen:
            raise ValueError("Each case needs a unique, filesystem-safe id.")
        seen.add(name)
        if case.get("category") not in CATEGORIES:
            raise ValueError("Unsupported category: " + str(case.get("category")))
        if case.get("garment_photo_type", "flat-lay") not in {"model", "flat-lay"}:
            raise ValueError("Invalid garment_photo_type.")
        for field in ("person", "garment"):
            case[field] = str((manifest.parent / case[field]).resolve())
            if check_files and not Path(case[field]).is_file():
                raise FileNotFoundError(case[field])
    return cases


def percentile(values: list[float], fraction: float) -> float:
    ordered = sorted(values)
    return ordered[max(0, math.ceil(len(ordered) * fraction) - 1)]


def file_hash(filename: Path) -> str:
    with filename.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--weights-dir", type=Path)
    parser.add_argument("--output", type=Path, default=Path("benchmarks/results/fashn"))
    parser.add_argument("--profiles", nargs="+", choices=list(PROFILES), default=list(PROFILES))
    parser.add_argument("--repeats", type=int, default=3)
    parser.add_argument("--warmup", type=int, default=1)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--device", choices=("cuda", "cpu"), default="cuda")
    parser.add_argument("--compile", action="store_true", help="Experimental; benchmark separately.")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--research-only", action="store_true", help="Acknowledge the default parser's research/evaluation terms.")
    args = parser.parse_args()
    if not 1 <= args.repeats <= 20 or not 0 <= args.warmup <= 10:
        parser.error("repeats must be 1..20; warmup must be 0..10.")
    cases = load_cases(args.manifest.resolve(), check_files=not args.dry_run)
    if args.dry_run:
        print(json.dumps({"cases": len(cases), "steps": {p: PROFILES[p] for p in args.profiles}, "repeats": args.repeats, "model_loaded": False}, indent=2))
        return
    if not args.research_only:
        parser.error("The upstream human parser is research/evaluation only. Read docs/AI_OPTIMIZATION.md and use --research-only for authorized evaluation.")
    if not args.weights_dir:
        parser.error("--weights-dir is required for actual inference.")

    # Heavy dependencies are deliberately absent from ordinary application CI.
    import torch
    from PIL import Image, ImageOps
    from fashn_vton import TryOnPipeline

    if args.device == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("CUDA is unavailable. No GPU measurements were made.")
    weights = args.weights_dir.resolve()
    pipeline = TryOnPipeline(weights_dir=str(weights), device=args.device)
    if args.compile:
        pipeline.tryon_model = torch.compile(pipeline.tryon_model, mode="reduce-overhead")
    args.output.mkdir(parents=True, exist_ok=True)
    metadata = {
        "torch": torch.__version__,
        "cuda": torch.version.cuda,
        "device": args.device,
        "gpu": torch.cuda.get_device_name() if args.device == "cuda" else None,
        "dtype": str(pipeline.inference_dtype),
        "compiled": args.compile,
        "weights_sha256": file_hash(weights / "model.safetensors"),
        "pipeline_sha256": file_hash(Path(inspect.getfile(TryOnPipeline))),
        "warmup_per_profile": args.warmup,
    }
    rows = []
    for profile in args.profiles:
        for case_index, case in enumerate(cases):
            with Image.open(case["person"]) as image:
                person = ImageOps.exif_transpose(image).convert("RGB")
            with Image.open(case["garment"]) as image:
                garment = ImageOps.exif_transpose(image).convert("RGB")
            options = {
                "person_image": person,
                "garment_image": garment,
                "category": case["category"],
                "garment_photo_type": case.get("garment_photo_type", "flat-lay"),
                "num_timesteps": PROFILES[profile],
                "num_samples": 1,
                "segmentation_free": True,
            }
            if case_index == 0:
                for _ in range(args.warmup):
                    pipeline(**options, seed=args.seed)
            for repeat in range(args.repeats):
                if args.device == "cuda":
                    torch.cuda.synchronize()
                    torch.cuda.reset_peak_memory_stats()
                started = time.perf_counter()
                result = pipeline(**options, seed=args.seed + repeat)
                if args.device == "cuda":
                    torch.cuda.synchronize()
                elapsed = time.perf_counter() - started
                image_name = case["id"] + "-" + profile + "-" + str(repeat) + ".png"
                result.images[0].save(args.output / image_name)
                rows.append({
                    "case_id": case["id"], "profile": profile, "steps": PROFILES[profile],
                    "repeat": repeat, "seed": args.seed + repeat, "seconds": elapsed,
                    "peak_allocated_bytes": torch.cuda.max_memory_allocated() if args.device == "cuda" else None,
                    "peak_reserved_bytes": torch.cuda.max_memory_reserved() if args.device == "cuda" else None,
                    "output": image_name,
                })
                # Persist after every sample so a failed experiment retains evidence.
                (args.output / "measurements.json").write_text(json.dumps({"metadata": metadata, "samples": rows}, indent=2), encoding="utf-8")
    summary = {}
    for profile in args.profiles:
        values = [row["seconds"] for row in rows if row["profile"] == profile]
        summary[profile] = {"samples": len(values), "p50_seconds": statistics.median(values), "p95_seconds": percentile(values, 0.95)}
    (args.output / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
