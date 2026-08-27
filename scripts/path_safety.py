"""Small dependency-free helpers for untrusted dataset path fields."""

from __future__ import annotations

import hashlib
from pathlib import Path


def safe_path_component(value: object, prefix: str = "item") -> str:
    digest = hashlib.sha256(str(value or "").encode("utf-8")).hexdigest()
    return f"{prefix}-{digest}"


def resolve_existing_file_beneath(root: Path, candidate: object) -> Path:
    real_root = root.resolve(strict=True)
    candidate_path = Path(str(candidate or ""))
    path = candidate_path if candidate_path.is_absolute() else real_root / candidate_path
    resolved = path.resolve(strict=True)

    try:
        resolved.relative_to(real_root)
    except ValueError as error:
        raise ValueError("Dataset source path escapes the configured image root") from error

    if not resolved.is_file():
        raise ValueError("Dataset source path is not a regular file")
    return resolved


def resolve_output_path_beneath(root: Path, *parts: str) -> Path:
    real_root = root.resolve()
    candidate = real_root.joinpath(*parts).resolve()
    try:
        candidate.relative_to(real_root)
    except ValueError as error:
        raise ValueError("Output path escapes the configured output root") from error
    return candidate
