import argparse
import json
import os
import random
import sqlite3
import sys

HERE = os.path.dirname(__file__)
KINDS = os.path.join(HERE, "..", "config", "poi-kinds.json")
TYPE = {"n": 0, "w": 1, "r": 2}


def lines(path):
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def code(identifier):
    return int(identifier[1:]) * 4 + TYPE[identifier[0]]


def check_pack(pack_path, work_dir, plate, sample=2000, seed=7):
    problems = []
    admin = lines(os.path.join(work_dir, "admin-pack", plate + ".jsonl"))
    districts = {row["id"] for row in admin if row["level"] == 6}
    district_index = {identifier: i + 1 for i, identifier in enumerate(sorted(districts, key=lambda x: int(x[1:])))}
    hood_rows = sorted((row["id"] for row in admin if row["level"] == 8 and row["parent"] in districts), key=lambda x: int(x[1:]))
    hood_index = {identifier: i + 1 for i, identifier in enumerate(hood_rows)}
    addresses = lines(os.path.join(work_dir, "addresses", plate, "addresses.jsonl"))
    streets = lines(os.path.join(work_dir, "streets", plate, "streets.jsonl"))
    places = lines(os.path.join(work_dir, "places", plate, "places.jsonl"))
    with open(KINDS, encoding="utf-8") as f:
        kinds = set(json.load(f))
    expected_addresses = [a for a in addresses if a["district"] in districts and len(a["number"]) <= 100]
    orphans = [a for a in addresses if a["district"] not in districts]
    if orphans:
        problems.append("ilçesi pakette olmayan %d satır var, ilki %s" % (len(orphans), orphans[0]["id"]))
    expected_parts = [s for s in streets if s["district"] in districts]
    expected_places = [p for p in places if p["district"] in districts and p["kind"] in kinds]
    db = sqlite3.connect("file:%s?mode=ro" % pack_path, uri=True)
    try:
        packed = {
            "addresses": db.execute("SELECT COUNT(*) FROM address").fetchone()[0],
            "parts": db.execute("SELECT COUNT(*) FROM street_part").fetchone()[0],
            "places": db.execute("SELECT COUNT(*) FROM poi").fetchone()[0],
        }
        if packed["addresses"] != len(expected_addresses):
            problems.append("adres sayısı tutmuyor: pakette %d, ara dosyada %d" % (packed["addresses"], len(expected_addresses)))
        dropped = db.execute("SELECT v FROM meta WHERE k = 'dropped_parts'").fetchone()
        dropped = int(dropped[0]) if dropped else 0
        if packed["parts"] + dropped != len(expected_parts):
            problems.append("sokak parçası sayısı tutmuyor: pakette %d, adlandırılamayıp atlanan %d, ara dosyada %d" % (packed["parts"], dropped, len(expected_parts)))
        if packed["places"] != len(expected_places):
            problems.append("yer sayısı tutmuyor: pakette %d, ara dosyada %d" % (packed["places"], len(expected_places)))
        picks = random.Random(seed).sample(expected_addresses, min(sample, len(expected_addresses)))
        for row in sorted(picks, key=lambda r: (int(r["id"][1:]), r["id"][0], r["number"])):
            found = db.execute("SELECT lon, lat, district_id, hood_id, cell FROM address WHERE osm = ? AND number = ?", (code(row["id"]), row["number"])).fetchone()
            if found is None:
                problems.append("örnek adres pakette yok: %s %s" % (row["id"], row["number"]))
                continue
            if abs(found[0] - round(row["lon"] * 1e6)) > 1 or abs(found[1] - round(row["lat"] * 1e6)) > 1:
                problems.append("örnek adresin koordinatı farklı: %s %s" % (row["id"], row["number"]))
            expected_cell = (found[1] * 500 // 1000000) * 65536 + (found[0] * 500 // 1000000)
            if found[4] != expected_cell:
                problems.append("örnek adresin hücre numarası farklı: %s %s" % (row["id"], row["number"]))
            if found[2] != district_index[row["district"]]:
                problems.append("örnek adresin ilçe kimliği farklı: %s %s" % (row["id"], row["number"]))
            if row.get("neighbourhood") in hood_index and found[3] != hood_index[row["neighbourhood"]]:
                problems.append("örnek adresin mahalle kimliği farklı: %s %s" % (row["id"], row["number"]))
    finally:
        db.close()
    counts = {
        "addresses": {"source": len(addresses), "expected": len(expected_addresses), "pack": packed["addresses"]},
        "parts": {"source": len(streets), "expected": len(expected_parts), "pack": packed["parts"]},
        "places": {"source": len(places), "expected": len(expected_places), "pack": packed["places"]},
    }
    return {"ok": not problems, "problems": problems, "counts": counts, "sampled": len(picks)}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("pack")
    parser.add_argument("work")
    parser.add_argument("plate")
    parser.add_argument("--sample", type=int, default=2000)
    args = parser.parse_args()
    result = check_pack(args.pack, args.work, args.plate, args.sample)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))
    sys.exit(0 if result["ok"] else 1)


if __name__ == "__main__":
    main()
