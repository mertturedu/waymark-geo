CLASSES = {
    "motorway", "trunk", "primary", "secondary", "tertiary", "unclassified", "residential", "living_street", "service",
    "motorway_link", "trunk_link", "primary_link", "secondary_link", "tertiary_link",
}
PRIVATE_SERVICE = {"parking_aisle", "driveway", "emergency_access"}
VEHICLE_KEYS = ("motorcar", "motor_vehicle", "vehicle", "access")
ALLOWED = {"yes", "permissive", "designated", "destination", "delivery", "customers"}
DENIED = {"no", "private", "military", "agricultural", "forestry", "emergency", "permit"}
FERRY_KEYS = ("motorcar", "motor_vehicle", "vehicle")
HARMLESS_BARRIERS = {"gate", "lift_gate", "swing_gate", "sliding_gate", "kerb", "toll_booth", "cattle_grid", "border_control", "sally_port", "entrance", "height_restrictor", "arch", "no"}
ONEWAY_KEYS = ("oneway:motorcar", "oneway:motor_vehicle", "oneway:vehicle", "oneway")
FORWARD = {"yes", "true", "1"}
BACKWARD = {"-1", "reverse"}
BOTH = {"no", "false", "0", "reversible", "alternating"}
MAX_FERRY_SECONDS = 48 * 3600
RESTRICTIONS = {
    "no_left_turn", "no_right_turn", "no_straight_on", "no_u_turn", "no_entry", "no_exit",
    "only_left_turn", "only_right_turn", "only_straight_on",
}
CONDITIONAL_KEYS = {"day_on", "day_off", "hour_on", "hour_off", "date_on", "date_off"}
CAR_EXCEPTIONS = {"motorcar", "motor_vehicle", "vehicle"}
CAR_RESTRICTION_TYPES = {"restriction", "restriction:motorcar"}


def access_of(tags):
    for key in VEHICLE_KEYS:
        value = tags.get(key)
        if value in ALLOWED:
            return True
        if value in DENIED:
            return False
    return None


def oneway_of(tags, cls):
    for key in ONEWAY_KEYS:
        value = tags.get(key)
        if value in FORWARD:
            return "f"
        if value in BACKWARD:
            return "b"
        if value in BOTH:
            return ""
    if tags.get("junction") in ("roundabout", "circular") or cls in ("motorway", "motorway_link"):
        return "f"
    return ""


def duration_of(text):
    if not text or not all(c in "0123456789:" for c in text):
        return None
    parts = text.split(":")
    if len(parts) > 3 or any(p == "" for p in parts):
        return None
    numbers = [int(p) for p in parts]
    if len(numbers) == 1:
        seconds = numbers[0] * 60
    elif len(numbers) == 2:
        seconds = numbers[0] * 3600 + numbers[1] * 60
    else:
        seconds = numbers[0] * 3600 + numbers[1] * 60 + numbers[2]
    return seconds if 0 < seconds <= MAX_FERRY_SECONDS else None


def classify_way(tags):
    if tags.get("route") == "ferry":
        cars = [tags.get(key) for key in FERRY_KEYS]
        if "yes" not in cars or any(v in DENIED for v in cars):
            return {"ok": False, "reason": "ferry_no_cars"}
        return {"ok": True, "cls": "ferry", "oneway": "", "ferry": True, "speed": None, "duration": duration_of(tags.get("duration", ""))}
    cls = tags.get("highway")
    if cls not in CLASSES:
        return {"ok": False, "reason": "class"}
    if tags.get("area") == "yes":
        return {"ok": False, "reason": "area"}
    if cls == "service" and tags.get("service") in PRIVATE_SERVICE:
        return {"ok": False, "reason": "service"}
    if access_of(tags) is False:
        return {"ok": False, "reason": "access"}
    return {"ok": True, "cls": cls, "oneway": oneway_of(tags, cls), "ferry": False, "speed": tags.get("maxspeed"), "duration": None}


def blocked_node(tags):
    allowed = access_of(tags)
    if allowed is not None:
        return not allowed
    barrier = tags.get("barrier")
    return barrier is not None and barrier not in HARMLESS_BARRIERS


def refused(reason):
    return {"ok": False, "reason": reason}


def parse_restriction(tags, members):
    if tags.get("type") not in CAR_RESTRICTION_TYPES:
        return refused("not_cars")
    if CONDITIONAL_KEYS & set(tags) or any(key.startswith("restriction:conditional") for key in tags):
        return refused("conditional")
    excepted = {part.strip() for part in tags.get("except", "").replace(",", ";").split(";")}
    if CAR_EXCEPTIONS & excepted:
        return refused("exception")
    value = tags.get("restriction:motorcar") or tags.get("restriction")
    if value not in RESTRICTIONS:
        return refused("unknown")
    sources = [ref for kind, ref, role in members if role == "from" and kind == "w"]
    targets = [ref for kind, ref, role in members if role == "to" and kind == "w"]
    vias = [(kind, ref) for kind, ref, role in members if role == "via"]
    stray = [m for m in members if m[2] in ("from", "to") and m[0] != "w"]
    nodes = [ref for kind, ref in vias if kind == "n"]
    ways = [ref for kind, ref in vias if kind == "w"]
    single_node = len(nodes) == 1 and not ways
    if len(sources) != 1 or len(targets) != 1 or stray or not (single_node or (ways and not nodes)):
        return refused("members")
    via = [{"n": nodes[0]}] if single_node else [{"w": ref} for ref in ways]
    return {"ok": True, "kind": "only" if value.startswith("only_") else "no", "restriction": value, "from": sources[0], "to": targets[0], "via": via}
