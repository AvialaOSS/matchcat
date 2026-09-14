/**
 * Rename-to template tokens, mirroring Figma's Rename layers chips.
 * Inserted as plain markers so the field stays a normal string input.
 */
export const TOKEN_CURRENT = '{{current}}';
export const TOKEN_NUMBER_ASC = '{{n}}';
export const TOKEN_NUMBER_DESC = '{{n-desc}}';

export type ExpandContext = {
  /** Full current variable path (group/leaf). */
  currentName: string;
  /** Zero-based index in the rename batch (selection order). */
  index: number;
  /** Total variables in the batch. */
  count: number;
  /** Value of "Start ascending from". */
  start: number;
};

/** Ascending number for this row: start, start+1, … */
export const ascendingNumber = (ctx: ExpandContext): number => ctx.start + ctx.index;

/**
 * Descending number for this row. First item gets the highest value so a batch
 * of 3 with start=1 yields 3, 2, 1 — same shape as Figma Rename layers.
 */
export const descendingNumber = (ctx: ExpandContext): number =>
  ctx.start + (ctx.count - 1 - ctx.index);

/** Expand every token occurrence in `template` for one row. */
export const expandRenameTemplate = (template: string, ctx: ExpandContext): string => {
  const asc = String(ascendingNumber(ctx));
  const desc = String(descendingNumber(ctx));
  return template
    .split(TOKEN_CURRENT)
    .join(ctx.currentName)
    .split(TOKEN_NUMBER_ASC)
    .join(asc)
    .split(TOKEN_NUMBER_DESC)
    .join(desc);
};

export type RenamePlanRow = {
  id: string;
  oldName: string;
  newName: string;
  /** True when Match was set and this name does not contain it — skipped. */
  skipped: boolean;
  unchanged: boolean;
};

export type BuildRenamePlanInput = {
  items: Array<{ id: string; name: string }>;
  match: string;
  renameTo: string;
  start: number;
};

/**
 * Build the before → after plan for a batch.
 *
 * - Empty Match: every name becomes the expanded Rename to template.
 * - Non-empty Match: only names that contain Match are touched; each Match
 *   substring is replaced by the expanded template (all occurrences).
 * - Empty Rename to with empty Match yields empty new names (caller validates).
 */
export const buildRenamePlan = (input: BuildRenamePlanInput): RenamePlanRow[] => {
  const match = input.match;
  const count = input.items.length;
  const start = Number.isFinite(input.start) ? Math.trunc(input.start) : 1;

  return input.items.map((item, index) => {
    const ctx: ExpandContext = {
      currentName: item.name,
      index,
      count,
      start
    };
    const expanded = expandRenameTemplate(input.renameTo, ctx);

    if (match.length > 0) {
      if (!item.name.includes(match)) {
        return {
          id: item.id,
          oldName: item.name,
          newName: item.name,
          skipped: true,
          unchanged: true
        };
      }
      const newName = item.name.split(match).join(expanded);
      return {
        id: item.id,
        oldName: item.name,
        newName,
        skipped: false,
        unchanged: newName === item.name
      };
    }

    return {
      id: item.id,
      oldName: item.name,
      newName: expanded,
      skipped: false,
      unchanged: expanded === item.name
    };
  });
};
