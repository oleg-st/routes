import importlib.util
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
import json
import os
from unittest.mock import patch

from PIL import Image

spec = importlib.util.spec_from_file_location("compress_avif", Path(__file__).resolve().parents[1] / "scripts/compress-avif.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CompressionTests(unittest.TestCase):
    def test_batch_cache_tracks_per_image_quality_and_chroma(self):
        with TemporaryDirectory() as directory:
            previous_directory = Path.cwd()
            try:
                os.chdir(directory)
                source, output = Path('original.png'), Path('result.avif')
                image = Image.new('RGB', (32, 24))
                image.putdata([(x * 7 % 256, y * 11 % 256, (x + y) * 9 % 256)
                               for y in range(24) for x in range(32)])
                image.save(source)
                manifest = Path('jobs.json')
                job = {'source': str(source), 'destination': str(output), 'quality': 50, 'subsampling': '4:2:0'}
                manifest.write_text(json.dumps([job]))
                module.compress_batch(manifest, 50)
                before = output.read_bytes()
                job.update(quality=85)
                manifest.write_text(json.dumps([job]))
                module.compress_batch(manifest, 50)
                self.assertNotEqual(before, output.read_bytes())
                before = output.read_bytes()
                job.update(subsampling='4:4:4')
                manifest.write_text(json.dumps([job]))
                module.compress_batch(manifest, 50)
                self.assertNotEqual(before, output.read_bytes())
                before = output.read_bytes()
                job.update(sharpen=True)
                manifest.write_text(json.dumps([job]))
                module.compress_batch(manifest, 50)
                self.assertNotEqual(before, output.read_bytes())
                with patch.object(module, 'compress_avif', side_effect=AssertionError('Unchanged image was re-encoded')):
                    module.compress_batch(manifest, 50)
                with Image.open(output) as result:
                    self.assertEqual(result.size, (32, 24))
                for limit, expected in [(16, (16, 12)), (8, (8, 6)), (16, (16, 12))]:
                    job.update(maxSize=limit)
                    manifest.write_text(json.dumps([job]))
                    module.compress_batch(manifest, 50)
                    with Image.open(output) as result:
                        self.assertEqual(result.size, expected)
                with patch.object(module, 'compress_avif', side_effect=AssertionError('Size cache was ignored')):
                    module.compress_batch(manifest, 50)
            finally:
                os.chdir(previous_directory)

    def test_orientation_dimensions_and_opaque_alpha(self):
        with TemporaryDirectory() as directory:
            source, output = Path(directory) / "original.png", Path(directory) / "result.avif"
            image = Image.new("RGBA", (24, 16), (80, 120, 160, 255))
            exif = Image.Exif()
            exif[274] = 6
            image.save(source, exif=exif)
            before = source.read_bytes()
            module.compress_avif(source, output, quality=85, subsampling='4:4:4', sharpen=True)
            with Image.open(output) as result:
                self.assertEqual(result.size, (16, 24))
                self.assertEqual(result.mode, "RGB")
            self.assertEqual(before, source.read_bytes())

    def test_transparency_is_retained(self):
        with TemporaryDirectory() as directory:
            source, output = Path(directory) / "original.png", Path(directory) / "result.avif"
            image = Image.new("RGBA", (16, 16), (80, 120, 160, 0))
            image.paste((80, 120, 160, 255), (8, 0, 16, 16))
            image.save(source)
            module.compress_avif(source, output, quality=85, subsampling='4:4:4', sharpen=True)
            with Image.open(output) as result:
                self.assertEqual(result.size, (16, 16))
                self.assertEqual(result.mode, "RGBA")
                self.assertEqual(result.getchannel("A").getextrema(), (0, 255))

    def test_animation_and_overwrite_are_rejected(self):
        with TemporaryDirectory() as directory:
            source, output = Path(directory) / "animation.gif", Path(directory) / "result.avif"
            Image.new("RGB", (8, 8), "red").save(source, save_all=True, append_images=[Image.new("RGB", (8, 8), "blue")])
            with self.assertRaisesRegex(ValueError, "static"):
                module.compress_avif(source, output)
            self.assertFalse(output.exists())
            with self.assertRaisesRegex(ValueError, "different"):
                module.compress_avif(source, source)

    def test_downscale_preserves_aspect_alpha_and_source_without_upscaling(self):
        with TemporaryDirectory() as directory:
            source, output = Path(directory) / 'original.png', Path(directory) / 'result.avif'
            image = Image.new('RGBA', (256, 128), (80, 120, 160, 0))
            image.paste((80, 120, 160, 255), (128, 0, 256, 128))
            image.save(source)
            before = source.read_bytes()
            module.compress_avif(source, output, max_size=64)
            with Image.open(output) as result:
                self.assertEqual(result.size, (64, 32))
                self.assertEqual(result.getchannel('A').getextrema(), (0, 255))
            module.compress_avif(source, output, max_size=512)
            with Image.open(output) as result:
                self.assertEqual(result.size, (256, 128))
            self.assertEqual(before, source.read_bytes())
            with self.assertRaisesRegex(ValueError, 'positive integer'):
                module.compress_avif(source, output, max_size=0)


if __name__ == "__main__":
    unittest.main()
