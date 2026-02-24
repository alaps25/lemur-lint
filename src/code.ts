figma.showUI(__html__, { width: 460, height: 600, themeColors: true });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type Category =
  | "padding-h" | "padding-v" | "gap" | "radius"
  | "fill" | "text-fill" | "stroke";

type ScanType = "float" | "color";

interface FieldDef {
  field: string;
  label: string;
  category: Category;
}

interface ColorValue { r: number; g: number; b: number; a: number; }

interface ScanResult {
  id: string;
  nodeId: string;
  nodeName: string;
  field: string;
  label: string;
  category: Category;
  scanType: ScanType;
  currentValue: number;
  currentColor: ColorValue | null;
  paintIndex: number;
  paintTarget: "fills" | "strokes" | null;
}

interface TokenInfo {
  variableId: string;
  variableKey?: string;
  name: string;
  value: number;
  color: ColorValue | null;
  tokenType: "float" | "color";
  libraryId: string;
  collectionKey?: string;
  source: "local" | "library";
  scopes: string[];
}

interface LibraryInfo {
  id: string;
  name: string;
  source: "local" | "library";
  tokenCount: number;
  collectionKeys: string[];
}

type MatchTier = "recommended" | "close-right" | "exact-other" | "close-other";

interface TokenAlternative {
  token: TokenInfo;
  tier: MatchTier;
  difference: number;
  score: number;
}

interface IssueInfo extends ScanResult {
  token: TokenInfo | null;
  tier: MatchTier | null;
  difference: number;
  alternatives: TokenAlternative[];
}

// ---------------------------------------------------------------------------
// Field definitions — the properties we audit
//
// Categories are now granular so matching rules can distinguish
// horizontal padding from vertical padding from gap.
// ---------------------------------------------------------------------------

const AUTOLAYOUT_FIELDS: FieldDef[] = [
  { field: "paddingLeft",        label: "Padding Left",   category: "padding-h" },
  { field: "paddingRight",       label: "Padding Right",  category: "padding-h" },
  { field: "paddingTop",         label: "Padding Top",    category: "padding-v" },
  { field: "paddingBottom",      label: "Padding Bottom", category: "padding-v" },
  { field: "itemSpacing",        label: "Gap",            category: "gap" },
  { field: "counterAxisSpacing", label: "Wrap Gap",       category: "gap" },
];

const RADIUS_FIELDS: FieldDef[] = [
  { field: "topLeftRadius",     label: "Top-Left Radius",     category: "radius" },
  { field: "topRightRadius",    label: "Top-Right Radius",    category: "radius" },
  { field: "bottomLeftRadius",  label: "Bottom-Left Radius",  category: "radius" },
  { field: "bottomRightRadius", label: "Bottom-Right Radius", category: "radius" },
];

// ---------------------------------------------------------------------------
// Token Matching Rules
//
// These rules define how token names map to Figma node properties.
// They are based on the Personio Foundations Library naming conventions
// but are designed to be extensible to other design systems.
//
// Each rule has:
//   - category: which Figma property category it applies to
//   - patterns: regex patterns matched against the token name (lowercase)
//   - priority: higher = preferred when multiple rules match
//
// HOW MATCHING WORKS:
//   1. "recommended" = exact value match + token name matches a rule for
//      the field's category (e.g. a padding-horizontal token for paddingLeft)
//   2. "exact-other" = exact value match but the token name suggests a
//      different category (e.g. a radius token matched for a gap field)
//   3. "close" = value is within CLOSE_THRESHOLD (±3px) but not exact
//   4. Tokens beyond CLOSE_THRESHOLD are shown only if nothing else exists,
//      capped at ALT_MAX_DIFF (±8px)
//
// Personio Foundations Library naming:
//   - spacing-padding-horizontal-*  → paddingLeft, paddingRight
//   - spacing-padding-vertical-*    → paddingTop, paddingBottom
//   - spacing-gap-*                 → itemSpacing, counterAxisSpacing
//   - spacing-section-*             → itemSpacing (larger section gaps)
//   - spacing-control-gap-*         → itemSpacing (label-to-control gaps)
//   - radius-*                      → corner radius fields
//   - primitive-spacing-*           → any spacing field (generic fallback)
//   - primitive-radius-*            → any radius field (generic fallback)
//
// Color naming (Personio):
//   - color/surface-*               → fill backgrounds
//   - color/content-*               → text fills
//   - color/stroke-*                → strokes / borders
//   - color/brand-*, color/input-*  → context-dependent
// ---------------------------------------------------------------------------

interface MatchRule {
  category: Category;
  patterns: RegExp[];
  priority: number;
}

