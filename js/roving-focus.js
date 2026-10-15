const KEYS = Object.freeze({
  horizontal: Object.freeze({ next: 'ArrowRight', previous: 'ArrowLeft' }),
  vertical: Object.freeze({ next: 'ArrowDown', previous: 'ArrowUp' }),
});

/**
 * Computes the next focused item index for a roving-tabindex widget.
 * Next/previous keys wrap around; Home/End jump to the first/last item.
 * @param {number} current Index of the currently focused item.
 * @param {string} key `KeyboardEvent.key` value.
 * @param {number} count Number of focusable items.
 * @param {'horizontal' | 'vertical'} [orientation] `'horizontal'` uses Left/Right, `'vertical'` uses Up/Down.
 * @returns {number} The new index, or -1 when the key does not move focus.
 */
export function rovingIndex(current, key, count, orientation = 'horizontal') {
  if (count <= 0) return -1;
  const keys = KEYS[orientation] ?? KEYS.horizontal;
  switch (key) {
    case keys.next:
      return (current + 1) % count;
    case keys.previous:
      return (current - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return -1;
  }
}
