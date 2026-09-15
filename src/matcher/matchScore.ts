import type { VariableInfo } from '../protocol/messages';

export type MatchConfidence = 'high' | 'medium' | 'low' | 'none';
export type MatchState = 'default' | 'hover' | 'active' | 'focus' | 'disabled' | null;

export type MatchCandidate = {
  targetId: string;
  targetName: string;
  score: number;
  confidence: MatchConfidence;
  targetState: MatchState;
  targetFamilyKey: string;
  reasons: string[];
};

export type MatchPreviewRow = {
  sourceId: string;
  sourceName: string;
  sourceState: MatchState;
  sourceFamilyKey: string;
  recommendedTargetId: string | null;
  recommendedScore: number;
  recommendedConfidence: MatchConfidence;
  autoChecked: boolean;
  candidates: MatchCandidate[];
};

export type BuildMatchPreviewInput = {
  sources: readonly VariableInfo[];
  targets: readonly VariableInfo[];
  confidenceThreshold: number;
  maxCandidates?: number;
};

type ParsedName = {
  raw: string;
  normalizedName: string;
  tokens: string[];
  suffixTokens: string[];
  leafTokens: string[];
  leafTokensNoState: string[];
  state: MatchState;
  familyKey: string;
  roleTokens: Set<string>;
};

const TOKEN_SPLIT_RE = /[\/\-_]+/;
const PREFIX_NOISE = new Set([
  'color',
  'colors',
  'colorsystem',
  'control',
  'controls',
  'semantic',
  'theme',
  'token',
  'tokens',
  'palette',
  'global',
  'system',
  'sys',
  'var',
  'vars'
]);
const ROLE_NOISE = new Set(['light', 'dark', 'mode', 'state']);
const STATE_ALIASES: Record<string, MatchState> = {
  default: 'default',
  rest: 'default',
  base: 'default',
  normal: 'default',
  hover: 'hover',
  active: 'active',
  pressed: 'active',
  focus: 'focus',
  focused: 'focus',
  disabled: 'disabled',
  disable: 'disabled'
};

const HIGH_CONFIDENCE = 0.86;
const MEDIUM_CONFIDENCE = 0.68;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const normalizeToken = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

const tokenize = (name: string): string[] =>
  name
    .split(TOKEN_SPLIT_RE)
    .map(normalizeToken)
    .filter((token) => token.length > 0);

const dropPrefixNoise = (tokens: string[]): string[] => {
  let index = 0;
  while (index < tokens.length && PREFIX_NOISE.has(tokens[index])) index += 1;
  return tokens.slice(index);
};

const dropNoiseAnywhere = (tokens: string[]): string[] =>
  tokens.filter((token) => !PREFIX_NOISE.has(token));

const detectState = (tokens: string[]): MatchState => {
  for (let index = tokens.length - 1; index >= 0; index -= 1) {
    const found = STATE_ALIASES[tokens[index]];
    if (found) return found;
  }
  return null;
};

const stripStateSuffix = (tokens: string[]): string[] => {
  if (tokens.length === 0) return tokens;
  const maybeState = STATE_ALIASES[tokens[tokens.length - 1]];
  return maybeState ? tokens.slice(0, -1) : tokens;
};

export const longestCommonTokenSuffix = (
  leftTokens: readonly string[],
  rightTokens: readonly string[]
): number => {
  let matched = 0;
  let li = leftTokens.length - 1;
  let ri = rightTokens.length - 1;
  while (li >= 0 && ri >= 0) {
    if (leftTokens[li] !== rightTokens[ri]) break;
    matched += 1;
    li -= 1;
    ri -= 1;
  }
  return matched;
};

const tokenSet = (tokens: string[]): Set<string> => {
  const set = new Set<string>();
  for (const token of tokens) {
    if (PREFIX_NOISE.has(token) || ROLE_NOISE.has(token)) continue;
    if (STATE_ALIASES[token]) continue;
    set.add(token);
  }
  return set;
};

const jaccard = (left: Set<string>, right: Set<string>): number => {
  if (left.size === 0 && right.size === 0) return 1;
  let intersection = 0;
  const union = new Set<string>(left);
  for (const token of right) {
    if (union.has(token)) intersection += 1;
    union.add(token);
  }
  return union.size === 0 ? 0 : intersection / union.size;
};