const MATCH_RULES: MatchRule[] = [
  // Horizontal padding — most specific
  {
    category: "padding-h",
    patterns: [/padding.?horizontal/, /padding.?h\b/, /padding.?left/, /padding.?right/],
    priority: 10,
  },
  // Vertical padding — most specific
  {
    category: "padding-v",
    patterns: [/padding.?vertical/, /padding.?v\b/, /padding.?top/, /padding.?bottom/],
    priority: 10,
  },
  // Generic padding — matches either h or v padding
  {
    category: "padding-h",
    patterns: [/\bpadding\b/, /\bpad\b/],
    priority: 5,
  },
  {
    category: "padding-v",
    patterns: [/\bpadding\b/, /\bpad\b/],
    priority: 5,
  },
  // Gap / spacing between elements
  {
    category: "gap",
    patterns: [/\bgap\b/, /\bsection\b/, /\bcontrol.?gap\b/, /item.?spacing/],
    priority: 10,
  },
  // Generic spacing — fallback for any spacing field
  {
    category: "padding-h",
    patterns: [/\bspacing\b/, /\bspace\b/],
    priority: 2,
  },
  {
    category: "padding-v",
    patterns: [/\bspacing\b/, /\bspace\b/],
    priority: 2,
  },
  {
    category: "gap",
    patterns: [/\bspacing\b/, /\bspace\b/],
    priority: 2,
  },
  // Radius
  {
    category: "radius",
    patterns: [/\bradius\b/, /\bradii\b/, /\bcorner\b/, /\bround\b/],
    priority: 10,
  },
  // --- Color rules ---
  {
    category: "fill",
    patterns: [/\bsurface\b/, /\bbackground\b/, /\bfill\b/, /\bhighlight\b/],
    priority: 10,
  },
  {
    category: "text-fill",
    patterns: [/\bcontent\b/, /\btext\b/, /\bforeground\b/],
    priority: 10,
  },
  {
    category: "stroke",
    patterns: [/\bstroke\b/, /\bborder\b/, /\boutline\b/],
    priority: 10,
  },
  {
    category: "fill",
    patterns: [/\bcolor\b/],
    priority: 2,
  },
  {
    category: "text-fill",
    patterns: [/\bcolor\b/],
    priority: 2,
  },
  {
    category: "stroke",
    patterns: [/\bcolor\b/],
    priority: 2,
  },
];

const CLOSE_THRESHOLD = 3;
const ALT_MAX_DIFF = 8;

// ---------------------------------------------------------------------------
// Scan — walk the tree and collect unbound properties
// ---------------------------------------------------------------------------

function pushFloatResult(
  results: ScanResult[], node: SceneNode, def: FieldDef, val: number
): void {
  results.push({
    id: `${node.id}::${def.field}`,
    nodeId: node.id,
    nodeName: node.name,
    field: def.field,
    label: def.label,
    category: def.category,
    scanType: "float",
    currentValue: val,
    currentColor: null,
    paintIndex: -1,
    paintTarget: null,
  });
}

function scanPaints(
  node: SceneNode, results: ScanResult[],
  target: "fills" | "strokes", category: Category, label: string
): void {
  const paints = (node as any)[target];
  if (!Array.isArray(paints)) return;
  for (let i = 0; i < paints.length; i++) {
    const p = paints[i];
    if (!p || p.type !== "SOLID") continue;
    if (p.visible === false) continue;
    const bv = p.boundVariables;
    if (bv && bv.color) continue;
    const c = p.color;
    if (!c) continue;
    const opacity = typeof p.opacity === "number" ? p.opacity : 1;
    results.push({
      id: `${node.id}::${target}::${i}`,
      nodeId: node.id,
      nodeName: node.name,
      field: `${target}::${i}`,
      label: label,
      category: category,
      scanType: "color",
      currentValue: 0,
      currentColor: { r: c.r, g: c.g, b: c.b, a: opacity },
      paintIndex: i,
      paintTarget: target,
    });
  }
}

function scanNode(node: SceneNode, results: ScanResult[]): void {
  // --- Spacing / auto-layout ---
  if ("layoutMode" in node && (node as FrameNode).layoutMode !== "NONE") {
    for (const def of AUTOLAYOUT_FIELDS) {
      const val = (node as any)[def.field];
      if (typeof val === "number" && val > 0) {
        const bv = (node as any).boundVariables;
        const bound = bv && bv[def.field];
        if (!bound) pushFloatResult(results, node, def, val);
      }
    }
  }

  // --- Radius ---
  if ("topLeftRadius" in node) {
    for (const def of RADIUS_FIELDS) {
      const val = (node as any)[def.field];
      if (typeof val === "number" && val > 0) {
        const bv = (node as any).boundVariables;
        const bound = bv && bv[def.field];
        if (!bound) pushFloatResult(results, node, def, val);
      }
    }
  }

  // --- Fill colors ---
  const isText = node.type === "TEXT";
  if ("fills" in node) {
    scanPaints(node, results, "fills", isText ? "text-fill" : "fill",
      isText ? "Text Color" : "Fill Color");
  }

  // --- Stroke colors ---
  if ("strokes" in node) {
    scanPaints(node, results, "strokes", "stroke", "Stroke Color");
  }

  // --- Recurse children ---
  if ("children" in node) {
    for (const child of (node as FrameNode).children) {
      scanNode(child, results);
    }
  }
}

