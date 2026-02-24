# I like to, move it — Architecture & Token Matching Rules

This document explains how the plugin works end-to-end, how token matching
decisions are made, and how to extend it for other design systems.

---

## Overview

The plugin scans a selected Figma frame for **hardcoded numeric values** on
spacing, radius, and color properties, matches them against **design system
variable tokens**, and lets the user bind the correct token in one click.

```
┌──────────────┐     ┌──────────────┐     ┌───────────────┐     ┌──────────┐
│  1. Scan      │────▶│  2. Load      │────▶│  3. Match      │────▶│  4. Apply │
│  Frame tree   │     │  Tokens       │     │  & Rank        │     │  Bindings │
└──────────────┘     └──────────────┘     └───────────────┘     └──────────┘
```

---

## 1. Scanning

The plugin walks every descendant of the selected frame and checks these
properties:

### Auto-Layout Properties (require `layoutMode !== "NONE"`)

| Figma Property       | Plugin Category | Description              |
|----------------------|-----------------|--------------------------|
| `paddingLeft`        | `padding-h`     | Horizontal padding left  |
| `paddingRight`       | `padding-h`     | Horizontal padding right |
| `paddingTop`         | `padding-v`     | Vertical padding top     |
| `paddingBottom`      | `padding-v`     | Vertical padding bottom  |
| `itemSpacing`        | `gap`           | Gap between children     |
| `counterAxisSpacing` | `gap`           | Wrap gap (cross-axis)    |

### Radius Properties (any node with corners)

| Figma Property       | Plugin Category | Description              |
|----------------------|-----------------|--------------------------|
| `topLeftRadius`      | `radius`        | Top-left corner radius   |
| `topRightRadius`     | `radius`        | Top-right corner radius  |
| `bottomLeftRadius`   | `radius`        | Bottom-left corner radius|
| `bottomRightRadius`  | `radius`        | Bottom-right corner radius|

### Color Properties (solid paints)

| Property         | Plugin Category | Description                        |
|------------------|-----------------|------------------------------------|
| `fills` (frame)  | `fill`          | Background fills on frames/shapes  |
| `fills` (text)   | `text-fill`     | Text color fills                   |
| `strokes`        | `stroke`        | Stroke/border colors               |

Color scanning rules:
- Only `SOLID` paint types are checked
- Paints with `visible === false` are skipped
- Paints already bound to a color variable (`boundVariables.color`) are skipped
- RGB values are compared with an epsilon of 0.02 per channel

### General Scanning Rules

A FLOAT/COLOR property is flagged only if:
- Its value is `> 0` (spacing/radius) or is a valid solid color
- It is **not** already bound to a variable (`boundVariables[field]` is empty)

---

## 2. Token Loading

### Local Variables

All `FLOAT` and `COLOR` variables from local variable collections are loaded
immediately. They're grouped under a single "Local Variables" library entry.

### Team Library Variables

1. `getAvailableLibraryVariableCollectionsAsync()` lists all enabled library
   collections (requires `"permissions": ["teamlibrary"]` in manifest).
2. Collections are grouped by `libraryName` — so all collections from
   "Foundations Library" appear as one dropdown entry.
3. Variable metadata (key, resolvedType) is stored without importing.
4. Actual import happens on demand: when a library is selected, its FLOAT
   and COLOR variables are imported in **parallel batches of 20** with a
   **5s timeout** per variable.

### Loading UX & Progress

The plugin provides real-time progress feedback to prevent the UI from
feeling stuck:

| Stage | Message | When |
|-------|---------|------|
| Layer scan | `Scanning layers…` | Immediately on run |
| Post-scan | `Found N unbound values. Loading libraries…` | After scan completes |
| Collection discovery | `Discovering tokens… 2/5 collections` | Per-collection during `getTeamLibraries` |
| Token import | `Importing Foundations Library tokens…` → `Importing tokens… 30/120` | Per-batch during import |

All loading messages include a friendly first-run hint: *"First time takes
a moment — after this it'll be snappy, promise!"* On subsequent runs,
Figma's internal variable cache makes imports near-instant, so the hint
barely appears.

### Alias Resolution

Design system libraries use **VariableAlias** objects for semantic tokens —
a semantic token like `padding-horizontal/small` is an alias pointing to a
primitive token like `primitive-spacing-8`. The plugin resolves these alias
chains (up to 5 levels deep) to get the final numeric/color value while
preserving the semantic token name for matching and display.

