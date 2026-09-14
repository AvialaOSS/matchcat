import { applyAliases, collectBoundVariableIds, snapshotLocalVariables } from './figma/variables';
import type { MainToUiMessage, UiToMainMessage } from './protocol/messages';

declare const UI_HTML: string;

const DEFAULT_WIDTH = 400;
const DEFAULT_HEIGHT = 560;
const DEFAULT_LIST_HEIGHT = 160;
const MIN_WIDTH = 320;
const MAX_WIDTH = 960;
const MIN_HEIGHT = 360;
const MAX_HEIGHT = 960;
const MIN_LIST_HEIGHT = 80;
const MAX_LIST_HEIGHT = 420;
const SIZE_KEY = 'matchcat.ui.size';

type StoredPrefs = {
  w: number;
  h: number;
  listHeight: number;
};

const clampWidth = (width: number) =>
  Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.floor(width)));

const clampHeight = (height: number) =>
  Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.floor(height)));

const clampListHeight = (height: number) =>
  Math.max(MIN_LIST_HEIGHT, Math.min(MAX_LIST_HEIGHT, Math.floor(height)));

const post = (message: MainToUiMessage) => {
  figma.ui.postMessage(message);
};

let prefs: StoredPrefs = {
  w: DEFAULT_WIDTH,
  h: DEFAULT_HEIGHT,
  listHeight: DEFAULT_LIST_HEIGHT
};

const readStoredPrefs = async (): Promise<StoredPrefs> => {
  const stored = await figma.clientStorage.getAsync(SIZE_KEY);
  const next: StoredPrefs = {
    w: DEFAULT_WIDTH,
    h: DEFAULT_HEIGHT,
    listHeight: DEFAULT_LIST_HEIGHT
  };
  if (typeof stored === 'number' && Number.isFinite(stored)) {
    next.w = clampWidth(stored);
    return next;
  }
  if (stored && typeof stored === 'object') {
    const row = stored as {
      w?: unknown;
      h?: unknown;
      listHeight?: unknown;
    };
    if (typeof row.w === 'number' && Number.isFinite(row.w)) next.w = clampWidth(row.w);
    if (typeof row.h === 'number' && Number.isFinite(row.h)) next.h = clampHeight(row.h);
    if (typeof row.listHeight === 'number' && Number.isFinite(row.listHeight)) {
      next.listHeight = clampListHeight(row.listHeight);
    }
  }
  return next;
};

const writeStoredPrefs = async (patch: Partial<StoredPrefs>) => {
  prefs = {
    w: patch.w !== undefined ? clampWidth(patch.w) : prefs.w,
    h: patch.h !== undefined ? clampHeight(patch.h) : prefs.h,
    listHeight: patch.listHeight !== undefined ? clampListHeight(patch.listHeight) : prefs.listHeight
  };
  await figma.clientStorage.setAsync(SIZE_KEY, prefs);
};

const pushSnapshot = async () => {
  const boundIds = collectBoundVariableIds(figma.currentPage.selection);
  const variables = await snapshotLocalVariables(boundIds);
  post({
    type: 'ready',
    variables,
    selectionBoundCount: [...boundIds].filter((id) => variables.some((v) => v.id === id)).length,
    prefs: {
      listHeight: prefs.listHeight
    }
  });
};

const main = async () => {
  prefs = await readStoredPrefs();
  figma.showUI(UI_HTML, { width: prefs.w, height: prefs.h, themeColors: true });

  figma.on('selectionchange', () => {
    void pushSnapshot().catch((error) => {
      post({
        type: 'error',
        message: error instanceof Error ? error.message : String(error)
      });
    });
  });

  figma.ui.onmessage = (raw: UiToMainMessage) => {
    void (async () => {
      try {
        switch (raw.type) {
          case 'init':
          case 'refresh':
            await pushSnapshot();
            break;
          case 'apply': {
            const result = await applyAliases({
              matches: raw.matches ?? [],
              dryRun: raw.dryRun ?? true,
              overwriteLiteral: raw.overwriteLiteral ?? false
            });
            post({ type: 'applied', dryRun: raw.dryRun ?? true, ...result });
            const { rowsApplied, modesApplied, modesWouldApply, modesFailed } = result.summary;
            if (raw.dryRun) {
              if (modesWouldApply > 0) {
                figma.notify(`Dry-run：${rowsApplied} 行可写入，${modesWouldApply} 个 mode 会更新`);
              } else {
                figma.notify('Dry-run：没有可更新的 mode');
              }
            } else if (modesApplied > 0 && modesFailed === 0) {
              figma.notify(`已写入 ${rowsApplied} 行，${modesApplied} 个 mode`);
            } else if (modesApplied > 0) {
              figma.notify(`已写入 ${modesApplied} 个 mode，失败 ${modesFailed} 个`);
            } else if (modesFailed > 0) {
              figma.notify(`写入失败 ${modesFailed} 个 mode`, { error: true });
            } else {
              figma.notify('没有需要写入的别名');
            }
            await pushSnapshot();
            break;
          }
          case 'resize': {
            const width = clampWidth(raw.width || DEFAULT_WIDTH);
            const height = clampHeight(raw.height || DEFAULT_HEIGHT);
            figma.ui.resize(width, height);
            if (raw.persist !== false) {
              await writeStoredPrefs({ w: width, h: height });
            } else {
              prefs = { ...prefs, w: width, h: height };
            }
            break;
          }
          case 'prefs': {
            const patch: Partial<StoredPrefs> = {};
            if (typeof raw.listHeight === 'number') patch.listHeight = raw.listHeight;
            if (raw.persist !== false) {
              await writeStoredPrefs(patch);
            } else {
              prefs = {
                ...prefs,
                ...(patch.listHeight !== undefined
                  ? { listHeight: clampListHeight(patch.listHeight) }
                  : {})
              };
            }
            break;
          }
          case 'close':
            figma.closePlugin();
            break;
          default:
            break;
        }
      } catch (error) {
        post({
          type: 'error',
          message: error instanceof Error ? error.message : String(error)
        });
      }
    })();
  };
};

void main();
