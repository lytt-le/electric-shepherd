# Maintaining Electric Shepherd

Short file, one rule worth writing down.

## The README and the in-app help are twins

`README.md` and the **?** handbook (`js/help.js`, opened with the toolbar `?` button,
the `?` key or `F1`) carry the same material. They are written by hand and neither is
generated from the other.

**When you edit a section of `README.md`, edit the matching pane in `js/help.js`.**

The `SECTIONS` array at the top of `js/help.js` documents the mapping, heading by
heading. Two differences are deliberate:

* README's **Running it** section has no pane — anyone reading the handbook is already
  running the app.
* The README intro becomes the **Overview** pane, rewritten for the screen.

Adding a section? Add an entry to `SECTIONS` (id, title, kicker, html) and it appears
in the sidebar and the filter box automatically — no other wiring.

## Names that must not be rebranded

The app was renamed from *Electric Sheep* to *Electric Shepherd*, but these strings
deliberately kept their old spelling, because they identify data rather than the
product:

| Where | String | Why |
|---|---|---|
| `js/genome.js` | `FORMAT = 'electric-sheep-local'` | stamped into every exported `.sheep.json` and checked on load |
| `js/library.js` | `electric-sheep-flock-v1`, `electric-sheep-settings-v1` | browser storage keys — renaming hides every flock already saved |
| `js/library.js` | `electric-sheep-local-flock` | the `.flock.json` format tag |
| `js/render.js` | WebM muxing/writing app tags | written into files already on disk |

A "sheep" is still a sheep, too: it is the word for a single flame genome throughout
the interface, the code and the file formats. Only the product name changed.