### Default Library

The plugin saves the user's preferred library name via `figma.clientStorage`.
Default: `"Foundations Library"`. On each scan, it auto-selects and auto-imports
the preferred library.

---

## 3. Token Matching — The 4-Tier System

This is the core of the plugin. Category correctness is prioritized over
value exactness. Each scanned value is matched against all tokens in the
selected library and classified into one of four tiers:

### Tier 1: Recommended (Green)

**Exact value match + token name matches the correct category for the field.**

Example: `paddingLeft = 8px` matched with a token named
`spacing/padding-horizontal/small` (value = 8).

This is the ideal match — right value, right semantic purpose. Auto-selected.

### Tier 2: Close, Right Category (Amber + ⚠ icon)

**Value is within ±3px and the token name matches the correct category.**

Example: `paddingLeft = 13px` matched with `spacing/padding-horizontal/medium`
(value = 12px, → -1px). The token is semantically correct even though the
value isn't exact.

These **are** auto-selected because category correctness matters more than
exact value. The dropdown shows **directional shift labels** like `→ -1px`
or `→ +1px` so the user knows exactly how the layout will change. A ⚠ icon
with an instant tooltip explains the shift.

### Tier 3: Exact Value, Wrong Category (Red)

**Exact value match but the token name suggests a different purpose.**

Example: `paddingLeft = 7px` matched with `radius/small` (value = 7). The
number is right but the token is meant for radii, not padding.

These are **NOT** auto-selected. The red color signals that while the value
matches, binding this token would be semantically incorrect. The user must
explicitly opt in.

### Tier 4: Close, Wrong Category (Red + ⚠ icon)

**Value is within ±3px but the token is for a different category.**

Example: `paddingLeft = 5px` matched with `radius/extra-small` (value = 4px).
Neither the value nor the category is correct.

These are **NOT** auto-selected and appear at the bottom of the dropdown.

### Color Matching

Color tokens use the same 4-tier system but compare RGB values instead of
numeric distances. Two colors are considered matching if all three channels
(R, G, B) are within an epsilon of 0.02. There is no "close match" for
colors — a color either matches exactly or doesn't.

For every color issue, the 5 nearest color alternatives (by RGB distance)
are always included in the dropdown, ensuring the user always has options
to choose from even when only one exact match exists.

### Far-Off Values (Relaxed Fallback)

When a value has **no matches at all** within normal thresholds (e.g.
`borderRadius = 999px`), the plugin performs a relaxed search:

1. Filters to **same-category tokens only** using name matching and strict
   scope matching (ignores `ALL_SCOPES` to prevent unrelated tokens like
   "Viewport Size" from appearing).
2. Picks the **5 nearest** by numeric distance.
3. Always includes the **largest** same-category token — since very large
   values often mean "max out this property" (e.g. `999px` radius →
   `radius-full = 9999px`).
4. Only falls back to cross-category tokens if zero same-category tokens
   exist.

This ensures every issue row is actionable with relevant suggestions.

### Excluded

- **Component-internal tokens** are always excluded (see section 5 below)
- Beyond the relaxed fallback, tokens that don't meet any tier criteria are
  excluded

---

## 4. Name-Based Matching Rules

Since Figma's `VariableScope` system uses a single `GAP` scope for both
padding and gap (there is no separate `PADDING` scope), the plugin uses
**token name pattern matching** to determine the correct category.

### Rule Configuration

Rules are defined in `MATCH_RULES` in `src/code.ts`:

```typescript
interface MatchRule {
  category: Category;     // "padding-h" | "padding-v" | "gap" | "radius" | "fill" | "text-fill" | "stroke"
  patterns: RegExp[];     // matched against token name (lowercase)
  priority: number;       // higher = preferred when multiple rules match
}
```

### Current Rules (Personio Foundations Library)

#### Spacing Rules

