/**
 * Result of a tree navigation key.
 * @typedef {object} TreeMove
 * @property {'focus'|'expand'|'collapse'} kind Move focus to a row, or expand or collapse a row.
 * @property {number} index Row index the move applies to.
 */

const KEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End']);

/**
 * Maps a navigation key on a tree row to a move, as in a WAI-ARIA tree view, without wrapping. Handled keys
 * always return a move, also one that changes nothing.
 * @param {ReadonlyArray<{ expandable: boolean, expanded: boolean, parentIndex: number }>} rows Visible rows.
 * @param {number} index Focused row; an index outside `rows` acts as 0.
 * @param {string} key `KeyboardEvent.key`.
 * @returns {TreeMove|null} The move, or `null` for an unhandled key or empty `rows`.
 */
export function treeKey(rows, index, key) {
  if (!KEYS.has(key) || rows.length === 0) return null;
  const last = rows.length - 1;
  const at = Number.isInteger(index) && index >= 0 && index <= last ? index : 0;
  const row = rows[at];
  const focus = (target) => Object.freeze({ kind: 'focus', index: target });
  switch (key) {
    case 'ArrowDown':
      return focus(Math.min(at + 1, last));
    case 'ArrowUp':
      return focus(Math.max(at - 1, 0));
    case 'Home':
      return focus(0);
    case 'End':
      return focus(last);
    case 'ArrowRight':
      if (!row.expandable) return focus(at);
      return row.expanded ? focus(Math.min(at + 1, last)) : Object.freeze({ kind: 'expand', index: at });
    default:
      if (row.expandable && row.expanded) return Object.freeze({ kind: 'collapse', index: at });
      return focus(row.parentIndex >= 0 ? row.parentIndex : at);
  }
}
