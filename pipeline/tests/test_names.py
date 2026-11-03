import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "extract"))

import overture_places as op  # noqa: E402
import place_names as pn  # noqa: E402


def row(**extra):
    base = {"id": "a", "name": "Güneş Eczanesi", "name_tr": None, "cat": "pharmacy", "confidence": 0.9, "status": None, "lon": 29.7, "lat": 38.3}
    base.update(extra)
    return base


def osm(name, group, lon=29.7, lat=38.3, id="n1"):
    return {"id": id, "name": name, "group": group, "lon": lon, "lat": lat}


def cells(*items):
    return pn.index_osm(list(items))


def test_the_turkish_name_of_overture_comes_first():
    chosen = pn.choose(row(name="Sun Pharmacy", name_tr="Güneş Eczanesi"), "pharmacy", cells(osm("Başka Eczane", "pharmacy")))
    assert chosen == {"name": "Sun Pharmacy", "name_tr": "Güneş Eczanesi", "blank": False, "source": "overture-tr"}


def test_an_osm_name_within_fifty_metres_replaces_an_english_pattern():
    near = osm("Kadıköy İstasyonu", "public", 29.7 + 0.0003, 38.3)
    chosen = pn.choose(row(name="Kadikoy Railway Station", cat="train_station"), "public", cells(near))
    assert chosen["name_tr"] == "Kadıköy İstasyonu"
    assert chosen["source"] == "osm"
    assert chosen["name"] == "Kadikoy Railway Station"


def test_railway_x_becomes_the_turkish_station_name_and_the_pattern_without_a_match_stays():
    chosen = pn.choose(row(name="Railway Kadıköy", cat="train_station"), "public", cells(osm("Kadıköy Garı", "public", 29.70005, 38.3)))
    assert chosen["name_tr"] == "Kadıköy Garı"
    stays = pn.choose(row(name="Railway Kadıköy", cat="train_station"), "public", cells())
    assert stays == {"name": "Railway Kadıköy", "name_tr": "", "blank": False, "source": "overture"}


def test_an_english_pattern_looks_a_little_further_than_fifty_metres():
    a_hundred = osm("Kadıköy Garı", "public", 29.7 + 0.0011, 38.3)
    assert pn.choose(row(name="Railway Kadıköy", cat="train_station"), "public", cells(a_hundred))["name_tr"] == "Kadıköy Garı"
    assert pn.choose(row(name="Moda Kadıköy", cat="train_station"), "public", cells(a_hundred))["source"] == "overture"
    too_far = osm("Uzak Gar", "public", 29.7 + 0.002, 38.3)
    assert pn.choose(row(name="Railway Kadıköy", cat="train_station"), "public", cells(too_far))["source"] == "overture"


def test_an_osm_place_further_than_fifty_metres_or_of_another_group_is_ignored():
    far = osm("Uzak İstasyon", "public", 29.7 + 0.002, 38.3)
    assert pn.choose(row(name="X Station", cat="train_station"), "public", cells(far))["source"] == "overture"
    other = osm("Başka Yer", "food")
    assert pn.choose(row(name="X Station", cat="train_station"), "public", cells(other))["source"] == "overture"


def test_the_nearest_of_two_osm_places_wins_and_ties_go_to_the_lower_id():
    a = osm("Yakın", "public", 29.7001, 38.3, id="n9")
    b = osm("Uzak", "public", 29.7003, 38.3, id="n1")
    assert pn.choose(row(name="X Station"), "public", cells(a, b))["name_tr"] == "Yakın"
    t1 = osm("Birinci", "public", 29.7002, 38.3, id="n1")
    t2 = osm("İkinci", "public", 29.7002, 38.3, id="n2")
    assert pn.choose(row(name="X Station"), "public", cells(t2, t1))["name_tr"] == "Birinci"


