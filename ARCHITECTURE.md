# I like to, move it — Architecture & Token Matching Rules

This document explains how the plugin works end-to-end, how token matching
decisions are made, and how to extend it for other design systems.

---

## Overview

The plugin scans a selected Figma frame for **hardcoded numeric values** on
spacing and radius properties, matches them against **design system variable
tokens**, and lets the user bind the correct token in one click.

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

A property is flagged only if:
- Its value is `> 0`
- It is **not** already bound to a variable (`boundVariables[field]` is empty)

---

## 2. Token Loading

### Local Variables

All `FLOAT` variables from local variable collections are loaded immediately.
They're grouped under a single "Local Variables" library entry.

### Team Library Variables

1. `getAvailableLibraryVariableCollectionsAsync()` lists all enabled library
   collections (requires `"permissions": ["teamlibrary"]` in manifest).
2. Collections are grouped by `libraryName` — so all collections from
   "Foundations Library" appear as one dropdown entry.
3. Variable metadata (key, resolvedType) is stored without importing.
4. Actual import happens on demand: when a library is selected, its FLOAT
   variables are imported in **parallel batches of 8** with a **5s timeout**
   per variable.

### Default Library

The plugin saves the user's preferred library name via `figma.clientStorage`.
Default: `"Foundations Library"`. On each scan, it auto-selects and auto-imports
the preferred library.

---

## 3. Token Matching — The 3-Tier System

This is the core of the plugin. Each scanned value is matched against all
tokens in the selected library and classified into one of three tiers:

### Tier 1: Recommended (Green)

**Exact value match + token name matches the correct category for the field.**

Example: `paddingLeft = 8px` matched with a token named
`spacing/padding-horizontal/small` (value = 8).

This is the ideal match — right value, right semantic purpose.

### Tier 2: Exact Value, Different Category (Amber)

**Exact value match but the token name suggests a different purpose.**

Example: `paddingLeft = 4px` matched with a token named `radius/extra-small`
(value = 4). The number is right but the token is meant for radii, not padding.

These are auto-selected because the value is correct, but the amber color
warns the user to double-check.

### Tier 3: Off-Scale / Close Match (Amber dropdown + ⚠ icon)

**Value is within ±3px but not exact — the value is "off-scale".**

Example: `paddingLeft = 13px`. No token has value 13. Nearest tokens are
`Spacing/3 = 12px (→ -1px)` and `Spacing/3pt5 = 14px (→ +1px)`.

These **are** auto-selected (pre-checked) because the designer likely intended
a nearby scale value. The dropdown shows **directional shift labels** like
`→ -1px` or `→ +1px` so the user knows exactly how the layout will change.

A small ⚠ icon appears inline after the dropdown with an instant CSS tooltip:
*"13px is not on the spacing scale. Applying will shift the value by -1px."*

The dropdown groups off-scale alternatives into:
- **"Nearest tokens"** — tokens whose name matches the correct category
- **"Other values"** — tokens from a different category (e.g. radius tokens)

### Excluded

- Tokens more than ±3px away from the scanned value are excluded from
  alternatives (beyond the close threshold)
- Tokens more than ±8px away are excluded from consideration entirely
  (`ALT_MAX_DIFF`)
- **Component-internal tokens** are always excluded (see section 5 below)

---

## 4. Name-Based Matching Rules

Since Figma's `VariableScope` system uses a single `GAP` scope for both
padding and gap (there is no separate `PADDING` scope), the plugin uses
**token name pattern matching** to determine the correct category.

### Rule Configuration

Rules are defined in `MATCH_RULES` in `src/code.ts`:

```typescript
interface MatchRule {
  category: Category;     // "padding-h" | "padding-v" | "gap" | "radius"
  patterns: RegExp[];     // matched against token name (lowercase)
  priority: number;       // higher = preferred when multiple rules match
}
```

### Current Rules (Personio Foundations Library)

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

### How Rules Are Applied

1. For each token, the name is lowercased and tested against all rules.
2. If any rule for the **field's category** matches, the token qualifies for
   "recommended" tier (assuming exact value match).
3. If rules match but for a **different category**, it's "exact-other" tier.
4. The `priority` value is used to sort within a tier — a `padding-horizontal`
   match (priority 10) ranks above a generic `spacing` match (priority 2).

### Scoring Formula

Within each tier, tokens are sorted by a composite score:

```
score = (nameRelevancePriority × 10) + (scopeMatches ? 5 : 0) - (difference × 2) + depthPenalty
```

Where:
- `nameRelevancePriority`: highest matching rule priority for the field's category
- `scopeMatches`: whether the token's Figma scope includes `GAP` (for spacing)
  or `CORNER_RADIUS` (for radius)
- `difference`: absolute pixel difference from the scanned value
- `depthPenalty`: penalty for deeply nested token paths (see below)

### Token Exclusion & Depth Penalty

Design system libraries often contain **component-internal variables** alongside
the actual scale tokens. For example, `Components/Settings tile/Padding = 16px`
is an internal component variable, not a reusable spacing token — but it
contains "Padding" in its name and would falsely match.

