// ============================================================
// HUD DRAW — the shared look of every HUD.
//
// HUD widgets draw on a 2D canvas (common/visor-hud.js hands each one a
// context). These are the pieces they draw with, so a health bar in one
// game and a mana bar in another look like they belong to the same
// visor, and nobody invents a new style for each game.
//
// The bar to aim for is a car dashboard: read at a glance, with your eyes
// only, while you look at the road. So:
//
//   - icons over words (a bullet and a number, not "AMMO: 6")
//   - everything outlined in near-black, since you never know what it
//     will be in front of — sky, sand, a white wall
//   - B612 for anything you read (it was made for cockpits: unmistakable
//     I l 1 and O 0, every figure the same width so counters do not
//     jitter); Wright Sans only for headings and big moments
//   - colour means something: accent for normal, amber for low, red for
//     danger, green for good — never decoration
//
// Coordinates are the widget's own logical units (see visor-hud.js: the
// canvas is always 100 units tall), so nothing here knows about pixels.
// ============================================================

import { ICONS } from './hud-icons.js';

export var HUD_COLORS = {
  text: '#eef6ff',
  accent: '#7fe3ff',
  good: '#6ee7a0',
  warn: '#ffc24a',
  danger: '#ff5c5c',
  muted: 'rgba(214, 230, 255, 0.38)',
  track: 'rgba(8, 14, 24, 0.55)',
  outline: 'rgba(3, 6, 12, 0.85)',
  panel: 'rgba(6, 11, 20, 0.42)',
};

export var HUD_FACES = {
  body: '"B612", system-ui, sans-serif',
  heading: '"Wright Sans", "B612", system-ui, sans-serif',
};

// A canvas font string. weight 700 unless asked; 'heading' for Wright Sans.
export function hudFont(size, options) {
  options = options || {};
  var face = options.face === 'heading' ? HUD_FACES.heading : HUD_FACES.body;
  return (options.weight || 700) + ' ' + size + 'px ' + face;
}

export function roundRect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// A soft dark backing, for the odd widget that needs one (a minimap).
export function drawPanel(ctx, x, y, w, h, options) {
  options = options || {};
  roundRect(ctx, x, y, w, h, options.radius == null ? 8 : options.radius);
  ctx.fillStyle = options.fill || HUD_COLORS.panel;
  ctx.fill();
  if (options.stroke) {
    ctx.lineWidth = options.lineWidth || 1.5;
    ctx.strokeStyle = options.stroke;
    ctx.stroke();
  }
}

var iconPaths = {};
function iconPath(name) {
  if (!iconPaths[name]) {
    var icon = ICONS[name];
    if (!icon || typeof Path2D === 'undefined') return null;
    iconPaths[name] = new Path2D(icon.d);
  }
  return iconPaths[name];
}

// An icon from common/hud-icons.js, centred on x, y, `size` units across,
// filled with `color` over a dark outline.
export function drawIcon(ctx, name, x, y, size, options) {
  options = options || {};
  var path = iconPath(name);
  if (!path) return;
  ctx.save();
  ctx.translate(x - size / 2, y - size / 2);
  ctx.scale(size / 512, size / 512);
  if (options.outline !== false) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = options.outlineWidth || 56;
    ctx.strokeStyle = HUD_COLORS.outline;
    ctx.stroke(path);
  }
  ctx.fillStyle = options.color || HUD_COLORS.text;
  ctx.fill(path);
  ctx.restore();
}

// Text with a dark outline. Returns its width.
export function drawText(ctx, text, x, y, options) {
  options = options || {};
  var size = options.size || 28;
  ctx.font = hudFont(size, options);
  ctx.textAlign = options.align || 'left';
  ctx.textBaseline = options.baseline || 'middle';
  if (options.outline !== false) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(2, size * 0.2);
    ctx.strokeStyle = HUD_COLORS.outline;
    ctx.strokeText(text, x, y);
  }
  ctx.fillStyle = options.color || HUD_COLORS.text;
  ctx.fillText(text, x, y);
  return ctx.measureText(text).width;
}

// A bar, left to right (or right to left with `reverse`), optionally
// split into segments and skewed like a visor readout. `value` is 0..1.
// `ghost` (0..1, >= value) shows what was just lost, in a pale trail,
// so a hit reads as "that much" rather than as a number changing.
export function drawBar(ctx, x, y, w, h, value, options) {
  options = options || {};
  var segments = options.segments || 1;
  var gap = segments > 1 ? (options.gap == null ? h * 0.25 : options.gap) : 0;
  var skew = options.skew || 0;
  var segW = (w - gap * (segments - 1)) / segments;
  var color = options.color || HUD_COLORS.accent;
  var ghost = options.ghost == null ? value : Math.max(value, options.ghost);
  for (var i = 0; i < segments; i++) {
    var index = options.reverse ? segments - 1 - i : i;
    var sx = x + index * (segW + gap);
    var lo = i / segments;
    var hi = (i + 1) / segments;
    var fill = Math.max(0, Math.min(1, (value - lo) / (hi - lo)));
    var trail = Math.max(0, Math.min(1, (ghost - lo) / (hi - lo)));
    parallelogram(ctx, sx, y, segW, h, skew);
    ctx.fillStyle = HUD_COLORS.track;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = HUD_COLORS.outline;
    ctx.stroke();
    if (trail > fill) {
      ctx.save();
      parallelogram(ctx, sx, y, segW, h, skew);
      ctx.clip();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
      var tx = options.reverse ? sx + segW * (1 - trail) : sx + segW * fill;
      ctx.fillRect(tx - Math.abs(skew), y, segW * (trail - fill) + Math.abs(skew), h);
      ctx.restore();
    }
    if (fill > 0) {
      ctx.save();
      parallelogram(ctx, sx, y, segW, h, skew);
      ctx.clip();
      ctx.fillStyle = color;
      var fx = options.reverse ? sx + segW * (1 - fill) : sx;
      ctx.fillRect(fx - Math.abs(skew), y, segW * fill + Math.abs(skew) * 2, h);
      ctx.restore();
    }
  }
}

