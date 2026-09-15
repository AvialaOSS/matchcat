import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode
} from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CheckboxInput,
  Input,
  Pagehead,
  Scroll,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
  Switch,
  Tag,
  Typography,
  ResponsiveTooltip
} from '@aviala-design/spiral';
import {
  buildMatchPreviewGrouped,
  type MatchCandidate,
  type MatchConfidence,
  type MatchFamily,
  type MatchPreviewRow,
  type MatchState
} from '../matcher/matchScore';
import type { MainToUiMessage, SourceScope, VariableInfo, VariableResolvedType } from '../protocol/messages';
import { toApplyResultsView, type ApplyResultsView } from './apply-results';
import { buildBindingReview, type BindingReviewSelection } from './write-preview';

const post = (message: unknown) => parent.postMessage({ pluginMessage: message }, '*');

const MIN_WIDTH = 320;
const MAX_WIDTH = 960;
const MIN_HEIGHT = 360;
const MAX_HEIGHT = 960;
const DEFAULT_LIST_HEIGHT = 160;
const MIN_LIST_HEIGHT = 80;
const MAX_LIST_HEIGHT = 420;

const TYPE_OPTIONS: Array<{ value: VariableResolvedType | 'all'; label: string }> = [
  { value: 'all', label: '全部类型' },
  { value: 'COLOR', label: 'COLOR' },
  { value: 'FLOAT', label: 'FLOAT' },
  { value: 'STRING', label: 'STRING' },
  { value: 'BOOLEAN', label: 'BOOLEAN' }
];

const PATH_SPLIT_RE = /[\/\-_]+/;
const STATE_TOKEN = new Set(['default', 'rest', 'base', 'normal', 'hover', 'active', 'pressed', 'focus', 'focused', 'disabled', 'disable']);
const STATE_ORDER: MatchState[] = ['default', 'hover', 'active', 'focus', 'disabled'];

type StepId = 1 | 2 | 3 | 4;
type EnrichedRow = MatchPreviewRow & {
  selectedTargetId: string | null;
  selectedCandidate: MatchCandidate | undefined;
  selectedConfidence: MatchConfidence;
};

const clampWidth = (width: number) => Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.floor(width)));
const clampHeight = (height: number) => Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.floor(height)));
const clampListHeight = (height: number) =>
  Math.max(MIN_LIST_HEIGHT, Math.min(MAX_LIST_HEIGHT, Math.floor(height)));
const clampThreshold = (value: number) => Math.max(0, Math.min(1, value));

const confidenceRank: Record<MatchConfidence, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3
};

const confidenceLabel: Record<MatchConfidence, string> = {
  none: '无',
  low: '低',
  medium: '中',
  high: '高'
};

const confidenceBadgeStyle = (confidence: MatchConfidence): 'success' | 'warning' | 'info' | 'normal' => {
  if (confidence === 'high') return 'success';
  if (confidence === 'medium') return 'warning';
  if (confidence === 'low') return 'info';
  return 'normal';
};

const confidencePasses = (
  confidence: MatchConfidence,
  filter: 'all' | 'high' | 'medium' | 'low'
): boolean => {
  if (filter === 'all') return true;
  if (filter === 'high') return confidence === 'high';
  if (filter === 'medium') return confidenceRank[confidence] >= confidenceRank.medium;
  return confidenceRank[confidence] >= confidenceRank.low;
};

const listCollections = (variables: readonly VariableInfo[]) => {
  const map = new Map<string, string>();
  for (const variable of variables) {
    if (variable.isRemote) continue;
    if (!map.has(variable.collectionId)) map.set(variable.collectionId, variable.collectionName);
  }
  return [...map.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((left, right) => left.name.localeCompare(right.name));
};

const variableColorHex = (variable: VariableInfo | undefined): string | null => {
  if (!variable) return null;
  if (typeof variable.colorHex === 'string' && variable.colorHex.length > 0) return variable.colorHex;
  if (variable.resolvedType !== 'COLOR') return null;
  const first = Object.values(variable.resolvedValues ?? {}).find(
    (value) => typeof value === 'string' && value.startsWith('#')
  );
  return first ?? null;
};

const pathTokens = (name: string): string[] =>
  name
    .split(PATH_SPLIT_RE)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);

const suffixOverlap = (left: readonly string[], right: readonly string[]): number => {
  let matched = 0;
  let li = left.length - 1;
  let ri = right.length - 1;
  while (li >= 0 && ri >= 0 && left[li].toLowerCase() === right[ri].toLowerCase()) {
    matched += 1;
    li -= 1;
    ri -= 1;
  }
  return matched;
};

const familyStatesOf = (family: MatchFamily): MatchState[] =>
  family.sourceStates.length > 0 ? family.sourceStates : family.rows.map((row) => row.sourceState);

