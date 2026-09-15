import { describe, expect, it } from 'vitest';
import { filterCandidates, listCollections } from '../src/filter/candidates';
import type { VariableInfo } from '../src/protocol/messages';

const v = (
  partial: Partial<VariableInfo> & Pick<VariableInfo, 'id' | 'name'>
): VariableInfo => ({
  resolvedType: 'COLOR',
  collectionId: 'c1',
  collectionName: 'component',
  isRemote: false,
  boundToSelection: false,
  modes: [],
  valuesByMode: {},
  resolvedValues: {},
  colorHex: null,
  ...partial
});

const sample: VariableInfo[] = [
  v({ id: '1', name: 'button/primary-background-rest', boundToSelection: true }),
  v({ id: '2', name: 'button/primary-background-hover' }),
  v({ id: '3', name: 'input/border-rest', collectionId: 'c2', collectionName: 'semantic' }),
  v({ id: '4', name: 'orphanLeaf', resolvedType: 'FLOAT', collectionId: 'c2', collectionName: 'semantic' }),
  v({ id: '5', name: 'remote/token', isRemote: true })
];

const base = {
  query: '',
  caseSensitive: false,
  useRegex: false,
  scope: 'all' as const,
  collectionId: 'all',
  resolvedType: 'all' as const,
  segment: '',
  requireSlash: false
};

describe('filterCandidates', () => {
  it('drops remote variables and supports bound scope', () => {
    expect(filterCandidates(sample, base).items.map((i) => i.id)).toEqual(['1', '2', '3', '4']);
    expect(filterCandidates(sample, { ...base, scope: 'bound' }).items.map((i) => i.id)).toEqual([
      '1'
    ]);
  });

  it('filters by collection and resolved type', () => {
    expect(
      filterCandidates(sample, { ...base, collectionId: 'c2' }).items.map((i) => i.id)
    ).toEqual(['3', '4']);
    expect(
      filterCandidates(sample, { ...base, resolvedType: 'FLOAT' }).items.map((i) => i.id)
    ).toEqual(['4']);
  });

  it('substring query is case-insensitive by default', () => {
    expect(
      filterCandidates(sample, { ...base, query: 'PRIMARY' }).items.map((i) => i.id)
    ).toEqual(['1', '2']);
    expect(
      filterCandidates(sample, { ...base, query: 'PRIMARY', caseSensitive: true }).items
    ).toHaveLength(0);
  });

  it('supports regex and reports invalid patterns', () => {
    const ok = filterCandidates(sample, {
      ...base,
      query: 'button/.+-rest',
      useRegex: true
    });
    expect(ok.items.map((i) => i.id)).toEqual(['1']);
    expect(ok.regexError).toBeNull();

    const bad = filterCandidates(sample, { ...base, query: '(', useRegex: true });
    expect(bad.items).toHaveLength(0);
    expect(bad.regexError).toBeTruthy();
  });

  it('requireSlash and segment filters', () => {
    expect(
      filterCandidates(sample, { ...base, requireSlash: true }).items.map((i) => i.id)
    ).toEqual(['1', '2', '3']);
    expect(
      filterCandidates(sample, { ...base, segment: 'border' }).items.map((i) => i.id)
    ).toEqual(['3']);
  });
});

describe('listCollections', () => {
  it('returns unique collections sorted by name', () => {
    expect(listCollections(sample)).toEqual([
      { id: 'c1', name: 'component' },
      { id: 'c2', name: 'semantic' }
    ]);
  });
});
