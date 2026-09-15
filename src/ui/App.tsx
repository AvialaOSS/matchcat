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
  Button,
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
  Typography
} from '@aviala-design/spiral';
import { buildMatchPreview, type MatchConfidence } from '../matcher/matchScore';
import type { MainToUiMessage, SourceScope, VariableInfo, VariableResolvedType } from '../protocol/messages';
import { toApplyResultsView, type ApplyResultsView } from './apply-results';
import { buildWritePreview } from './write-preview';

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

export const App = () => {
  const [variables, setVariables] = useState<VariableInfo[]>([]);
  const [sourceScope, setSourceScope] = useState<SourceScope>('all');
  const [sourceCollectionId, setSourceCollectionId] = useState('all');
  const [targetCollectionId, setTargetCollectionId] = useState('all');
  const [resolvedType, setResolvedType] = useState<VariableResolvedType | 'all'>('all');
  const [confidenceThreshold, setConfidenceThreshold] = useState(0.75);
  const [confidenceFilter, setConfidenceFilter] = useState<'all' | 'high' | 'medium' | 'low'>('all');
  const [overwriteLiteral, setOverwriteLiteral] = useState(false);
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

  const rows = useMemo(
    () =>
      buildMatchPreview({
        sources: sourcePool,
        targets: targetPool,
        confidenceThreshold,
        maxCandidates: 8
      }),
    [sourcePool, targetPool, confidenceThreshold]
  );

  useEffect(() => {
    setSelectedTargetBySource((prev) => {
      const next: Record<string, string> = {};
      for (const row of rows) {
        const current = prev[row.sourceId];
        const fallback = row.recommendedTargetId ?? '';
        const targetId = current || fallback;
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

  const enrichedRows = useMemo(
    () =>
      rows.map((row) => {
        const selectedTargetId = selectedTargetBySource[row.sourceId] ?? row.recommendedTargetId;
        const selectedCandidate = row.candidates.find((candidate) => candidate.targetId === selectedTargetId);
        return {
          ...row,
          selectedTargetId: selectedTargetId ?? null,
          selectedCandidate,
          selectedConfidence: selectedCandidate?.confidence ?? row.recommendedConfidence
        };
      }),
    [rows, selectedTargetBySource]
  );

  const displayRows = useMemo(
    () => enrichedRows.filter((row) => confidencePasses(row.selectedConfidence, confidenceFilter)),
    [enrichedRows, confidenceFilter]
  );

  const checkedReadyCount = useMemo(
    () =>
      enrichedRows.filter((row) => checkedSourceIds.has(row.sourceId) && row.selectedTargetId !== null)
        .length,
    [enrichedRows, checkedSourceIds]
  );

  const selectedMatches = useMemo(
    () =>
      enrichedRows
        .filter((row) => checkedSourceIds.has(row.sourceId) && row.selectedTargetId)
        .map((row) => ({
          sourceId: row.sourceId,
          targetId: row.selectedTargetId as string
        })),
    [enrichedRows, checkedSourceIds]
  );

  const writePreview = useMemo(
    () => buildWritePreview(localVariables, selectedMatches, overwriteLiteral),
    [localVariables, selectedMatches, overwriteLiteral]
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

  const clearChecked = () => setCheckedSourceIds(new Set());

  const runApply = (dryRun: boolean) => {
    if (busy) return;
    const matches = selectedMatches;
    if (matches.length === 0) {
      setStatus('没有可应用的映射（请先勾选并选择候选）。');
      return;
    }
    setBusy(true);
    if (!dryRun) setApplyResults(null);
    setStatus(null);
    setError(null);
    post({
      type: 'apply',
      matches,
      dryRun,
      overwriteLiteral
    });
  };

  const title = sourcePool.length > 0 ? `智能匹配 ${sourcePool.length} 个变量` : '智能匹配变量';

  return (
    <div className="mc-shell">
      <PanelResizeHandles />
      <Pagehead title={title} description="MatchCat：智能匹配 source → target，并写入 VARIABLE_ALIAS（支持 dry-run）。" />
      <Scroll className="mc-body">
        <div className="mc-body-inner">
          {error ? <Alert type="error" appearance="light" size="small" title="出错了" description={error} /> : null}
          {status ? (
            <Alert type="success" appearance="light" size="small" title="执行结果" description={status} />
          ) : null}

          <div className="mc-field">
            <Typography level="caption">范围与过滤</Typography>
            <div className="mc-row mc-row--tight">
              <Button mode={sourceScope === 'all' ? 'primary' : 'outline'} size="small" onClick={() => setSourceScope('all')}>
                Source：全部
              </Button>
              <Button mode={sourceScope === 'bound' ? 'primary' : 'outline'} size="small" onClick={() => setSourceScope('bound')}>
                Source：画板绑定 ({selectionBoundCount})
              </Button>
              <Button mode="outline" size="small" onClick={() => post({ type: 'refresh' })}>
                刷新
              </Button>
            </div>
            <div className="mc-row mc-row--tight">
              <Select value={sourceCollectionId} onValueChange={setSourceCollectionId}>
                <SelectTrigger className="mc-grow" size="regular" aria-label="source-collection">
                  <SelectValue placeholder="Source 集合" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Source：全部集合</SelectItem>
                  {collections.map((collection) => (
                    <SelectItem key={`source-${collection.id}`} value={collection.id}>
                      {collection.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={targetCollectionId} onValueChange={setTargetCollectionId}>
                <SelectTrigger className="mc-grow" size="regular" aria-label="target-collection">
                  <SelectValue placeholder="Target 集合" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Target：全部集合</SelectItem>
                  {collections.map((collection) => (
                    <SelectItem key={`target-${collection.id}`} value={collection.id}>
                      {collection.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="mc-row mc-row--tight">
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
              <Select value={confidenceFilter} onValueChange={(value) => setConfidenceFilter(value as 'all' | 'high' | 'medium' | 'low')}>
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
              <Input
                value={String(confidenceThreshold)}
                type="number"
                min="0"
                max="1"
                step="0.05"
                onChange={(event) => {
                  const next = Number(event.target.value);
                  setConfidenceThreshold(Number.isFinite(next) ? clampThreshold(next) : 0.75);
                }}
                placeholder="自动勾选阈值"
              />
            </div>
          </div>

          <div className="mc-row mc-row--tight">
            <Typography level="caption">
              预览行：{displayRows.length} / {rows.length}，已勾选可应用：{checkedReadyCount}
            </Typography>
            <span className="mc-push" />
            <Button mode="outline" size="small" onClick={selectVisible}>
              勾选可见
            </Button>
            <Button mode="noBackground" size="small" onClick={clearChecked}>
              清空勾选
            </Button>
          </div>

          <ResizablePreviewList height={listHeight} onHeightChange={onListHeightChange}>
            {displayRows.length === 0 ? (
              <div className="mc-row-item">
                <Typography level="caption">没有可展示的匹配结果，请调整过滤条件。</Typography>
              </div>
            ) : (
              displayRows.map((row) => (
                <div key={row.sourceId} className="mc-row-item">
                  <CheckboxInput
                    checked={checkedSourceIds.has(row.sourceId)}
                    onCheckedChange={(value) => toggleSource(row.sourceId, value === true)}
                    title={row.sourceName}
                    description={`状态：${row.sourceState ?? 'none'} · 置信度：${confidenceLabel[row.selectedConfidence]} · 得分 ${Math.round((row.selectedCandidate?.score ?? row.recommendedScore) * 100)}%`}
                  />
                  <div className="mc-row-edit">
                    <Select
                      value={row.selectedTargetId ?? '__none__'}
                      onValueChange={(value) => {
                        setSelectedTargetBySource((prev) => {
                          const next = { ...prev };
                          if (value === '__none__') delete next[row.sourceId];
                          else next[row.sourceId] = value;
                          return next;
                        });
                      }}
                    >
                      <SelectTrigger className="mc-grow" size="regular" aria-label={`candidate-${row.sourceId}`}>
                        <SelectValue placeholder="选择候选 target" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">（不应用）</SelectItem>
                        {row.candidates.map((candidate) => (
                          <SelectItem key={`${row.sourceId}-${candidate.targetId}`} value={candidate.targetId}>
                            {candidate.targetName} · {Math.round(candidate.score * 100)}%
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Typography level="caption" className="mc-hint">
                      {(row.selectedCandidate?.reasons ?? row.candidates[0]?.reasons ?? []).join(' · ') || '无可用候选'}
                    </Typography>
                  </div>
                </div>
              ))
            )}
          </ResizablePreviewList>

          <div className="mc-field">
            <Typography level="caption">写入预览（应用前）</Typography>
            <div className="mc-result-summary">
              变量行 {writePreview.summary.rowCount} · 将写入 {writePreview.summary.modeSetCount} 个 mode · 跳过{' '}
              {writePreview.summary.modeSkipCount} · 失败 {writePreview.summary.modeFailCount}
            </div>
            <div className="mc-result-list">
              {writePreview.rows.length === 0 ? (
                <div className="mc-result-row">
                  <Typography level="caption" className="mc-hint">
                    勾选变量并选择候选后，这里会显示将写入的 VARIABLE_ALIAS 计划。
                  </Typography>
                </div>
              ) : (
                writePreview.rows.map((row, index) => (
                  <div key={`${row.sourceId}-${row.targetId}-${index}`} className="mc-result-row">
                    <div className="mc-result-main">
                      <span className="mc-result-path">
                        {row.sourceName} → {row.targetName}
                      </span>
                      <span className="mc-result-tag" data-status={row.failCount > 0 ? 'failed' : row.setCount > 0 ? 'success' : 'skipped'}>
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
          </div>

          <div className="mc-field">
            <label className="mc-switch">
              <Switch size="small" checked={overwriteLiteral} onCheckedChange={setOverwriteLiteral} />
              <Typography level="caption">覆盖 literal（默认关闭）</Typography>
            </label>
          </div>

          {applyResults ? (
            <div className="mc-field">
              <Typography level="caption">应用结果（主线程回传）</Typography>
              <div className="mc-result-summary">
                成功 {applyResults.successCount} · 跳过 {applyResults.skippedCount} · 失败{' '}
                {applyResults.failedCount}
              </div>
              <div className="mc-result-list">
                {applyResults.rows.map((row, index) => (
                  <div key={`${row.sourceName}-${row.targetName}-${index}`} className="mc-result-row">
                    <div className="mc-result-main">
                      <span className="mc-result-path">
                        {row.sourceName} → {row.targetName}
                      </span>
                      <span
                        className="mc-result-tag"
                        data-status={row.status}
                      >
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
            </div>
          ) : null}
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
