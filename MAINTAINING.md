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

## Bump the cache buster when you deploy

Every asset in `index.html` is loaded with a `?v=` on the end:

```html
<link rel="stylesheet" href="css/style.css?v=2">
<script src="js/main.js?v=2"></script>
```

`index.html` is served `no-cache`, but the CSS and JS go out with a long
`max-age`, so a CDN in front of the site will keep serving the old ones after a
deploy. The result is new markup against a stale stylesheet — controls that
should be hidden appear, widths blow out, and it reads as though the UI has
broken, which is exactly what happened once already.

**Bump every `?v=` together as part of deploying**, from the repo root:

```sh
sed -i 's/?v=[0-9]*/?v=3/g' index.html
```

The number is arbitrary — it only has to differ from last time. Purging the
CDN cache by hand works too, but this survives forgetting.

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