const sortFamilyRows = (rows: MatchPreviewRow[]): MatchPreviewRow[] =>
  [...rows].sort((left, right) => {
    const li = STATE_ORDER.indexOf(left.sourceState);
    const ri = STATE_ORDER.indexOf(right.sourceState);
    const leftRank = li === -1 ? STATE_ORDER.length : li;
    const rightRank = ri === -1 ? STATE_ORDER.length : ri;
    return leftRank - rightRank || left.sourceName.localeCompare(right.sourceName);
  });

type ResizeAxis = 'x' | 'y' | 'xy';
type DragState = {
  axis: ResizeAxis;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
};

const emitResize = (width: number, height: number, persist: boolean) => {
  post({ type: 'resize', width: clampWidth(width), height: clampHeight(height), persist });
};

const sizeFromDrag = (drag: DragState, event: PointerEvent) => {
  const width = drag.axis === 'y' ? drag.startWidth : drag.startWidth + (event.clientX - drag.startX);
  const height = drag.axis === 'x' ? drag.startHeight : drag.startHeight + (event.clientY - drag.startY);
  return { width, height };
};

const PanelResizeHandles = () => {
  const [dragging, setDragging] = useState<ResizeAxis | null>(null);
  const dragRef = useRef<DragState | null>(null);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const next = sizeFromDrag(drag, event);
      emitResize(next.width, next.height, false);
    };
    const onUp = (event: PointerEvent) => {
      const drag = dragRef.current;
      dragRef.current = null;
      setDragging(null);
      if (!drag) return;
      const next = sizeFromDrag(drag, event);
      emitResize(next.width, next.height, true);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [dragging]);

  const startDrag = (axis: ResizeAxis, event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragRef.current = {
      axis,
      startX: event.clientX,
      startY: event.clientY,
      startWidth: window.innerWidth,
      startHeight: window.innerHeight
    };
    setDragging(axis);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  return (
    <>
      <div
        className="mc-resize mc-resize--e"
        data-dragging={dragging === 'x' ? 'true' : 'false'}
        role="separator"
        aria-orientation="vertical"
        aria-label="拖拽调整插件宽度"
        onPointerDown={(event) => startDrag('x', event)}
      />
      <div
        className="mc-resize mc-resize--s"
        data-dragging={dragging === 'y' ? 'true' : 'false'}
        role="separator"
        aria-orientation="horizontal"
        aria-label="拖拽调整插件高度"
        onPointerDown={(event) => startDrag('y', event)}
      />
      <div
        className="mc-resize mc-resize--se"
        data-dragging={dragging === 'xy' ? 'true' : 'false'}
        role="separator"
        aria-label="拖拽调整插件宽高"
        onPointerDown={(event) => startDrag('xy', event)}
      />
    </>
  );
};

type ListPaneProps = {
  height: number;
  onHeightChange: (height: number, persist: boolean) => void;
  children: ReactNode;
};

const ResizablePreviewList = ({ height, onHeightChange, children }: ListPaneProps) => {
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      onHeightChange(clampListHeight(drag.startHeight + (event.clientY - drag.startY)), false);
    };
    const onUp = (event: PointerEvent) => {
      const drag = dragRef.current;
      dragRef.current = null;
      setDragging(false);
      if (!drag) return;
      onHeightChange(clampListHeight(drag.startHeight + (event.clientY - drag.startY)), true);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [dragging, onHeightChange]);

  return (
    <div className="mc-list-shell">
      <div className="mc-list" style={{ height }}>
        {children}
      </div>
      <div
        className="mc-list-split"
        data-dragging={dragging ? 'true' : 'false'}
        role="separator"
        aria-orientation="horizontal"
        aria-label="拖拽调整预览列表高度"
        onPointerDown={(event) => {
          event.preventDefault();
          dragRef.current = { startY: event.clientY, startHeight: height };
          setDragging(true);
          event.currentTarget.setPointerCapture?.(event.pointerId);
        }}
      />
    </div>
  );
};

const ColorChip = ({ hex, label }: { hex: string | null; label: string }) => {
  if (!hex) return null;
  return (
    <ResponsiveTooltip content={`${label} · ${hex}`}>
      <span className="mc-chip" style={{ backgroundColor: hex }} aria-label={`${label} ${hex}`} />
    </ResponsiveTooltip>
  );
};