// ---------------------------------------------------------------------------
// Fetch tokens — local variables grouped as a single "Local" library
// ---------------------------------------------------------------------------

const LOCAL_LIBRARY_ID = "__local__";

function isRgb(val: any): val is { r: number; g: number; b: number } {
  return val && typeof val.r === "number" && typeof val.g === "number" && typeof val.b === "number";
}

function isVariableAlias(val: any): val is { type: string; id: string } {
  return val && typeof val === "object" && val.type === "VARIABLE_ALIAS" && typeof val.id === "string";
}

async function resolveAliasValue(
  rawValue: any, modeId: string, depth?: number
): Promise<{ resolved: number | { r: number; g: number; b: number } | null }> {
  const d = depth || 0;
  if (d > 5) return { resolved: null };
  if (typeof rawValue === "number") return { resolved: rawValue };
  if (isRgb(rawValue)) return { resolved: rawValue };
  if (isVariableAlias(rawValue)) {
    try {
      const target = await figma.variables.getVariableByIdAsync(rawValue.id);
      if (!target) return { resolved: null };
      const targetCol = await figma.variables.getVariableCollectionByIdAsync(
        target.variableCollectionId
      );
      if (!targetCol) return { resolved: null };
      const targetMode = targetCol.modes[0].modeId;
      return resolveAliasValue(target.valuesByMode[targetMode], targetMode, d + 1);
    } catch {
      return { resolved: null };
    }
  }
  return { resolved: null };
}

async function getLocalTokens(): Promise<{
  library: LibraryInfo | null;
  tokens: TokenInfo[];
}> {
  const tokens: TokenInfo[] = [];
  const localCols = await figma.variables.getLocalVariableCollectionsAsync();

  for (const col of localCols) {
    for (const varId of col.variableIds) {
      const v = await figma.variables.getVariableByIdAsync(varId);
      if (!v) continue;
      const modeId = col.modes[0].modeId;
      const rawValue = v.valuesByMode[modeId];
      const scopes = v.scopes ? [...v.scopes] : [];

      const { resolved } = await resolveAliasValue(rawValue, modeId);
      if (resolved === null) continue;

      if (v.resolvedType === "FLOAT" && typeof resolved === "number") {
        tokens.push({
          variableId: v.id, name: v.name, value: resolved,
          color: null, tokenType: "float",
          libraryId: LOCAL_LIBRARY_ID, source: "local", scopes,
        });
      } else if (v.resolvedType === "COLOR" && isRgb(resolved)) {
        const a = typeof (resolved as any).a === "number" ? (resolved as any).a : 1;
        tokens.push({
          variableId: v.id, name: v.name, value: 0,
          color: { r: resolved.r, g: resolved.g, b: resolved.b, a },
          tokenType: "color",
          libraryId: LOCAL_LIBRARY_ID, source: "local", scopes,
        });
      }
    }
  }

  if (tokens.length === 0) return { library: null, tokens: [] };

  return {
    library: {
      id: LOCAL_LIBRARY_ID,
      name: "Local Variables",
      source: "local",
      tokenCount: tokens.length,
      collectionKeys: [],
    },
    tokens,
  };
}

// ---------------------------------------------------------------------------
// Fetch team library info — grouped by libraryName
// ---------------------------------------------------------------------------

interface LibVarRef {
  key: string;
  resolvedType: string;
  collectionKey: string;
  libraryId: string;
}

async function getTeamLibraries(): Promise<{
  libraries: LibraryInfo[];
  varRefs: LibVarRef[];
  error: string | null;
}> {
  const libraries: LibraryInfo[] = [];
  const varRefs: LibVarRef[] = [];

  try {
    const libCols =
      await figma.teamLibrary.getAvailableLibraryVariableCollectionsAsync();
    console.log("[Move It] Found", libCols.length, "library variable collections");

    const byLibrary = new Map<string, {
      name: string;
      floatCount: number;
      collectionKeys: string[];
      refs: LibVarRef[];
    }>();

    for (let ci = 0; ci < libCols.length; ci++) {
      const lc = libCols[ci];
      console.log("[Move It] Collection:", lc.name, "from", lc.libraryName);
      figma.ui.postMessage({
        type: "loading",
        message: `Discovering tokens\u2026 ${ci + 1}/${libCols.length} collections`,
        hint: FIRST_RUN_HINT,
      });
      const vars =
        await figma.teamLibrary.getVariablesInLibraryCollectionAsync(lc.key);
      const usableVars = vars.filter((v) => v.resolvedType === "FLOAT" || v.resolvedType === "COLOR");
      console.log("[Move It]  -> usable:", usableVars.length, "/ total:", vars.length);

      const libId = lc.libraryName;
      let entry = byLibrary.get(libId);
      if (!entry) {
        entry = { name: lc.libraryName, floatCount: 0, collectionKeys: [], refs: [] };
        byLibrary.set(libId, entry);
      }
      entry.floatCount += usableVars.length;
      entry.collectionKeys.push(lc.key);
      for (const uv of usableVars) {
        entry.refs.push({
          key: uv.key,
          resolvedType: uv.resolvedType,
          collectionKey: lc.key,
          libraryId: libId,
        });
      }
    }

    byLibrary.forEach((entry, libId) => {
      if (entry.floatCount > 0) {
        libraries.push({
          id: libId,
          name: entry.name,
          source: "library",
          tokenCount: entry.floatCount,
          collectionKeys: entry.collectionKeys,
        });
        varRefs.push(...entry.refs);
      }
    });

    return { libraries, varRefs, error: null };
  } catch (e: any) {
    const msg = e && e.message ? e.message : String(e);
    console.error("[Move It] Library fetch failed:", msg);
    return { libraries, varRefs, error: msg };
  }
}

