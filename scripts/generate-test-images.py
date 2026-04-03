#!/usr/bin/env python3
"""Generate signed PNG test images from JPEGs, simulating C2PA camera behavior.

This script mocks what a C2PA-enabled camera does:
1. Capture image with EXIF metadata (we read EXIF from source JPEG)
2. Convert to PNG with EXIF embedded in eXIf chunk
3. Sign the entire file with a secp256k1 key (mocking camera secure element)

In production, steps 1-3 happen inside the camera hardware.
For the hackathon, this script mocks the camera's behavior.

Usage:
    # Default: convert the ETHGlobal Cannes venue photo
    python3 scripts/generate-test-images.py

    # Custom JPEG with output name
    python3 scripts/generate-test-images.py path/to/photo.jpg --name my_photo

Requires: pip install Pillow piexif ecdsa
"""

import argparse
import hashlib
import json
import struct
import zlib
from pathlib import Path

import piexif
from ecdsa import SECP256k1, SigningKey
from PIL import Image

SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
OUTPUT_DIR = PROJECT_ROOT / "test_images"

# Default source JPEG — the ETHGlobal Cannes venue photo
DEFAULT_JPEG_CANDIDATES = [
    PROJECT_ROOT / ".context" / "attachments" / "1775230279-v1.jpg",
    PROJECT_ROOT / ".context" / "attachments" / "1775230279.jpg",
]


def find_default_jpeg() -> Path:
    for p in DEFAULT_JPEG_CANDIDATES:
        if p.exists():
            return p
    raise FileNotFoundError(
        f"No default JPEG found. Tried: {[str(p) for p in DEFAULT_JPEG_CANDIDATES]}"
    )


def read_exif_from_jpeg(jpeg_path: Path) -> dict:
    """Read EXIF from a JPEG file and return as piexif dict.

    Falls back to synthetic EXIF if the JPEG has no metadata.
    """
    try:
        exif_dict = piexif.load(str(jpeg_path))
        # Check if we got meaningful data
        if exif_dict.get("0th") and exif_dict["0th"].get(piexif.ImageIFD.Make):
            print(f"  Read EXIF from {jpeg_path.name}")
            return exif_dict
    except Exception as e:
        print(f"  Could not read EXIF from {jpeg_path.name}: {e}")

    print(f"  No EXIF in {jpeg_path.name}, using synthetic metadata")
    return None


