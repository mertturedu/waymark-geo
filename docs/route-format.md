# Route pack format (versions 1 and 2)

One file per province (`route-<digest>.bin`, `kind: route` in the manifest). Numbers are little endian. A "varint" is an unsigned integer written in 7-bit groups (at most 5 bytes, 32 bits); a "zigzag" is a signed number turned into a varint with `v >= 0 ? 2v : -2v - 1`. Coordinates are in micro degrees (degrees x 1e6).

## Header (44 bytes)

| Offset | Size | Meaning |
|---|---|---|
| 0 | u32 | magic number `0x54524759` (`YGRT`) |
| 4 | u16 | version (1 or 2) |
| 6 | u16 | flags (0) |
| 8 | u32 | number of hierarchy nodes (junctions + turn copies) |
| 12 | u32 | number of base junctions |
| 16 | u32 | number of road segments (undirected) |
| 20 | 4 x i32 | box: west, south, east, north |
| 36 | u32 | reserved |
| 40 | u32 | number of sections |

The section table follows immediately: for each section `u8 id, u32 start, u32 length` (9 bytes). Sections are at absolute offsets counted from the start of the file. The reader checks that every section stays inside the file.

## Sections

1. **Nodes.** For each base junction: `zigzag Δlongitude`, `zigzag Δlatitude` (relative to the previous one), `varint hierarchy node`.
2. **Road segments.** For each segment: `zigzag Δstart` (relative to the start of the previous segment), `zigzag (end - start)`, `varint flags`, `varint length (m)`, `varint forward time`, `varint backward time` (deciseconds, without the junction penalty; 0 if there is no direction), `varint shape byte count`.
   Flags: bit 0 passable forward, bit 1 passable backward, bit 2 in the main network, bit 3 junction penalty in the forward direction, bit 4 junction penalty in the backward direction, bit 5 and up road class (the order of `ROAD_CLASSES` in `src/core/route/speeds.ts`).
   The directed arc id is `pa = 2 x segment + direction` (direction 0: start to end, 1: the reverse).
3. **Shapes.** The intermediate points of the segments one after another: `varint point count`, then for each point `zigzag Δlongitude`, `zigzag Δlatitude` (starting from the start node). The byte range of a segment is found from the shape byte counts in the road segments section.
4. **Up arcs** and 5. **down arcs** (contraction hierarchies). The node id is the ordering rank: the target of an up arc always has a larger id. First `varint total arc count`, then for each node `varint count` and that many records: `varint target delta` (`target - node - 1` in the first record, relative to the previous target in the following ones), `varint time`, `varint length (m)`, `varint via`. If the low bit of `via` is 1 it is an original arc and `via >> 1` is the directed arc id; if 0 it is a shortcut and `via >> 1` is the middle node (always smaller than this node).
   The up list holds the arcs going from the node to a higher-ranked node, the down list the arcs coming from a higher-ranked node to this node (for the backward search).
6. **Entry table.** Directed arcs that have a copy because of a turn restriction: `varint count`, then `varint Δarc id`, `varint node` (the node reached when the arc ends).
7. **Exit table.** Copy nodes from which an arc can be started (except the root node): `varint count`, then `varint Δarc id`, `varint node`.
8. **Grid.** `zigzag start longitude`, `zigzag start latitude`, `varint cell size (5000)`, `varint columns`, `varint rows`, then for each cell `varint record count`, then the road segment ids of each cell (`varint` increasing delta).

## Version 2: mirror arcs

Everything except the up and down arc sections is the same as in version 1.

- The `via` in an up arc record carries one more bit: the written value is `2 x via + mirror`. If `mirror` is 1, the reverse of this arc is in the down list of the same node and is not written to the down section. The reverse: the same end node, the same time and length; for an original arc the direction bit of the directed arc id is flipped (`pa ^ 1`), for a shortcut the middle node stays the same.
- The down section holds only arcs that have no mirror (the total count is also their count).
- The reader builds each node's down list by merging, ordered by end node; the result is identical to the list of a version 1 file. A mirror is used only if the down list has a single arc to that end node; if the same end node appears twice the file is considered corrupt.
- The `minSdk` of a manifest that contains a version 2 pack is at least `0.6.0`. The pack pipeline writes version 2 when the SDK version is 0.6.0 or above; `GEO_ROUTE_FORMAT=1|2` forces it. `rewriteRoutePack` (`pipeline/build/route-pack.ts`) converts a file between the two versions without rebuilding it.

## Time and weight

Weights are in deciseconds (0.1 s). The weight of a directed arc is the time computed from road type, `maxspeed`, nearby junction density and the length between junctions (`roadKmh`), plus, if at least three roads meet at the arrival junction, a junction penalty by road type (`speeds.ts`). Turn restrictions are applied with local copy nodes; there is no left-turn penalty.

## Reader rules

For corrupt input the reader throws an error with the code `route_pack_corrupt`; it never enters an infinite loop. Counts cannot be larger than the file size, every node and road segment id must be in range, and the middle of a shortcut must be smaller than its own node.
