import type {
  AliasApplyPair,
  AliasApplyRowResult,
  ApplySummary,
  ModeValueInfo,
  VariableInfo,
  VariableResolvedType
} from '../protocol/messages';

const isAliasValue = (value: unknown): value is VariableAlias =>
  Boolean(
    value &&
      typeof value === 'object' &&
      'type' in value &&
      (value as { type?: unknown }).type === 'VARIABLE_ALIAS' &&
      'id' in value &&
      typeof (value as { id?: unknown }).id === 'string'
  );

const modeValueInfo = (value: unknown): ModeValueInfo => {
  if (value === undefined) return { kind: 'EMPTY' };
  if (isAliasValue(value)) return { kind: 'ALIAS', aliasId: value.id };
  return { kind: 'LITERAL' };
};

const toInfo = (
  variable: Variable,
  collection: VariableCollection,
  boundIds: Set<string>
): VariableInfo => {
  const valuesByMode: Record<string, ModeValueInfo> = {};
  for (const mode of collection.modes) {
    valuesByMode[mode.modeId] = modeValueInfo(variable.valuesByMode[mode.modeId]);
  }
  return {
    id: variable.id,
    name: variable.name,
    resolvedType: variable.resolvedType as VariableResolvedType,
    collectionId: variable.variableCollectionId,
    collectionName: collection.name,
    isRemote: variable.remote,
    boundToSelection: boundIds.has(variable.id),
    modes: collection.modes.map((mode) => ({ id: mode.modeId, name: mode.name })),
    valuesByMode
  };
};

/** Collect variable ids bound on the current selection (including nested). */
export const collectBoundVariableIds = (nodes: readonly SceneNode[]): Set<string> => {
  const ids = new Set<string>();
  const visit = (node: SceneNode) => {
    const bound = 'boundVariables' in node ? node.boundVariables : null;
    if (bound) {
      for (const value of Object.values(bound)) {
        const refs = Array.isArray(value) ? value : value ? [value] : [];
        for (const ref of refs) {
          if (ref && typeof ref === 'object' && 'id' in ref && typeof ref.id === 'string') {
            ids.add(ref.id);
          }
        }
      }
    }
    if ('children' in node) {
      for (const child of node.children) visit(child);
    }
  };
  for (const node of nodes) visit(node);
  return ids;
};

export const snapshotLocalVariables = async (
  boundIds: Set<string>
): Promise<VariableInfo[]> => {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const byCollectionId = new Map(collections.map((collection) => [collection.id, collection]));
  const variables = await figma.variables.getLocalVariablesAsync();
  return variables
    .map((variable) => {
      const collection = byCollectionId.get(variable.variableCollectionId);
      if (!collection) {
        return {
          id: variable.id,
          name: variable.name,
          resolvedType: variable.resolvedType as VariableResolvedType,
          collectionId: variable.variableCollectionId,
          collectionName: '',
          isRemote: variable.remote,
          boundToSelection: boundIds.has(variable.id),
          modes: [],
          valuesByMode: {}
        } satisfies VariableInfo;
      }
      return toInfo(variable, collection, boundIds);
    })
    .sort((left, right) => {
      const byCollection = left.collectionName.localeCompare(right.collectionName);
      if (byCollection !== 0) return byCollection;
      return left.name.localeCompare(right.name);
    });
};

export type ApplyAliasesInput = {
  matches: readonly AliasApplyPair[];
  dryRun: boolean;
  overwriteLiteral: boolean;
};

export type ApplyAliasesResult = {
  results: AliasApplyRowResult[];
  summary: ApplySummary;
};

const makeRowResult = (
  sourceId: string,
  sourceName: string,
  targetId: string,
  targetName: string
): AliasApplyRowResult => ({
  sourceId,
  sourceName,
  targetId,
  targetName,
  appliedModes: [],
  wouldApplyModes: [],
  skippedModes: [],
  failedModes: []
});

