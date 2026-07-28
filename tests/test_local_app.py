import tempfile
import unittest
from pathlib import Path

import local_app


class CropTests(unittest.TestCase):
    def test_portrait_video_uses_square_map_below_header(self):
        crop = local_app.default_crop({"width": 1080, "height": 2400})

        self.assertEqual(crop, {"x": 0, "y": 430, "w": 1080, "h": 1080})

    def test_landscape_video_uses_largest_top_left_square(self):
        crop = local_app.default_crop({"width": 1920, "height": 1080})

        self.assertEqual(crop, {"x": 0, "y": 0, "w": 1080, "h": 1080})


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.client = local_app.app.test_client()

    def test_defaults_matches_configured_environment_default(self):
        response = self.client.get("/api/defaults")

        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()["ok"])
        self.assertEqual(response.get_json()["videoPath"], local_app.DEFAULT_VIDEO)

    def test_resolve_videos_finds_supported_files_recursively(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            nested = root / "nested"
            nested.mkdir()
            first = root / "01.mp4"
            second = nested / "02.MOV"
            ignored = root / "notes.txt"
            first.touch()
            second.touch()
            ignored.touch()

            response = self.client.post(
                "/api/resolve-videos", json={"paths": [str(root)]}
            )

        payload = response.get_json()
        self.assertEqual(response.status_code, 200)
        self.assertTrue(payload["ok"])
        self.assertEqual(payload["paths"], [str(first), str(second)])
        self.assertEqual(payload["missing"], [])

    def test_resolve_videos_reports_missing_inputs(self):
        with tempfile.TemporaryDirectory() as directory:
            existing = Path(directory) / "match.webm"
            existing.touch()
            missing = Path(directory) / "missing.mp4"

            response = self.client.post(
                "/api/resolve-videos",
                json={"paths": [str(existing), str(missing)]},
            )

        payload = response.get_json()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload["paths"], [str(existing)])
        self.assertEqual(payload["missing"], [str(missing)])


if __name__ == "__main__":
    unittest.main()