function parallelogram(ctx, x, y, w, h, skew) {
  ctx.beginPath();
  ctx.moveTo(x + skew, y);
  ctx.lineTo(x + w + skew, y);
  ctx.lineTo(x + w - skew, y + h);
  ctx.lineTo(x - skew, y + h);
  ctx.closePath();
}

// One round of ammunition, standing up, `h` tall, centred on x.
export function drawRound(ctx, x, y, h, color) {
  var w = h * 0.34;
  ctx.beginPath();
  ctx.moveTo(x - w / 2, y + h / 2);
  ctx.lineTo(x - w / 2, y - h * 0.08);
  ctx.quadraticCurveTo(x - w / 2, y - h / 2, x, y - h / 2);
  ctx.quadraticCurveTo(x + w / 2, y - h / 2, x + w / 2, y - h * 0.08);
  ctx.lineTo(x + w / 2, y + h / 2);
  ctx.closePath();
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(2, h * 0.09);
  ctx.strokeStyle = HUD_COLORS.outline;
  ctx.stroke();
  ctx.fillStyle = color || HUD_COLORS.text;
  ctx.fill();
  // The case line.
  ctx.fillStyle = HUD_COLORS.outline;
  ctx.fillRect(x - w / 2, y + h * 0.04, w, Math.max(1, h * 0.05));
}

// Ammunition the way a revolver shows it: one round per shot while there
// are few enough to count (`pipsAt`, default 6, so a six-shooter always
// shows its cylinder), a round and a number when there are more. Spent
// rounds of a counted load show as dim outlines. Draws inside x, y, w, h;
// `align` 'left' or 'right' says which edge to hug.
export function drawAmmo(ctx, x, y, w, h, count, capacity, options) {
  options = options || {};
  var pipsAt = options.pipsAt || 6;
  var color = count === 0 ? HUD_COLORS.danger : (count <= Math.ceil(capacity / 4) ? HUD_COLORS.warn : HUD_COLORS.text);
  var right = options.align === 'right';
  if (capacity <= pipsAt) {
    var roundH = Math.min(h, w / (capacity * 0.5));
    var step = roundH * 0.5;
    for (var i = 0; i < capacity; i++) {
      var k = right ? capacity - 1 - i : i;
      var cx = right ? x + w - step / 2 - k * step : x + step / 2 + k * step;
      var live = right ? i >= capacity - count : i < count;
      drawRound(ctx, cx, y + h / 2, roundH * 0.9, live ? color : 'rgba(214, 230, 255, 0.16)');
    }
    return;
  }
  var size = h * 0.8;
  var iconX = right ? x + w - size * 0.25 : x + size * 0.25;
  drawRound(ctx, iconX, y + h / 2, size, color);
  drawText(ctx, String(count), right ? iconX - size * 0.4 : iconX + size * 0.4, y + h / 2, {
    size: h * 0.62, align: right ? 'right' : 'left', color: color,
  });
}

// A key cap and what it does: [X] Pick up. Centred on x, y. Returns the
// total width drawn.
export function drawKeyHint(ctx, key, label, x, y, size) {
  size = size || 30;
  ctx.font = hudFont(size * 0.62);
  var capText = String(key || '');
  var capW = capText ? Math.max(size, ctx.measureText(capText).width + size * 0.5) : 0;
  ctx.font = hudFont(size * 0.78);
  var labelW = label ? ctx.measureText(label).width : 0;
  var gap = capText && label ? size * 0.35 : 0;
  var total = capW + gap + labelW;
  var left = x - total / 2;
  // A soft pill behind the lot, so a hint over a bright sky still reads.
  roundRect(ctx, left - size * 0.35, y - size * 0.62, total + size * 0.7, size * 1.24, size * 0.3);
  ctx.fillStyle = 'rgba(4, 8, 14, 0.5)';
  ctx.fill();
  if (capText) {
    roundRect(ctx, left, y - size / 2, capW, size, size * 0.18);
    ctx.fillStyle = '#f4f8ff';
    ctx.fill();
    ctx.fillStyle = '#0d1420';
    ctx.font = hudFont(size * 0.62);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(capText, left + capW / 2, y + size * 0.03);
  }
  if (label) drawText(ctx, label, left + capW + gap, y, { size: size * 0.78, align: 'left' });
  return total;
}

