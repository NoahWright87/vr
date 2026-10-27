// Small DOM helpers for the workshop's panels: building elements, and
// number fields that stay in step with the store.

export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on')) el.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key in el && key !== 'list') el[key] = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  const add = child => {
    if (child == null || child === false) return;
    if (Array.isArray(child)) child.forEach(add);
    else el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  };
  children.forEach(add);
  return el;
}

const round = (n, places) => Math.round(n * 10 ** places) / 10 ** places;
const show = (n, places) => String(round(n, places));

// A panel's fields: each remembers how to read its value back, so that
// `sync()` can bring them all up to date after the store changes under
// them (a gizmo drag) without rebuilding the panel.
export function createFields() {
  const syncers = [];
  const track = fn => { syncers.push(fn); fn(); };

  // A number input. `get`/`set` read and write the store.
  // With `nullable`, an empty box means "none": get may return null, and set is given null.
  function number({ get, set, step = 0.01, min, max, places = 3, title, nullable = false, placeholder }) {
    const input = h('input', { type: 'number', step, min, max, title, placeholder, class: 'num' });
    input.addEventListener('input', () => {
      const value = parseFloat(input.value);
      if (nullable && input.value === '') { set(null); return; }
      if (!Number.isFinite(value)) return;
      set(min != null && max != null ? Math.min(max, Math.max(min, value)) : value);
    });
    input.addEventListener('wheel', event => event.preventDefault(), { passive: false });
    track(() => {
      if (document.activeElement === input) return;
      const value = get();
      input.value = value === null ? '' : show(value, places);
    });
    return input;
  }

  // A slider with its number beside it.
  function slider({ get, set, min, max, step, places = 2, title }) {
    const range = h('input', { type: 'range', min, max, step, title, class: 'slide' });
    const box = number({ get, set, step, min, max, places, title });
    range.addEventListener('input', () => set(parseFloat(range.value)));
    track(() => { range.value = get(); });
    return h('span', { class: 'slider' }, range, box);
  }

  // x y z: three numbers for a position or a rotation.
  function vec3({ get, set, step, places, title }) {
    const parts = [0, 1, 2].map(axis => number({
      get: () => get()[axis], set: value => set(axis, value), step, places, title: `${title} ${'xyz'[axis]}`,
    }));
    parts.forEach((part, axis) => part.classList.add(`axis-${'xyz'[axis]}`));
    return h('span', { class: 'vec3' }, parts);
  }

  function text({ get, set, placeholder, list, title }) {
    const input = h('input', { type: 'text', placeholder, list, title, class: 'txt', spellcheck: false });
    input.addEventListener('input', () => set(input.value));
    track(() => { if (document.activeElement !== input) input.value = get(); });
    return input;
  }

  function select({ get, set, options, title }) {
    const el = h('select', { title }, options.map(o => h('option', { value: o.value }, o.label ?? o.value)));
    el.addEventListener('change', () => set(el.value));
    track(() => { el.value = get(); });
    return el;
  }

  function check({ get, set, label, title }) {
    const input = h('input', { type: 'checkbox', title });
    input.addEventListener('change', () => set(input.checked));
    track(() => { input.checked = Boolean(get()); });
    return h('label', { class: 'check' }, input, label);
  }

  return { number, slider, vec3, text, select, check, sync: () => syncers.forEach(fn => fn()) };
}

// Copy text to the clipboard; resolves to whether it worked.
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch { /* fall through to the older way */ }
  const area = h('textarea', { value: text, style: 'position:fixed;opacity:0' });
  document.body.append(area);
  area.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  area.remove();
  return ok;
}
