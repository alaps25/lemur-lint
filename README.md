# I like to, move it — Figma Token Audit Plugin

Scans a selected frame for hardcoded spacing, padding, gap, border-radius,
and color values, matches them against your design system's variable tokens,
and lets you bind the correct tokens in one click — so engineering gets clean,
tokenized specs.

## Quick Start

```bash
npm install
npm run build
```

### Load in Figma

1. Open the Figma desktop app
2. Go to **Plugins → Development → Import plugin from manifest…**
3. Select the `manifest.json` file from this folder
4. Open any design file, select a frame, and run **Plugins → Development → I like to, move it**

## How It Works

| Step | What Happens |
|------|-------------|
| **1. Select a frame** | Pick any frame, component, or instance on the canvas |
| **2. Run the plugin** | Walks the entire layer tree inside your selection |
| **3. Load tokens** | Auto-selects "Foundations Library" (or your last pick). Imports all FLOAT and COLOR variable tokens from all collections in the library |
| **4. Audit** | Flags every `paddingLeft/Right/Top/Bottom`, `itemSpacing`, `counterAxisSpacing`, corner radius, fill/stroke color, and text color that **isn't** bound to a variable |
| **5. Smart match** | Classifies each value into **Recommended**, **Exact (wrong category)**, or **Close** using token name patterns and semantic preference |
| **6. Apply** | Check the fixes you want, hit **Apply**, and the plugin binds each property to the real design-system variable |

## What It Scans

| Category | Properties | Token Type |
|----------|-----------|------------|
| **Spacing** | `paddingLeft`, `paddingRight`, `paddingTop`, `paddingBottom`, `itemSpacing`, `counterAxisSpacing` | FLOAT variables |
| **Radius** | `topLeftRadius`, `topRightRadius`, `bottomLeftRadius`, `bottomRightRadius` | FLOAT variables |
| **Fill Color** | Solid fills on frames/shapes | COLOR variables |
| **Text Color** | Solid fills on text nodes | COLOR variables |
| **Stroke Color** | Solid strokes on any node | COLOR variables |

Invisible paints (visibility toggled off in Figma) are automatically skipped.

## 4-Tier Match System

| Tier | Color | Meaning | Auto-selected? |
|------|-------|---------|----------------|
| **Recommended** | Green | Exact value + token name matches the right category (e.g. `padding-horizontal` token for `paddingLeft`) | Yes |
| **Close, right category** | Amber + ⚠ | Off-scale value but nearest token is the right category — shift labels show `→ -1px` etc. | Yes |
| **Exact, wrong category** | Red | Exact value but token is for a different purpose (e.g. `radius` token for a padding field) | No — manual opt-in |
| **Close, wrong category** | Red + ⚠ | Off-scale value and nearest token is a different category | No — manual opt-in |

Each issue row has a **dropdown** showing all alternatives grouped by tier,
so you can override the auto-pick if needed.

## Semantic Token Preference

The plugin prefers **semantic tokens** over primitive tokens. For example:
- `spacing/padding-horizontal/small` (semantic) ranks above `primitive-spacing-8` (primitive)
- `color/content-default` (semantic) ranks above `color/gray-900` (primitive)

Tokens with `primitive` in the name receive a small scoring penalty (-5),
while component-internal tokens with deeply nested paths (4+ segments) are
heavily penalized (-30). Component tokens starting with `Components/` are
excluded entirely.

## Loading UX

The plugin provides real-time progress feedback during each stage:

| Stage | Message Example |
|-------|----------------|
| Scanning layers | `Scanning layers…` |
| After scan | `Found 42 unbound values. Loading libraries…` |
| Discovering collections | `Discovering tokens… 2/5 collections` |
| Importing tokens | `Importing Foundations Library tokens…` then `Importing tokens… 30/120` |

On the first run, a friendly hint lets users know: *"First time takes a
moment — after this it'll be snappy, promise!"* Subsequent runs are near-instant
thanks to Figma's internal variable cache.

## Token Name Matching Rules

The plugin uses regex patterns to determine which tokens are appropriate for
which fields. This is necessary because Figma's `VariableScope` system uses
a single `GAP` scope for both padding and gap — there's no separate padding
scope.

Key rules for Personio's Foundations Library:

| Token Name Pattern | Matched To |
|---|---|
| `padding-horizontal`, `padding-h`, `padding-left`, `padding-right` | `paddingLeft`, `paddingRight` |
| `padding-vertical`, `padding-v`, `padding-top`, `padding-bottom` | `paddingTop`, `paddingBottom` |
| `gap`, `section`, `control-gap` | `itemSpacing`, `counterAxisSpacing` |
| `radius`, `radii`, `corner`, `round` | All corner radius fields |
| `surface`, `background`, `fill`, `highlight` | Frame/shape fills |
| `content`, `text`, `foreground` | Text fills |
| `stroke`, `border`, `outline` | Strokes |
| `spacing`, `space` (generic fallback) | Any spacing field |
| `color` (generic fallback) | Any color field |

See [ARCHITECTURE.md](./ARCHITECTURE.md) for the full rule config, scoring
formula, and instructions on adapting for other design systems.

## Project Structure

```
manifest.json          Figma plugin manifest (with teamlibrary permission)
src/code.ts            Plugin sandbox — scanning, matching, applying
src/ui.html            Plugin UI — results panel, tier dropdowns, apply button
dist/                  Built output loaded by Figma
ARCHITECTURE.md        Deep dive into matching rules, scoring, and adaptation guide
```

## Development

```bash
npm run build      # one-shot production build
npm run watch      # rebuild code.ts on save (re-copy ui.html manually)
```

After rebuilding, close and reopen the plugin in Figma to pick up changes.
If `manifest.json` changed, re-import via **Plugins → Development → Import
plugin from manifest…**.

## Adapting for Another Design System

1. Change `DEFAULT_LIBRARY_NAME` in `src/code.ts`
2. Update `MATCH_RULES` to match your token naming conventions (spacing, color, and radius patterns)
3. Update `EXCLUDED_TOKEN_PATTERNS` if your component tokens use a different prefix
4. Adjust `CLOSE_THRESHOLD` and `ALT_MAX_DIFF` if your spacing scale differs
5. Rebuild

Full instructions in [ARCHITECTURE.md](./ARCHITECTURE.md#9-adapting-for-other-design-systems).
