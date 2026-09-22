"""
Exhaustive confirmation that `uncoverRequirement` is an item type.

The earlier exhaustive sweep *proved* 42 levels unsolvable if the field is read
as a shipment counter, and 57 unsolvable if covers never lift. Levels ship with
`generationShuffles`, so they are reverse-shuffled from a solved state and are
winnable by construction -- both readings are therefore refuted.

This run applies the surviving reading (cover = item type, lifts when a set of
that type ships) and reports any level that is still provably unsolvable. A
`proved unsolvable` count of 0 is the result we expect; anything else means the
rule implementation in game.js is wrong somewhere.

Mystery crates are ignored here on purpose: `hiddenIndices` only hides
information from the player, it does not change which moves are legal, so
including it would only weaken the search.
"""
import json
import re
import sys
from collections import Counter

CAP = 4
NODE_CAP = 400_000

raw = json.load(open("levels_raw.json"))
main = {
    int(m.group(1)): v for k, v in raw.items() if (m := re.match(r"Level_(\d+)_V1$", k))
}


def load(level):
    """Source is top->bottom with empties at the front; store bottom-first."""
    stacks, stuck, cover = [], [], []
    for s in level["generatedLevel"]["stacks"]:
        items = [v for v in reversed(s["items"]) if v != 0]
        items += [0] * (CAP - len(items))
        stacks.append(tuple(items))
        stuck.append(bool(s["isStuck"]))
        cover.append(int(s["uncoverRequirement"]))
    return tuple(stacks), tuple(stuck), tuple(cover)


def top_run(st):
    top = -1
    for i in range(CAP - 1, -1, -1):
        if st[i]:
            top = i
            break
    if top < 0:
        return 0, 0, -1
    t = st[top]
    n, i = 0, top
    while i >= 0 and st[i] == t:
        n += 1
        i -= 1
    return t, n, top - n + 1


filled = lambda st: sum(1 for v in st if v)


def solve(stacks, stuck, cover):
    """DFS over (board, set of shipped types). Shipped types drive cover lifts."""
    start = (stacks, frozenset())
    seen = {start}
    work = [start]
    nodes = 0
    while work:
        cur, shipped = work.pop()
        nodes += 1
        if nodes > NODE_CAP:
            return None
        if all(filled(s) == 0 for s in cur):
            return True

        covered = [cover[i] != 0 and cover[i] not in shipped for i in range(len(cur))]
        moves = []
        for i, si in enumerate(cur):
            if stuck[i] or covered[i] or filled(si) == 0:
                continue
            t, n, frm = top_run(si)
            for j, sj in enumerate(cur):
                if i == j or covered[j] or filled(sj) >= CAP:
                    continue
                if filled(sj) and top_run(sj)[0] != t:
                    continue
                k = min(n, CAP - filled(sj))
                nl = [list(x) for x in cur]
                for c in range(k):
                    idx = frm + n - 1 - c
                    v = nl[i][idx]
                    nl[i][idx] = 0
                    nl[j][nl[j].index(0)] = v

                ns = shipped
                # shipping a set lifts covers of that type, which can cascade
                changed = True
                while changed:
                    changed = False
                    for q, sq in enumerate(nl):
                        if cover[q] != 0 and cover[q] not in ns:
                            continue
                        if filled(sq) == CAP and len(set(sq)) == 1:
                            ns = ns | {sq[0]}
                            nl[q] = [0] * CAP
                            changed = True

                nxt = (tuple(tuple(x) for x in nl), ns)
                if nxt not in seen:
                    moves.append(nxt)
        # explore states that shipped more first
        moves.sort(key=lambda m: len(m[1]))
        for m in moves:
            seen.add(m)
            work.append(m)
    return False


start_at = int(sys.argv[1]) if len(sys.argv) > 1 else 1

tally = Counter()
unsolvable, timeout = [], []
for n in sorted(main):
    if n < start_at:
        continue
    r = solve(*load(main[n]))
    if r is True:
        tally["solved"] += 1
    elif r is False:
        tally["proved unsolvable"] += 1
        unsolvable.append(n)
    else:
        tally["timeout"] += 1
        timeout.append(n)
    print(f"  L{n:<4d} {r}", flush=True)

print(f"\nrule: cover = item type, lifts when that type ships")
print(f"  {dict(tally)}")
print(f"  proved unsolvable: {unsolvable}")
print(f"  hit the {NODE_CAP} node cap: {timeout}")
sys.exit(1 if unsolvable else 0)
