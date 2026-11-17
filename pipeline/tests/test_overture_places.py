import json
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "extract"))

import overture_places as op


def row(**extra):
    base = {"id": "a", "name": "Güneş Eczanesi", "cat": "pharmacy", "confidence": 0.9, "status": None, "name_tr": None, "lon": 29.7, "lat": 38.3}
    base.update(extra)
    return base


@pytest.mark.parametrize(
    "category,group",
    [
        ("hospital", "health"), ("dentist", "health"), ("pharmacy", "pharmacy"), ("police_station", "safety"), ("fire_station", "safety"),
        ("bank_credit_union", "money"), ("atm", "money"), ("gas_station", "fuel"), ("car_wash", "fuel"), ("muslim_place_of_worship", "worship"),
        ("hotel", "lodging"), ("grocery_store", "market"), ("supermarket", "market"), ("convenience_store", "market"), ("cafe", "food"),
        ("turkish_restaurant", "food"), ("bakery", "food"), ("government_office", "public"), ("elementary_school", "public"),
        ("clothing_store", "shop"), ("furniture_store", "shop"), ("hair_salon", "shop"), ("party_and_event_planning", "other"), ("", "other"), (None, "other"),
    ],
)
def test_classify(category, group):
    assert op.classify(category) == group


@pytest.mark.parametrize(
    "category,group",
    [("barber", "shop"), ("barber_shop", "shop"), ("public_bath", "public"), ("public_bath_house", "public"), ("public_service_and_government", "public"), ("public_toilet", "other"), ("public_plaza", "other"), ("publisher", "other"), ("notary_public", "other"), ("retirement_home", "other"), ("pubs_and_bars", "food"), ("pub", "food"), ("gastropub", "food"), ("cafeteria", "food"), ("tire_shop", "fuel"), ("shopping", "shop"), ("bookstore", "shop"), ("superstore", "shop"), ("preschool", "public"), ("public_school", "public"), ("cosmetic_dentistry", "health"), ("veterinary_clinic", "health"), ("ev_charging_station", "fuel"), ("fire_station", "safety")],
)
def test_classify_keeps_short_words_from_matching_inside_longer_ones(category, group):
    assert op.classify(category) == group


def test_pharmacy_is_not_health_and_market_is_not_shop():
    assert op.classify("pharmacy") == "pharmacy"
    assert op.classify("grocery_store") == "market"


def test_min_zoom_follows_importance_and_confidence():
    assert op.min_zoom("health", "hospital", 0.6) == 13
    assert op.min_zoom("market", "shopping_center", 0.5) == 13
    assert op.min_zoom("money", "bank", 0.9) == 14
    assert op.min_zoom("money", "bank", 0.6) == 15
    assert op.min_zoom("food", "cafe", 0.9) == 15
    assert op.min_zoom("food", "cafe", 0.6) == 16
    assert op.min_zoom("shop", "store", 0.9) == 15
    assert op.min_zoom("other", "x", 0.99) == 16
    assert op.min_zoom("other", None, 0.99) == 16


@pytest.mark.parametrize(
    "extra,kept",
    [({}, True), ({"confidence": 0.5}, True), ({"confidence": 0.49}, False), ({"confidence": None}, False), ({"name": ""}, False), ({"name": "A"}, False),
     ({"name": None}, False), ({"name": "x" * 81}, False), ({"name": "x" * 80}, True), ({"status": "permanently_closed"}, False),
     ({"status": "temporarily_closed"}, False), ({"status": "open"}, True), ({"cat": None}, False), ({"cat": ""}, False)],
)
def test_keep(extra, kept):
    assert op.keep(row(**extra)) is kept


@pytest.mark.parametrize("confidence,kept", [(0.3, True), (0.29, False), (0.45, True), (None, False)])
def test_keep_for_the_directory_takes_lower_confidence(confidence, kept):
    assert op.keep(row(confidence=confidence), op.DIRECTORY_MIN_CONFIDENCE) is kept


def test_other_addresses_skip_the_first_and_empty_and_repeated_ones():
    assert op.other_addresses('["Cumhuriyet Cd. 5", "Atatürk Sk. 2", "", null, "Atatürk Sk. 2", "cumhuriyet cd. 5"]') == ["Atatürk Sk. 2"]
    assert op.other_addresses(None) == []
    assert op.other_addresses("bozuk") == []
    assert op.other_addresses('["tek"]') == []


def test_feature_has_only_what_the_map_needs_and_a_zoom_range():
    f = op.feature(row(name_tr="Güneş Eczane"))
    assert f["properties"] == {"name": "Güneş Eczanesi", "name:tr": "Güneş Eczane", "cat": "pharmacy", "g": "pharmacy", "c": 90}
    assert f["geometry"] == {"type": "Point", "coordinates": [29.7, 38.3]}
    assert f["tippecanoe"] == {"minzoom": 14, "maxzoom": 16}
    assert "name:tr" not in op.feature(row())["properties"]
    assert "name:tr" not in op.feature(row(name_tr="Güneş Eczanesi"))["properties"]


def test_feature_never_carries_contact_data():
    f = op.feature(row(phones=["+90"], emails=["a@b"], websites=["x"], socials=["y"]))
    assert set(f["properties"]) <= {"name", "name:tr", "cat", "g", "c"}


