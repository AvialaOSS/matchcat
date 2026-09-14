import { describe, expect, it } from 'vitest';
import { buildMatchPreview, longestCommonTokenSuffix } from '../src/matcher/matchScore';
import type { VariableInfo, VariableResolvedType } from '../src/protocol/messages';

const variable = (input: {
  id: string;
  name: string;
  resolvedType?: VariableResolvedType;
  collectionId?: string;
  collectionName?: string;
  boundToSelection?: boolean;
}): VariableInfo => ({
  id: input.id,
  name: input.name,
  resolvedType: input.resolvedType ?? 'COLOR',
  collectionId: input.collectionId ?? 'source',
  collectionName: input.collectionName ?? input.collectionId ?? 'source',
  isRemote: false,
  boundToSelection: input.boundToSelection ?? false,
  modes: [],
  valuesByMode: {}
});

describe('longestCommonTokenSuffix', () => {
  it('computes suffix length from end', () => {
    expect(longestCommonTokenSuffix(['a', 'b', 'c'], ['x', 'b', 'c'])).toBe(2);
    expect(longestCommonTokenSuffix(['a', 'b'], ['b'])).toBe(1);
    expect(longestCommonTokenSuffix(['a'], ['b'])).toBe(0);
  });
});

describe('buildMatchPreview', () => {
  it('type-gates mismatch candidates', () => {
    const rows = buildMatchPreview({
      sources: [variable({ id: 's1', name: 'button/primary-background-default', resolvedType: 'COLOR' })],
      targets: [variable({ id: 't1', name: 'control/theme-primary-background-default', resolvedType: 'FLOAT' })],
      confidenceThreshold: 0.6
    });
    expect(rows[0]?.candidates).toHaveLength(0);
    expect(rows[0]?.recommendedTargetId).toBeNull();
  });

  it('gives exact normalized names the max score', () => {
    const rows = buildMatchPreview({
      sources: [variable({ id: 's1', name: 'button/primary-background-default' })],
      targets: [variable({ id: 't1', name: 'button/primary_background-default' })],
      confidenceThreshold: 0.6
    });
    expect(rows[0]?.recommendedScore).toBe(1);
    expect(rows[0]?.recommendedTargetId).toBe('t1');
  });

  it('aligns state and picks hover for hover', () => {
    const rows = buildMatchPreview({
      sources: [variable({ id: 's-hover', name: 'button/primary-background-hover' })],
      targets: [
        variable({ id: 't-default', name: 'control/theme-primary-background-default', collectionId: 'target' }),
        variable({ id: 't-hover', name: 'control/theme-primary-background-hover', collectionId: 'target' }),
        variable({ id: 't-active', name: 'control/theme-primary-background-active', collectionId: 'target' })
      ],
      confidenceThreshold: 0.6
    });
    expect(rows[0]?.recommendedTargetId).toBe('t-hover');
  });

  it('keeps family consistency across default/hover/active batch', () => {
    const rows = buildMatchPreview({
      sources: [
        variable({ id: 's-d', name: 'button/primary-background-default' }),
        variable({ id: 's-h', name: 'button/primary-background-hover' }),
        variable({ id: 's-a', name: 'button/primary-background-active' })
      ],
      targets: [
        variable({ id: 't-d', name: 'control/theme-primary-background-default', collectionId: 'target' }),
        variable({ id: 't-h', name: 'control/theme-primary-background-hover', collectionId: 'target' }),
        variable({ id: 't-a', name: 'control/theme-primary-background-active', collectionId: 'target' }),
        variable({ id: 'x-h', name: 'semantic/theme-primary-background-hover', collectionId: 'other' }),
        variable({ id: 'x-a', name: 'semantic/theme-primary-background-active', collectionId: 'other' })
      ],
      confidenceThreshold: 0.7
    });
    const byId = new Map(rows.map((row) => [row.sourceId, row]));
    expect(byId.get('s-d')?.recommendedTargetId).toBe('t-d');
    expect(byId.get('s-h')?.recommendedTargetId).toBe('t-h');
    expect(byId.get('s-a')?.recommendedTargetId).toBe('t-a');
  });

  it('uses confidence threshold for auto-check defaults', () => {
    const rows = buildMatchPreview({
      sources: [variable({ id: 's1', name: 'button/primary-background-default' })],
      targets: [variable({ id: 't1', name: 'control/theme-primary-background-default', collectionId: 'target' })],
      confidenceThreshold: 0.95
    });
    expect(rows[0]?.autoChecked).toBe(false);
    const relaxed = buildMatchPreview({
      sources: [variable({ id: 's1', name: 'button/primary-background-default' })],
      targets: [variable({ id: 't1', name: 'control/theme-primary-background-default', collectionId: 'target' })],
      confidenceThreshold: 0.55
    });
    expect(relaxed[0]?.autoChecked).toBe(true);
  });
});
