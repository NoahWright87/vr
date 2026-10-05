// Small hex-colour helpers, kept DOM-free and AFRAME-free so they can be
// unit tested under plain `node --test` alongside the rest of common/.
//
// These exist because "the floor is a checkerboard in a lighter shade of
// that room's own wall colour" is a rule, not six hand-picked pairs --
// see games/rainbow-hotel. Deriving the pair from one colour is what
// makes adding a seventh room a one-line change.

function clampByte (value) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

// Accepts '#rgb', '#rrggbb', or the same without the leading '#'.
// Returns null rather than throwing for anything else, so a bad value in
// a component schema degrades to "leave the material alone" instead of
// taking the whole scene down during init().
export function hexToRgb (hex) {
  var text = String(hex || '').trim().replace(/^#/, '');
  if (text.length === 3) text = text[0] + text[0] + text[1] + text[1] + text[2] + text[2];
  if (!/^[0-9a-fA-F]{6}$/.test(text)) return null;
  return {
    r: parseInt(text.slice(0, 2), 16),
    g: parseInt(text.slice(2, 4), 16),
    b: parseInt(text.slice(4, 6), 16),
  };
}

export function rgbToHex (rgb) {
  if (!rgb) return null;
  var parts = [rgb.r, rgb.g, rgb.b].map(function (channel) {
    var text = clampByte(channel).toString(16);
    return text.length === 1 ? '0' + text : text;
  });
  return '#' + parts.join('');
}

// Linear RGB-space blend. Deliberately not perceptual: these colours are
// flat-shaded UI-ish surfaces, and a straight lerp keeps "lighter shade
// of the same wall colour" obviously the same hue, which is the whole
// point of the room/floor pairing.
export function mixColors (from, to, amount) {
  var a = hexToRgb(from);
  var b = hexToRgb(to);
  if (!a || !b) return null;
  var t = Math.max(0, Math.min(1, Number(amount) || 0));
  return rgbToHex({
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  });
}

export function lighten (hex, amount) {
  return mixColors(hex, '#ffffff', amount);
}

export function darken (hex, amount) {
  return mixColors(hex, '#000000', amount);
}
