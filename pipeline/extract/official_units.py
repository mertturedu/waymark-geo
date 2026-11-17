import argparse
import json
import re

TR_LOWER = str.maketrans({"I": "ı", "İ": "i"})


def title(text):
    out = []
    for word in text.translate(TR_LOWER).lower().split(" "):
        out.append(word[:1].replace("i", "İ").replace("ı", "I").upper() + word[1:] if word else word)
    return " ".join(out)


def strip_suffix(name):
    return re.sub(r"\s+(Mah\.?|Mh\.?|Mahallesi|Mahalle|Köyü|Köy)$", "", name.strip(), flags=re.IGNORECASE).strip()


def rows(path):
    data = json.load(open(path, encoding="utf-8"))
    return [x for x in data if x.get("type") == "table"][0]["data"]


def dask(directory):
    ilce = {x["id"]: x for x in rows(directory + "/ilce.json")}
    koy = {x["id"]: x for x in rows(directory + "/koy.json")}
    out = {}
    for m in rows(directory + "/mahalle.json"):
        k = koy.get(m["koy_id"])
        c = ilce.get(k["ilce_id"]) if k else None
        if not c:
            continue
        name = k["name"].split("-", 1)[-1] if m["name"] == "KÖYÜN KENDİSİ" else m["name"]
        out.setdefault(int(c["il_id"]), {}).setdefault(title(c["name"]), set()).add(strip_suffix(title(name)))
    return out


def tn(path):
    out = {}
    for code, districts in json.load(open(path, encoding="utf-8")).items():
        for district, names in districts.items():
            out.setdefault(int(code), {}).setdefault(district, set()).update(strip_suffix(n) for n in names)
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dask", required=True)
    parser.add_argument("--tn", required=True)
    parser.add_argument("out")
    args = parser.parse_args()
    first = dask(args.dask)
    second = tn(args.tn)
    merged = {}
    for plate in sorted(set(first) | set(second)):
        if plate < 1 or plate > 81:
            continue
        districts = {}
        for district in sorted(set(first.get(plate, {})) | set(second.get(plate, {}))):
            units = {}
            for name in first.get(plate, {}).get(district, ()):
                units[name] = units.get(name, 0) | 1
            for name in second.get(plate, {}).get(district, ()):
                units[name] = units.get(name, 0) | 2
            districts[district] = sorted([name, flags] for name, flags in units.items() if name)
        merged["%02d" % plate] = districts
    json.dump(merged, open(args.out, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    print(sum(len(v) for d in merged.values() for v in d.values()))


if __name__ == "__main__":
    main()
