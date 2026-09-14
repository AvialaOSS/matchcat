/**
 * postMessage contract — shared by plugin main + UI.
 */

export type VariableResolvedType = 'FLOAT' | 'STRING' | 'BOOLEAN' | 'COLOR';
export type SourceScope = 'all' | 'bound';
export type ModeValueKind = 'ALIAS' | 'LITERAL' | 'EMPTY';

export type ModeInfo = {
  id: string;
  name: string;
};

export type ModeValueInfo = {
  kind: ModeValueKind;
  aliasId?: string;
};

export type VariableInfo = {
  id: string;
  name: string;
  resolvedType: VariableResolvedType;
  collectionId: string;
  collectionName: string;
  isRemote: boolean;
  /** True when this variable is bound to the current canvas selection. */
  boundToSelection: boolean;
  modes: ModeInfo[];
  valuesByMode: Record<string, ModeValueInfo>;
};

export type UiPrefs = {
  listHeight: number;
};

export type AliasApplyPair = {
  sourceId: string;
  targetId: string;
};

export type ModeApplyDetail = {
  modeName: string;
  reason: string;
};

export type ModeApplyFailure = {
  modeName: string;
  error: string;
};

export type AliasApplyRowResult = {
  sourceId: string;
  sourceName: string;
  targetId: string;
  targetName: string;
  appliedModes: string[];
  wouldApplyModes: string[];
  skippedModes: ModeApplyDetail[];
  failedModes: ModeApplyFailure[];
};

export type ApplySummary = {
  rowsRequested: number;
  rowsApplied: number;
  modesApplied: number;
  modesWouldApply: number;
  modesSkipped: number;
  modesFailed: number;
};

export type UiToMainMessage =
  | { type: 'init' }
  | { type: 'refresh' }
  | {
      type: 'apply';
      matches: AliasApplyPair[];
      dryRun: boolean;
      overwriteLiteral: boolean;
    }
  | { type: 'resize'; width: number; height: number; persist?: boolean }
  | {
      type: 'prefs';
      listHeight?: number;
      persist?: boolean;
    }
  | { type: 'close' };

export type MainToUiMessage =
  | {
      type: 'ready';
      variables: VariableInfo[];
      selectionBoundCount: number;
      prefs: UiPrefs;
    }
  | {
      type: 'applied';
      dryRun: boolean;
      results: AliasApplyRowResult[];
      summary: ApplySummary;
    }
  | { type: 'error'; message: string };
