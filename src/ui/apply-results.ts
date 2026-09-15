import type { AliasApplyRowResult } from '../protocol/messages';

export type ApplyRowStatus = 'success' | 'skipped' | 'failed';

export type ApplyRowView = {
  sourceName: string;
  targetName: string;
  status: ApplyRowStatus;
  statusLabel: string;
  detail: string;
  errorText: string | null;
};

export type ApplyResultsView = {
  successCount: number;
  skippedCount: number;
  failedCount: number;
  rows: ApplyRowView[];
};

const joinModes = (modes: string[]): string => modes.join('、');

const modeFailureSummary = (row: AliasApplyRowResult): string | null => {
  if (row.failedModes.length === 0) return null;
  return row.failedModes.map((item) => `${item.modeName}: ${item.error}`).join('；');
};

const rowStatus = (row: AliasApplyRowResult): ApplyRowStatus => {
  if (row.failedModes.length > 0) return 'failed';
  if (row.appliedModes.length > 0) return 'success';
  return 'skipped';
};

const rowStatusLabel = (row: AliasApplyRowResult): string => {
  if (row.failedModes.length > 0 && row.appliedModes.length > 0) return '失败（部分成功）';
  if (row.failedModes.length > 0) return '失败';
  if (row.appliedModes.length > 0) return '成功';
  return '跳过';
};

const rowDetail = (row: AliasApplyRowResult): string => {
  const parts: string[] = [];
  if (row.appliedModes.length > 0) {
    parts.push(`写入 mode：${joinModes(row.appliedModes)}`);
  }
  if (row.skippedModes.length > 0) {
    const top = row.skippedModes.slice(0, 2).map((item) => `${item.modeName}: ${item.reason}`);
    parts.push(`跳过 ${row.skippedModes.length} 个（${top.join('；')}）`);
  }
  if (row.failedModes.length > 0) {
    parts.push(`失败 ${row.failedModes.length} 个 mode`);
  }
  if (parts.length === 0) return '没有可写入的 mode';
  return parts.join('；');
};

export const toApplyResultsView = (rows: AliasApplyRowResult[]): ApplyResultsView => {
  let successCount = 0;
  let skippedCount = 0;
  let failedCount = 0;

  const views = rows.map((row) => {
    const status = rowStatus(row);
    if (status === 'success') successCount += 1;
    else if (status === 'skipped') skippedCount += 1;
    else failedCount += 1;

    return {
      sourceName: row.sourceName,
      targetName: row.targetName,
      status,
      statusLabel: rowStatusLabel(row),
      detail: rowDetail(row),
      errorText: modeFailureSummary(row)
    };
  });

  return { successCount, skippedCount, failedCount, rows: views };
};