def build_exif_from_jpeg(jpeg_path: Path) -> bytes:
    """Extract EXIF from source JPEG and enrich with additional fields for demo.

    Uses real GPS/date/camera from the JPEG, adds extra fields (artist, serial
    numbers, etc.) that a C2PA camera would embed — these are the fields the
    ZK proof will strip for privacy.
    """
    source_exif = read_exif_from_jpeg(jpeg_path)
    img = Image.open(jpeg_path)
    w, h = img.size

    if source_exif and source_exif.get("GPS"):
        # Use real GPS from the source image
        gps = source_exif["GPS"]
        gps_data = {
            piexif.GPSIFD.GPSLatitudeRef: gps.get(piexif.GPSIFD.GPSLatitudeRef, b"N"),
            piexif.GPSIFD.GPSLatitude: gps.get(piexif.GPSIFD.GPSLatitude, ((0, 1), (0, 1), (0, 1))),
            piexif.GPSIFD.GPSLongitudeRef: gps.get(piexif.GPSIFD.GPSLongitudeRef, b"E"),
            piexif.GPSIFD.GPSLongitude: gps.get(piexif.GPSIFD.GPSLongitude, ((0, 1), (0, 1), (0, 1))),
            piexif.GPSIFD.GPSAltitudeRef: 0,
            piexif.GPSIFD.GPSAltitude: gps.get(piexif.GPSIFD.GPSAltitude, (0, 1)),
        }
        # Print readable GPS
        lat = gps.get(piexif.GPSIFD.GPSLatitude, ((0,1),(0,1),(0,1)))
        lon = gps.get(piexif.GPSIFD.GPSLongitude, ((0,1),(0,1),(0,1)))
        lat_d = lat[0][0]/lat[0][1] + lat[1][0]/lat[1][1]/60 + lat[2][0]/lat[2][1]/3600
        lon_d = lon[0][0]/lon[0][1] + lon[1][0]/lon[1][1]/60 + lon[2][0]/lon[2][1]/3600
        print(f"  GPS: {lat_d:.6f}N, {lon_d:.6f}E")
    else:
        # Fallback: Palais des Festivals, Cannes
        gps_data = {
            piexif.GPSIFD.GPSLatitudeRef: b"N",
            piexif.GPSIFD.GPSLatitude: ((43, 1), (33, 1), (1025, 100)),
            piexif.GPSIFD.GPSLongitudeRef: b"E",
            piexif.GPSIFD.GPSLongitude: ((7, 1), (1, 1), (249, 100)),
            piexif.GPSIFD.GPSAltitudeRef: 0,
            piexif.GPSIFD.GPSAltitude: (0, 1),
        }
        print("  GPS: 43.552847N, 7.017369E (default: Cannes)")

    # Read real camera make/model/date or use defaults
    zeroth = source_exif.get("0th", {}) if source_exif else {}
    exif_ifd = source_exif.get("Exif", {}) if source_exif else {}

    make = zeroth.get(piexif.ImageIFD.Make, b"Canon")
    model = zeroth.get(piexif.ImageIFD.Model, b"EOS R5")
    date_time = zeroth.get(piexif.ImageIFD.DateTime, b"2026:04:03 10:30:17")
    software = zeroth.get(piexif.ImageIFD.Software, b"Firmware Version 2.0.0")
    date_original = exif_ifd.get(piexif.ExifIFD.DateTimeOriginal, date_time)
    # Note: width/height in EXIF reflect the resized dimensions (640x480),
    # not the original camera resolution, since we resize before embedding.

    if isinstance(make, str):
        make = make.encode()
    if isinstance(model, str):
        model = model.encode()
    if isinstance(date_time, str):
        date_time = date_time.encode()
    if isinstance(software, str):
        software = software.encode()
    if isinstance(date_original, str):
        date_original = date_original.encode()

    print(f"  Camera: {make.decode()} {model.decode()}")
    print(f"  Date: {date_original.decode()}")

    exif_dict = {
        "0th": {
            piexif.ImageIFD.Make: make,
            piexif.ImageIFD.Model: model,
            piexif.ImageIFD.Software: software,
            piexif.ImageIFD.DateTime: date_time,
            # Privacy-sensitive fields the ZK proof will strip:
            piexif.ImageIFD.Artist: b"Marie Dupont",
            piexif.ImageIFD.Copyright: b"Copyright 2026 Marie Dupont. All rights reserved.",
            piexif.ImageIFD.ImageWidth: w,
            piexif.ImageIFD.ImageLength: h,
        },
        "Exif": {
            piexif.ExifIFD.DateTimeOriginal: date_original,
            piexif.ExifIFD.DateTimeDigitized: date_original,
            piexif.ExifIFD.SubSecTimeOriginal: b"83",
            piexif.ExifIFD.OffsetTimeOriginal: b"+02:00",
            piexif.ExifIFD.ExposureTime: (1, 125),
            piexif.ExifIFD.FNumber: (56, 10),
            piexif.ExifIFD.ISOSpeedRatings: 800,
            piexif.ExifIFD.FocalLength: (350, 10),
            piexif.ExifIFD.FocalLengthIn35mmFilm: 35,
            piexif.ExifIFD.MeteringMode: 5,
            piexif.ExifIFD.Flash: 0,
            piexif.ExifIFD.WhiteBalance: 0,
            piexif.ExifIFD.ExposureProgram: 3,
            piexif.ExifIFD.ExposureBiasValue: (0, 10),
            # Device serial numbers — highly identifying:
            piexif.ExifIFD.BodySerialNumber: b"032024001849",
            piexif.ExifIFD.LensMake: make,
            piexif.ExifIFD.LensModel: b"RF24-105mm F4 L IS USM",
            piexif.ExifIFD.LensSerialNumber: b"0000c0e934",
        },
        "GPS": gps_data,
    }

    exif_bytes = piexif.dump(exif_dict)

    # piexif prepends "Exif\0\0" (JPEG APP1 header). For PNG eXIf chunk,
    # we need raw TIFF bytes (starting with "MM" or "II").
    if exif_bytes[:6] == b"Exif\x00\x00":
        exif_bytes = exif_bytes[6:]

    return exif_bytes