// ---------------------------------------------------------------------------
// Import library tokens — batched in parallel with timeout + progress
// ---------------------------------------------------------------------------

const BATCH_SIZE = 20;
const PER_VAR_TIMEOUT_MS = 5000;
const FIRST_RUN_HINT = "First time takes a moment \u2014 after this it\u2019ll be snappy, promise!";

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (!done) { done = true; resolve(null); }
    }, ms);
    promise.then(
      (val) => { if (!done) { done = true; clearTimeout(timer); resolve(val); } },
      () => { if (!done) { done = true; clearTimeout(timer); resolve(null); } }
    );
  });
}

async function importLibraryTokens(
  libraryId: string,
  refs: LibVarRef[]
): Promise<TokenInfo[]> {
  const tokens: TokenInfo[] = [];
  const total = refs.length;
  let imported = 0;

  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batch = refs.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (ref) => {
        const variable = await withTimeout(
          figma.variables.importVariableByKeyAsync(ref.key),
          PER_VAR_TIMEOUT_MS
        );
        if (!variable) return null;
        try {
          const col = await withTimeout(
            figma.variables.getVariableCollectionByIdAsync(
              variable.variableCollectionId
            ),
            PER_VAR_TIMEOUT_MS
          );
          if (!col) return null;
          const modeId = col.modes[0].modeId;
          const rawVal = variable.valuesByMode[modeId];
          const scopes = variable.scopes ? [...variable.scopes] : [];

          const { resolved } = await resolveAliasValue(rawVal, modeId);
          if (resolved === null) return null;

          if (typeof resolved === "number") {
            return {
              variableId: variable.id, variableKey: ref.key,
              name: variable.name, value: resolved, color: null, tokenType: "float" as const,
              libraryId, collectionKey: ref.collectionKey,
              source: "library" as const, scopes,
            };
          } else if (isRgb(resolved)) {
            const a = typeof (resolved as any).a === "number" ? (resolved as any).a : 1;
            return {
              variableId: variable.id, variableKey: ref.key,
              name: variable.name, value: 0,
              color: { r: resolved.r, g: resolved.g, b: resolved.b, a },
              tokenType: "color" as const,
              libraryId, collectionKey: ref.collectionKey,
              source: "library" as const, scopes,
            };
          }
          return null;
        } catch {
          return null;
        }
      })
    );

    for (const r of results) {
      if (r) tokens.push(r);
    }
    imported += batch.length;

    figma.ui.postMessage({
      type: "loading",
      message: `Importing tokens\u2026 ${imported}/${total}`,
      hint: FIRST_RUN_HINT,
    });
  }

  return tokens;
}

// ---------------------------------------------------------------------------
// Token matching — 4-tier system (category correctness > value exactness)
//
// Tier 1: "recommended"   — exact value + name matches the right category
// Tier 2: "close-right"   — close value (±CLOSE_THRESHOLD) + right category
// Tier 3: "exact-other"   — exact value but wrong category
// Tier 4: "close-other"   — close value + wrong category
//
// Within each tier, tokens are sorted by relevance score.
// Tokens beyond ALT_MAX_DIFF are excluded entirely.
//
// When NO alternatives are found within normal thresholds, we do a relaxed
// search across all tokens to find the nearest matches (for values like 999px).
// ---------------------------------------------------------------------------

function tokenNameMatchesCategory(name: string, category: Category): boolean {
  const lower = name.toLowerCase();
  const rules = MATCH_RULES.filter((r) => r.category === category);
  return rules.some((rule) =>
    rule.patterns.some((pat) => pat.test(lower))
  );
}

function tokenNameRelevanceScore(name: string, category: Category): number {
  const lower = name.toLowerCase();
  let best = 0;
  for (const rule of MATCH_RULES) {
    if (rule.category !== category) continue;
    for (const pat of rule.patterns) {
      if (pat.test(lower) && rule.priority > best) {
        best = rule.priority;
      }
    }
  }
  return best;
}

function scopeMatchesCategory(scopes: string[], category: Category): boolean {
  if (scopes.includes("ALL_SCOPES")) return true;
  switch (category) {
    case "padding-h":
    case "padding-v":
    case "gap":
      return scopes.includes("GAP");
    case "radius":
      return scopes.includes("CORNER_RADIUS");
    case "fill":
      return scopes.includes("ALL_FILLS") || scopes.includes("FRAME_FILL") || scopes.includes("SHAPE_FILL");
    case "text-fill":
      return scopes.includes("ALL_FILLS") || scopes.includes("TEXT_FILL");
    case "stroke":
      return scopes.includes("STROKE_COLOR");
    default:
      return false;
  }
}