def test_assign_puts_each_point_in_the_province_that_contains_it():
    from shapely.geometry import box
    import numpy

    borders = {"20": box(29, 37, 30, 39), "34": box(28, 40, 30, 42)}
    lon = numpy.array([29.5, 29.0, 35.0, 29.5])
    lat = numpy.array([38.0, 41.0, 39.0, 40.5])
    assert list(op.assign(lon, lat, borders)) == ["20", "34", "", "34"]


def test_load_borders_reads_rings_and_filters_plates(tmp_path):
    path = tmp_path / "b.jsonl"
    ring = [[29, 37], [30, 37], [30, 39], [29, 39], [29, 37]]
    hole = [[29.4, 37.4], [29.6, 37.4], [29.6, 37.6], [29.4, 37.6], [29.4, 37.4]]
    path.write_text("\n".join(json.dumps(r) for r in [{"plate": "20", "rings": [[ring, hole]]}, {"plate": "34", "rings": [[ring]]}]) + "\n")
    both = op.load_borders(str(path), None)
    assert sorted(both) == ["20", "34"]
    only = op.load_borders(str(path), {"20"})
    assert sorted(only) == ["20"]
    assert not only["20"].contains(__import__("shapely").geometry.Point(29.5, 37.5))
    assert only["20"].contains(__import__("shapely").geometry.Point(29.2, 37.2))


def test_extract_writes_files_per_province_from_a_small_parquet(tmp_path):
    import duckdb

    from shapely.geometry import box

    cache = tmp_path / "cache" / "r1"
    cache.mkdir(parents=True)
    con = duckdb.connect()
    con.execute(
        f"""copy (select * from (values
          ('1','Güneş Eczanesi',NULL,'pharmacy',0.95,'Cumhuriyet Cd. No:5','["Cumhuriyet Cd. No:5","Atatürk Sk. 2"]','Güneş','pharmacy>health','Çivril','20000','meta','CDLA-Permissive-2.0',NULL,29.5,38.0),
          ('2','Kapalı Market',NULL,'grocery_store',0.9,NULL,NULL,NULL,NULL,NULL,NULL,'meta','CDLA-Permissive-2.0','permanently_closed',29.6,38.1),
          ('3','Düşük Güven',NULL,'cafe',0.3,'x',NULL,NULL,NULL,NULL,NULL,'meta','CDLA-Permissive-2.0',NULL,29.7,38.2),
          ('4','Deniz Otel','Deniz Otel TR','hotel',0.8,'Sahil Yolu 3',NULL,NULL,NULL,'Kadıköy',NULL,'meta','CDLA-Permissive-2.0',NULL,29.0,41.0),
          ('5','Dışarıda',NULL,'bank',0.9,'Y',NULL,NULL,NULL,NULL,NULL,'meta','CDLA-Permissive-2.0',NULL,35.0,39.0),
          ('6','Çok Düşük',NULL,'cafe',0.1,'x',NULL,NULL,NULL,NULL,NULL,'meta','CDLA-Permissive-2.0',NULL,29.8,38.3)
        ) t(id,name,name_tr,cat,confidence,addr,addrs,brand,tax,locality,postcode,src,license,status,lon,lat)) to '{cache}/tr-places-v2.parquet' (format parquet)"""
    )
    borders = tmp_path / "borders.jsonl"
    ring = lambda b: [[[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]], [b[0], b[1]]]]
    borders.write_text("\n".join(json.dumps({"plate": p, "rings": [ring(b)]}) for p, b in [("20", (29, 37, 30, 39)), ("34", (28.5, 40.5, 29.5, 41.5))]) + "\n")
    out = tmp_path / "out"
    summary = op.extract("r1", str(borders), str(out), str(tmp_path / "cache"), None)
    assert summary == {"20": {"all": 4, "kept": 1, "listed": 2, "minzoom": 14}, "34": {"all": 1, "kept": 1, "listed": 1, "minzoom": 14}}
    first = [json.loads(line) for line in (out / "20.geojsonl").read_text().splitlines()]
    assert [f["properties"]["name"] for f in first] == ["Güneş Eczanesi"]
    second = [json.loads(line) for line in (out / "34.geojsonl").read_text().splitlines()]
    assert second[0]["properties"]["name:tr"] == "Deniz Otel TR"
    rows = [json.loads(line) for line in (out / "20.rows.jsonl").read_text().splitlines()]
    assert rows[0] == {"id": "1", "name": "Güneş Eczanesi", "name_tr": None, "cat": "pharmacy", "g": "pharmacy", "conf": 0.95, "addr": "Cumhuriyet Cd. No:5", "more": ["Atatürk Sk. 2"], "brand": "Güneş", "tax": "pharmacy>health", "locality": "Çivril", "postcode": "20000", "lon": 29.5, "lat": 38.0}
    assert [r["id"] for r in rows] == ["1", "3"]
    other = [json.loads(line) for line in (out / "34.rows.jsonl").read_text().splitlines()]
    assert other[0]["name_tr"] == "Deniz Otel TR" and other[0]["g"] == "lodging" and other[0]["more"] == [] and other[0]["brand"] is None
    assert json.loads((out / "summary.json").read_text())["release"] == "r1"
    again = op.extract("r1", str(borders), str(out), str(tmp_path / "cache"), None)
    assert again == summary