def make_png_chunk(chunk_type: bytes, data: bytes) -> bytes:
    """Build a PNG chunk: [4-byte length][type][data][4-byte CRC]."""
    length = struct.pack(">I", len(data))
    crc = struct.pack(">I", zlib.crc32(chunk_type + data) & 0xFFFFFFFF)
    return length + chunk_type + data + crc


def embed_exif_in_png(png_path: Path, exif_bytes: bytes) -> None:
    """Insert an eXIf chunk into a PNG file, right after IHDR.

    PNG structure: [8-byte signature][IHDR chunk][...other chunks...][IEND]
    We insert [eXIf chunk] between IHDR and the next chunk.
    """
    data = png_path.read_bytes()

    assert data[:8] == b"\x89PNG\r\n\x1a\n", "Not a valid PNG file"

    # IHDR chunk starts at byte 8: [4-byte len][IHDR][13 bytes data][4-byte CRC]
    ihdr_len = struct.unpack(">I", data[8:12])[0]
    ihdr_end = 8 + 4 + 4 + ihdr_len + 4

    exif_chunk = make_png_chunk(b"eXIf", exif_bytes)

    new_data = data[:ihdr_end] + exif_chunk + data[ihdr_end:]
    png_path.write_bytes(new_data)


def generate_keypair_and_sign(png_path: Path) -> dict:
    """Generate secp256k1 keypair, sign SHA-256(file_bytes) with raw ECDSA.

    Mocks what a C2PA camera's secure element does:
    - Camera has a signing key embedded in hardware
    - After capturing the photo (with EXIF), it signs SHA-256(entire_file)
    - Signature covers BOTH pixel data AND EXIF metadata

    For the hackathon, we generate a fresh key. In production, this would be
    a manufacturer key from Canon/Leica/Sony's C2PA trust list.
    """
    file_bytes = png_path.read_bytes()
    file_hash = hashlib.sha256(file_bytes).digest()

    sk = SigningKey.generate(curve=SECP256k1)
    vk = sk.get_verifying_key()

    # Raw ECDSA sign (no Ethereum prefix) — matches ZK guest's k256::verify
    raw_sig = sk.sign_digest(file_hash)  # raw r||s (64 bytes), RFC 6979

    # Normalize to low-S (k256 crate requires s <= n/2)
    n = SECP256k1.order
    r = int.from_bytes(raw_sig[:32], "big")
    s = int.from_bytes(raw_sig[32:], "big")
    if s > n // 2:
        s = n - s
    signature = r.to_bytes(32, "big") + s.to_bytes(32, "big")

    # Compressed public key (33 bytes)
    vk_bytes = vk.to_string()
    x = vk_bytes[:32]
    y = vk_bytes[32:]
    prefix = b"\x03" if y[-1] & 1 else b"\x02"
    compressed_pubkey = prefix + x

    result = {
        "private_key": sk.to_string().hex(),
        "public_key": compressed_pubkey.hex(),
        "public_key_uncompressed": "04" + vk_bytes.hex(),
        "signature": signature.hex(),
        "file_hash": file_hash.hex(),
        "file_size": len(file_bytes),
        "note": (
            "Mock C2PA camera signature. Raw ECDSA secp256k1 over SHA-256(png_file_bytes). "
            "No Ethereum prefix. Signature covers entire file including embedded EXIF. "
            "In production, this key lives in the camera's secure element."
        ),
    }

    assert vk.verify_digest(signature, file_hash), "Signature verification failed!"
    return result


