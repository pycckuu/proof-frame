#!/usr/bin/env python3
"""Generate test PNG images with synthetic EXIF-like metadata for ProofFrame testing.

Usage:
    python3 scripts/generate-test-images.py

Creates test_images/ directory with various test PNGs.
Note: PNG doesn't natively support EXIF, so we embed metadata in tEXt chunks
and also create a companion JSON with the "EXIF" fields the host would parse.
"""

# TODO: Implement T8 — see tasks/TASKS.md
# Generate PNGs at 320x240, 640x480, 1280x960
# Include edge cases: solid color, gradient, photo-like noise
# Create companion JSON with synthetic EXIF data (GPS, date, camera info)

print("Test image generation — not yet implemented. See tasks/TASKS.md T8.")
