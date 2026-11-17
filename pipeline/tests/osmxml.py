from xml.sax.saxutils import quoteattr

STAMP = 'version="1" timestamp="2026-01-01T00:00:00Z"'


def _tags(tags):
    return "".join("<tag k=%s v=%s/>" % (quoteattr(str(k)), quoteattr(str(v))) for k, v in (tags or {}).items())


def node(id, lat, lon, tags=None):
    return '<node id="%d" %s lat="%s" lon="%s">%s</node>' % (id, STAMP, lat, lon, _tags(tags))


def way(id, refs, tags=None):
    return '<way id="%d" %s>%s%s</way>' % (id, STAMP, "".join('<nd ref="%d"/>' % r for r in refs), _tags(tags))


def relation(id, members, tags=None):
    inner = "".join('<member type="%s" ref="%d" role="%s"/>' % m for m in members)
    return '<relation id="%d" %s>%s%s</relation>' % (id, STAMP, inner, _tags(tags))


def box(first_id, west, south, east, north):
    ids = [first_id + i for i in range(4)]
    corners = [(south, west), (south, east), (north, east), (north, west)]
    nodes = [node(i, lat, lon) for i, (lat, lon) in zip(ids, corners)]
    return nodes, ids + [ids[0]]


def write(path, *parts):
    flat = []
    for part in parts:
        flat.extend(part if isinstance(part, list) else [part])
    def by_id(items):
        return sorted(items, key=lambda x: int(x.split('id="', 1)[1].split('"', 1)[0]))

    nodes = by_id([p for p in flat if p.startswith("<node")])
    ways = by_id([p for p in flat if p.startswith("<way")])
    relations = by_id([p for p in flat if p.startswith("<relation")])
    path.write_text('<?xml version="1.0" encoding="UTF-8"?>\n<osm version="0.6" generator="fixture">\n' + "\n".join(nodes + ways + relations) + "\n</osm>\n", encoding="utf-8")
    return str(path)


def admin_relation(id, way_id, level, name, tags=None):
    base = {"boundary": "administrative", "admin_level": str(level), "name": name, "type": "boundary"}
    base.update(tags or {})
    return relation(id, [("way", way_id, "outer")], base)
