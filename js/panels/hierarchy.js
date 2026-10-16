import { ancestorKeys, hierarchyRows, hierarchyTree } from '../model/hierarchy.js';
import { treeKey } from '../tree-nav.js';
import { openMenu } from '../menu.js';
import { actionTitle } from '../header.js';
import { attachTooltip } from '../tooltip.js';

/**
 * @typedef {object} Hierarchy
 * @property {() => void} destroy Removes listeners, tooltips, the pending frame callback and the panel content.
 */

const TREE_ID = 'hierarchy-tree';
const HELP_ID = 'hierarchy-tree-help';
const HELP_TEXT =
  'Arrow keys move and select. Shift adds to the selection, Control moves without selecting. Space toggles. '
  + 'Shift click toggles, Control click deselects. Delete removes the selection, F frames it.';
const GROUP_NAME = 'Unlinked, warning: not connected to the root body';

const ADD_ACTION = Object.freeze({ id: 'add', label: 'Add' });
const DELETE_ACTION = Object.freeze({ id: 'delete', label: 'Delete', shortcut: 'Del' });
const ADD_ITEMS = Object.freeze([
  Object.freeze({ id: 'add-shape', label: 'Add shape', kind: 'item' }),
  Object.freeze({ id: 'add-joint', label: 'Add joint', kind: 'item' }),
]);

const ICONS = Object.freeze({
  root: '<circle cx="12" cy="12" r="5"/><path d="M12 3v18M3 12h18"/>',
  body: '<rect x="3.5" y="10" width="10" height="10" rx="1"/><circle cx="15" cy="9" r="5.5"/>',
  circle: '<circle cx="12" cy="12" r="7"/>',
  box: '<rect x="5" y="7" width="14" height="10"/>',
  polygon: '<path d="M12 4l7.6 5.5-2.9 9H7.3l-2.9-9z"/>',
  shape: '<path d="M5 18 12 5l7 13z"/>',
  joint: '<circle cx="12" cy="12" r="3"/><path d="M3.5 18.5 9.5 14M14.5 10l6-4.5"/>',
  unlinked: '<path d="M12 4 21 20H3z"/><path d="M12 10v4"/><circle cx="12" cy="17" r="0.8" fill="currentColor"/>',
  trash: '<path d="M4 7h16M10 4h4M6 7l1 13h10l1-13M10 11v6M14 11v6"/>',
  chevron: '<path d="M7 10l5 5 5-5"/>',
});

const KIND_NAMES = Object.freeze({ root: 'ragdoll root', body: 'body', joint: 'joint' });

function svgIcon(doc, markup, className) {
  const span = doc.createElement('span');
  span.className = className;
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 24 24" focusable="false">${markup}</svg>`;
  return span;
}

function kindName(item) {
  if (item.kind === 'shape') return item.shapeType ? `${item.shapeType} shape` : 'shape';
  return KIND_NAMES[item.kind];
}

function accessibleName(row) {
  const { item } = row;
  if (item.kind === 'unlinked') return GROUP_NAME;
  let name = `${item.label}, ${kindName(item)}`;
  if (row.match?.field === 'id') name += `, id ${item.id}`;
  if (item.loop) name += `, loop joint to ${item.loopTo}`;
  if (item.unassigned) name += ', unassigned joint';
  return name;
}

function highlighted(doc, text, indices) {
  const marked = new Set(indices);
  const nodes = [];
  let run = '';
  let runMarked = false;
  const flush = () => {
    if (run === '') return;
    if (runMarked) {
      const mark = doc.createElement('mark');
      mark.textContent = run;
      nodes.push(mark);
    } else {
      nodes.push(doc.createTextNode(run));
    }
    run = '';
  };
  for (let index = 0; index < text.length; index++) {
    const isMarked = marked.has(index);
    if (isMarked !== runMarked) {
      flush();
      runMarked = isMarked;
    }
    run += text[index];
  }
  flush();
  return nodes;
}

