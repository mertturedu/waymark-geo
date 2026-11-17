# Live tiles (reading a region that is not downloaded from a server)

A region whose pack is downloaded is drawn from a file. A region that is not downloaded can be read live from a tile server (`z/x/y`).
Both paths work together on the same map: the base pack, fonts and icons are always local, only the region tiles change.

## Configuration

```ts
<GeoProvider config={{ manifestUrl, publicKeys, tiles: { url: 'https://tile.example.com' } }}>
```

Without `tiles` nothing changes and the map draws only the downloaded regions.

## Which region is read?

The app tells the SDK where the map is looking:

```ts
const geo = useGeo();
geo.map.stream.set([[lng, lat], ...]);
```

Regions that contain the point, are not downloaded and have a `tiles` file in the manifest are read (at most `MAX_STREAMED`, 3).
The map's fonts, icons and overview live in the "base pack" (about 16 MB) and are always local.
When live reading is configured and the base pack is not installed, `stream.set` downloads it by itself (also on mobile data), even if no region is downloaded.
It can also be requested by hand: `geo.regions.downloadBase()`, and `geo.regions.baseReady()` tells whether it is ready. While live reading is on, the base pack is kept even when the last region is removed.
When a region is downloaded later, the style switches to the file by itself. `useMapStyle` follows the change, nothing else is needed.
If `only` is given, the list is the app's own and live reading is not added.

## Server side

The tile address is derived from the file path in the manifest: the file `34/tiles-6f086fc5.mlt.pmtiles`
is requested as `<url>/34/tiles-6f086fc5.mlt/{z}/{x}/{y}.mlt` (`.mvt` for a plain vector archive).
`tiles`, `places` and `transit` files are read with the same rule; these files must sit in the server's storage under the paths given in the manifest.