function scopeStrictMatchesCategory(scopes: string[], category: Category): boolean {
  switch (category) {
    case "padding-h":
    case "padding-v":
    case "gap":
      return scopes.includes("GAP");
    case "radius":
      return scopes.includes("CORNER_RADIUS");
    case "fill":
      return scopes.includes("ALL_FILLS") || scopes.includes("FRAME_FILL") || scopes.includes("SHAPE_FILL");
    case "text-fill":
      return scopes.includes("ALL_FILLS") || scopes.includes("TEXT_FILL");
    case "stroke":
      return scopes.includes("STROKE_COLOR");
    default:
      return false;
  }
}

// ---------------------------------------------------------------------------
// Color matching helpers
// ---------------------------------------------------------------------------

const COLOR_EPSILON = 0.02;

function colorDistance(a: ColorValue, b: ColorValue): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

function colorsMatch(a: ColorValue, b: ColorValue): boolean {
  return Math.abs(a.r - b.r) < COLOR_EPSILON &&
         Math.abs(a.g - b.g) < COLOR_EPSILON &&
         Math.abs(a.b - b.b) < COLOR_EPSILON;
}

function classifyColorAlternative(
  token: TokenInfo,
  targetColor: ColorValue,
  category: Category
): { tier: MatchTier; difference: number; score: number } | null {
  if (isExcludedToken(token.name)) return null;
  if (token.tokenType !== "color" || !token.color) return null;

  const dist = colorDistance(targetColor, token.color);
  const isExact = colorsMatch(targetColor, token.color);
  if (!isExact) return null;

  const nameMatches = tokenNameMatchesCategory(token.name, category);
  const nameScore = tokenNameRelevanceScore(token.name, category);
  const scopeMatches = scopeMatchesCategory(token.scopes, category);

  const tier: MatchTier = nameMatches ? "recommended" : "exact-other";
  let score = nameScore * 10 + (scopeMatches ? 5 : 0) + tokenLevelScore(token.name);

  return { tier, difference: Math.round(dist * 1000) / 1000, score };
}

const COLOR_CLOSE_THRESHOLD = 0.15;
const COLOR_FALLBACK_LIMIT = 5;

function findRankedColorTokens(
  targetColor: ColorValue,
  category: Category,
  tokens: TokenInfo[]
): TokenAlternative[] {
  const candidates: TokenAlternative[] = [];

  for (const token of tokens) {
    const result = classifyColorAlternative(token, targetColor, category);
    if (!result) continue;
    candidates.push({ token, tier: result.tier, difference: result.difference, score: result.score });
  }

  // Always include nearest color alternatives so the user has a dropdown
  // to pick from — even when there are exact matches. De-duplicate against
  // tokens already in candidates.
  const existingIds = new Set(candidates.map((c) => c.token.variableId));
  const eligible = tokens.filter(
    (t) => t.tokenType === "color" && t.color && !isExcludedToken(t.name) && !existingIds.has(t.variableId)
  );

  const scored = eligible.map((t) => {
    const dist = colorDistance(targetColor, t.color!);
    return { token: t, dist };
  });
  scored.sort((a, b) => a.dist - b.dist);

  const fallback = scored.slice(0, COLOR_FALLBACK_LIMIT);

  for (const entry of fallback) {
    const nameMatches = tokenNameMatchesCategory(entry.token.name, category);
    const nameScore = tokenNameRelevanceScore(entry.token.name, category);
    const scopeMatches = scopeMatchesCategory(entry.token.scopes, category);
    const isClose = entry.dist <= COLOR_CLOSE_THRESHOLD;
    let tier: MatchTier;
    if (isClose && nameMatches) tier = "close-right";
    else if (isClose) tier = "close-other";
    else if (nameMatches) tier = "close-right";
    else tier = "close-other";
    const score = nameScore * 10 + (scopeMatches ? 5 : 0) - entry.dist * 100 + tokenLevelScore(entry.token.name);
    candidates.push({
      token: entry.token,
      tier,
      difference: Math.round(entry.dist * 1000) / 1000,
      score,
    });
  }

  const tierOrder: Record<MatchTier, number> = {
    recommended: 0, "close-right": 1, "exact-other": 2, "close-other": 3,
  };

  candidates.sort((a, b) => {
    const tierDiff = tierOrder[a.tier] - tierOrder[b.tier];
    if (tierDiff !== 0) return tierDiff;
    return b.score - a.score || a.difference - b.difference;
  });

  return candidates;
}

// Tokens whose names match these patterns are component-internal variables,
// not design system scale tokens. They should be excluded from matching.
const EXCLUDED_TOKEN_PATTERNS: RegExp[] = [
  /^components\//i,
  /^component\//i,
];

