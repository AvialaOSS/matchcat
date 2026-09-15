import type { ModeValueInfo, VariableInfo } from '../protocol/messages';

export type WritePreviewSelection = {
  sourceId: string;
  targetId: string;
};

export type WritePreviewModePlan = {
  modeName: string;
  action: 'set' | 'skip' | 'fail';
  note: string;
};

export type WritePreviewRow = {
  sourceId: string;
  sourceName: string;
  targetId: string;
  targetName: string;
  setCount: number;
  skipCount: number;
  failCount: number;
  modes: WritePreviewModePlan[];
};

export type WritePreviewResult = {
  rows: WritePreviewRow[];
  summary: {
    rowCount: number;
    modeSetCount: number;
    modeSkipCount: number;
    modeFailCount: number;
  };
};

const literalBlocked = (value: ModeValueInfo | undefined, overwriteLiteral: boolean): boolean =>
  value?.kind === 'LITERAL' && !overwriteLiteral;

const alreadyAliased = (value: ModeValueInfo | undefined, targetId: string): boolean =>
  value?.kind === 'ALIAS' && value.aliasId === targetId;

export const buildWritePreview = (
  variables: readonly VariableInfo[],
  selections: readonly WritePreviewSelection[],
  overwriteLiteral: boolean
): WritePreviewResult => {
  const variableById = new Map(variables.map((variable) => [variable.id, variable]));
  const rows: WritePreviewRow[] = [];
  let modeSetCount = 0;
  let modeSkipCount = 0;
  let modeFailCount = 0;

  for (const selection of selections) {
    const source = variableById.get(selection.sourceId);
    const target = variableById.get(selection.targetId);
    const row: WritePreviewRow = {
      sourceId: selection.sourceId,
      sourceName: source?.name ?? selection.sourceId,
      targetId: selection.targetId,
      targetName: target?.name ?? selection.targetId,
      setCount: 0,
      skipCount: 0,
      failCount: 0,
      modes: []
    };
    rows.push(row);

    if (!source || !target) {
      row.modes.push({ modeName: '*', action: 'fail', note: '变量不存在（source 或 target）' });
      row.failCount += 1;
      modeFailCount += 1;
      continue;
    }
    if (source.isRemote || target.isRemote) {
      row.modes.push({ modeName: '*', action: 'fail', note: '远程变量不可写入' });
      row.failCount += 1;
      modeFailCount += 1;
      continue;
    }
    if (source.id === target.id) {
      row.modes.push({ modeName: '*', action: 'skip', note: 'source 与 target 相同，跳过' });
      row.skipCount += 1;
      modeSkipCount += 1;
      continue;
    }
    if (source.resolvedType !== target.resolvedType) {
      row.modes.push({ modeName: '*', action: 'fail', note: '变量类型不一致，应用会失败' });
      row.failCount += 1;
      modeFailCount += 1;
      continue;
    }

    const targetModeByName = new Map(target.modes.map((mode) => [mode.name, mode.id]));
    for (const sourceMode of source.modes) {
      const currentValue = source.valuesByMode[sourceMode.id];
      if (!targetModeByName.has(sourceMode.name)) {
        row.modes.push({
          modeName: sourceMode.name,
          action: 'skip',
          note: '目标集合不存在同名 mode'
        });
        row.skipCount += 1;
        modeSkipCount += 1;
        continue;
      }
      if (alreadyAliased(currentValue, target.id)) {
        row.modes.push({ modeName: sourceMode.name, action: 'skip', note: '已是同一别名' });
        row.skipCount += 1;
        modeSkipCount += 1;
        continue;
      }
      if (literalBlocked(currentValue, overwriteLiteral)) {
        row.modes.push({
          modeName: sourceMode.name,
          action: 'skip',
          note: 'literal 值未覆盖（overwrite-literal=off）'
        });
        row.skipCount += 1;
        modeSkipCount += 1;
        continue;
      }

      row.modes.push({
        modeName: sourceMode.name,
        action: 'set',
        note: `将设置为 VARIABLE_ALIAS -> ${target.name}`
      });
      row.setCount += 1;
      modeSetCount += 1;
    }
  }

  return {
    rows,
    summary: {
      rowCount: rows.length,
      modeSetCount,
      modeSkipCount,
      modeFailCount
    }
  };
};
