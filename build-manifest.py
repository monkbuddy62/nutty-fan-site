#!/usr/bin/env python3
# Scans media/ and writes media/manifest.json
# Run after adding or converting files: python3 build-manifest.py

import os, json

MEDIA_DIR = 'media'
VALID = {'.jpg', '.jpeg', '.png', '.gif', '.mp4', '.webm', '.mov'}

files = sorted([
    f for f in os.listdir(MEDIA_DIR)
    if os.path.splitext(f.lower())[1] in VALID
])

out_path = os.path.join(MEDIA_DIR, 'manifest.json')
with open(out_path, 'w') as f:
    json.dump(files, f, indent=2)

print(f'manifest.json written — {len(files)} files')