| Priority | Category    | Patterns                                                  | Example Token Names              |
|----------|-------------|-----------------------------------------------------------|----------------------------------|
| 10       | `padding-h` | `padding.?horizontal`, `padding.?h\b`, `padding.?left`, `padding.?right` | `spacing/padding-horizontal/sm` |
| 10       | `padding-v` | `padding.?vertical`, `padding.?v\b`, `padding.?top`, `padding.?bottom`   | `spacing/padding-vertical/md`   |
| 5        | `padding-h` | `\bpadding\b`, `\bpad\b`                                  | `padding/default`               |
| 5        | `padding-v` | `\bpadding\b`, `\bpad\b`                                  | `padding/default`               |
| 10       | `gap`       | `\bgap\b`, `\bsection\b`, `\bcontrol.?gap\b`, `item.?spacing` | `spacing/gap/medium`, `spacing/section/large` |
| 2        | `padding-h` | `\bspacing\b`, `\bspace\b`                                | `primitive-spacing-4`           |
| 2        | `padding-v` | `\bspacing\b`, `\bspace\b`                                | `primitive-spacing-4`           |
| 2        | `gap`       | `\bspacing\b`, `\bspace\b`                                | `primitive-spacing-4`           |
| 10       | `radius`    | `\bradius\b`, `\bradii\b`, `\bcorner\b`, `\bround\b`     | `radius/medium`                 |

#### Color Rules

| Priority | Category    | Patterns                                                  | Example Token Names              |
|----------|-------------|-----------------------------------------------------------|----------------------------------|
| 10       | `fill`      | `\bsurface\b`, `\bbackground\b`, `\bfill\b`, `\bhighlight\b` | `color/surface-default`     |
| 10       | `text-fill` | `\bcontent\b`, `\btext\b`, `\bforeground\b`               | `color/content-primary`     |
| 10       | `stroke`    | `\bstroke\b`, `\bborder\b`, `\boutline\b`                 | `color/stroke-default`      |
| 2        | `fill`      | `\bcolor\b`                                               | `color/brand-primary`       |
| 2        | `text-fill` | `\bcolor\b`                                               | `color/brand-primary`       |
| 2        | `stroke`    | `\bcolor\b`                                               | `color/brand-primary`       |

### How Rules Are Applied

1. For each token, the name is lowercased and tested against all rules.
2. If any rule for the **field's category** matches + exact value → "recommended".
3. If any rule for the **field's category** matches + close value → "close-right".
4. If rules match but for a **different category** + exact value → "exact-other".
5. If rules match but for a **different category** + close value → "close-other".
6. The `priority` value is used to sort within a tier — a `padding-horizontal`
   match (priority 10) ranks above a generic `spacing` match (priority 2).

### Scoring Formula

Within each tier, tokens are sorted by a composite score:

```
score = (nameRelevancePriority × 10) + (scopeMatches ? 5 : 0) - (difference × 2) + tokenLevelScore
```

Where:
- `nameRelevancePriority`: highest matching rule priority for the field's category
- `scopeMatches`: whether the token's Figma scope includes the relevant scope
  (`GAP` for spacing, `CORNER_RADIUS` for radius, `ALL_FILLS`/`FRAME_FILL`/etc.
  for colors). `ALL_SCOPES` counts as a match for normal classification, but is
  **ignored** in the relaxed fallback search (`scopeStrictMatchesCategory`) to
  prevent unrelated tokens from appearing.
- `difference`: absolute pixel difference from the scanned value
- `tokenLevelScore`: semantic vs. primitive preference (see below)

### Semantic vs. Primitive Token Preference

Design system libraries publish both **semantic tokens** (context-aware names
like `spacing/padding-horizontal/small`) and **primitive tokens** (raw scale
values like `primitive-spacing-8`). Engineers should use semantic tokens in
code, so the plugin ranks them higher.

The `tokenLevelScore` function applies these adjustments:

| Token Type | Condition | Score Adjustment |
|------------|-----------|------------------|
| Semantic (2-3 segments) | Normal naming | 0 (no penalty) |
| Primitive | Name contains `primitive` | -5 |
| Component-internal | 4+ path segments | -30 |

This ensures semantic tokens rank above primitives when both have the same
value, while component-internal tokens are effectively pushed to the bottom.

### Token Exclusion

Design system libraries often contain **component-internal variables** alongside
the actual scale tokens. For example, `Components/Settings tile/Padding = 16px`
is an internal component variable, not a reusable spacing token.

**Excluded entirely:**

Tokens whose names start with these prefixes are filtered out before matching:
- `Components/`
- `Component/`

This is configured via `EXCLUDED_TOKEN_PATTERNS` in `src/code.ts`.

---

## 5. Personio-Specific Optimizations

The plugin was iteratively tuned to handle real-world quirks of the Personio
Foundations Library. These are the key challenges we encountered and how the
plugin addresses them:

