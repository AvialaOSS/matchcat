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
  /** Display-formatted resolved value per mode. COLOR: "#RRGGBB", FLOAT: "16", etc. */
  resolvedValues: Record<string, string>;
  /** Raw hex for COLOR variables (first mode), null otherwise. Used for chips + value scoring. */
  colorHex: string | null;
};

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

export type MatchFamily = {
  familyKey: string;
  sourceStates: MatchState[];
  rows: MatchPreviewRow[];
  /** All rows consistently mapped to same target family? */
  consistent: boolean;
};

export type MatchPreviewResult = {
  families: MatchFamily[];
  ungrouped: MatchPreviewRow[];
  totalSources: number;
  totalMatched: number;
};

export type WritePreviewModePlan = {
  modeName: string;
  action: 'set' | 'skip' | 'fail';
  note: string;
};

export type BindingReviewRow = {
  sourceId: string;
  sourceName: string;
  sourceColorHex: string | null;
  targetId: string;
  targetName: string;
  targetColorHex: string | null;
  score: number;
  confidence: MatchConfidence;
  modes: WritePreviewModePlan[];
  setCount: number;
  skipCount: number;
  failCount: number;
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
