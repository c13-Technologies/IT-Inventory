# Minia Inventory

Static-served version of the **Minia** admin dashboard (Themesbrand). The HTML / CSS / JS in this folder is served as‑is by a tiny Express server — no templating, no build step.

## Requirements

- Node.js **>= 18** (tested on Node 24)

## Install

```bash
npm install
```

## Run

```bash
npm start        # production-style, no auto-reload
npm run dev      # nodemon watches server.js and the static assets
```

Then open <http://127.0.0.1:3000/>.

## Configuration (env vars)

| Var    | Default     | Purpose                                                       |
| ------ | ----------- | ------------------------------------------------------------- |
| `PORT` | `3000`      | Port to bind. If busy, the server auto-falls back to PORT+1, +2, ... up to 10 ports. |
| `HOST` | `127.0.0.1` | Interface to bind. Set to `0.0.0.0` to expose on the LAN.      |

Examples:

```bash
HOST=0.0.0.0 PORT=8080 npm start          # bind 8080 on all interfaces
PORT=4000 npm start                       # start at 4000 (auto-fallback to 4001, 4002, ...)
```

If the server can't find a free port in the `PORT..PORT+9` range, it prints a clear error and exits with code 1 — so nodemon won't crash-loop silently.

## Folder layout

```
.
├── index.html              # Dashboard landing
├── auth-login.html         # Login page
├── assets/
│   ├── css/                # Bootstrap, Icons, app styles
│   ├── js/
│   │   ├── app.js          # App shell: sidebar, dark mode, RTL, etc.
│   │   └── pages/
│   │       └── dashboard.init.js
│   ├── libs/               # jQuery, Bootstrap, ApexCharts, jVectorMap, etc.
│   ├── images/             # logos, avatars, flags
│   └── fonts/
└── server.js               # Express static server
```

## Known gaps in this checkout

The following pages are linked from the sidebar but the supporting assets are **not** present in this folder, so they will look broken until you add them from the full Minia package:

- All pages other than `index.html` and `auth-login.html` (e.g. `tables-datatable.html`, `charts-echart.html`, `icons-*`, `form-*`).
- `assets/js/pages/pass-addon.init.js` is referenced by `auth-login.html` but missing.
- The `assets/lang/*.json` files used by the language switcher are not included.

To restore the full template, copy the missing files from the original Minia download into the matching `assets/` sub‑folder.
