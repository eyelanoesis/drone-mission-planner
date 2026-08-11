#!/usr/bin/env python3
"""exif_profile.py — build/verify a drone camera profile from a real photo.

Why this exists (spec §7.1): published sensor specs are occasionally wrong, and
a wrong focal length silently corrupts every GSD and spacing calculation
downstream. So profiles in profiles/drones.json are filled from the EXIF of an
actual photo taken by YOUR aircraft, once per airframe.

Usage:
  pip install exifread            (once)
  python3 tools/exif_profile.py DJI_0001.JPG
  python3 tools/exif_profile.py DJI_0001.JPG --altitude 50   # also prints GSD check

It prints a ready-to-paste JSON snippet for profiles/drones.json and flags any
field it could not derive (sensor width sometimes needs the 35mm-equivalent
cross-check, printed when available).
"""
import argparse
import json
import sys

try:
    import exifread
except ImportError:
    sys.exit("pip install exifread   (then re-run)")


def rational(tags, key):
    v = tags.get(key)
    if v is None:
        return None
    try:
        r = v.values[0]
        return float(r.num) / float(r.den)
    except Exception:
        try:
            return float(str(v))
        except Exception:
            return None


def integer(tags, key):
    v = tags.get(key)
    if v is None:
        return None
    try:
        return int(str(v))
    except Exception:
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("photo")
    ap.add_argument("--altitude", type=float, default=None,
                    help="AGL in metres at capture, to print a GSD sanity check")
    args = ap.parse_args()

    with open(args.photo, "rb") as f:
        tags = exifread.process_file(f, details=False)

    make = str(tags.get("Image Make", "?"))
    model = str(tags.get("Image Model", "?"))
    focal = rational(tags, "EXIF FocalLength")
    focal35 = rational(tags, "EXIF FocalLengthIn35mmFilm")
    img_w = integer(tags, "EXIF ExifImageWidth") or integer(tags, "Image ImageWidth")
    img_h = integer(tags, "EXIF ExifImageLength") or integer(tags, "Image ImageLength")

    # Sensor width derivation: full-frame is 36 mm wide, so
    # sensor_width = 36 * focal / focal35  (crop factor from the 35mm equivalent)
    sensor_w = round(36.0 * focal / focal35, 3) if (focal and focal35) else None
    sensor_h = round(sensor_w * img_h / img_w, 3) if (sensor_w and img_w and img_h) else None

    print(f"Camera: {make} {model}")
    print(f"FocalLength        : {focal} mm")
    print(f"FocalLength (35mm) : {focal35} mm")
    print(f"Image              : {img_w} x {img_h} px")
    print(f"Sensor (derived)   : {sensor_w} x {sensor_h} mm"
          f"{'' if sensor_w else '  <- could not derive; fill manually'}")

    profile = {
        "id": model.strip().lower().replace(" ", "-"),
        "name": f"{make.strip()} {model.strip()}",
        "sensor_width_mm": sensor_w,
        "sensor_height_mm": sensor_h,
        "focal_length_mm": focal,
        "image_width_px": img_w,
        "image_height_px": img_h,
        "min_shot_interval_s": None,
        "_verified": "EXIF-derived from a real image; min_shot_interval_s must be "
                     "measured (fastest reliable interval-shooting setting)",
    }
    print("\nPaste into profiles/drones.json:\n")
    print(json.dumps(profile, indent=2))

    if args.altitude and sensor_w and focal and img_w:
        gsd = sensor_w * args.altitude * 100.0 / (focal * img_w)
        print(f"\nGSD sanity check @ {args.altitude} m AGL: {gsd:.2f} cm/px")
        print("Verify against a measured ground feature (e.g. a parking bay line).")


if __name__ == "__main__":
    main()