function isExcludedToken(name: string): boolean {
  return EXCLUDED_TOKEN_PATTERNS.some((pat) => pat.test(name));
}

// Semantic vs primitive scoring. Semantic tokens (context-aware names like
// "Item Padding/Horizontal/Small") should rank above primitives ("Spacing/2").
// Component-internal tokens (4+ segments) are still heavily penalized.
const PRIMITIVE_TOKEN_PATTERN = /\bprimitive\b/i;

function tokenLevelScore(name: string): number {
  const segments = name.split("/").length;
  if (segments >= 4) return -30;
  if (PRIMITIVE_TOKEN_PATTERN.test(name)) return -5;
  return 0;
}

function classifyAlternative(
  token: TokenInfo,
  value: number,
  category: Category
): { tier: MatchTier; difference: number; score: number } | null {
  if (isExcludedToken(token.name)) return null;

  const diff = Math.abs(token.value - value);
  if (diff > ALT_MAX_DIFF) return null;

  const isExact = diff === 0;
  const isClose = !isExact && diff <= CLOSE_THRESHOLD;
  const nameMatches = tokenNameMatchesCategory(token.name, category);
  const nameScore = tokenNameRelevanceScore(token.name, category);
  const scopeMatches = scopeMatchesCategory(token.scopes, category);

  let tier: MatchTier;
  if (isExact && nameMatches) {
    tier = "recommended";
  } else if (isClose && nameMatches) {
    tier = "close-right";
  } else if (isExact) {
    tier = "exact-other";
  } else if (isClose) {
    tier = "close-other";
  } else {
    return null;
  }

  let score = 0;
  score += nameScore * 10;
  if (scopeMatches) score += 5;
  score -= diff * 2;
  score += tokenLevelScore(token.name);

  return { tier, difference: Math.round(diff * 100) / 100, score };
}

function findRankedTokens(
  value: number,
  category: Category,
  tokens: TokenInfo[]
): TokenAlternative[] {
  const candidates: TokenAlternative[] = [];

  for (const token of tokens) {
    const result = classifyAlternative(token, value, category);
    if (!result) continue;
    candidates.push({
      token,
      tier: result.tier,
      difference: result.difference,
      score: result.score,
    });
  }

  const tierOrder: Record<MatchTier, number> = {
    recommended: 0,
    "close-right": 1,
    "exact-other": 2,
    "close-other": 3,
  };

  // Relaxed fallback: when no alternatives found within normal thresholds,
  // find the nearest tokens from the full set (e.g. 999px → radius-full = 9999px).
  // Prioritize same-category tokens; only include other-category if none found.
  if (candidates.length === 0) {
    const FALLBACK_LIMIT = 5;
    const eligible = tokens.filter((t) => !isExcludedToken(t.name));

    const sameCatTokens = eligible
      .filter((t) => tokenNameMatchesCategory(t.name, category) || scopeStrictMatchesCategory(t.scopes, category));

    const sameCatNearest = sameCatTokens
      .map((t) => ({ token: t, diff: Math.abs(t.value - value) }))
      .sort((a, b) => a.diff - b.diff)
      .slice(0, FALLBACK_LIMIT);

    // For large outlier values, also include the max token in the same category
    // (e.g. radius-full = 9999px for a 999px radius). This handles the common
    // "designer meant max/full" intent.
    const maxToken = sameCatTokens.reduce<TokenInfo | null>(
      (best, t) => (!best || t.value > best.value) ? t : best, null
    );
    const alreadyIncluded = maxToken && sameCatNearest.some(
      (e) => e.token.variableId === maxToken.variableId
    );
    if (maxToken && !alreadyIncluded) {
      sameCatNearest.push({ token: maxToken, diff: Math.abs(maxToken.value - value) });
    }

    const fallbackList = sameCatNearest.length > 0
      ? sameCatNearest
      : eligible
          .map((t) => ({ token: t, diff: Math.abs(t.value - value) }))
          .sort((a, b) => a.diff - b.diff)
          .slice(0, FALLBACK_LIMIT);

    for (const entry of fallbackList) {
      const nameMatches = tokenNameMatchesCategory(entry.token.name, category);
      const nameScore = tokenNameRelevanceScore(entry.token.name, category);
      const scopeMatches = scopeMatchesCategory(entry.token.scopes, category);
      const tier: MatchTier = nameMatches || scopeMatches ? "close-right" : "close-other";
      const score = nameScore * 10 + (scopeMatches ? 5 : 0) - entry.diff * 2 + tokenLevelScore(entry.token.name);
      candidates.push({
        token: entry.token,
        tier,
        difference: Math.round(entry.diff * 100) / 100,
        score,
      });
    }
  }

  candidates.sort((a, b) => {
    const tierDiff = tierOrder[a.tier] - tierOrder[b.tier];
    if (tierDiff !== 0) return tierDiff;
    return b.score - a.score || a.difference - b.difference;
  });

  return candidates;
}

