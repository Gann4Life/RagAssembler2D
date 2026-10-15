import { marqueeTool } from './select-box.js';

/**
 * Object a Select click acts on: the topmost hit, or with ALT the hit just below the topmost selected hit,
 * wrapping to the topmost (the topmost when no hit is selected).
 * @param {number[]} hits Uids under the press point, topmost first.
 * @param {(uid: number) => boolean} isSelected Whether a uid is selected.
 * @param {boolean} alt ALT held at the release.
 * @returns {number|null} The target uid, or `null` without hits.
 */
export function clickTarget(hits, isSelected, alt) {
  if (hits.length === 0) return null;
  if (!alt) return hits[0];
  const selected = hits.findIndex(isSelected);
  return hits[(selected + 1) % hits.length];
}

/**
 * Applies a Select click: with a target, CTRL removes it, else SHIFT toggles it, else it becomes the only
 * selected object; without one, no modifier clears the selection and SHIFT or CTRL do nothing.
 * @param {import('../model/selection.js').Selection} selection Selection to change.
 * @param {number|null} target Clicked uid, or `null` for empty space.
 * @param {{ shift: boolean, ctrl: boolean }} modifiers Modifiers held at the release.
 * @returns {void}
 */
export function applyClick(selection, target, { shift, ctrl }) {
  if (target === null) {
    if (!shift && !ctrl) selection.clear();
    return;
  }
  if (ctrl) selection.remove([target]);
  else if (shift) selection.toggle(target);
  else selection.set([target]);
}

/**
 * Select tool (`V`): a click selects the object under the press point, a drag selects with a box.
 * Default cursor, hover feedback shown.
 * @returns {Readonly<import('./tool.js').Tool>} The tool.
 */
export function selectTool() {
  return marqueeTool({
    id: 'select',
    cursor: 'default',
    hover: true,
    click(press, release, ctx) {
      const hits = ctx.hitTest(press.screen);
      const target = clickTarget(hits, (uid) => ctx.selection.has(uid), release.alt);
      applyClick(ctx.selection, target, release);
    },
  });
}
