"""Dump mainline level assets out of a Unity Addressables bundle."""
import json
import re
import sys
from pathlib import Path

import UnityPy

BUNDLE = Path(__file__).parent / "apk/assets/aa/Android/levels_assets_all_dc34cd3ea5647af7c6948061aa842a00.bundle"
OUT = Path(__file__).parent / "levels_raw.json"

env = UnityPy.load(str(BUNDLE))
found = {}
kinds = {}

for obj in env.objects:
    kinds[obj.type.name] = kinds.get(obj.type.name, 0) + 1
    if obj.type.name != "MonoBehaviour":
        continue
    try:
        tree = obj.read_typetree()
    except Exception:
        try:
            data = obj.read()
            tree = {"m_Name": getattr(data, "m_Name", "")}
        except Exception:
            continue
    name = tree.get("m_Name") or ""
    if not re.match(r"^[A-Za-z]*Level_\d+_V\d+$", name):
        continue
    found[name] = tree

print("object types:", kinds, file=sys.stderr)
print("levels found:", len(found), file=sys.stderr)
if found:
    sample = sorted(found)[0]
    print("sample key:", sample, file=sys.stderr)
    print(json.dumps(found[sample], indent=2, default=str)[:3000], file=sys.stderr)

OUT.write_text(json.dumps(found, indent=1, default=str))
print(f"wrote {OUT} ({len(found)} levels)", file=sys.stderr)