def create_metadata_json(png_path: Path, metadata_path: Path, jpeg_path: Path) -> None:
    """Create companion metadata JSON showing ALL fields from the original file.

    This JSON is for demo purposes only — it shows what the original file
    contained so the UI can display "before ZK proof" vs "after ZK proof".
    The actual proof uses EXIF embedded in the PNG file, NOT this JSON.
    """
    img = Image.open(png_path)
    w, h = img.size

    # Read real EXIF values from source JPEG for accurate demo display
    source_exif = read_exif_from_jpeg(jpeg_path)
    zeroth = source_exif.get("0th", {}) if source_exif else {}
    gps = source_exif.get("GPS", {}) if source_exif else {}

    # Compute readable GPS
    gps_lat = gps_lon = 0.0
    if gps:
        lat = gps.get(piexif.GPSIFD.GPSLatitude, ((0,1),(0,1),(0,1)))
        lon = gps.get(piexif.GPSIFD.GPSLongitude, ((0,1),(0,1),(0,1)))
        gps_lat = lat[0][0]/lat[0][1] + lat[1][0]/lat[1][1]/60 + lat[2][0]/lat[2][1]/3600
        gps_lon = lon[0][0]/lon[0][1] + lon[1][0]/lon[1][1]/60 + lon[2][0]/lon[2][1]/3600

    make = zeroth.get(piexif.ImageIFD.Make, b"Canon")
    if isinstance(make, bytes):
        make = make.decode().strip('\x00')

    metadata = {
        "_description": (
            "This JSON shows ALL metadata the camera embedded in the original file. "
            "The ZK proof strips everything except selectively disclosed fields. "
            "This file is for demo display only — the proof reads EXIF from the PNG."
        ),

        # Fields the photographer CAN selectively disclose
        "disclosable": {
            "date": "2026-04-03T17:29:53+02:00",
            "gps_lat": round(gps_lat, 6),
            "gps_lon": round(gps_lon, 6),
            "camera_make": make,
            "image_width": w,
            "image_height": h,
        },

        # Fields ALWAYS stripped by the ZK proof
        "stripped": {
            "camera_model": "iPhone 14 Pro",
            "body_serial_number": "032024001849",
            "lens_serial_number": "0000c0e934",
            "lens_model": "RF24-105mm F4 L IS USM",
            "firmware_version": "26.4",
            "date_time_original": "2026:04:03 17:29:53",
            "sub_sec_time_original": "83",
            "offset_time_original": "+02:00",
            "exposure_time": "1/125",
            "f_number": 5.6,
            "iso_speed": 800,
            "focal_length_mm": 35.0,
            "metering_mode": "Pattern",
            "flash": "Off, Did not fire",
            "white_balance": "Auto",
            "exposure_program": "Aperture priority",
            "gps_altitude_m": 0.0,
            "artist": "Marie Dupont",
            "copyright": "Copyright 2026 Marie Dupont. All rights reserved.",
            "c2pa_claim_generator": "Apple iPhone 14 Pro/26.4",
            "c2pa_signature_type": "COSE_Sign1 with ES256",
            "c2pa_certificate_subject": "CN=Apple Camera Signing,O=Apple Inc,C=US",
            "c2pa_certificate_serial": "4A:3B:2C:1D:00:FF:EE:DD",
            "xmp_creator": "Marie Dupont",
            "xmp_creator_tool": "Adobe Lightroom Classic 13.2",
            "iptc_creator_job_title": "Freelance Photojournalist",
            "iptc_city": "Cannes",
            "iptc_country": "France",
            "iptc_email": "marie.dupont@example.com",
            "iptc_phone": "+33 6 12 34 56 78",
        },
    }

    metadata_path.write_text(json.dumps(metadata, indent=2) + "\n")

    n_disclosable = len(metadata["disclosable"])
    n_stripped = len(metadata["stripped"])
    print(f"  Created {metadata_path.name}")
    print(f"  Disclosable fields: {n_disclosable}")
    print(f"  Always stripped: {n_stripped}")


def generate_clean_image(png_path: Path, clean_path: Path) -> str:
    """Generate the 'clean' published image: pixels only, zero metadata.

    This simulates what the ZK proof outputs: the image crate decodes PNG
    to raw RGB pixels, then re-encodes as a new PNG with only IHDR+IDAT+IEND.
    All EXIF/XMP/IPTC/C2PA metadata is structurally destroyed.

    Returns the SHA-256 hex hash of the RGB pixel bytes (the pixel_hash).
    """
    img = Image.open(png_path).convert("RGB")
    img.save(clean_path, "PNG")

    # Compute pixel hash: SHA-256 of raw RGB bytes (3 bytes/pixel)
    # This must match what the ZK guest produces
    rgb_bytes = img.tobytes()  # width * height * 3 bytes
    pixel_hash = hashlib.sha256(rgb_bytes).hexdigest()

    return pixel_hash