const PathDiff = ({ name, otherName }: { name: string; otherName: string }) => {
  const tokens = pathTokens(name);
  const other = pathTokens(otherName);
  const matched = otherName ? suffixOverlap(tokens, other) : 0;
  const splitAt = tokens.length - matched;
  return (
    <span className="mc-path">
      {tokens.map((token, index) => {
        const dim = matched > 0 && index < splitAt;
        const isState = STATE_TOKEN.has(token.toLowerCase());
        return (
          <span key={`${token}-${index}`} className="mc-path-part">
            {index > 0 ? <span className="mc-path-sep">/</span> : null}
            {isState ? (
              <Tag level="caption">{token}</Tag>
            ) : (
              <span className={dim ? 'mc-path-dim' : 'mc-path-hit'}>{token}</span>
            )}
          </span>
        );
      })}
    </span>
  );
};

const StepSection = ({
  step,
  title,
  badge,
  badgeStyle,
  open,
  disabled,
  onToggle,
  children
}: {
  step: StepId;
  title: string;
  badge: string;
  badgeStyle?: 'theme' | 'success' | 'info' | 'normal';
  open: boolean;
  disabled?: boolean;
  onToggle: () => void;
  children: ReactNode;
}) => (
  <Card className="mc-step" data-open={open ? 'true' : 'false'} data-disabled={disabled ? 'true' : 'false'}>
    <button
      type="button"
      className="mc-step-head"
      aria-expanded={open}
      disabled={disabled}
      onClick={onToggle}
    >
      <span className="mc-step-index">{step}</span>
      <span className="mc-step-title">{title}</span>
      <Badge style={badgeStyle ?? 'theme'} level="caption">
        {badge}
      </Badge>
    </button>
    {open ? <CardBody className="mc-step-body">{children}</CardBody> : null}
  </Card>
);

