# MatchCat

MatchCat is a Figma plugin that **smart-matches source variables to target variables**
and writes `VARIABLE_ALIAS` values with a reviewable preview table.

Example mapping:

- Source `componentToken/button/primary-background-default`
- Target `colorSystem/control/theme-primary-background-default`

…including aligned states such as `default / hover / active`.

## Core behavior

- Type-gated matching (`COLOR/FLOAT/STRING/BOOLEAN`)
- Leaf normalization + longest token-suffix similarity
- State alignment (`default/rest/base`, `hover`, `active/pressed`, etc.)
- Role-word overlap scoring with soft prefix noise tolerance
- Family consistency for `default/hover/active` batches
- Candidate preview + per-row candidate override
- `setValueForMode` alias writes with mode-name alignment
- Dry-run support
- `overwrite-literal` default **OFF**

MatchCat never creates variables, never renames variables, and never creates collections.

## Local development

```bash
npm install
npm run build
```

Or keep rebuilding while editing:

```bash
npm run watch
```

For local plugin iteration, keep the watch process running so `dist/` stays hot for Figma reload.

### Scripts

| Script | What it does |
|--------|--------------|
| `npm run build` | Bundles `dist/code.js` + `dist/ui.html` |
| `npm run watch` | Bundles on save |
| `npm test` | Runs matcher unit tests |
| `npm run typecheck` | TypeScript check (`--noEmit`) |

## Import into Figma

1. Open **Figma Desktop**
2. Go to **Plugins → Development → Import plugin from manifest…**
3. Select this repo’s `manifest.json`
4. Run **MatchCat** from Plugins → Development

After code changes, run **Reload plugin** from the plugin’s development entry.

## Repository layout

```
matchcat/
├── manifest.json
├── src/
│   ├── code.ts                 plugin runtime + postMessage bridge
│   ├── figma/variables.ts      variable snapshot + alias apply
│   ├── matcher/matchScore.ts   pure scoring + family consistency
│   ├── protocol/messages.ts    UI/main message contract
│   └── ui/                     Spiral React interface (zh-CN)
├── scripts/build.mjs
└── tests/matchScore.test.ts
```