def process_image(jpeg_path: Path, name: str) -> None:
    """Full pipeline: JPEG -> PNG with EXIF -> sign -> clean image -> metadata JSON."""
    png_path = OUTPUT_DIR / f"{name}.png"
    clean_path = OUTPUT_DIR / f"{name}.clean.png"
    key_path = OUTPUT_DIR / f"{name}.signing_key.json"
    metadata_path = OUTPUT_DIR / f"{name}.metadata.json"

    # 1. Convert JPEG to PNG (resized to 640x480 for ZK proving budget)
    print(f"\n1. Converting JPEG to PNG (640x480)...")
    img = Image.open(jpeg_path)
    img = img.resize((640, 480), Image.LANCZOS)
    img.save(png_path, "PNG")
    print(f"  {jpeg_path.name} -> {png_path.name} ({img.size[0]}x{img.size[1]})")

    # 2. Read EXIF from source JPEG and embed in PNG
    print(f"\n2. Embedding EXIF metadata in PNG (eXIf chunk)...")
    exif_bytes = build_exif_from_jpeg(jpeg_path)
    embed_exif_in_png(png_path, exif_bytes)
    print(f"  Embedded {len(exif_bytes)} bytes of TIFF-encoded EXIF")

    # 3. Sign the PNG (with EXIF) — mocks C2PA camera signature
    print(f"\n3. Signing PNG with mock C2PA key (secp256k1)...")
    key_data = generate_keypair_and_sign(png_path)
    key_path.write_text(json.dumps(key_data, indent=2) + "\n")
    print(f"  Public key:  {key_data['public_key']}")
    print(f"  File hash:   {key_data['file_hash']}")
    print(f"  Signature:   {key_data['signature'][:32]}...")
    print(f"  File size:   {key_data['file_size']:,} bytes (with EXIF)")

    # 4. Generate clean image (pixels only, zero metadata — what gets published)
    print(f"\n4. Generating clean published image (zero metadata)...")
    pixel_hash = generate_clean_image(png_path, clean_path)
    print(f"  {clean_path.name} ({clean_path.stat().st_size:,} bytes)")
    print(f"  Pixel hash (SHA-256 of RGB bytes): {pixel_hash}")

    # Add pixel hash to signing key JSON
    key_data["pixel_hash"] = pixel_hash
    key_path.write_text(json.dumps(key_data, indent=2) + "\n")

    # 5. Create demo metadata JSON
    print(f"\n5. Creating demo metadata JSON...")
    create_metadata_json(png_path, metadata_path, jpeg_path)


def main():
    parser = argparse.ArgumentParser(
        description="Generate signed PNG test images from JPEGs (mock C2PA camera)"
    )
    parser.add_argument(
        "jpeg", nargs="?", default=None,
        help="Path to source JPEG (default: ETHGlobal Cannes venue photo)"
    )
    parser.add_argument(
        "--name", default=None,
        help="Output name prefix (default: derived from input filename)"
    )
    args = parser.parse_args()

    print("ProofFrame Test Image Generator (Mock C2PA Camera)")
    print("=" * 52)

    OUTPUT_DIR.mkdir(exist_ok=True)

    if args.jpeg:
        jpeg_path = Path(args.jpeg)
        if not jpeg_path.exists():
            raise FileNotFoundError(f"JPEG not found: {jpeg_path}")
        name = args.name or jpeg_path.stem
    else:
        jpeg_path = find_default_jpeg()
        name = args.name or "ethglobal_cannes"

    process_image(jpeg_path, name)

    print(f"\nDone! Files in {OUTPUT_DIR}/:")
    for f in sorted(OUTPUT_DIR.iterdir()):
        if not f.name.startswith("."):
            print(f"  {f.name} ({f.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
