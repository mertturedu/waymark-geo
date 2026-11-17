import json
import os
import random
import subprocess
import sys

import osmxml as ox

HERE = os.path.dirname(__file__)
EXTRACT = os.path.join(HERE, "..", "extract")
sys.path.insert(0, EXTRACT)
from extract_addresses import extract  # noqa: E402


def square(west, south, east, north):
    return "POLYGON ((%s %s, %s %s, %s %s, %s %s, %s %s))" % (west, south, east, south, east, north, west, north, west, south)


def admin_row(id, level, name, wkt, parent=None, iso=None):
    return {"id": id, "level": level, "iso": iso, "names": {"tr": name}, "alt": [], "bbox": [0, 0, 0, 0], "wkt": wkt, "parent": parent}


ADMIN = [
    admin_row("r1", 4, "Istanbul", square(28.5, 40.5, 29.5, 41.5), iso="TR-34"),
    admin_row("r2", 4, "Ankara", square(32.0, 39.5, 33.0, 40.5), iso="TR-06"),
    admin_row("r10", 6, "Kadikoy", square(28.5, 40.5, 29.0, 41.5), parent="r1"),
    admin_row("r11", 6, "Uskudar", square(29.0, 40.5, 29.5, 41.0), parent="r1"),
    admin_row("r12", 6, "Cankaya", square(32.0, 39.5, 33.0, 40.5), parent="r2"),
    admin_row("r20", 8, "Moda Mahallesi", square(28.5, 40.5, 28.75, 41.0), parent="r10"),
]
PLACES = [{"id": "n900", "name": "Fener", "names": {"tr": "Fener"}, "lon": 28.9, "lat": 41.2, "type": "suburb"}]


def write_inputs(tmp_path, elements, admin=ADMIN, places=PLACES, name="in"):
    pbf = ox.write(tmp_path / (name + ".osm"), elements)
    admin_path = tmp_path / (name + "-admin.jsonl")
    admin_path.write_text("".join(json.dumps(r) + "\n" for r in admin), encoding="utf-8")
    places_path = tmp_path / (name + "-places.jsonl")
    places_path.write_text("".join(json.dumps(r) + "\n" for r in places), encoding="utf-8")
    return pbf, str(admin_path), str(places_path)


def addr(id, lat, lon, number, street="Bahariye Caddesi", **more):
    tags = {"addr:housenumber": number}
    if street is not None:
        tags["addr:street"] = street
    tags.update(more)
    return ox.node(id, lat, lon, tags)


def run(tmp_path, elements, name="in", **kwargs):
    pbf, admin, places = write_inputs(tmp_path, elements, name=name)
    out = tmp_path / ("out-" + name)
    accounting = extract(pbf, admin, places, str(out), **kwargs)
    return accounting, out


def rows_of(out, plate, name="addresses.jsonl"):
    path = out / plate / name
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]


def test_accepted_rows_carry_the_place_in_the_hierarchy_and_the_tags(tmp_path):
    node = addr(1, 40.9, 28.6, "14", **{"addr:postcode": "34710", "addr:city": "İstanbul", "addr:district": "Kadıköy", "addr:neighbourhood": "Moda"})
    accounting, out = run(tmp_path, [node])
    [row] = rows_of(out, "34")
    assert row == {
        "id": "n1", "street": "Bahariye Caddesi", "place": None, "number": "14", "postcode": "34710",
        "lon": 28.6, "lat": 40.9, "district": "r10", "neighbourhood": "r20", "hoodName": None, "hoodNames": None,
        "hoodSource": "polygon", "slack": False,
        "tags": {"city": "İstanbul", "district": "Kadıköy", "neighbourhood": "Moda"},
    }
    assert accounting["provinces"]["34"] == {"source": 1, "accepted": 1, "rows": 1, "rejected": {}}
    assert (out / "06" / "addresses.jsonl").read_text() == ""