### Challenge 1: No Separate Padding Scope in Figma

Figma's variable scope system groups padding and gap under a single `GAP`
scope — there is no `PADDING` scope. This means scope-based matching alone
cannot distinguish between a gap token and a padding token. Both have `GAP`
scope.

**Solution:** Name-based regex matching (`MATCH_RULES`). The plugin reads the
token name to determine intent — `padding-horizontal/*` maps to `paddingLeft`
/`paddingRight`, while `gap/*` maps to `itemSpacing`. This is why the matching
rules in section 4 exist.

### Challenge 2: Component-Internal Tokens Polluting Suggestions

The Foundations Library publishes variables at all levels, including
component-internal ones like `Components/Settings tile/Padding = 16px`. These
contain words like "Padding" in the name, so a naive name-match would rank
them as top recommendations.

**Solution:** Two-layer defense:
1. `EXCLUDED_TOKEN_PATTERNS` — hard-filter any token starting with
   `Components/` or `Component/` (never shown to the user)
2. `tokenLevelScore` — tokens with deeply nested paths (4+ segments) get a
   heavy scoring penalty (-30), so even if an edge-case slips through the
   filter, it ranks below semantic and primitive scale tokens

### Challenge 3: Personio's Non-Linear Spacing Scale

Personio's spacing scale is base-4px but includes half-steps (`0.5 = 2px`,
`1.5 = 6px`, `3.5 = 14px`). This means a hardcoded value like `13px` is
genuinely off-scale — it doesn't round neatly to the nearest 4px step. The
closest tokens are `Spacing/3 = 12px` and `Spacing/3pt5 = 14px`.

**Solution:** The off-scale UX (Tier 2) shows both nearest tokens with
directional shift labels (`→ -1px` and `→ +1px`), an inline warning icon,
and auto-selects the closest match so the designer can make an informed
decision.

### Challenge 4: Semantic vs. Primitive Token Preference

Personio has both **primitive** tokens (`primitive-spacing-4 = 4px`) and
**semantic** tokens (`spacing/padding-horizontal/small = 8px`). For a
`paddingLeft = 8px`, the semantic `padding-horizontal/small` is the better
recommendation — it communicates design intent to engineers.

**Solution:** The `tokenLevelScore` function penalizes tokens with `primitive`
in the name (-5) and heavily penalizes deeply nested component-internal tokens
(-30). Combined with the priority system in `MATCH_RULES` (specific semantic
patterns at priority 10 vs. generic `spacing/space` at priority 2), semantic
tokens consistently rank at the top.

### Challenge 5: Semantic Tokens Are VariableAliases

Semantic tokens in the Foundations Library are implemented as `VariableAlias`
objects pointing to primitive tokens. When imported, a semantic token's raw
value is an alias reference, not a number. If the plugin only reads the raw
value, semantic tokens get `null` values and are silently dropped.

**Solution:** The `resolveAliasValue` function follows alias chains (up to 5
levels deep) to extract the final numeric or color value. This is called during
both local and library token loading, ensuring semantic tokens are available
with their resolved values for matching.

### Challenge 6: Library Import Performance

The Foundations Library contains hundreds of variables across multiple
collections. Importing them sequentially caused the plugin to hang
indefinitely.

**Solution:** Parallel batched imports (20 concurrent) with a 5-second
per-variable timeout. Progress is streamed to the UI at every stage
(collection discovery, per-batch import counts) so the user sees real-time
feedback instead of an infinite spinner. A friendly first-run hint reassures
users that subsequent loads will be faster thanks to Figma's internal cache.

---

## 6. Personio Design System Token Reference

Based on the Personio Foundations Library (`personio-web` codebase):

### Spacing Tokens

| Token Prefix                    | Use For                           | Figma Fields                    |
|---------------------------------|-----------------------------------|---------------------------------|
| `spacing/padding-horizontal/*`  | Horizontal internal padding       | `paddingLeft`, `paddingRight`   |
| `spacing/padding-vertical/*`    | Vertical internal padding         | `paddingTop`, `paddingBottom`   |
| `spacing/gap/*`                 | Gap between adjacent elements     | `itemSpacing`                   |
| `spacing/section/*`             | Gap between major sections        | `itemSpacing`                   |
| `spacing/control-gap/*`         | Gap between controls and labels   | `itemSpacing`                   |
| `primitive-spacing/*`           | Raw numeric scale (fallback)      | Any spacing field               |

