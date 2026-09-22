"""
Convert the dumped mainline levels into the format game.js reads.

Source layout (verified against the raw assets):
  items[]            slot 0 is the TOP of the stack, empties sit at the front
  hiddenIndices[]    mystery items, indexed the same way; index 0 never appears
  isStuck            one-way truck: items go in, never come out
  uncoverRequirement item type whose shipment lifts this truck's cover (0 = none)

Demo layout: slot 0 is the BOTTOM (next to the cab), so items are reversed.
"""
import json
import re
from collections import Counter
from pathlib import Path

CAP = 4
HERE = Path(__file__).parent
raw = json.load(open(HERE / "levels_raw.json"))
OUT = HERE.parent / "levels.json"

main = {
    int(m.group(1)): v for k, v in raw.items() if (m := re.match(r"Level_(\d+)_V1$", k))
}

levels = []
for n in sorted(main):
    src = main[n]["generatedLevel"]["stacks"]
    trucks = []
    for s in src:
        top_first = s["items"]
        items = [v for v in reversed(top_first) if v != 0]
        items += [0] * (CAP - len(items))
        # top-first index i maps to bottom-first index (CAP - 1 - i)
        hidden = sorted(CAP - 1 - i for i in s["hiddenIndices"])
        t = {"slots": items}
        if hidden:
            t["hidden"] = hidden
        if s["isStuck"]:
            t["stuck"] = 1
        if s["uncoverRequirement"]:
            t["cover"] = int(s["uncoverRequirement"])
        trucks.append(t)
    levels.append({"id": n, "trucks": trucks})

# sanity: every item type must come in multiples of 4, or the level is unwinnable
bad = []
for lv in levels:
    c = Counter(v for t in lv["trucks"] for v in t["slots"] if v)
    if any(k % CAP for k in c.values()):
        bad.append(lv["id"])
assert not bad, f"levels with item counts not divisible by {CAP}: {bad}"

# sanity: no gaps in a packed stack, and hidden never points at the top item
for lv in levels:
    for t in lv["trucks"]:
        s = t["slots"]
        filled = [i for i, v in enumerate(s) if v]
        assert filled == list(range(len(filled))), (lv["id"], s)
        if "hidden" in t:
            assert max(t["hidden"]) < len(filled), (lv["id"], t)
            assert len(filled) - 1 not in t["hidden"], (lv["id"], t)

OUT.write_text(json.dumps({"levels": levels}, separators=(",", ":")))

types = max(max(v for t in lv["trucks"] for v in t["slots"]) for lv in levels)
print(f"wrote {OUT.relative_to(HERE.parent.parent)}")
print(f"  levels        : {len(levels)} (Level_1 .. Level_{levels[-1]['id']})")
print(f"  item types     : 1..{types}")
print(f"  trucks per lvl : {min(len(l['trucks']) for l in levels)}..{max(len(l['trucks']) for l in levels)}")
print(f"  with stuck     : {sum(any(t.get('stuck') for t in l['trucks']) for l in levels)}")
print(f"  with covers    : {sum(any(t.get('cover') for t in l['trucks']) for l in levels)}")
print(f"  with mystery   : {sum(any(t.get('hidden') for t in l['trucks']) for l in levels)}")
print(f"  file size      : {OUT.stat().st_size / 1024:.0f} KB")
