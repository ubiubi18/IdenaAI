from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from path_safety import (
    resolve_existing_file_beneath,
    resolve_output_path_beneath,
    safe_path_component,
)


class PathSafetyTest(unittest.TestCase):
    def test_resolves_only_files_beneath_source_root(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir) / "images"
            root.mkdir()
            image = root / "panel.png"
            image.write_bytes(b"image")
            outside = Path(temp_dir) / "secret.txt"
            outside.write_text("secret", encoding="utf-8")

            self.assertEqual(resolve_existing_file_beneath(root, image), image.resolve())
            with self.assertRaisesRegex(ValueError, "escapes"):
                resolve_existing_file_beneath(root, outside)

            symlink = root / "escape"
            symlink.symlink_to(outside)
            with self.assertRaisesRegex(ValueError, "escapes"):
                resolve_existing_file_beneath(root, symlink)

    def test_hashes_identifiers_and_contains_outputs(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            component = safe_path_component("../../outside", "request")
            self.assertRegex(component, r"^request-[0-9a-f]{64}$")
            self.assertEqual(
                resolve_output_path_beneath(root, component, "panel.png").parent,
                (root / component).resolve(),
            )
            with self.assertRaisesRegex(ValueError, "escapes"):
                resolve_output_path_beneath(root, "..", "outside")


if __name__ == "__main__":
    unittest.main()
