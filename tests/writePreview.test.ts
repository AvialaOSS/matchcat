import { describe, expect, it } from 'vitest';
import { buildBindingReview, buildWritePreview } from '../src/ui/write-preview';
import type { VariableInfo, VariableResolvedType } from '../src/protocol/messages';

const variable = (input: {
  id: string;
  name: string;
  collectionId: string;
  resolvedType?: VariableResolvedType;
  modes: Array<{ id: string; name: string }>;
  valuesByMode?: Record<string, { kind: 'ALIAS' | 'LITERAL' | 'EMPTY'; aliasId?: string }>;
  colorHex?: string | null;
  resolvedValues?: Record<string, string>;
}): VariableInfo => ({
  id: input.id,
  name: input.name,
  resolvedType: input.resolvedType ?? 'COLOR',
  collectionId: input.collectionId,
  collectionName: input.collectionId,
  isRemote: false,
  boundToSelection: false,
  modes: input.modes,
  valuesByMode: input.valuesByMode ?? {},
  resolvedValues: input.resolvedValues ?? {},
  colorHex: input.colorHex ?? null
});

describe('buildWritePreview', () => {
  it('shows concrete VARIABLE_ALIAS write plans', () => {
    const source = variable({
      id: 's',
      name: 'button/primary-background-default',
      collectionId: 'src',
      modes: [
        { id: 's-default', name: 'default' },
        { id: 's-hover', name: 'hover' }
      ],
      valuesByMode: {
        's-default': { kind: 'EMPTY' },
        's-hover': { kind: 'EMPTY' }
      }
    });
    const target = variable({
      id: 't',
      name: 'control/theme-primary-background-default',
      collectionId: 'tgt',
      modes: [
        { id: 't-default', name: 'default' },
        { id: 't-hover', name: 'hover' }
      ]
    });

    const preview = buildWritePreview(
      [source, target],
      [{ sourceId: source.id, targetId: target.id }],
      false
    );

    expect(preview.summary.rowCount).toBe(1);
    expect(preview.summary.modeSetCount).toBe(2);
    expect(preview.rows[0]?.modes.every((mode) => mode.action === 'set')).toBe(true);
    expect(preview.rows[0]?.modes[0]?.note).toContain('VARIABLE_ALIAS');
  });

  it('explains mode skip reasons before apply', () => {
    const source = variable({
      id: 's',
      name: 'button/primary-background-default',
      collectionId: 'src',
      modes: [
        { id: 's-default', name: 'default' },
        { id: 's-hover', name: 'hover' }
      ],
      valuesByMode: {
        's-default': { kind: 'ALIAS', aliasId: 't' },
        's-hover': { kind: 'LITERAL' }
      }
    });
    const target = variable({
      id: 't',
      name: 'control/theme-primary-background-default',
      collectionId: 'tgt',
      modes: [{ id: 't-day', name: 'day' }]
    });

    const preview = buildWritePreview(
      [source, target],
      [{ sourceId: source.id, targetId: target.id }],
      false
    );
    const notes = preview.rows[0]?.modes.map((mode) => mode.note).join('；') ?? '';
    expect(preview.summary.modeSetCount).toBe(0);
    expect(preview.summary.modeSkipCount).toBe(2);
    expect(notes).toContain('已是同一别名');
    expect(notes).toContain('literal 值未覆盖');
  });

  it('does not require same mode names for write plan', () => {
    const source = variable({
      id: 's',
      name: 'button/primary-background-default',
      collectionId: 'src',
      modes: [
        { id: 's-default', name: 'default' },
        { id: 's-hover', name: 'hover' }
      ],
      valuesByMode: {
        's-default': { kind: 'EMPTY' },
        's-hover': { kind: 'EMPTY' }
      }
    });
    const target = variable({
      id: 't',
      name: 'control/theme-primary-background-default',
      collectionId: 'tgt',
      modes: [
        { id: 't-day', name: 'day' },
        { id: 't-night', name: 'night' }
      ]
    });

    const preview = buildWritePreview(
      [source, target],
      [{ sourceId: source.id, targetId: target.id }],
      false
    );

    expect(preview.summary.modeSetCount).toBe(2);
    expect(preview.summary.modeSkipCount).toBe(0);
    expect(preview.rows[0]?.modes[0]?.note).toContain('不要求同名 mode');
  });

  it('propagates colorHex on write preview rows', () => {
    const source = variable({
      id: 's',
      name: 'button/primary-background-default',
      collectionId: 'src',
      colorHex: '#112233',
      modes: [{ id: 's-default', name: 'default' }],
      valuesByMode: { 's-default': { kind: 'EMPTY' } }
    });
    const target = variable({
      id: 't',
      name: 'control/theme-primary-background-default',
      collectionId: 'tgt',
      colorHex: '#445566',
      modes: [{ id: 't-default', name: 'default' }]
    });
    const preview = buildWritePreview([source, target], [{ sourceId: 's', targetId: 't' }], false);
    expect(preview.rows[0]?.sourceColorHex).toBe('#112233');
    expect(preview.rows[0]?.targetColorHex).toBe('#445566');
  });
});

describe('buildBindingReview', () => {
  it('merges match metadata with write preview mode plans', () => {
    const source = variable({
      id: 's',
      name: 'button/primary-background-default',
      collectionId: 'src',
      modes: [{ id: 's-default', name: 'default' }],
      valuesByMode: { 's-default': { kind: 'EMPTY' } }
    });
    const target = variable({
      id: 't',
      name: 'control/theme-primary-background-default',
      collectionId: 'tgt',
      modes: [{ id: 't-default', name: 'default' }]
    });
    const rows = buildBindingReview(
      [source, target],
      [{ sourceId: 's', targetId: 't', score: 0.91, confidence: 'high' }],
      false
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.score).toBe(0.91);
    expect(rows[0]?.confidence).toBe('high');
    expect(rows[0]?.setCount).toBe(1);
    expect(rows[0]?.modes[0]?.action).toBe('set');
  });
});
