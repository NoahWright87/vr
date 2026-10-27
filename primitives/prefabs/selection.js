// What the workshop has picked to edit: the model's fit, one hand
// placement, an emitter or an attachment socket. All four are a place and
// a turn in the prefab frame, which is what the gizmo moves.

export const select = {
  fit: () => ({ kind: 'fit' }),
  occupant: (i, j, left = false) => ({ kind: 'occupant', i, j, left }),
  emitter: i => ({ kind: 'emitter', i }),
  socket: i => ({ kind: 'socket', i }),
};

export const sameSelection = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// The { pos, rot } inside `entry` that this selection edits, or null if
// the thing it names is gone.
export function placementOf(entry, selection) {
  if (!entry || !selection) return null;
  switch (selection.kind) {
    case 'fit': return entry.fit;
    case 'occupant': {
      const occupant = entry.interactions[selection.i]?.occupants[selection.j];
      return selection.left ? occupant?.left ?? null : occupant ?? null;
    }
    case 'emitter': return entry.emitters[selection.i] ?? null;
    case 'socket': return entry.attachments[selection.i] ?? null;
    default: return null;
  }
}

export function describeSelection(entry, selection) {
  if (!placementOf(entry, selection)) return '';
  switch (selection.kind) {
    case 'fit': return 'model fit';
    case 'occupant': return `${entry.interactions[selection.i].id} · hand ${selection.j + 1}${selection.left ? ' (left)' : ''}`;
    case 'emitter': return `emitter ${entry.emitters[selection.i].id}`;
    default: return `socket ${entry.attachments[selection.i].id}`;
  }
}
