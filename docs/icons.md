# Map icons

The category badges on the map (`src/native/map/icons/geo-badge-*.png`) are generated, not drawn by hand.

| Source | Version | Licence |
|---|---|---|
| Maki, Mapbox (`@mapbox/maki`) | 8.2.0 | CC0 1.0 |
| Temaki, iD editor (`@rapideditor/temaki`) | 5.13.0 | CC0 1.0 |

Both sets are public domain, no credit line is required. They are dev dependencies; the app ships only the generated pictures.

Each glyph in `src/native/map/poi-glyphs.ts` names its source file (`maki:restaurant`). `npm run icons:badges` redraws every picture: a round badge with the glyph cut out, stored as a small distance field (64 x 64, about 3 KB). At run time the badge is tinted from the theme (`icon-color`) and the cut-out and the thin ring come out white from the icon halo. Apps cannot add their own icon pictures; they can recolour, resize, hide or re-rank the built-in ones.

Which Overture category gets which glyph is decided by the ordered rules in `poi-glyphs.ts`; categories no rule or data group covers (real estate, advertising, manufacturing and similar) get no badge.