**Excluded entirely:**

Tokens whose names start with these prefixes are filtered out before matching:
- `Components/`
- `Component/`

This is configured via `EXCLUDED_TOKEN_PATTERNS` in `src/code.ts`.

**Depth penalty:**

Tokens with deeply nested paths are penalized in scoring so that primitive
and semantic tokens always rank above incidentally-named nested tokens:

| Path Depth | Example                          | Penalty |
|------------|----------------------------------|---------|
| 1–2 segments | `Spacing/3`, `radius/medium`  | 0       |
| 3 segments | `spacing/gap/medium`              | -10     |
| 4+ segments | `Components/Card/Inner/Padding` | -30     |

This ensures `Spacing/3pt5 = 14px` ranks above a deeply nested token like
`Layouts/Card/Section/Gap = 14px` even if both match the name rules.

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
2. `depthPenalty` — tokens with deeply nested paths (3+ segments) get a
   scoring penalty, so even if an edge-case slips through the filter, it
   ranks below primitive scale tokens

### Challenge 3: Personio's Non-Linear Spacing Scale

Personio's spacing scale is base-4px but includes half-steps (`0.5 = 2px`,
`1.5 = 6px`, `3.5 = 14px`). This means a hardcoded value like `13px` is
genuinely off-scale — it doesn't round neatly to the nearest 4px step. The
closest tokens are `Spacing/3 = 12px` and `Spacing/3pt5 = 14px`.

**Solution:** The off-scale UX (Tier 3) shows both nearest tokens with
directional shift labels (`→ -1px` and `→ +1px`), an inline warning icon,
and auto-selects the closest match so the designer can make an informed
decision.

### Challenge 4: Semantic vs. Primitive Token Preference

Personio has both **primitive** tokens (`primitive-spacing-4 = 4px`) and
**semantic** tokens (`spacing/padding-horizontal/small = 8px`). For a
`paddingLeft = 8px`, the semantic `padding-horizontal/small` is the better
recommendation — it communicates design intent to engineers.

**Solution:** The priority system in `MATCH_RULES` gives specific semantic
patterns (priority 10) much higher weight than generic `spacing/space`
patterns (priority 2). The scoring formula amplifies this: `priority × 10`
means a semantic match scores 100 points vs. a generic match's 20.

### Challenge 5: Library Import Performance

The Foundations Library contains hundreds of variables across multiple
collections. Importing them sequentially caused the plugin to hang
indefinitely.

**Solution:** Parallel batched imports (8 concurrent) with a 5-second
per-variable timeout. Progress is streamed to the UI so the user sees
real-time feedback instead of an infinite spinner.

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

---

## 7. UI Behavior Summary

| Scenario | Dropdown Color | Auto-checked? | Dropdown Groups |
|----------|---------------|---------------|-----------------|
| Exact match, right category | Green | Yes | "Recommended" / "Exact value, different category" / "Close matches" |
| Exact match, wrong category | Amber | Yes | Same as above |
| Off-scale (no exact match) | Amber + ⚠ icon | Yes | "Nearest tokens" / "Other values" |
| Single alternative only | Static label (no dropdown) | Depends on tier | N/A |
| No match at all | Grey italic "no match" | No (disabled) | N/A |

### Off-scale tooltip

The ⚠ icon uses a custom CSS tooltip (no browser delay) positioned above the
icon. It reads: *"Xpx is not on the spacing scale. Applying will shift the
value by ±Npx."*

### User overrides

Every issue row with alternatives shows a `<select>` dropdown. Picking a
different token updates the issue in-place and adjusts the checkbox state.
All overrides are preserved until Rescan or Apply.

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

---

## 9. File Structure

```
manifest.json          Figma plugin manifest (includes teamlibrary permission)
src/code.ts            Plugin sandbox — scanning, token loading, matching, applying
src/ui.html            Plugin UI — results panel, dropdowns, apply button
dist/                  Built output (code.js + ui.html)
ARCHITECTURE.md        This file — architecture and matching rules documentation
README.md              Quick start guide
```

---

## 10. Key Constants

| Constant                   | Value                  | Purpose                                         |
|----------------------------|------------------------|--------------------------------------------------|
| `BATCH_SIZE`               | `8`                    | Parallel import batch size                        |
| `PER_VAR_TIMEOUT_MS`       | `5000`                 | Timeout per variable import (ms)                  |
| `CLOSE_THRESHOLD`          | `3`                    | Max px diff for "close" tier                      |
| `ALT_MAX_DIFF`             | `8`                    | Max px diff to include in alternatives            |
| `DEFAULT_LIBRARY_NAME`     | `"Foundations Library"` | Auto-selected library on first run                |
| `STORAGE_KEY`              | `"preferredLibrary"`   | clientStorage key for remembering selection        |
| `EXCLUDED_TOKEN_PATTERNS`  | `[/^components?\//i]`  | Regex patterns to exclude component-internal tokens|