def test_a_record_without_a_street_is_kept_and_an_addr_place_is_carried(tmp_path):
    accounting, out = run(tmp_path, [addr(1, 40.9, 28.6, "7", street=None), addr(2, 40.95, 28.6, "9", street=None, **{"addr:place": "Koy Mevkii"})])
    rows = rows_of(out, "34")
    assert [(r["street"], r["place"], r["number"]) for r in rows] == [(None, None, "7"), (None, "Koy Mevkii", "9")]
    assert accounting["provinces"]["34"]["accepted"] == 2


def test_bad_number_values_are_rejected_with_a_reason_and_never_crash(tmp_path):
    elements = [
        addr(1, 40.9, 28.6, " "), addr(2, 40.9, 28.61, "-"), addr(3, 40.9, 28.62, "yok"), addr(4, 40.9, 28.63, "?"),
        addr(5, 40.9, 28.64, "1" * 200), addr(6, 40.9, 28.65, "٣٤"), addr(7, 40.9, 28.66, "5-7"), addr(8, 40.9, 28.67, "12/A"),
    ]
    accounting, out = run(tmp_path, elements)
    rejects = {r["id"]: r["reason"] for r in rows_of(out, "34", "rejects.jsonl")}
    assert rejects == {"n1": "empty", "n2": "no_digit", "n3": "no_digit", "n4": "no_digit", "n5": "too_long"}
    assert sorted(r["number"] for r in rows_of(out, "34")) == sorted(["٣٤", "5-7", "12/A"])
    assert accounting["provinces"]["34"]["rejected"] == {"empty": 1, "no_digit": 3, "too_long": 1}


def test_several_values_become_several_rows_but_one_object(tmp_path):
    accounting, out = run(tmp_path, [addr(1, 40.9, 28.6, "12; 14;")])
    assert sorted(r["number"] for r in rows_of(out, "34")) == ["12", "14"]
    assert accounting["provinces"]["34"] == {"source": 1, "accepted": 1, "rows": 2, "rejected": {}}


def test_an_object_outside_every_province_goes_to_the_country_bucket(tmp_path):
    accounting, out = run(tmp_path, [addr(1, 48.0, 10.0, "3"), addr(2, 40.9, 28.6, "4")])
    assert accounting["outside"] == 1
    assert accounting["source"] == 2
    assert accounting["provinces"]["34"]["source"] == 1


def test_a_point_in_a_province_but_in_no_district_is_rejected_as_no_district(tmp_path):
    accounting, out = run(tmp_path, [addr(1, 41.3, 29.3, "3")])
    assert [r["reason"] for r in rows_of(out, "34", "rejects.jsonl")] == ["no_district"]
    assert accounting["provinces"]["34"] == {"source": 1, "accepted": 0, "rows": 0, "rejected": {"no_district": 1}}


def test_the_same_address_at_the_same_spot_is_kept_once_but_a_far_copy_stays(tmp_path):
    elements = [addr(5, 40.9, 28.6, "14"), addr(2, 40.9, 28.600001, "14"), addr(3, 40.9, 28.7, "14"), addr(4, 40.9, 28.600001, "14", street="Baska Sokak")]
    accounting, out = run(tmp_path, elements)
    assert sorted(r["id"] for r in rows_of(out, "34")) == ["n2", "n3", "n4"]
    assert [(r["id"], r["reason"]) for r in rows_of(out, "34", "rejects.jsonl")] == [("n5", "duplicate")]


def test_a_way_gets_the_representative_point_of_its_outline_and_a_building_relation_is_located(tmp_path):
    nodes = [ox.node(i, lat, lon) for i, (lat, lon) in zip(range(10, 14), [(40.60, 28.60), (40.60, 28.62), (40.62, 28.62), (40.62, 28.60)])]
    tags = {"addr:housenumber": "21", "addr:street": "Kose Sokak", "building": "yes"}
    closed = ox.way(10, [10, 11, 12, 13, 10], tags)
    open_way = ox.way(11, [10, 11, 12], {"addr:housenumber": "22", "addr:street": "Kose Sokak"})
    outer = ox.way(12, [10, 11, 12, 13, 10])
    relation = ox.relation(30, [("way", 12, "outer")], {"type": "multipolygon", "addr:housenumber": "23", "addr:street": "Kose Sokak", "building": "yes"})
    broken = ox.relation(31, [], {"type": "associatedStreet", "addr:housenumber": "24", "addr:street": "Kose Sokak"})
    accounting, out = run(tmp_path, nodes + [closed, open_way, outer, relation, broken])
    by_id = {r["id"]: r for r in rows_of(out, "34")}
    assert set(by_id) == {"w10", "w11", "r30"}
    assert 28.60 < by_id["w10"]["lon"] < 28.62 and 40.60 < by_id["w10"]["lat"] < 40.62
    assert (by_id["w11"]["lon"], by_id["w11"]["lat"]) == (28.62, 40.6)
    assert by_id["r30"]["lon"] == by_id["w10"]["lon"]
    assert accounting["unlocatable"] == 1
    assert accounting["source"] == 4