const MatchRowView = ({
  row,
  sourceHex,
  targetHex,
  candidateHex,
  checked,
  onToggle,
  onSelectTarget
}: {
  row: EnrichedRow;
  sourceHex: string | null;
  targetHex: string | null;
  candidateHex: Record<string, string | null>;
  checked: boolean;
  onToggle: (checked: boolean) => void;
  onSelectTarget: (targetId: string) => void;
}) => {
  const targetName = row.selectedCandidate?.targetName ?? '';
  const score = row.selectedCandidate?.score ?? row.recommendedScore;
  return (
    <div className="mc-match">
      <div className="mc-match-source">
        <CheckboxInput
          checked={checked}
          onCheckedChange={(value) => onToggle(value === true)}
          title={row.sourceName}
          description={
            row.sourceState
              ? `状态 ${row.sourceState} · ${confidenceLabel[row.selectedConfidence]}`
              : confidenceLabel[row.selectedConfidence]
          }
        />
        <div className="mc-match-title">
          <ColorChip hex={sourceHex} label={row.sourceName} />
          <PathDiff name={row.sourceName} otherName={targetName} />
        </div>
      </div>
      <div className="mc-match-target">
        <div className="mc-match-target-head">
          <ColorChip hex={targetHex} label={targetName || '候选'} />
          <PathDiff name={targetName || '（无候选）'} otherName={row.sourceName} />
          <Badge style={confidenceBadgeStyle(row.selectedConfidence)} level="caption" primary>
            {Math.round(score * 100)}%
          </Badge>
        </div>
        <Select
          value={row.selectedTargetId ?? '__none__'}
          onValueChange={onSelectTarget}
        >
          <SelectTrigger className="mc-grow" size="regular" aria-label={`candidate-${row.sourceId}`}>
            <SelectValue placeholder="选择候选 target（Top 5）" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">（不应用）</SelectItem>
            {row.candidates.map((candidate) => {
              const hex = candidateHex[candidate.targetId];
              return (
                <SelectItem key={`${row.sourceId}-${candidate.targetId}`} value={candidate.targetId}>
                  {hex ? `${hex} · ` : ''}
                  {candidate.targetName} · {Math.round(candidate.score * 100)}%
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
        <Typography level="caption" className="mc-hint">
          {(row.selectedCandidate?.reasons ?? row.candidates[0]?.reasons ?? []).join(' · ') || '无可用候选'}
        </Typography>
      </div>
    </div>
  );
};

export const App = () => {
  const [variables, setVariables] = useState<VariableInfo[]>([]);
  const [sourceScope, setSourceScope] = useState<SourceScope>('all');
  const [sourceCollectionId, setSourceCollectionId] = useState('all');
  const [targetCollectionId, setTargetCollectionId] = useState('all');
  const [resolvedType, setResolvedType] = useState<VariableResolvedType | 'all'>('all');
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.85);
  const [confidenceFilter, setConfidenceFilter] = useState<'all' | 'high' | 'medium' | 'low'>('all');
  const [overwriteLiteral, setOverwriteLiteral] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [openStep, setOpenStep] = useState<StepId>(1);
  const [collapsedFamilies, setCollapsedFamilies] = useState<Set<string>>(new Set());
  const [listHeight, setListHeight] = useState(DEFAULT_LIST_HEIGHT);
  const [selectedTargetBySource, setSelectedTargetBySource] = useState<Record<string, string>>({});
  const [checkedSourceIds, setCheckedSourceIds] = useState<Set<string>>(new Set());
  const [selectionBoundCount, setSelectionBoundCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [applyResults, setApplyResults] = useState<ApplyResultsView | null>(null);
  const seededRowRef = useRef<Set<string>>(new Set());
  const seededCollectionRef = useRef(false);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const message = event.data?.pluginMessage as MainToUiMessage | undefined;
      if (!message) return;
      if (message.type === 'ready') {
        setVariables(message.variables);
        setSelectionBoundCount(message.selectionBoundCount);
        if (typeof message.prefs.listHeight === 'number') {
          setListHeight(clampListHeight(message.prefs.listHeight));
        }
        setError(null);
      } else if (message.type === 'applied') {
        setBusy(false);
        const summary = message.summary;
        setOpenStep(4);
        if (message.dryRun) {
          setStatus(
            `Dry-run：${summary.rowsApplied}/${summary.rowsRequested} 行可写入，` +
              `${summary.modesWouldApply} 个 mode 将更新，${summary.modesSkipped} 个跳过`
          );
        } else {
          const resultView = toApplyResultsView(message.results);
          setApplyResults(resultView);
          setStatus(
            `应用完成：成功 ${resultView.successCount}，跳过 ${resultView.skippedCount}，失败 ${resultView.failedCount}`
          );
        }
      } else if (message.type === 'error') {
        setBusy(false);
        setError(message.message);
      }
    };
    window.addEventListener('message', onMessage);
    post({ type: 'init' });
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const collections = useMemo(() => listCollections(variables), [variables]);
  const localVariables = useMemo(() => variables.filter((variable) => !variable.isRemote), [variables]);
  const variableById = useMemo(
    () => new Map(localVariables.map((variable) => [variable.id, variable])),
    [localVariables]
  );

  useEffect(() => {
    if (seededCollectionRef.current) return;
    if (collections.length === 0) return;
    seededCollectionRef.current = true;
    setSourceCollectionId(collections[0]?.id ?? 'all');
    setTargetCollectionId(collections[1]?.id ?? collections[0]?.id ?? 'all');
  }, [collections]);

  const sourcePool = useMemo(
    () =>
      localVariables.filter((variable) => {
        if (sourceScope === 'bound' && !variable.boundToSelection) return false;
        if (sourceCollectionId !== 'all' && variable.collectionId !== sourceCollectionId) return false;
        if (resolvedType !== 'all' && variable.resolvedType !== resolvedType) return false;
        return true;
      }),
    [localVariables, sourceScope, sourceCollectionId, resolvedType]
  );

  const targetPool = useMemo(
    () =>
      localVariables.filter((variable) => {
        if (targetCollectionId !== 'all' && variable.collectionId !== targetCollectionId) return false;
        if (resolvedType !== 'all' && variable.resolvedType !== resolvedType) return false;
        return true;
      }),
    [localVariables, targetCollectionId, resolvedType]
  );

  const sameCollection =
    sourceCollectionId !== 'all' &&
    targetCollectionId !== 'all' &&
    sourceCollectionId === targetCollectionId;
  const scopeReady = sourcePool.length > 0 && targetPool.length > 0;

  const grouped = useMemo(() => {
    const result = buildMatchPreviewGrouped({
      sources: sourcePool,
      targets: targetPool,
      confidenceThreshold,
      maxCandidates: 5
    });
    return {
      ...result,
      families: result.families.map((family) => ({
        ...family,
        rows: sortFamilyRows(family.rows)
      }))
    };
  }, [sourcePool, targetPool, confidenceThreshold]);

  const rows = useMemo(
    () => [...grouped.families.flatMap((family) => family.rows), ...grouped.ungrouped],
    [grouped]
  );

  useEffect(() => {
    setSelectedTargetBySource((prev) => {
      const next: Record<string, string> = {};
      for (const row of rows) {
        const current = prev[row.sourceId];
        const candidateIds = new Set(row.candidates.map((candidate) => candidate.targetId));
        const fallback = row.recommendedTargetId ?? '';
        const targetId = current && candidateIds.has(current) ? current : fallback;
        if (targetId) next[row.sourceId] = targetId;
      }
      return next;
    });
  }, [rows]);

  useEffect(() => {
    setCheckedSourceIds((prev) => {
      const alive = new Set(rows.map((row) => row.sourceId));
      const next = new Set<string>();
      for (const id of prev) {
        if (alive.has(id)) next.add(id);
      }
      for (const row of rows) {
        if (seededRowRef.current.has(row.sourceId)) continue;
        seededRowRef.current.add(row.sourceId);
        if (row.autoChecked && row.recommendedTargetId) next.add(row.sourceId);
      }
      return next;
    });
  }, [rows]);

  const enrichedById = useMemo(() => {
    const map = new Map<string, EnrichedRow>();
    for (const row of rows) {
      const selectedTargetId = selectedTargetBySource[row.sourceId] ?? row.recommendedTargetId;
      const selectedCandidate = row.candidates.find((candidate) => candidate.targetId === selectedTargetId);
      map.set(row.sourceId, {
        ...row,
        selectedTargetId: selectedTargetId ?? null,
        selectedCandidate,
        selectedConfidence: selectedCandidate?.confidence ?? row.recommendedConfidence
      });
    }
    return map;
  }, [rows, selectedTargetBySource]);

  const displayFamilyGroups = useMemo(() => {
    const families = grouped.families
      .map((family) => ({
        ...family,
        rows: family.rows
          .map((row) => enrichedById.get(row.sourceId))
          .filter((row): row is EnrichedRow => Boolean(row && confidencePasses(row.selectedConfidence, confidenceFilter)))
      }))
      .filter((family) => family.rows.length > 0);
    const ungrouped = grouped.ungrouped
      .map((row) => enrichedById.get(row.sourceId))
      .filter((row): row is EnrichedRow => Boolean(row && confidencePasses(row.selectedConfidence, confidenceFilter)));
    return { families, ungrouped };
  }, [grouped, enrichedById, confidenceFilter]);

  const displayRows = useMemo(
    () => [...displayFamilyGroups.families.flatMap((family) => family.rows), ...displayFamilyGroups.ungrouped],
    [displayFamilyGroups]
  );

  const checkedReadyCount = useMemo(() => {
    let count = 0;
    for (const row of enrichedById.values()) {
      if (checkedSourceIds.has(row.sourceId) && row.selectedTargetId) count += 1;
    }
    return count;
  }, [enrichedById, checkedSourceIds]);

  const selectedMatches = useMemo(() => {
    const matches: BindingReviewSelection[] = [];
    for (const row of enrichedById.values()) {
      if (!checkedSourceIds.has(row.sourceId) || !row.selectedTargetId) continue;
      matches.push({
        sourceId: row.sourceId,
        targetId: row.selectedTargetId,
        score: row.selectedCandidate?.score ?? row.recommendedScore,
        confidence: row.selectedConfidence
      });
    }
    return matches;
  }, [enrichedById, checkedSourceIds]);

  const bindingRows = useMemo(
    () => buildBindingReview(localVariables, selectedMatches, overwriteLiteral),
    [localVariables, selectedMatches, overwriteLiteral]
  );

  const bindingSummary = useMemo(() => {
    let setCount = 0;
    let skipCount = 0;
    let failCount = 0;
    for (const row of bindingRows) {
      setCount += row.setCount;
      skipCount += row.skipCount;
      failCount += row.failCount;
    }
    return { setCount, skipCount, failCount };
  }, [bindingRows]);

  const applyOk = Boolean(
    applyResults && applyResults.failedCount === 0 && applyResults.successCount > 0
  );

  const onListHeightChange = useCallback((height: number, persist: boolean) => {
    const next = clampListHeight(height);
    setListHeight(next);
    post({ type: 'prefs', listHeight: next, persist });
  }, []);

  const toggleSource = (sourceId: string, checked: boolean) => {
    setCheckedSourceIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(sourceId);
      else next.delete(sourceId);
      return next;
    });
  };

  const selectVisible = () => {
    setCheckedSourceIds((prev) => {
      const next = new Set(prev);
      for (const row of displayRows) {
        if (row.selectedTargetId) next.add(row.sourceId);
      }
      return next;
    });
  };

  const selectHighConfidence = () => {
    setCheckedSourceIds((prev) => {
      const next = new Set(prev);
      for (const row of displayRows) {
        if (row.selectedConfidence === 'high' && row.selectedTargetId) next.add(row.sourceId);
      }
      return next;
    });
  };

  const selectFamily = (familyRows: EnrichedRow[]) => {
    setCheckedSourceIds((prev) => {
      const next = new Set(prev);
      for (const row of familyRows) {
        if (row.selectedTargetId) next.add(row.sourceId);
      }
      return next;
    });
  };

  const clearChecked = () => setCheckedSourceIds(new Set());

  const setRowTarget = (sourceId: string, value: string) => {
    setSelectedTargetBySource((prev) => {
      const next = { ...prev };
      if (value === '__none__') delete next[sourceId];
      else next[sourceId] = value;
      return next;
    });
  };

  const toggleFamily = (familyKey: string) => {
    setCollapsedFamilies((prev) => {
      const next = new Set(prev);
      if (next.has(familyKey)) next.delete(familyKey);
      else next.add(familyKey);
      return next;
    });
  };

  const gotoStep = (step: StepId) => {
    if (step !== 1 && !scopeReady) return;
    setOpenStep(step);
  };

  const runApply = (dryRun: boolean) => {
    if (busy) return;
    const matches = selectedMatches.map((match) => ({
      sourceId: match.sourceId,
      targetId: match.targetId
    }));
    if (matches.length === 0) {
      setStatus('没有可应用的映射（请先勾选并选择候选）。');
      setOpenStep(2);
      return;
    }
    setBusy(true);
    if (!dryRun) setApplyResults(null);
    setStatus(null);
    setError(null);
    setOpenStep(4);
    post({
      type: 'apply',
      matches,
      dryRun,
      overwriteLiteral
    });
  };

  const title = sourcePool.length > 0 ? `智能匹配 ${sourcePool.length} 个变量` : '智能匹配变量';
  const step2Disabled = !scopeReady;
  const step3Disabled = !scopeReady;
  const step4Disabled = !scopeReady;

  const renderMatchRow = (row: EnrichedRow) => {
    const sourceVar = variableById.get(row.sourceId);
    const targetVar = row.selectedTargetId ? variableById.get(row.selectedTargetId) : undefined;
    const candidateHex: Record<string, string | null> = {};
    for (const candidate of row.candidates) {
      candidateHex[candidate.targetId] = variableColorHex(variableById.get(candidate.targetId));
    }
    return (
      <MatchRowView
        key={row.sourceId}
        row={row}
        sourceHex={variableColorHex(sourceVar)}
        targetHex={variableColorHex(targetVar)}
        candidateHex={candidateHex}
        checked={checkedSourceIds.has(row.sourceId)}
        onToggle={(checked) => toggleSource(row.sourceId, checked)}
        onSelectTarget={(value) => setRowTarget(row.sourceId, value)}
      />
    );
  };

  return (
    <div className="mc-shell">
      <PanelResizeHandles />
      <Pagehead
        title={title}
        description="MatchCat：范围 → 匹配 → 核对绑定 → 应用，将 source 写入 VARIABLE_ALIAS。"
      />
      <Scroll className="mc-body">
        <div className="mc-body-inner">
          {error ? <Alert type="error" appearance="light" size="small" title="出错了" description={error} /> : null}
          {status ? (
            <Alert
              type={applyResults && applyResults.failedCount > 0 ? 'warning' : 'success'}
              appearance="light"
              size="small"
              title="执行结果"
              description={status}
            />
          ) : null}

          <StepSection
            step={1}
            title="范围"
            badge={`${sourcePool.length} 个 source`}
            open={openStep === 1}
            onToggle={() => gotoStep(1)}
          >
            <div className="mc-field">
              <div className="mc-row mc-row--tight">
                <Button mode={sourceScope === 'all' ? 'primary' : 'outline'} size="small" onClick={() => setSourceScope('all')}>
                  全部
                </Button>
                <Button
                  mode={sourceScope === 'bound' ? 'primary' : 'outline'}
                  size="small"
                  onClick={() => setSourceScope('bound')}
                >
                  画板绑定 ({selectionBoundCount})
                </Button>
                <Button mode="outline" size="small" onClick={() => post({ type: 'refresh' })}>
                  刷新
                </Button>
              </div>
              <div className="mc-pair">
                <div className="mc-field">
                  <Typography level="caption">源集合 Source</Typography>
                  <Select value={sourceCollectionId} onValueChange={setSourceCollectionId}>
                    <SelectTrigger className="mc-grow" size="regular" aria-label="source-collection">
                      <SelectValue placeholder="源集合" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">全部集合</SelectItem>
                      {collections.map((collection) => (
                        <SelectItem key={`source-${collection.id}`} value={collection.id}>
                          {collection.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="mc-field">
                  <Typography level="caption">目标集合 Target</Typography>
                  <Select value={targetCollectionId} onValueChange={setTargetCollectionId}>
                    <SelectTrigger className="mc-grow" size="regular" aria-label="target-collection">
                      <SelectValue placeholder="目标集合" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">全部集合</SelectItem>
                      {collections.map((collection) => (
                        <SelectItem key={`target-${collection.id}`} value={collection.id}>
                          {collection.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              {sameCollection ? (
                <Alert
                  type="warning"
                  appearance="light"
                  size="small"
                  title="Source 与 Target 为同一集合"
                  description="可能产生自匹配噪音，建议选择不同的目标集合。"
                />
              ) : null}
              <Select value={resolvedType} onValueChange={(value) => setResolvedType(value as VariableResolvedType | 'all')}>
                <SelectTrigger size="regular" aria-label="resolved-type">
                  <SelectValue placeholder="变量类型" />
                </SelectTrigger>
                <SelectContent>
                  {TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button mode="noBackground" size="small" onClick={() => setAdvancedOpen((prev) => !prev)}>
                {advancedOpen ? '收起高级' : '高级：自动勾选阈值'}
              </Button>
              {advancedOpen ? (
                <Input
                  value={String(confidenceThreshold)}
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    setConfidenceThreshold(Number.isFinite(next) ? clampThreshold(next) : 0.85);
                  }}
                  placeholder="自动勾选阈值"
                />
              ) : null}
              <div className="mc-row">
                <span className="mc-push" />
                <Button mode="primary" size="small" disabled={!scopeReady} onClick={() => gotoStep(2)}>
                  下一步：匹配
                </Button>
              </div>
            </div>
          </StepSection>

          <StepSection
            step={2}
            title="匹配"
            badge={scopeReady ? `${checkedReadyCount} / ${rows.length} 已选` : '需先选范围'}
            open={openStep === 2}
            disabled={step2Disabled}
            onToggle={() => gotoStep(2)}
          >
            <div className="mc-field">
              <div className="mc-row mc-row--tight">
                <Select
                  value={confidenceFilter}
                  onValueChange={(value) => setConfidenceFilter(value as 'all' | 'high' | 'medium' | 'low')}
                >
                  <SelectTrigger size="regular" aria-label="confidence-filter">
                    <SelectValue placeholder="置信度过滤" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">显示全部置信度</SelectItem>
                    <SelectItem value="high">仅高置信度</SelectItem>
                    <SelectItem value="medium">中/高置信度</SelectItem>
                    <SelectItem value="low">低/中/高（排除无）</SelectItem>
                  </SelectContent>
                </Select>
                <Button mode="outline" size="small" onClick={selectVisible}>
                  勾选可见
                </Button>
                <Button mode="outline" size="small" onClick={selectHighConfidence}>
                  勾选全部高置信度
                </Button>
                <Button mode="noBackground" size="small" onClick={clearChecked}>
                  清空勾选
                </Button>
              </div>

              <ResizablePreviewList height={listHeight} onHeightChange={onListHeightChange}>
                {displayRows.length === 0 ? (
                  <div className="mc-empty">
                    <Typography level="caption">没有可展示的匹配结果，请调整过滤条件。</Typography>
                  </div>
                ) : (
                  <>
                    {displayFamilyGroups.families.map((family) => {
                      const expanded = !collapsedFamilies.has(family.familyKey);
                      const states = familyStatesOf(family).filter((state): state is Exclude<MatchState, null> =>
                        Boolean(state)
                      );
                      const avgScore =
                        family.rows.reduce((sum, row) => sum + (row.selectedCandidate?.score ?? row.recommendedScore), 0) /
                        Math.max(family.rows.length, 1);
                      return (
                        <div key={family.familyKey} className="mc-family">
                          <div className="mc-family-head">
                            <button
                              type="button"
                              className="mc-family-toggle"
                              aria-expanded={expanded}
                              onClick={() => toggleFamily(family.familyKey)}
                            >
                              <span className="mc-family-key">{family.familyKey || '未命名家族'}</span>
                              <span className="mc-family-tags">
                                {states.map((state) => (
                                  <Tag key={state} level="caption">
                                    {state}
                                  </Tag>
                                ))}
                                <Badge style={family.consistent ? 'success' : 'warning'} level="caption">
                                  {Math.round(avgScore * 100)}%
                                </Badge>
                                {family.consistent ? (
                                  <Badge style="success" level="caption">
                                    一致
                                  </Badge>
                                ) : (
                                  <Badge style="warning" level="caption">
                                    不一致
                                  </Badge>
                                )}
                              </span>
                            </button>
                            <Button mode="outline" size="small" onClick={() => selectFamily(family.rows)}>
                              全选此家族
                            </Button>
                          </div>
                          {expanded ? family.rows.map(renderMatchRow) : null}
                        </div>
                      );
                    })}
                    {displayFamilyGroups.ungrouped.map(renderMatchRow)}
                  </>
                )}
              </ResizablePreviewList>
              <div className="mc-row">
                <Button mode="outline" size="small" onClick={() => gotoStep(1)}>
                  上一步
                </Button>
                <span className="mc-push" />
                <Button mode="primary" size="small" onClick={() => gotoStep(3)}>
                  下一步：核对绑定
                </Button>
              </div>
            </div>
          </StepSection>

          <StepSection
            step={3}
            title="核对绑定"
            badge={scopeReady ? `${bindingRows.length} 个绑定` : '需先选范围'}
            open={openStep === 3}
            disabled={step3Disabled}
            onToggle={() => gotoStep(3)}
          >
            <div className="mc-field">
              <div className="mc-banner">
                将写入 {bindingSummary.setCount} 个 mode · 跳过 {bindingSummary.skipCount} · 失败 {bindingSummary.failCount}
              </div>
              <label className="mc-switch">
                <Switch size="small" checked={overwriteLiteral} onCheckedChange={setOverwriteLiteral} />
                <Typography level="caption">覆盖 literal（默认关闭）</Typography>
              </label>
              <div className="mc-result-list">
                {bindingRows.length === 0 ? (
                  <div className="mc-result-row">
                    <Typography level="caption" className="mc-hint">
                      勾选变量并选择候选后，这里会显示将写入的 VARIABLE_ALIAS 计划。
                    </Typography>
                  </div>
                ) : (
                  bindingRows.map((row, index) => (
                    <div key={`${row.sourceId}-${row.targetId}-${index}`} className="mc-result-row">
                      <div className="mc-result-main">
                        <ColorChip hex={row.sourceColorHex} label={row.sourceName} />
                        <span className="mc-result-path">
                          {row.sourceName} → {row.targetName}
                        </span>
                        <ColorChip hex={row.targetColorHex} label={row.targetName} />
                        <Badge style={confidenceBadgeStyle(row.confidence)} level="caption">
                          {Math.round(row.score * 100)}%
                        </Badge>
                        <span
                          className="mc-result-tag"
                          data-status={row.failCount > 0 ? 'failed' : row.setCount > 0 ? 'success' : 'skipped'}
                        >
                          写入 {row.setCount} / 跳过 {row.skipCount} / 失败 {row.failCount}
                        </span>
                      </div>
                      {row.modes.map((mode) => (
                        <Typography
                          key={`${row.sourceId}-${row.targetId}-${mode.modeName}-${mode.action}`}
                          level="caption"
                          className={mode.action === 'fail' ? 'mc-result-error' : 'mc-hint'}
                        >
                          {mode.modeName}：{mode.note}
                        </Typography>
                      ))}
                    </div>
                  ))
                )}
              </div>
              <div className="mc-row">
                <Button mode="outline" size="small" onClick={() => gotoStep(2)}>
                  上一步
                </Button>
                <span className="mc-push" />
                <Button mode="primary" size="small" onClick={() => gotoStep(4)}>
                  下一步：应用
                </Button>
              </div>
            </div>
          </StepSection>

          <StepSection
            step={4}
            title="应用"
            badge={
              applyResults
                ? `成功 ${applyResults.successCount}`
                : scopeReady
                  ? `${checkedReadyCount} 待写入`
                  : '需先选范围'
            }
            badgeStyle={applyOk ? 'success' : 'theme'}
            open={openStep === 4}
            disabled={step4Disabled}
            onToggle={() => gotoStep(4)}
          >
            <div className="mc-field">
              <Typography level="caption">使用底部按钮执行 Dry-run 或写入别名。结果会显示在本步骤。</Typography>
              {applyResults ? (
                <>
                  <div className={applyOk ? 'mc-banner mc-banner--ok' : 'mc-banner'}>
                    成功 {applyResults.successCount} · 跳过 {applyResults.skippedCount} · 失败 {applyResults.failedCount}
                  </div>
                  <div className="mc-result-list">
                    {applyResults.rows.map((row, index) => (
                      <div key={`${row.sourceName}-${row.targetName}-${index}`} className="mc-result-row">
                        <div className="mc-result-main">
                          <span className="mc-result-path">
                            {row.sourceName} → {row.targetName}
                          </span>
                          <span className="mc-result-tag" data-status={row.status}>
                            {row.statusLabel}
                          </span>
                        </div>
                        <Typography level="caption" className="mc-hint">
                          {row.detail}
                        </Typography>
                        {row.errorText ? (
                          <Typography level="caption" className="mc-result-error">
                            {row.errorText}
                          </Typography>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <Typography level="caption" className="mc-hint">
                  尚未执行。核对绑定后即可 Dry-run 或应用。
                </Typography>
              )}
            </div>
          </StepSection>
        </div>
      </Scroll>

      <div className="mc-foot">
        <Stack direction="row" gap="inside" className="mc-row">
          <Button mode="outline" size="regular" onClick={() => post({ type: 'close' })}>
            关闭
          </Button>
          <span className="mc-push" />
          <Button
            mode="outline"
            size="regular"
            disabled={busy || checkedReadyCount === 0}
            onClick={() => runApply(true)}
          >
            {busy ? '执行中…' : 'Dry-run 预演'}
          </Button>
          <Button
            mode="primary"
            size="regular"
            disabled={busy || checkedReadyCount === 0}
            onClick={() => runApply(false)}
          >
            {busy ? '执行中…' : '应用别名'}
          </Button>
        </Stack>
      </div>
    </div>
  );
};