function matchIssues(
  scanResults: ScanResult[],
  tokens: TokenInfo[],
  libraryId: string
): IssueInfo[] {
  const libTokens = tokens.filter((t) => t.libraryId === libraryId);
  return scanResults.map((sr) => {
    let alternatives: TokenAlternative[];
    if (sr.scanType === "color" && sr.currentColor) {
      alternatives = findRankedColorTokens(sr.currentColor, sr.category, libTokens);
    } else {
      alternatives = findRankedTokens(sr.currentValue, sr.category, libTokens);
    }
    const best = alternatives[0] || null;
    return {
      ...sr,
      token: best ? best.token : null,
      tier: best ? best.tier : null,
      difference: best ? best.difference : Infinity,
      alternatives,
    };
  });
}

// ---------------------------------------------------------------------------
// Auto-detect — pick the library whose tokens cover the most scanned values
// ---------------------------------------------------------------------------

function autoDetectLibrary(
  scanResults: ScanResult[],
  tokens: TokenInfo[],
  libraries: LibraryInfo[]
): string | null {
  if (libraries.length === 0) return null;
  if (libraries.length === 1) return libraries[0].id;

  const uniqueValues = new Set(scanResults.map((sr) => sr.currentValue));
  let bestId = libraries[0].id;
  let bestMatches = -1;

  for (const lib of libraries) {
    const libValues = new Set(
      tokens.filter((t) => t.libraryId === lib.id).map((t) => t.value)
    );
    let matches = 0;
    for (const v of uniqueValues) {
      if (libValues.has(v)) matches++;
    }
    if (matches > bestMatches) {
      bestMatches = matches;
      bestId = lib.id;
    }
  }

  return bestId;
}

// ---------------------------------------------------------------------------
// Apply — bind variables to node properties
// ---------------------------------------------------------------------------

async function resolveVariable(token: TokenInfo): Promise<Variable | null> {
  if (token.source === "library" && token.variableKey) {
    return figma.variables.importVariableByKeyAsync(token.variableKey);
  }
  return figma.variables.getVariableByIdAsync(token.variableId);
}

async function applyFixes(
  issues: IssueInfo[]
): Promise<{ applied: number; failed: number }> {
  let applied = 0;
  let failed = 0;

  for (const issue of issues) {
    if (!issue.token) { failed++; continue; }
    try {
      const node = await figma.getNodeByIdAsync(issue.nodeId);
      if (!node) { failed++; continue; }
      const variable = await resolveVariable(issue.token);
      if (!variable) { failed++; continue; }

      if (issue.scanType === "color" && issue.paintTarget && issue.paintIndex >= 0) {
        // Color: use setBoundVariableForPaint
        const paints: readonly Paint[] = (node as any)[issue.paintTarget];
        if (!paints || issue.paintIndex >= paints.length) { failed++; continue; }
        const paint = paints[issue.paintIndex];
        if (!paint || paint.type !== "SOLID") { failed++; continue; }
        const newPaint = figma.variables.setBoundVariableForPaint(
          paint as SolidPaint, "color", variable
        );
        const updated = [...paints];
        updated[issue.paintIndex] = newPaint;
        (node as any)[issue.paintTarget] = updated;
        applied++;
      } else {
        // Spacing / radius: existing path
        (node as any).setBoundVariable(issue.field as any, variable);
        applied++;
      }
    } catch {
      failed++;
    }
  }

  return { applied, failed };
}

// ---------------------------------------------------------------------------
// Plugin state
// ---------------------------------------------------------------------------

let currentScanResults: ScanResult[] = [];
let currentTokens: TokenInfo[] = [];
let currentLibraries: LibraryInfo[] = [];
let currentIssues: IssueInfo[] = [];
let libraryVarRefs: LibVarRef[] = [];

const STORAGE_KEY = "preferredLibrary";
const DEFAULT_LIBRARY_NAME = "Foundations Library";

async function getPreferredLibraryName(): Promise<string> {
  try {
    const stored = await figma.clientStorage.getAsync(STORAGE_KEY);
    if (typeof stored === "string" && stored.length > 0) return stored;
  } catch {}
  return DEFAULT_LIBRARY_NAME;
}

async function savePreferredLibrary(name: string): Promise<void> {
  try {
    await figma.clientStorage.setAsync(STORAGE_KEY, name);
  } catch {}
}

// ---------------------------------------------------------------------------
// Main scan flow
// ---------------------------------------------------------------------------

