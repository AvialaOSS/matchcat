import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAliases } from '../src/figma/variables';

type MockVariable = Variable & {
  setValueForMode: ReturnType<typeof vi.fn>;
};

const makeCollection = (id: string, name: string, modes: Array<{ modeId: string; name: string }>) =>
  ({ id, name, modes }) as VariableCollection;

const makeVariable = (input: {
  id: string;
  name: string;
  resolvedType: VariableResolvedDataType;
  variableCollectionId: string;
  valuesByMode: Record<string, unknown>;
}): MockVariable => {
  const variable = {
    id: input.id,
    key: input.id,
    name: input.name,
    remote: false,
    resolvedType: input.resolvedType,
    variableCollectionId: input.variableCollectionId,
    valuesByMode: { ...input.valuesByMode }
  } as unknown as MockVariable;
  variable.setValueForMode = vi.fn((modeId: string, value: VariableValue) => {
    variable.valuesByMode[modeId] = value;
  });
  return variable;
};

const mockFigma = (collections: VariableCollection[], variables: Variable[]) => {
  (globalThis as unknown as { figma: PluginAPI }).figma = {
    variables: {
      getLocalVariableCollectionsAsync: vi.fn(async () => collections),
      getLocalVariablesAsync: vi.fn(async () => variables)
    }
  } as unknown as PluginAPI;
};

describe('applyAliases', () => {
  const sourceCollection = makeCollection('source-collection', 'source', [
    { modeId: 's-default', name: 'default' },
    { modeId: 's-hover', name: 'hover' }
  ]);
  const targetCollection = makeCollection('target-collection', 'target', [
    { modeId: 't-default', name: 'default' },
    { modeId: 't-hover', name: 'hover' }
  ]);

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('dry-run previews rows without writing aliases', async () => {
    const source = makeVariable({
      id: 'source-var',
      name: 'button/primary-background-default',
      resolvedType: 'COLOR',
      variableCollectionId: sourceCollection.id,
      valuesByMode: {
        's-default': { r: 1, g: 1, b: 1, a: 1 },
        's-hover': { r: 0.9, g: 0.9, b: 0.9, a: 1 }
      }
    });
    const target = makeVariable({
      id: 'target-var',
      name: 'control/theme-primary-background-default',
      resolvedType: 'COLOR',
      variableCollectionId: targetCollection.id,
      valuesByMode: {
        't-default': { r: 0.1, g: 0.2, b: 0.3, a: 1 },
        't-hover': { r: 0.2, g: 0.3, b: 0.4, a: 1 }
      }
    });
    mockFigma([sourceCollection, targetCollection], [source, target]);

    const result = await applyAliases({
      matches: [{ sourceId: source.id, targetId: target.id }],
      dryRun: true,
      overwriteLiteral: true
    });

    expect(source.setValueForMode).not.toHaveBeenCalled();
    expect(result.summary.rowsApplied).toBe(1);
    expect(result.summary.modesWouldApply).toBe(2);
    expect(result.summary.modesApplied).toBe(0);
  });

  it('apply writes VARIABLE_ALIAS when dryRun is false', async () => {
    const source = makeVariable({
      id: 'source-var',
      name: 'button/primary-background-default',
      resolvedType: 'COLOR',
      variableCollectionId: sourceCollection.id,
      valuesByMode: {
        's-default': { r: 1, g: 1, b: 1, a: 1 },
        's-hover': { r: 0.9, g: 0.9, b: 0.9, a: 1 }
      }
    });
    const target = makeVariable({
      id: 'target-var',
      name: 'control/theme-primary-background-default',
      resolvedType: 'COLOR',
      variableCollectionId: targetCollection.id,
      valuesByMode: {
        't-default': { r: 0.1, g: 0.2, b: 0.3, a: 1 },
        't-hover': { r: 0.2, g: 0.3, b: 0.4, a: 1 }
      }
    });
    mockFigma([sourceCollection, targetCollection], [source, target]);

    const result = await applyAliases({
      matches: [{ sourceId: source.id, targetId: target.id }],
      dryRun: false,
      overwriteLiteral: true
    });

    expect(source.setValueForMode).toHaveBeenCalledTimes(2);
    expect(source.valuesByMode['s-default']).toEqual({
      type: 'VARIABLE_ALIAS',
      id: target.id
    });
    expect(source.valuesByMode['s-hover']).toEqual({
      type: 'VARIABLE_ALIAS',
      id: target.id
    });
    expect(result.summary.rowsApplied).toBe(1);
    expect(result.summary.modesApplied).toBe(2);
    expect(result.summary.modesWouldApply).toBe(0);
  });
});