function rowSignature(row) {
  const { item, match } = row;
  return JSON.stringify([
    item.kind,
    item.label,
    item.id,
    item.shapeType,
    item.loop,
    item.loopTo,
    item.unassigned,
    match,
    row.expandable,
    row.expanded,
  ]);
}

function span(doc, className, text) {
  const element = doc.createElement('span');
  element.className = className;
  element.textContent = text;
  return element;
}

function rowContent(doc, row) {
  const { item, match } = row;
  const arrow = span(doc, 'hierarchy-arrow', row.expandable ? (row.expanded ? '▾' : '▸') : '');
  arrow.setAttribute('aria-hidden', 'true');
  if (item.kind === 'unlinked') {
    return [arrow, svgIcon(doc, ICONS.unlinked, 'hierarchy-icon is-warning'), span(doc, 'hierarchy-label is-muted', item.label)];
  }
  const icon = svgIcon(doc, ICONS[item.kind === 'shape' ? (item.shapeType ?? 'shape') : item.kind] ?? ICONS.shape, 'hierarchy-icon');
  const label = span(doc, 'hierarchy-label', '');
  if (match?.field === 'label') label.append(...highlighted(doc, item.label, match.indices));
  else label.textContent = item.label;
  const nodes = [arrow, icon, label];
  if (match?.field === 'id') {
    const id = span(doc, 'hierarchy-id', '');
    id.append(...highlighted(doc, item.id, match.indices));
    nodes.push(id);
  }
  if (item.loop) {
    nodes.push(span(doc, 'hierarchy-badge', 'loop'), span(doc, 'hierarchy-loop-to', `→ ${item.loopTo}`));
  }
  if (item.unassigned) nodes.push(span(doc, 'hierarchy-badge is-error', 'unassigned'));
  return nodes;
}

/**
 * Mounts the Hierarchy panel into a dock panel element, replacing its content: a toolbar with the search field,
 * the Add menu and the Delete button, then the object tree. Selection goes through `editor.selection`; Add and
 * Delete run the `add-shape`, `add-joint` and `delete` actions. Never mutates the model itself.
 * @param {HTMLElement} element Panel element given by the dock.
 * @param {import('../editor.js').Editor} editor Editor core.
 * @returns {Hierarchy}
 */