async function runScan(): Promise<void> {
  const selection = figma.currentPage.selection;

  if (selection.length === 0) {
    figma.ui.postMessage({
      type: "error",
      message: "Select a frame, then hit Rescan.",
    });
    return;
  }

  if (selection.length > 1) {
    figma.ui.postMessage({
      type: "error",
      message: "Select a single frame to scan.",
    });
    return;
  }

  const selected = selection[0];
  const validTypes: string[] = [
    "FRAME", "COMPONENT", "COMPONENT_SET", "INSTANCE", "SECTION",
  ];
  if (!validTypes.includes(selected.type)) {
    figma.ui.postMessage({
      type: "error",
      message: `Select a frame, component, or instance.\nYou selected: ${selected.type}`,
    });
    return;
  }

  figma.ui.postMessage({ type: "loading", message: "Scanning layers\u2026", hint: FIRST_RUN_HINT });

  currentScanResults = [];
  scanNode(selected, currentScanResults);

  if (currentScanResults.length === 0) {
    figma.ui.postMessage({ type: "no-issues", frameName: selected.name });
    return;
  }

  figma.ui.postMessage({
    type: "loading",
    message: `Found ${currentScanResults.length} unbound values. Loading libraries\u2026`,
    hint: FIRST_RUN_HINT,
  });

  const [localResult, teamResult] = await Promise.all([
    getLocalTokens(),
    getTeamLibraries(),
  ]);

  currentLibraries = [];
  currentTokens = [];
  libraryVarRefs = teamResult.varRefs;

  if (localResult.library) {
    currentLibraries.push(localResult.library);
    currentTokens.push(...localResult.tokens);
  }
  currentLibraries.push(...teamResult.libraries);

  if (currentLibraries.length === 0) {
    figma.ui.postMessage({
      type: "no-tokens",
      frameName: selected.name,
      issueCount: currentScanResults.length,
      libraryError: teamResult.error,
    });
    return;
  }

  const preferredName = await getPreferredLibraryName();
  const preferredLib = currentLibraries.find(
    (l) => l.name === preferredName
  );
  const loadedLibs = currentLibraries.filter(
    (l) => currentTokens.some((t) => t.libraryId === l.id)
  );

  let bestId: string;
  if (preferredLib) {
    bestId = preferredLib.id;
  } else if (loadedLibs.length > 0) {
    bestId = autoDetectLibrary(currentScanResults, currentTokens, loadedLibs)
      || currentLibraries[0].id;
  } else {
    bestId = currentLibraries[0].id;
  }

  if (bestId !== LOCAL_LIBRARY_ID && !currentTokens.some((t) => t.libraryId === bestId)) {
    const libName = currentLibraries.find((l) => l.id === bestId)?.name || "library";
    figma.ui.postMessage({
      type: "loading",
      message: `Importing ${libName} tokens\u2026`,
      hint: FIRST_RUN_HINT,
    });
    const refs = libraryVarRefs.filter((r) => r.libraryId === bestId);
    const importedTokens = await importLibraryTokens(bestId, refs);
    currentTokens.push(...importedTokens);
  }

  currentIssues = matchIssues(currentScanResults, currentTokens, bestId);

  figma.ui.postMessage({
    type: "scan-complete",
    frameName: selected.name,
    libraries: currentLibraries,
    selectedLibraryId: bestId,
    issues: currentIssues,
    libraryError: teamResult.error,
  });
}

// ---------------------------------------------------------------------------
// Message handler
// ---------------------------------------------------------------------------

figma.ui.onmessage = async (msg: any) => {
  switch (msg.type) {
    case "scan":
      await runScan();
      break;

    case "switch-library": {
      const libId = msg.libraryId as string;
      const lib = currentLibraries.find((l) => l.id === libId);

      if (lib) await savePreferredLibrary(lib.name);

      if (!currentTokens.some((t) => t.libraryId === libId)) {
        if (libId !== LOCAL_LIBRARY_ID) {
          figma.ui.postMessage({
            type: "loading",
            message: `Importing ${lib ? lib.name : "library"} tokens\u2026`,
            hint: FIRST_RUN_HINT,
          });
          const refs = libraryVarRefs.filter((r) => r.libraryId === libId);
          const importedTokens = await importLibraryTokens(libId, refs);
          currentTokens.push(...importedTokens);
          if (lib) lib.tokenCount = importedTokens.length;
        }
      }

      currentIssues = matchIssues(currentScanResults, currentTokens, libId);

      figma.ui.postMessage({
        type: "library-switched",
        selectedLibraryId: libId,
        issues: currentIssues,
      });
      break;
    }

    case "apply": {
      const selectedIds = new Set(msg.issueIds as string[]);
      const tokenOverrides: Record<string, { variableId: string; variableKey: string | null; source: string }> =
        msg.tokenOverrides || {};

      const toApply = currentIssues.filter(
        (i) => selectedIds.has(i.id) && i.token
      );

      for (const issue of toApply) {
        const ov = tokenOverrides[issue.id];
        if (!ov) continue;
        if (ov.variableId === issue.token!.variableId) continue;
        const altToken = issue.alternatives.find(
          (a) => a.token.variableId === ov.variableId
        );
        if (altToken) {
          issue.token = altToken.token;
          issue.tier = altToken.tier;
          issue.difference = altToken.difference;
        }
      }

      figma.ui.postMessage({
        type: "loading",
        message: `Applying ${toApply.length} fix${toApply.length !== 1 ? "es" : ""}\u2026`,
      });

      const result = await applyFixes(toApply);

      figma.ui.postMessage({
        type: "apply-complete",
        applied: result.applied,
        failed: result.failed,
      });

      setTimeout(() => runScan(), 600);
      break;
    }

    case "close":
      figma.closePlugin();
      break;
  }
};

runScan();