def test_a_similar_osm_name_repairs_the_spelling_of_the_overture_name():
    chosen = pn.choose(row(name="Gunes Eczanesi"), "pharmacy", cells(osm("Güneş Eczanesi", "pharmacy")))
    assert chosen["name_tr"] == "Güneş Eczanesi"
    same = pn.choose(row(name="Güneş Eczanesi"), "pharmacy", cells(osm("Güneş Eczanesi", "pharmacy")))
    assert chosen["source"] == "osm" and same["name_tr"] == "Güneş Eczanesi"


def test_a_neighbour_of_the_same_group_with_another_name_does_not_rename_the_place():
    chosen = pn.choose(row(name="Güneş Eczanesi"), "pharmacy", cells(osm("Deniz Eczanesi", "pharmacy")))
    assert chosen == {"name": "Güneş Eczanesi", "name_tr": "", "blank": False, "source": "overture"}
    unrelated = pn.choose(row(name="Moda Kafe"), "food", cells(osm("Sahil Lokantası", "food")))
    assert unrelated["source"] == "overture"


@pytest.mark.parametrize("a,b,expected", [("Gunes Eczanesi", "Güneş Eczanesi", True), ("Migros", "Migros Jet", True), ("Moda Kafe", "Sahil Lokantası", False), ("", "x", False), ("Ab", "Cd", False), ("Yeni Cami", "Yeni Camii", True), ("Güneş Eczanesi", "Deniz Eczanesi", False), ("Migros Jet", "Migros Ekspres", True)])
def test_similar(a, b, expected):
    assert pn.similar(a, b) is expected


@pytest.mark.parametrize("name", ["Eğitim", "Park", "Market", "Eczane", "ECZANE", "Eczane.", "Okul", "Pharmacy", "Çocuk Parkı", "Süpermarket", "Spor Salonu"])
def test_a_name_that_is_only_a_category_word_is_blank(name):
    assert pn.choose(row(name=name), "public", cells()) == {"name": "", "name_tr": "", "blank": True, "source": "generic"}


@pytest.mark.parametrize("name", ["Güneş Eczanesi", "Park Otel", "Market Plus", "Eğitim Sokağı", "Migros"])
def test_a_real_name_that_contains_a_category_word_stays(name):
    assert pn.choose(row(name=name), "public", cells())["blank"] is False


def test_a_generic_name_is_replaced_by_the_osm_name_when_there_is_one():
    chosen = pn.choose(row(name="Eczane"), "pharmacy", cells(osm("Deniz Eczanesi", "pharmacy")))
    assert chosen["name_tr"] == "Deniz Eczanesi" and chosen["blank"] is False


def test_a_generic_osm_name_does_not_replace_anything():
    chosen = pn.choose(row(name="X Station"), "public", cells(osm("Park", "public")))
    assert chosen["source"] == "overture"


def test_the_feature_of_a_blank_place_has_an_empty_name_and_no_turkish_name():
    r = row(name="Eczane")
    op.choose_names([r], {})
    props = op.feature(r)["properties"]
    assert props["name"] == "" and "name:tr" not in props


def test_the_feature_carries_the_chosen_turkish_name():
    r = row(name="Kadikoy Railway Station", cat="train_station", name_tr=None)
    op.choose_names([r], cells(osm("Kadıköy Garı", "public", 29.7001, 38.3)))
    assert op.feature(r)["properties"]["name:tr"] == "Kadıköy Garı"


def test_choose_names_counts_where_each_name_came_from():
    rows = [row(id="1", name_tr="Güneş"), row(id="2", name="Eczane"), row(id="3", name="Plain Pharmacy Shop"), row(id="4", name="X Station", lon=29.8)]
    counts = op.choose_names(rows, cells(osm("Gar", "public", 29.8001, 38.3)))
    assert counts == {"overture-tr": 1, "osm": 0, "generic": 1, "overture": 2}


def test_a_name_without_osm_help_is_left_alone():
    assert pn.choose(row(), "pharmacy", None) == {"name": "Güneş Eczanesi", "name_tr": "", "blank": False, "source": "overture"}