export function createHierarchy(element, editor) {
  const { model, selection, actions, history, modes } = editor;
  const doc = element.ownerDocument;
  const view = doc.defaultView;

  const toolbar = doc.createElement('div');
  toolbar.className = 'hierarchy-toolbar';

  const search = doc.createElement('input');
  search.type = 'search';
  search.className = 'hierarchy-search';
  search.placeholder = 'Search';
  search.setAttribute('aria-label', 'Search hierarchy');
  search.setAttribute('aria-controls', TREE_ID);

  const addButton = doc.createElement('button');
  addButton.type = 'button';
  addButton.className = 'hierarchy-button';
  addButton.setAttribute('aria-label', 'Add');
  addButton.setAttribute('aria-haspopup', 'menu');
  addButton.setAttribute('aria-expanded', 'false');
  addButton.append(span(doc, 'hierarchy-button-text', 'Add'), svgIcon(doc, ICONS.chevron, 'hierarchy-button-chevron'));

  const deleteButton = doc.createElement('button');
  deleteButton.type = 'button';
  deleteButton.className = 'hierarchy-button is-icon';
  deleteButton.setAttribute('aria-label', 'Delete');
  deleteButton.append(svgIcon(doc, ICONS.trash, 'hierarchy-button-icon'));

  toolbar.append(search, addButton, deleteButton);

  const tree = doc.createElement('ul');
  tree.id = TREE_ID;
  tree.className = 'hierarchy-tree';
  tree.setAttribute('role', 'tree');
  tree.setAttribute('aria-label', 'Hierarchy');
  tree.setAttribute('aria-multiselectable', 'true');
  tree.setAttribute('aria-describedby', HELP_ID);

  const help = doc.createElement('p');
  help.id = HELP_ID;
  help.className = 'visually-hidden';
  help.textContent = HELP_TEXT;

  const noMatches = doc.createElement('p');
  noMatches.className = 'hierarchy-empty';
  noMatches.textContent = 'No matches';
  noMatches.hidden = true;

  element.classList.add('hierarchy-panel');
  element.replaceChildren(toolbar, tree, help, noMatches);

  const collapsed = new Set();
  const searchCollapsed = new Set();
  const rowElements = new Map();
  let query = '';
  let rovingKey = null;
  let currentTree = hierarchyTree(model);
  let rows = [];
  let dirty = false;
  let frame = 0;
  let pendingReveal = null;
  let pendingQueryChange = false;
  let selfSelecting = false;
  let lastObjects = selection.objects;
  let menu = null;

  const searching = () => query.trim() !== '';
  const activeCollapsed = () => (searching() ? searchCollapsed : collapsed);
  const rowIndexOf = (key) => rows.findIndex((row) => row.item.key === key);

  function select(change) {
    selfSelecting = true;
    try {
      change();
    } finally {
      selfSelecting = false;
    }
  }

  function setRovingKey(key) {
    rovingKey = key;
    for (const [rowKey, li] of rowElements) li.tabIndex = rowKey === key ? 0 : -1;
  }

  function updateRow(li, row, selected) {
    const { item } = row;
    const signature = rowSignature(row);
    if (li.dataset.signature !== signature) {
      li.dataset.signature = signature;
      li.replaceChildren(...rowContent(doc, row));
    }
    li.style.setProperty('--level', String(row.level));
    li.setAttribute('aria-level', String(row.level));
    li.setAttribute('aria-posinset', String(row.posInSet));
    li.setAttribute('aria-setsize', String(row.setSize));
    li.setAttribute('aria-label', accessibleName(row));
    if (row.expandable) li.setAttribute('aria-expanded', String(row.expanded));
    else li.removeAttribute('aria-expanded');
    if (item.uid === null) li.removeAttribute('aria-selected');
    else li.setAttribute('aria-selected', String(selected.has(item.uid)));
    li.classList.toggle('is-dimmed', row.dimmed);
  }

  function render({ queryChanged = false } = {}) {
    const active = doc.activeElement;
    const focusedRow = active && active.parentElement === tree ? active : null;
    const focusedKey = focusedRow?.dataset.key ?? null;
    const focusedIndex = focusedKey === null ? -1 : rowIndexOf(focusedKey);
    const rovingIndex = rovingKey === null ? -1 : rowIndexOf(rovingKey);

    rows = hierarchyRows(currentTree, { collapsed: activeCollapsed(), query });
    const keys = new Set(rows.map((row) => row.item.key));
    for (const [key, li] of rowElements) {
      if (keys.has(key)) continue;
      li.remove();
      rowElements.delete(key);
    }

    const selected = new Set(selection.objects);
    rows.forEach((row, index) => {
      let li = rowElements.get(row.item.key);
      if (!li) {
        li = doc.createElement('li');
        li.className = 'hierarchy-row';
        li.setAttribute('role', 'treeitem');
        li.dataset.key = row.item.key;
        li.tabIndex = -1;
        rowElements.set(row.item.key, li);
      }
      updateRow(li, row, selected);
      const current = tree.children[index] ?? null;
      if (current !== li) tree.insertBefore(li, current);
    });

    const replacement = (index) => (rows.length === 0 ? null : rows[Math.min(Math.max(index, 0), rows.length - 1)].item.key);
    let nextRoving = rovingKey;
    if (nextRoving === null || !keys.has(nextRoving)) {
      nextRoving = queryChanged || rovingIndex < 0 ? replacement(0) : replacement(rovingIndex);
    }
    let focusKey = null;
    if (focusedKey !== null) {
      focusKey = keys.has(focusedKey) ? focusedKey : replacement(focusedIndex);
      if (!keys.has(focusedKey)) nextRoving = focusKey;
    }
    setRovingKey(nextRoving);
    noMatches.hidden = !(searching() && rows.length === 0);
    if (focusKey !== null) {
      const target = rowElements.get(focusKey);
      if (doc.activeElement !== target) target.focus();
    }
  }

  function flush() {
    if (frame !== 0) {
      view.cancelAnimationFrame(frame);
      frame = 0;
    }
    if (dirty) {
      currentTree = hierarchyTree(model);
      dirty = false;
    }
    const reveal = pendingReveal;
    pendingReveal = null;
    if (reveal) {
      for (const uid of reveal) {
        for (const key of ancestorKeys(currentTree, uid)) {
          collapsed.delete(key);
          searchCollapsed.delete(key);
        }
      }
    }
    const queryChanged = pendingQueryChange;
    pendingQueryChange = false;
    render({ queryChanged });
    if (!reveal) return;
    for (let index = reveal.length - 1; index >= 0; index--) {
      const li = rowElements.get(String(reveal[index]));
      if (!li) continue;
      setRovingKey(li.dataset.key);
      li.scrollIntoView({ block: 'nearest' });
      break;
    }
  }

  function schedule() {
    if (frame === 0) frame = view.requestAnimationFrame(flush);
  }

  function ensureFresh() {
    if (frame !== 0) flush();
  }

  function refreshButtons() {
    const addEnabled = actions.isEnabled('add-shape');
    addButton.setAttribute('aria-disabled', String(!addEnabled));
    if (!addEnabled) menu?.close();
    deleteButton.setAttribute('aria-disabled', String(!actions.isEnabled('delete')));
    addTooltip.update();
    deleteTooltip.update();
  }

  function setQuery(value) {
    if (value === query) return;
    query = value;
    searchCollapsed.clear();
    pendingQueryChange = true;
    flush();
  }

  function clearQuery() {
    search.value = '';
    setQuery('');
  }

  function toggleExpansion(index) {
    const row = rows[index];
    if (!row?.expandable) return;
    const set = activeCollapsed();
    if (row.expanded) {
      const rovingIndex = rowIndexOf(rovingKey);
      let end = index + 1;
      while (end < rows.length && rows[end].level > row.level) end++;
      if (rovingIndex > index && rovingIndex < end) setRovingKey(row.item.key);
      set.add(row.item.key);
    } else {
      set.delete(row.item.key);
    }
    flush();
  }

  function focusRow(index) {
    const li = rowElements.get(rows[index].item.key);
    setRovingKey(li.dataset.key);
    li.focus();
  }

  function selectByMove(row, event) {
    const { uid } = row.item;
    if (uid === null || event.ctrlKey || event.metaKey) return;
    select(() => (event.shiftKey ? selection.add([uid]) : selection.set([uid])));
  }

  const rowOf = (target) => {
    const li = target instanceof view.Element ? target.closest('li.hierarchy-row') : null;
    return li && li.parentElement === tree ? li : null;
  };

  const addTooltip = attachTooltip(
    addButton,
    () => actionTitle(ADD_ACTION, actions.isEnabled('add-shape'), actions.reason('add-shape')),
    { placement: 'below' },
  );
  const deleteTooltip = attachTooltip(
    deleteButton,
    () => actionTitle(DELETE_ACTION, actions.isEnabled('delete'), actions.reason('delete')),
    { placement: 'below' },
  );

  function toggleAddMenu(focus) {
    if (addButton.getAttribute('aria-disabled') === 'true') return;
    if (addButton.getAttribute('aria-expanded') === 'true') {
      menu?.close();
      return;
    }
    menu = openMenu(addButton, ADD_ITEMS, {
      focus,
      onSelect(item) {
        if (query !== '') clearQuery();
        actions.run(item.id);
        addButton.focus();
      },
    });
  }

  search.addEventListener('input', () => setQuery(search.value));
  search.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && search.value !== '') {
      event.preventDefault();
      clearQuery();
      return;
    }
    if (event.key === 'ArrowDown' && !event.altKey) {
      event.preventDefault();
      ensureFresh();
      if (rows.length > 0) focusRow(0);
    }
  });

  addButton.addEventListener('click', () => toggleAddMenu('first'));
  addButton.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    if (addButton.getAttribute('aria-expanded') !== 'true') toggleAddMenu(event.key === 'ArrowUp' ? 'last' : 'first');
  });
  deleteButton.addEventListener('click', () => {
    if (deleteButton.getAttribute('aria-disabled') !== 'true') actions.run('delete');
  });

  tree.addEventListener('mousedown', (event) => {
    if (event.target instanceof view.Element && event.target.closest('.hierarchy-arrow')) {
      const li = rowOf(event.target);
      if (li && li.hasAttribute('aria-expanded')) event.preventDefault();
    }
  });

  tree.addEventListener('click', (event) => {
    ensureFresh();
    const li = rowOf(event.target);
    if (!li) {
      if (event.target === tree) select(() => selection.clear());
      return;
    }
    const index = rowIndexOf(li.dataset.key);
    if (index < 0) return;
    const row = rows[index];
    if (row.expandable && event.target.closest('.hierarchy-arrow')) {
      toggleExpansion(index);
      return;
    }
    const { uid } = row.item;
    if (uid === null) return;
    if (event.ctrlKey || event.metaKey) select(() => selection.remove([uid]));
    else if (event.shiftKey) select(() => selection.toggle(uid));
    else select(() => selection.set([uid]));
  });

  tree.addEventListener('dblclick', (event) => {
    ensureFresh();
    const li = rowOf(event.target);
    if (!li || event.target.closest('.hierarchy-arrow')) return;
    const index = rowIndexOf(li.dataset.key);
    if (index < 0) return;
    const { uid } = rows[index].item;
    if (uid === null) {
      toggleExpansion(index);
      return;
    }
    select(() => selection.set([uid]));
    actions.run('frame-selection');
  });

  tree.addEventListener('focusin', (event) => {
    const li = rowOf(event.target);
    if (li && li.dataset.key !== rovingKey) setRovingKey(li.dataset.key);
  });

  tree.addEventListener('keydown', (event) => {
    const li = rowOf(event.target);
    if (!li || event.altKey) return;
    ensureFresh();
    const index = rowIndexOf(li.dataset.key);
    if (index < 0) return;
    if (event.key === ' ') {
      event.preventDefault();
      const { uid } = rows[index].item;
      if (uid !== null) select(() => selection.toggle(uid));
      return;
    }
    const move = treeKey(rows, index, event.key);
    if (move === null) return;
    event.preventDefault();
    if (move.kind === 'expand' || move.kind === 'collapse') {
      toggleExpansion(move.index);
      return;
    }
    if (move.index === index) return;
    focusRow(move.index);
    selectByMove(rows[move.index], event);
  });

  const onChange = () => {
    dirty = true;
    refreshButtons();
    schedule();
  };
  const onReset = () => {
    collapsed.clear();
    searchCollapsed.clear();
    onChange();
  };
  const onSelection = (state) => {
    const previous = new Set(lastObjects);
    lastObjects = state.objects;
    if (!selfSelecting) {
      const added = state.objects.filter((uid) => !previous.has(uid));
      if (added.length > 0) pendingReveal = [...(pendingReveal ?? []), ...added];
    }
    refreshButtons();
    schedule();
  };

  const unsubscribe = [
    model.on('change', onChange),
    model.on('reset', onReset),
    selection.on('selection', onSelection),
    history.on('history', refreshButtons),
    modes.on('mode', refreshButtons),
  ];

  render();
  refreshButtons();

  return {
    destroy() {
      for (const off of unsubscribe) off();
      if (frame !== 0) view.cancelAnimationFrame(frame);
      frame = 0;
      menu?.close();
      addTooltip.detach();
      deleteTooltip.detach();
      element.classList.remove('hierarchy-panel');
      element.replaceChildren();
    },
  };
}
