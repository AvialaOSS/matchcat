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

const isRgba = (value: unknown): value is RGBA =>
  Boolean(
    value &&
      typeof value === 'object' &&
      'r' in value &&
      'g' in value &&
      'b' in value &&
      typeof (value as RGBA).r === 'number'
  );

const byteToHex = (value: number): string => {
  const clamped = Math.max(0, Math.min(255, Math.round(value)));
  return clamped.toString(16).padStart(2, '0');
};

export const rgbaToDisplayHex = (rgba: RGBA): string => {
  const r = byteToHex(rgba.r * 255);
  const g = byteToHex(rgba.g * 255);
  const b = byteToHex(rgba.b * 255);
  const a = rgba.a !== undefined && rgba.a < 1 ? byteToHex(rgba.a * 255) : '';
  return a ? `#${r}${g}${b}${a}`.toUpperCase() : `#${r}${g}${b}`.toUpperCase();
};

export const formatModeValueDisplay = (
  value: unknown,
  resolvedType: VariableResolvedType
): string | null => {
  if (value === undefined) return null;
  if (isAliasValue(value)) return null;
  switch (resolvedType) {
    case 'COLOR':
      return isRgba(value) ? rgbaToDisplayHex(value) : null;
    case 'FLOAT':
      return typeof value === 'number' && Number.isFinite(value) ? String(value) : null;
    case 'STRING':
      return typeof value === 'string' ? value : null;
    case 'BOOLEAN':
      return typeof value === 'boolean' ? (value ? 'true' : 'false') : null;
    default:
      return null;
  }
};

const modeValueInfo = (value: unknown): ModeValueInfo => {
  if (value === undefined) return { kind: 'EMPTY' };
  if (isAliasValue(value)) return { kind: 'ALIAS', aliasId: value.id };
  return { kind: 'LITERAL' };
};

const buildResolvedSnapshot = (
  variable: Variable,
  collection: VariableCollection
): { resolvedValues: Record<string, string>; colorHex: string | null } => {
  const resolvedValues: Record<string, string> = {};
  let colorHex: string | null = null;
  for (const mode of collection.modes) {
    const raw = variable.valuesByMode[mode.modeId];
    const display = formatModeValueDisplay(raw, variable.resolvedType as VariableResolvedType);
    if (display !== null) {
      resolvedValues[mode.modeId] = display;
      if (colorHex === null && variable.resolvedType === 'COLOR') {
        colorHex = display;
      }
    }
  }
  return { resolvedValues, colorHex };
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
  const { resolvedValues, colorHex } = buildResolvedSnapshot(variable, collection);
  return {
    id: variable.id,
    name: variable.name,
    resolvedType: variable.resolvedType as VariableResolvedType,
    collectionId: variable.variableCollectionId,
    collectionName: collection.name,
    isRemote: variable.remote,
    boundToSelection: boundIds.has(variable.id),
    modes: collection.modes.map((mode) => ({ id: mode.modeId, name: mode.name })),
    valuesByMode,
    resolvedValues,
    colorHex
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
          valuesByMode: {},
          resolvedValues: {},
          colorHex: null
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
