import type { VariableInfo, VariableResolvedType } from '../protocol/messages';

export type CandidateScope = 'all' | 'bound';

export type CandidateFilters = {
  /** Name / path query — substring or regex depending on `useRegex`. */
  query: string;
  caseSensitive: boolean;
  useRegex: boolean;
  /** all local vs only variables bound to the current canvas selection. */
  scope: CandidateScope;
  /** Collection id, or `all`. */
  collectionId: string;
  /** Resolved type, or `all`. */
  resolvedType: VariableResolvedType | 'all';
  /** When set, at least one `/`-split path segment must contain this text. */
  segment: string;
  /** Require the path to contain `/` (grouped variable). */
  requireSlash: boolean;
};

export type FilterResult = {
  items: VariableInfo[];
  /** Set when `useRegex` is on and the query is not a valid RegExp. */
  regexError: string | null;
};

const nameMatches = (
  name: string,
  query: string,
  caseSensitive: boolean,
  useRegex: boolean
): { ok: boolean; regexError: string | null } => {
  const trimmed = query.trim();
  if (!trimmed) return { ok: true, regexError: null };

  if (useRegex) {
    try {
      const flags = caseSensitive ? '' : 'i';
      const re = new RegExp(trimmed, flags);
      return { ok: re.test(name), regexError: null };
    } catch (error) {
      return {
        ok: false,
        regexError: error instanceof Error ? error.message : String(error)
      };
    }
  }

  if (caseSensitive) return { ok: name.includes(trimmed), regexError: null };
  return { ok: name.toLowerCase().includes(trimmed.toLowerCase()), regexError: null };
};

const segmentMatches = (name: string, segment: string, caseSensitive: boolean): boolean => {
  const needle = segment.trim();
  if (!needle) return true;
  const parts = name.split('/');
  if (caseSensitive) return parts.some((part) => part.includes(needle));
  const lower = needle.toLowerCase();
  return parts.some((part) => part.toLowerCase().includes(lower));
};

/**
 * Live-filter local variable candidates for the NameCat picker.
 * Pure — no Figma API — so vitest can cover the matrix.
 */
export const filterCandidates = (
  variables: readonly VariableInfo[],
  filters: CandidateFilters
): FilterResult => {
  let regexError: string | null = null;
  const items = variables.filter((variable) => {
    if (variable.isRemote) return false;
    if (filters.scope === 'bound' && !variable.boundToSelection) return false;
    if (filters.collectionId !== 'all' && variable.collectionId !== filters.collectionId) {
      return false;
    }
    if (filters.resolvedType !== 'all' && variable.resolvedType !== filters.resolvedType) {
      return false;
    }
    if (filters.requireSlash && !variable.name.includes('/')) return false;
    if (!segmentMatches(variable.name, filters.segment, filters.caseSensitive)) return false;

    const match = nameMatches(
      variable.name,
      filters.query,
      filters.caseSensitive,
      filters.useRegex
    );
    if (match.regexError) regexError = match.regexError;
    return match.ok;
  });

  return { items, regexError };
};

/** Distinct collections present in the snapshot, sorted by display name. */
export const listCollections = (
  variables: readonly VariableInfo[]
): Array<{ id: string; name: string }> => {
  const map = new Map<string, string>();
  for (const variable of variables) {
    if (!map.has(variable.collectionId)) {
      map.set(variable.collectionId, variable.collectionName || variable.collectionId);
    }
  }
  return [...map.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
};

export const TYPE_OPTIONS: Array<{ value: VariableResolvedType | 'all'; label: string }> = [
  { value: 'all', label: '全部类型' },
  { value: 'COLOR', label: 'COLOR' },
  { value: 'FLOAT', label: 'FLOAT' },
  { value: 'STRING', label: 'STRING' },
  { value: 'BOOLEAN', label: 'BOOLEAN' }
];
