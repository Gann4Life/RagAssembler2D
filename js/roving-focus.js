/**
 * Computes the next focused item index for a roving-tabindex toolbar.
 * Left/Right wrap around; Home/End jump to the first/last item.
 * @param {number} current Index of the currently focused item.
 * @param {string} key `KeyboardEvent.key` value.
 * @param {number} count Number of focusable items.
 * @returns {number} The new index, or -1 when the key does not move focus.
 */
export function rovingIndex(current, key, count) {
  if (count <= 0) return -1;
  switch (key) {
    case 'ArrowRight':
      return (current + 1) % count;
    case 'ArrowLeft':
      return (current - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return -1;
  }
}