/**
 * Writes VARIABLE_ALIAS values in a mode-agnostic way.
 * - Source/target types must match
 * - Every source mode points to the chosen target variable id
 * - Existing same alias is skipped
 * - Literal overwrite is off by default (opt-in)
 */
export const applyAliases = async (input: ApplyAliasesInput): Promise<ApplyAliasesResult> => {
  const collections = await figma.variables.getLocalVariableCollectionsAsync();
  const collectionById = new Map(collections.map((collection) => [collection.id, collection]));
  const variables = await figma.variables.getLocalVariablesAsync();
  const variableById = new Map(variables.map((variable) => [variable.id, variable]));

  const results: AliasApplyRowResult[] = [];
  const summary: ApplySummary = {
    rowsRequested: input.matches.length,
    rowsApplied: 0,
    modesApplied: 0,
    modesWouldApply: 0,
    modesSkipped: 0,
    modesFailed: 0
  };

  for (const pair of input.matches) {
    const source = variableById.get(pair.sourceId);
    const target = variableById.get(pair.targetId);
    const sourceName = source?.name ?? pair.sourceId;
    const targetName = target?.name ?? pair.targetId;
    const row = makeRowResult(pair.sourceId, sourceName, pair.targetId, targetName);
    results.push(row);

    if (!source || !target) {
      row.failedModes.push({
        modeName: '*',
        error: '变量不存在（source 或 target）'
      });
      summary.modesFailed += 1;
      continue;
    }
    if (source.remote || target.remote) {
      row.failedModes.push({ modeName: '*', error: '远程变量不可写入' });
      summary.modesFailed += 1;
      continue;
    }
    if (source.id === target.id) {
      row.skippedModes.push({ modeName: '*', reason: 'source 与 target 相同，跳过' });
      summary.modesSkipped += 1;
      continue;
    }
    if (source.resolvedType !== target.resolvedType) {
      row.failedModes.push({ modeName: '*', error: '变量类型不一致，无法建立别名' });
      summary.modesFailed += 1;
      continue;
    }

    const sourceCollection = collectionById.get(source.variableCollectionId);
    const sourceModes =
      sourceCollection?.modes.map((mode) => ({ modeId: mode.modeId, modeName: mode.name })) ??
      Object.keys(source.valuesByMode).map((modeId) => ({ modeId, modeName: modeId }));
    if (sourceModes.length === 0) {
      row.skippedModes.push({ modeName: '*', reason: 'source 没有可写入 mode' });
      summary.modesSkipped += 1;
      continue;
    }

    for (const sourceMode of sourceModes) {
      const currentValue = source.valuesByMode[sourceMode.modeId];
      if (isAliasValue(currentValue) && currentValue.id === target.id) {
        row.skippedModes.push({
          modeName: sourceMode.modeName,
          reason: '已是同一别名'
        });
        summary.modesSkipped += 1;
        continue;
      }

      const isLiteral = currentValue !== undefined && !isAliasValue(currentValue);
      if (isLiteral && !input.overwriteLiteral) {
        row.skippedModes.push({
          modeName: sourceMode.modeName,
          reason: 'literal 值未覆盖（overwrite-literal=off）'
        });
        summary.modesSkipped += 1;
        continue;
      }

      if (input.dryRun) {
        row.wouldApplyModes.push(sourceMode.modeName);
        summary.modesWouldApply += 1;
        continue;
      }

      try {
        source.setValueForMode(sourceMode.modeId, {
          type: 'VARIABLE_ALIAS',
          id: target.id
        });
        row.appliedModes.push(sourceMode.modeName);
        summary.modesApplied += 1;
      } catch (error) {
        row.failedModes.push({
          modeName: sourceMode.modeName,
          error: error instanceof Error ? error.message : String(error)
        });
        summary.modesFailed += 1;
      }
    }

    if (row.appliedModes.length > 0 || row.wouldApplyModes.length > 0) {
      summary.rowsApplied += 1;
    }
  }

  return { results, summary };
};