// A strip compass, like the top of a flight display: `heading` in
// degrees (0 north, 90 east), `span` degrees across the strip. Marks are
// { bearing, icon?, color? } for things worth finding.
export function drawCompassTape(ctx, w, h, heading, options) {
  options = options || {};
  var span = options.span || 120;
  var cx = w / 2;
  var scale = w / span;
  var labels = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
  ctx.save();
  // Fade out toward both ends, so the strip has no hard edges.
  var gradient = ctx.createLinearGradient(0, 0, w, 0);
  gradient.addColorStop(0, 'rgba(0,0,0,0)');
  gradient.addColorStop(0.18, 'rgba(0,0,0,1)');
  gradient.addColorStop(0.82, 'rgba(0,0,0,1)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  for (var b = Math.floor((heading - span / 2) / 15) * 15; b <= heading + span / 2; b += 15) {
    var x = cx + wrap180(b - heading) * scale;
    var bearing = ((b % 360) + 360) % 360;
    var major = labels[bearing] != null;
    ctx.fillStyle = HUD_COLORS.outline;
    ctx.fillRect(x - 2, h * 0.62, 4, major ? h * 0.3 : h * 0.18);
    ctx.fillStyle = HUD_COLORS.text;
    ctx.fillRect(x - 1, h * 0.62, 2, major ? h * 0.3 : h * 0.18);
    if (major) {
      drawText(ctx, labels[bearing], x, h * 0.36, {
        size: bearing % 90 === 0 ? h * 0.38 : h * 0.28,
        align: 'center', color: bearing === 0 ? HUD_COLORS.warn : HUD_COLORS.text,
      });
    }
  }
  (options.marks || []).forEach(function (mark) {
    var offset = wrap180(mark.bearing - heading);
    var clamped = Math.max(-span / 2, Math.min(span / 2, offset));
    var mx = cx + clamped * scale;
    if (mark.icon) drawIcon(ctx, mark.icon, mx, h * 0.36, h * 0.42, { color: mark.color || HUD_COLORS.accent });
  });
  // Where you are facing.
  ctx.beginPath();
  ctx.moveTo(cx - h * 0.12, h);
  ctx.lineTo(cx + h * 0.12, h);
  ctx.lineTo(cx, h * 0.8);
  ctx.closePath();
  ctx.fillStyle = HUD_COLORS.accent;
  ctx.fill();
  ctx.globalCompositeOperation = 'destination-in';
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

function wrap180(deg) {
  var d = ((deg + 180) % 360 + 360) % 360 - 180;
  return d;
}

// A round gauge (speed, revs): an arc that fills from 7 o'clock round to
// 5 o'clock, with the value in the middle.
export function drawDial(ctx, cx, cy, r, value, max, options) {
  options = options || {};
  var start = Math.PI * 0.75;
  var sweep = Math.PI * 1.5;
  var t = Math.max(0, Math.min(1, value / max));
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(cx, cy, r, start, start + sweep);
  ctx.lineWidth = r * 0.22;
  ctx.strokeStyle = HUD_COLORS.outline;
  ctx.stroke();
  ctx.lineWidth = r * 0.14;
  ctx.strokeStyle = HUD_COLORS.track;
  ctx.stroke();
  if (t > 0) {
    ctx.beginPath();
    ctx.arc(cx, cy, r, start, start + sweep * t);
    ctx.strokeStyle = options.color || (t > 0.85 ? HUD_COLORS.warn : HUD_COLORS.accent);
    ctx.stroke();
  }
  ctx.lineCap = 'butt';
  drawText(ctx, options.text != null ? options.text : String(Math.round(value)), cx, cy - r * 0.05, { size: r * 0.62, align: 'center' });
  if (options.unit) drawText(ctx, options.unit, cx, cy + r * 0.5, { size: r * 0.26, align: 'center', color: HUD_COLORS.muted });
}

// A row of icons standing for a count: hearts for health. Partial values
// show the last icon partly filled. Draws inside x, y, w, h.
export function drawIconMeter(ctx, icon, x, y, w, h, value, max, options) {
  options = options || {};
  var size = Math.min(h, w / max);
  var right = options.align === 'right';
  for (var i = 0; i < max; i++) {
    var k = right ? max - 1 - i : i;
    var cx = right ? x + w - size / 2 - k * size : x + size / 2 + k * size;
    var cy = y + h / 2;
    var fill = Math.max(0, Math.min(1, value - i));
    drawIcon(ctx, icon, cx, cy, size * 0.86, { color: 'rgba(214, 230, 255, 0.16)' });
    if (fill <= 0) continue;
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx - size / 2, cy - size / 2, size * fill, size);
    ctx.clip();
    drawIcon(ctx, icon, cx, cy, size * 0.86, { color: options.color || HUD_COLORS.danger, outline: false });
    ctx.restore();
  }
}