def test_the_books_balance_for_a_hundred_random_objects(tmp_path):
    rng = random.Random(7)
    values = ["1", "2/A", "-", "yok", " ", "5;6", "٣", "x" * 150, "7"]
    elements = []
    for i in range(1, 201):
        lon, lat = rng.choice([(28.5 + rng.random(), 40.5 + rng.random()), (32.0 + rng.random(), 39.5 + rng.random()), (10 + rng.random(), 48 + rng.random())])
        street = rng.choice([None, "Bir Sokak", "Iki Sokak"])
        elements.append(addr(i, round(lat, 5), round(lon, 5), rng.choice(values), street))
    accounting, out = run(tmp_path, elements)
    inside = 0
    for plate, entry in accounting["provinces"].items():
        assert entry["source"] == entry["accepted"] + sum(entry["rejected"].values())
        assert entry["accepted"] == len({r["id"] for r in rows_of(out, plate)})
        inside += entry["source"]
    assert accounting["source"] == 200 == inside + accounting["outside"] + accounting["unlocatable"]


def test_the_hash_seed_does_not_change_a_single_byte(tmp_path):
    rng = random.Random(3)
    elements = [addr(i, round(40.5 + rng.random() * 0.5, 5), round(28.5 + rng.random() * 0.9, 5), str(rng.randint(1, 30)), rng.choice(["A Sokak", "B Sokak"])) for i in range(1, 80)]
    pbf, admin, places = write_inputs(tmp_path, elements, name="seed")
    outputs = []
    for seed in ("1", "2"):
        out = tmp_path / ("proc-" + seed)
        subprocess.run([sys.executable, os.path.join(EXTRACT, "extract_addresses.py"), pbf, admin, places, str(out)], check=True, env=dict(os.environ, PYTHONHASHSEED=seed), capture_output=True)
        outputs.append({p: (out / p).read_bytes() for p in ("34/addresses.jsonl", "34/rejects.jsonl", "accounting.json", "06/addresses.jsonl")})
    assert outputs[0] == outputs[1]
    assert len(outputs[0]["34/addresses.jsonl"]) > 1000


def test_only_the_asked_provinces_are_written(tmp_path):
    accounting, out = run(tmp_path, [addr(1, 40.9, 28.6, "1"), addr(2, 40.0, 32.5, "2")], provinces={"06"})
    assert not (out / "34").exists()
    assert accounting["provinces"]["06"]["source"] == 1
    assert accounting["filtered"] is True


def test_comma_lists_split_into_rows_and_the_digit_and_length_rules_match_the_typescript_side(tmp_path):
    elements = [addr(1, 40.9, 28.6, "31,33"), addr(2, 40.9, 28.61, "1/1, 1/2"), addr(3, 40.9, 28.62, "²"), addr(4, 40.9, 28.63, "१२"), addr(5, 40.9, 28.64, "1" * 100), addr(6, 40.9, 28.65, "\U0001d7d9" * 51)]
    accounting, out = run(tmp_path, elements)
    numbers = sorted((r["id"], r["number"]) for r in rows_of(out, "34"))
    assert numbers == [("n1", "31"), ("n1", "33"), ("n2", "1/1"), ("n2", "1/2"), ("n5", "1" * 100)]
    rejects = {r["id"]: r["reason"] for r in rows_of(out, "34", "rejects.jsonl")}
    assert rejects == {"n3": "no_digit", "n4": "no_digit", "n6": "too_long"}