### Spacing Scale (base 4px)

| Token         | Value | Token         | Value |
|---------------|-------|---------------|-------|
| `spacing/0`   | 0px   | `spacing/5`   | 24px  |
| `spacing/0.5` | 2px   | `spacing/6`   | 32px  |
| `spacing/1`   | 4px   | `spacing/7`   | 40px  |
| `spacing/1.5` | 6px   | `spacing/8`   | 48px  |
| `spacing/2`   | 8px   | `spacing/9`   | 64px  |
| `spacing/2.5` | 10px  | `spacing/9.5` | 72px  |
| `spacing/3`   | 12px  | `spacing/10`  | 80px  |
| `spacing/3.5` | 14px  |               |       |
| `spacing/4`   | 16px  |               |       |
| `spacing/4.5` | 20px  |               |       |

### Semantic Gap Tokens (responsive)

| Token                | Large  | Medium | Small |
|----------------------|--------|--------|-------|
| `gap-extra-small`    | 2px    | 2px    | 4px   |
| `gap-small`          | 4px    | 4px    | 6px   |
| `gap-medium`         | 8px    | 6px    | 8px   |
| `gap-large`          | 12px   | 8px    | 12px  |
| `gap-extra-large`    | 16px   | 10px   | 16px  |

### Semantic Padding Tokens

| Token                            | Value |
|----------------------------------|-------|
| `padding-vertical-extra-small`   | 2px   |
| `padding-vertical-small`         | 4px   |
| `padding-vertical-medium`        | 6px   |
| `padding-vertical-large`         | 8px   |
| `padding-horizontal-extra-small` | 6px   |
| `padding-horizontal-small`       | 8px   |
| `padding-horizontal-medium`      | 10px  |
| `padding-horizontal-large`       | 12px  |

### Radius Tokens

| Token               | Value |
|----------------------|-------|
| `radius-extra-small` | 4px   |
| `radius-small`       | 6px   |
| `radius-medium`      | 8px   |
| `radius-large`       | 12px  |
| `radius-extra-large` | 16px  |
| `radius-huge`        | 24px  |
| `radius-full`        | 9999px|

### Color Token Categories

| Token Name Pattern    | Use For               | Figma Scope         |
|-----------------------|-----------------------|---------------------|
| `color/surface-*`     | Background fills      | `FRAME_FILL`, `SHAPE_FILL` |
| `color/content-*`     | Text / foreground     | `TEXT_FILL`         |
| `color/stroke-*`      | Borders / strokes     | `STROKE_COLOR`      |
| `color/brand-*`       | Brand colors          | Context-dependent   |
| `color/input-*`       | Input field colors    | Context-dependent   |

---

## 7. UI Behavior Summary

### Variable Token Issues

| Scenario | Dropdown Color | Auto-checked? | Dropdown Groups |
|----------|---------------|---------------|-----------------|
| Exact match, right category | Green | Yes | "Exact match" / other groups as available |
| Close match, right category | Amber + ⚠ | Yes | "Nearest value" / "Exact value, different property" / etc. |
| Exact match, wrong category | Red | No | "Exact value, different property" / other groups |
| Close match, wrong category | Red + ⚠ | No | "Nearest value, different property" / other groups |
| Far-off value (relaxed fallback) | Amber/Red + ⚠ | Depends on category match | "Nearest value" / "Nearest value, different property" |
| Single alternative only | Static label (no dropdown) | Depends on tier | N/A |
| No match at all | Grey italic "no match" | No (disabled) | N/A |

### Summary Pills

| Pill | Color | Count |
|------|-------|-------|
| Exact | Green | Recommended tier matches |
| Off-scale | Amber | Close, right category matches |
| Wrong property | Red | Exact value, wrong category matches |
| Off-scale (wrong property) | Red | Close value, wrong category matches |
| No match | Red | No alternatives found |

### Off-scale Tooltip

The ⚠ icon uses a custom CSS tooltip (no browser delay) positioned above the
icon. It reads: *"Xpx is not on the spacing scale. Applying will shift the
value by ±Npx."*

### User Overrides

Every issue row with alternatives shows a `<select>` dropdown. Picking a
different token updates the issue in-place and adjusts the checkbox state.
All overrides are preserved until Rescan or Apply. When Apply is clicked,
the UI sends `tokenOverrides` mapping each issue ID to the selected token's
`variableId`, ensuring the sandbox applies the user's choice rather than
the auto-pick.

