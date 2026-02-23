# I like to, move it — Figma Token Audit Plugin

Scans a selected frame for hardcoded spacing, padding, gap, and border-radius
values, matches them against your design system's variable tokens using
**semantic name-based rules**, and lets you bind the correct tokens in one
click — so engineering gets clean, tokenized specs.

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
| **3. Load tokens** | Auto-selects "Foundations Library" (or your last pick). Imports all FLOAT variable tokens from all collections in the library |
| **4. Audit** | Flags every `paddingLeft/Right/Top/Bottom`, `itemSpacing`, `counterAxisSpacing`, and corner radius that **isn't** bound to a variable |
| **5. Smart match** | Classifies each value into **Recommended**, **Exact (wrong category)**, or **Close** using token name patterns |
| **6. Apply** | Check the fixes you want, hit **Apply**, and the plugin binds each property to the real design-system variable |

## 3-Tier Match System

| Tier | Color | Meaning | Auto-selected? |
|------|-------|---------|----------------|
| **Recommended** | Green | Exact value + token name matches the right category (e.g. `padding-horizontal` token for `paddingLeft`) | Yes |
| **Exact, different category** | Amber | Exact value but token is for a different purpose (e.g. `radius` token for a padding field) | Yes (with warning) |
| **Off-scale / Close (±1–3px)** | Amber + ⚠ | Value not on the DS scale — nearest tokens shown with shift labels (e.g. `→ -1px`) | Yes (pre-checked) |

Each issue row has a **dropdown** showing all alternatives grouped by tier,
so you can override the auto-pick if needed.

Component-internal tokens (e.g. `Components/Settings tile/Padding`) are
automatically excluded from suggestions — only reusable scale tokens appear.

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
| `spacing`, `space` (generic fallback) | Any spacing field |

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
2. Update `MATCH_RULES` to match your token naming conventions
3. Update `EXCLUDED_TOKEN_PATTERNS` if your component tokens use a different prefix
4. Adjust `CLOSE_THRESHOLD` and `ALT_MAX_DIFF` if your spacing scale differs
5. Rebuild

Full instructions in [ARCHITECTURE.md](./ARCHITECTURE.md#8-adapting-for-other-design-systems).