const parseName = (name: string): ParsedName => {
  const normalizedName = normalizeToken(name.replace(/[\/_-]+/g, '/'));
  const tokens = tokenize(name);
  const tokensNoPrefixNoise = dropPrefixNoise(tokens);
  const suffixTokens = dropNoiseAnywhere(tokensNoPrefixNoise);
  const leaf = name.split('/').at(-1) ?? name;
  const leafTokens = tokenize(leaf);
  const leafTokensNoState = stripStateSuffix(dropNoiseAnywhere(dropPrefixNoise(leafTokens)));
  const familyTokens = stripStateSuffix(suffixTokens);
  return {
    raw: name,
    normalizedName,
    tokens,
    suffixTokens,
    leafTokens,
    leafTokensNoState,
    state: detectState(leafTokens),
    familyKey: familyTokens.join('/'),
    roleTokens: tokenSet(suffixTokens)
  };
};

const scoreState = (sourceState: MatchState, targetState: MatchState): number => {
  if (!sourceState && !targetState) return 0.55;
  if (!sourceState || !targetState) return 0.45;
  if (sourceState === targetState) return 1;
  return 0;
};

const confidenceFromScore = (score: number): MatchConfidence => {
  if (score <= 0) return 'none';
  if (score >= HIGH_CONFIDENCE) return 'high';
  if (score >= MEDIUM_CONFIDENCE) return 'medium';
  return 'low';
};

const buildCandidate = (
  source: VariableInfo,
  target: VariableInfo,
  sourceParsed: ParsedName,
  targetParsed: ParsedName
): MatchCandidate | null => {
  if (source.id === target.id) return null;
  if (source.resolvedType !== target.resolvedType) return null;

  if (sourceParsed.normalizedName === targetParsed.normalizedName) {
    return {
      targetId: target.id,
      targetName: target.name,
      score: 1,
      confidence: 'high',
      targetState: targetParsed.state,
      targetFamilyKey: targetParsed.familyKey,
      reasons: ['exact-name']
    };
  }

  const leafBase = Math.max(sourceParsed.leafTokensNoState.length, targetParsed.leafTokensNoState.length, 1);
  const leafSuffix = longestCommonTokenSuffix(
    sourceParsed.leafTokensNoState,
    targetParsed.leafTokensNoState
  );
  const leafScore = leafSuffix / leafBase;

  const fullBase = Math.max(sourceParsed.suffixTokens.length, targetParsed.suffixTokens.length, 1);
  const fullSuffix = longestCommonTokenSuffix(
    sourceParsed.suffixTokens,
    targetParsed.suffixTokens
  );
  const suffixScore = fullSuffix / fullBase;
  const roleScore = jaccard(sourceParsed.roleTokens, targetParsed.roleTokens);
  const stateScore = scoreState(sourceParsed.state, targetParsed.state);

  let score = leafScore * 0.5 + suffixScore * 0.3 + roleScore * 0.05 + stateScore * 0.15;
  if (leafSuffix >= 2) score += 0.05;
  if (fullSuffix >= 3) score += 0.05;
  if (leafSuffix === 0 && fullSuffix === 0) score *= 0.2;
  if (sourceParsed.state && targetParsed.state && sourceParsed.state !== targetParsed.state) {
    score *= 0.2;
  } else if (stateScore === 0) {
    score *= 0.55;
  }
  score = clamp01(score);

  const reasons: string[] = [];
  if (leafSuffix > 0) reasons.push(`leaf-suffix:${leafSuffix}`);
  if (fullSuffix > 0) reasons.push(`path-suffix:${fullSuffix}`);
  if (stateScore === 1) reasons.push('state-aligned');
  if (roleScore >= 0.5) reasons.push('role-overlap');
  if (reasons.length === 0) reasons.push('weak-similarity');

  return {
    targetId: target.id,
    targetName: target.name,
    score,
    confidence: confidenceFromScore(score),
    targetState: targetParsed.state,
    targetFamilyKey: targetParsed.familyKey,
    reasons
  };
};