---

## 8. Adapting for Other Design Systems

To adapt this plugin for a different design system:

### Step 1: Update `DEFAULT_LIBRARY_NAME`

Change the constant in `src/code.ts`:

```typescript
const DEFAULT_LIBRARY_NAME = "Your Library Name";
```

### Step 2: Update `MATCH_RULES`

Add or modify rules to match your token naming conventions. Each rule needs:

- `category`: which Figma property type it applies to
- `patterns`: array of regex patterns to match against token names
- `priority`: how specific this rule is (10 = very specific, 2 = generic fallback)

Example for a system that uses `space-inline-*` for horizontal and
`space-stack-*` for vertical:

```typescript
{
  category: "padding-h",
  patterns: [/space.?inline/, /horizontal/],
  priority: 10,
},
{
  category: "padding-v",
  patterns: [/space.?stack/, /vertical/],
  priority: 10,
},
```

For color tokens with different naming:

```typescript
{
  category: "fill",
  patterns: [/\bbg\b/, /\bbackground\b/],
  priority: 10,
},
{
  category: "text-fill",
  patterns: [/\bfg\b/, /\btext\b/],
  priority: 10,
},
```

### Step 3: Update `EXCLUDED_TOKEN_PATTERNS`

If your library has component-internal variables under a different prefix:

```typescript
const EXCLUDED_TOKEN_PATTERNS: RegExp[] = [
  /^components\//i,
  /^internal\//i,
  /^private\//i,
];
```

### Step 4: Adjust Thresholds

```typescript
const CLOSE_THRESHOLD = 3;  // max px diff for "close" tier
const ALT_MAX_DIFF = 8;     // max px diff to show in dropdown at all
```

### Step 5: Rebuild

```bash
npm run build
```

---

## 9. Data Flow

```
┌─────────────────────────────────────────────────────────────────────┐
│ runScan()                                                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  scanNode(selected)           → ScanResult[]  (spacing/radius/color)│
│                                                                     │
│  ┌── parallel ──────────────────────────────────────────────┐       │
│  │ getLocalTokens()           → TokenInfo[]                  │       │
│  │ getTeamLibraries()         → LibraryInfo[] + LibVarRef[]  │       │
│  └───────────────────────────────────────────────────────────┘       │
│                                                                     │
│  importLibraryTokens()        → TokenInfo[]  (on-demand, batched)   │
│                                                                     │
│  matchIssues()                → IssueInfo[]  (4-tier ranked)        │
│                                                                     │
│  → postMessage("scan-complete", { issues })                         │
├─────────────────────────────────────────────────────────────────────┤
│ apply                                                               │
│  applyFixes(issues)           → setBoundVariable / setBoundVar...   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 10. File Structure

```
manifest.json          Figma plugin manifest (includes teamlibrary permission)
src/code.ts            Plugin sandbox — scanning, token loading, matching, applying
src/ui.html            Plugin UI — results panel, dropdowns, apply button
dist/                  Built output (code.js + ui.html)
ARCHITECTURE.md        This file — architecture and matching rules documentation
README.md              Quick start guide
```

---

## 11. Key Constants

| Constant                   | Value                  | Purpose                                         |
|----------------------------|------------------------|--------------------------------------------------|
| `BATCH_SIZE`               | `20`                   | Parallel import batch size                        |
| `PER_VAR_TIMEOUT_MS`       | `5000`                 | Timeout per variable import (ms)                  |
| `CLOSE_THRESHOLD`          | `3`                    | Max px diff for "close" tier                      |
| `ALT_MAX_DIFF`             | `8`                    | Max px diff to include in alternatives            |
| `COLOR_EPSILON`            | `0.02`                 | Max per-channel difference for color matching     |
| `DEFAULT_LIBRARY_NAME`     | `"Foundations Library"` | Auto-selected library on first run                |
| `STORAGE_KEY`              | `"preferredLibrary"`   | clientStorage key for remembering selection        |
| `EXCLUDED_TOKEN_PATTERNS`  | `[/^components?\//i]`  | Regex patterns to exclude component-internal tokens|
| `PRIMITIVE_TOKEN_PATTERN`  | `/\bprimitive\b/i`     | Pattern to identify primitive tokens for scoring  |
| `FIRST_RUN_HINT`           | (friendly message)     | Shown during all loading stages on first run      |
