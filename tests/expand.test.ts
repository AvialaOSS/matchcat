import { describe, expect, it } from 'vitest';
import {
  TOKEN_CURRENT,
  TOKEN_NUMBER_ASC,
  TOKEN_NUMBER_DESC,
  ascendingNumber,
  buildRenamePlan,
  descendingNumber,
  expandRenameTemplate
} from '../src/rename/expand';
import { isRenameAllowed, isStructurallyValid, validateRenameName, validateStructure } from '../src/paradigm/structure';

describe('expandRenameTemplate', () => {
  it('replaces current-name and both number directions', () => {
    const out = expandRenameTemplate(
      `${TOKEN_CURRENT}-${TOKEN_NUMBER_ASC}-${TOKEN_NUMBER_DESC}`,
      { currentName: 'button/primary-background-rest', index: 0, count: 3, start: 1 }
    );
    expect(out).toBe('button/primary-background-rest-1-3');
  });

  it('ascending / descending counters match Figma-style batching', () => {
    const rows = [0, 1, 2].map((index) => ({
      asc: ascendingNumber({ currentName: 'x', index, count: 3, start: 1 }),
      desc: descendingNumber({ currentName: 'x', index, count: 3, start: 1 })
    }));
    expect(rows.map((r) => r.asc)).toEqual([1, 2, 3]);
    expect(rows.map((r) => r.desc)).toEqual([3, 2, 1]);
  });

  it('honours a custom start', () => {
    expect(
      expandRenameTemplate(`item-${TOKEN_NUMBER_ASC}`, {
        currentName: 'a',
        index: 1,
        count: 2,
        start: 10
      })
    ).toBe('item-11');
  });
});

describe('buildRenamePlan', () => {
  const items = [
    { id: '1', name: 'button/primary-background-rest' },
    { id: '2', name: 'button/primary-background-hover' },
    { id: '3', name: 'input/border-rest' }
  ];

  it('replaces the whole name when Match is empty', () => {
    const plan = buildRenamePlan({
      items,
      match: '',
      renameTo: `comp/${TOKEN_NUMBER_ASC}`,
      start: 1
    });
    expect(plan.map((row) => row.newName)).toEqual(['comp/1', 'comp/2', 'comp/3']);
    expect(plan.every((row) => !row.skipped)).toBe(true);
  });

  it('only rewrites names that contain Match', () => {
    const plan = buildRenamePlan({
      items,
      match: 'primary-',
      renameTo: 'second-',
      start: 1
    });
    expect(plan[0].newName).toBe('button/second-background-rest');
    expect(plan[1].newName).toBe('button/second-background-hover');
    expect(plan[2].skipped).toBe(true);
    expect(plan[2].newName).toBe('input/border-rest');
  });

  it('can keep current name and append a suffix with a number', () => {
    const plan = buildRenamePlan({
      items: items.slice(0, 2),
      match: '',
      renameTo: `${TOKEN_CURRENT}-v${TOKEN_NUMBER_ASC}`,
      start: 1
    });
    expect(plan[0].newName).toBe('button/primary-background-rest-v1');
    expect(plan[1].newName).toBe('button/primary-background-hover-v2');
  });
});

describe('structure validation', () => {
  it('accepts paradigm-shaped paths', () => {
    expect(isStructurallyValid('button/primary-background-rest')).toBe(true);
    expect(isStructurallyValid('palette/primary/s8')).toBe(true);
  });

  it('rejects illegal charset and missing group', () => {
    expect(validateStructure('button/primary background').length).toBeGreaterThan(0);
    expect(validateStructure('noGroup').some((i) => i.code === 'missingGroup')).toBe(true);
    expect(validateStructure('Button/Primary').some((i) => i.code === 'slotCase')).toBe(true);
  });
});

describe('free naming gate', () => {
  it('blocks empty names in free mode, allows free-form paths', () => {
    expect(isRenameAllowed('My Free Name!', false)).toBe(true);
    expect(isRenameAllowed('noGroup', false)).toBe(true);
    expect(isRenameAllowed('   ', false)).toBe(false);
    expect(isRenameAllowed('', false)).toBe(false);
  });

  it('still enforces structure when followVarcatStructure is on', () => {
    expect(isRenameAllowed('My Free Name!', true)).toBe(false);
    expect(isRenameAllowed('button/primary-background-rest', true)).toBe(true);
  });

  it('warns duplicates without blocking', () => {
    const issues = validateRenameName({
      newName: 'button/primary-background-rest',
      followVarcatStructure: false,
      siblingNames: new Set(['button/primary-background-rest'])
    });
    expect(issues.some((i) => i.code === 'duplicate' && !i.blocking)).toBe(true);
    expect(issues.every((i) => i.code === 'duplicate' || !i.blocking)).toBe(true);
  });
});