const scoreSortedCandidates = (
  source: VariableInfo,
  sourceParsed: ParsedName,
  targets: readonly VariableInfo[],
  targetParsedById: Map<string, ParsedName>,
  maxCandidates: number
): MatchCandidate[] => {
  const out: MatchCandidate[] = [];
  for (const target of targets) {
    const parsed = targetParsedById.get(target.id);
    if (!parsed) continue;
    const candidate = buildCandidate(source, target, sourceParsed, parsed);
    if (candidate) out.push(candidate);
  }
  out.sort((left, right) => right.score - left.score || left.targetName.localeCompare(right.targetName));
  return out.slice(0, maxCandidates);
};

const applyFamilyConsistency = (rows: MatchPreviewRow[]): MatchPreviewRow[] => {
  const grouped = new Map<string, MatchPreviewRow[]>();
  for (const row of rows) {
    if (!row.sourceState) continue;
    if (row.sourceState !== 'default' && row.sourceState !== 'hover' && row.sourceState !== 'active') {
      continue;
    }
    const group = grouped.get(row.sourceFamilyKey) ?? [];
    group.push(row);
    grouped.set(row.sourceFamilyKey, group);
  }

  for (const group of grouped.values()) {
    if (group.length < 2) continue;
    const familyScores = new Map<string, { sum: number; count: number }>();
    for (const row of group) {
      for (const candidate of row.candidates) {
        if (!row.sourceState) continue;
        if (candidate.targetState !== row.sourceState) continue;
        const bucket = familyScores.get(candidate.targetFamilyKey) ?? { sum: 0, count: 0 };
        bucket.sum += candidate.score;
        bucket.count += 1;
        familyScores.set(candidate.targetFamilyKey, bucket);
      }
    }
    const ranked = [...familyScores.entries()]
      .map(([familyKey, value]) => ({
        familyKey,
        avg: value.sum / Math.max(value.count, 1),
        coverage: value.count
      }))
      .sort((left, right) => right.coverage - left.coverage || right.avg - left.avg);

    const winner = ranked[0];
    if (!winner) continue;
    if (winner.coverage < 2 || winner.avg < 0.58) continue;

    for (const row of group) {
      const preferred = row.candidates.find(
        (candidate) =>
          candidate.targetFamilyKey === winner.familyKey &&
          candidate.targetState === row.sourceState
      );
      if (!preferred) continue;
      row.recommendedTargetId = preferred.targetId;
      row.recommendedScore = preferred.score;
      row.recommendedConfidence = preferred.confidence;
      if (!preferred.reasons.includes('family-consistent')) {
        preferred.reasons = [...preferred.reasons, 'family-consistent'];
      }
    }
  }
  return rows;
};

export const buildMatchPreview = (input: BuildMatchPreviewInput): MatchPreviewRow[] => {
  const threshold = clamp01(input.confidenceThreshold);
  const maxCandidates = Math.max(1, Math.min(20, input.maxCandidates ?? 5));
  const targetParsedById = new Map(input.targets.map((variable) => [variable.id, parseName(variable.name)]));

  const rows = input.sources.map((source) => {
    const parsed = parseName(source.name);
    const candidates = scoreSortedCandidates(
      source,
      parsed,
      input.targets,
      targetParsedById,
      maxCandidates
    );
    const best = candidates[0];
    const bestScore = best?.score ?? 0;
    const bestConfidence = best?.confidence ?? 'none';
    return {
      sourceId: source.id,
      sourceName: source.name,
      sourceState: parsed.state,
      sourceFamilyKey: parsed.familyKey,
      recommendedTargetId: best?.targetId ?? null,
      recommendedScore: bestScore,
      recommendedConfidence: bestConfidence,
      autoChecked: Boolean(best && bestScore >= threshold && bestConfidence === 'high'),
      candidates
    } as MatchPreviewRow;
  });

  applyFamilyConsistency(rows);
  for (const row of rows) {
    row.autoChecked = Boolean(
      row.recommendedTargetId &&
        row.recommendedScore >= threshold &&
        row.recommendedConfidence === 'high'
    );
  }
  return rows;
};
