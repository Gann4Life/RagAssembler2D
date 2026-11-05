const FADE_IN = 0.25;
const FADE_OUT = 0.3;

/**
 * Picks the first joint name matched by the earliest pattern, or the first name when no pattern matches.
 * @param {string[]} names Joint names in file order.
 * @param {RegExp[]} patterns Patterns in priority order.
 * @returns {string} The chosen name, or `''` for an empty list.
 */
export function pickJoint(names, patterns) {
  for (const pattern of patterns) {
    const match = names.find((name) => pattern.test(name));
    if (match !== undefined) return match;
  }
  return names[0] ?? '';
}

/**
 * Wires a toggle button, a joint dropdown and a weight slider to one procedural aim override.
 * @param {{ toggle: HTMLButtonElement, select: HTMLSelectElement, slider: HTMLInputElement, output: HTMLOutputElement,
 *   patterns: RegExp[] }} elements Controls and the patterns that choose the default joint.
 * @returns {{ setJoints: (names: string[]) => void, bind: (rag: *) => void, apply: (target: { x: number, y: number }) => void }}
 *   `setJoints` fills the dropdown for a loaded ragdoll, `bind` attaches a spawned instance, `apply` re-aims the selected joint at a
 *   world point in meters while the toggle is on.
 */
export function createJointAim({ toggle, select, slider, output, patterns }) {
  let active = false;
  let rag = null;
  let handle = null;
  let handleName = '';

  function release() {
    handle?.clearOverride({ fadeOut: FADE_OUT });
    handle = null;
    handleName = '';
  }

  function refreshToggle() {
    toggle.classList.toggle('active', active);
    toggle.setAttribute('aria-pressed', String(active));
  }

  toggle.addEventListener('click', () => {
    active = !active;
    if (!active) release();
    refreshToggle();
  });

  slider.addEventListener('input', () => {
    output.textContent = Number(slider.value).toFixed(2);
  });

  refreshToggle();

  return {
    setJoints(names) {
      select.replaceChildren(
        ...names.map((name) => {
          const option = document.createElement('option');
          option.value = name;
          option.textContent = name;
          return option;
        }),
      );
      select.value = pickJoint(names, patterns);
      select.disabled = names.length === 0;
      toggle.disabled = names.length === 0;
    },
    bind(instance) {
      rag = instance;
      handle = null;
      handleName = '';
    },
    apply(target) {
      if (!active || rag === null || select.value === '') return;
      if (handleName !== select.value) {
        handle?.clearOverride({ fadeOut: FADE_OUT });
        handle = rag.jointControl(select.value);
        handleName = select.value;
      }
      handle.lookAt(target, { weight: Number(slider.value), fadeIn: FADE_IN });
    },
  };
}
