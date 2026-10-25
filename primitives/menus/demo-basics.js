// ============================================================
// BASICS — the menu system itself, every kind of row doing something real.
//
// The tour menu becomes a list where each row is one kind of row: an
// action, a toggle, a choice, a number that previews as you scroll, a
// submenu, a row whose text is in the sidecar, a label too long for its
// row. They change the sky and the stars around you. Behind you, a lamp
// on a side table opens its own menu when you grab it — the same menu
// system, on a thing in the room.
// ============================================================

import { registerMenuPage } from '../../common/menu-crossbar.js';
import { drawText } from '../../common/hud-draw.js';

var SKIES = { night: '#0d1526', dusk: '#3b2a4a', day: '#7aa6d6', ember: '#2a1a12' };

var state = { sky: 'night', stars: true, sun: 0.7, lampOn: true, lampColor: '#ffd59a', lampBrightness: 1.2 };

registerMenuPage('lamp', {
  title: 'LAMP',
  items: [
    { kind: 'toggle', id: 'lamp-power', label: 'Power', value: true },
    { kind: 'number', id: 'lamp-brightness', label: 'Brightness', value: 1.2, min: 0, max: 3, step: 0.1, format: function (v) { return Math.round(v / 3 * 100) + '%'; } },
    {
      kind: 'select', id: 'lamp-color', label: 'Colour', value: '#ffd59a',
      options: [
        { value: '#ffd59a', label: 'Warm' }, { value: '#eaf4ff', label: 'Cool' },
        { value: '#ff6a5c', label: 'Red' }, { value: '#7fe3ff', label: 'Cyan' }, { value: '#9dffb0', label: 'Green' },
      ],
    },
    { kind: 'info', id: 'lamp-about', label: 'About this menu', info: ['A MENU ON A THING', 'Grab the lamp to open', 'its menu; grab again to', 'close it. Scrolling a', 'choice previews it.'] },
  ],
});

function applyRoom() {
  document.querySelector('#showcase-sky').setAttribute('color', SKIES[state.sky]);
  document.querySelector('#sun-light').setAttribute('light', 'intensity', state.sun);
  document.querySelector('#basics-stars').object3D.visible = state.stars;
  var bulb = document.querySelector('#basics-bulb');
  bulb.setAttribute('material', 'emissive', state.lampOn ? state.lampColor : '#000000');
  bulb.setAttribute('material', 'color', state.lampOn ? state.lampColor : '#555555');
  document.querySelector('#basics-lamp-light').setAttribute('light', { color: state.lampColor, intensity: state.lampOn ? state.lampBrightness : 0 });
}

function onRow(evt) {
  var id = evt.detail.id;
  var v = evt.detail.value;
  if (id === 'basics-sky') state.sky = v;
  else if (id === 'basics-stars') state.stars = v;
  else if (id === 'basics-sun') state.sun = v;
  else if (id === 'lamp-power') state.lampOn = v;
  else if (id === 'lamp-brightness') state.lampBrightness = v;
  else if (id === 'lamp-color') state.lampColor = v;
  else return;
  applyRoom();
}

var widgets = {};

export default {
  id: 'basics',
  label: 'Basics',
  title: 'BASICS',
  blurb: ['BASICS', 'Every kind of row in the', 'menu system, each one', 'doing something: the', 'sky, the stars, the sun.', '', 'Behind you, a lamp with', 'a menu of its own.'],

  rows: function () {
    return [
      { kind: 'info', id: 'basics-start', label: 'Start here', info: ['HOW THESE MENUS WORK', 'Up and down to move.', 'In (right) to open a', 'row; out (left) to back', 'out and keep a value.', 'Point and click works', 'too, everywhere.'] },
      { kind: 'select', id: 'basics-sky', label: 'Sky', value: state.sky, options: [{ value: 'night', label: 'Night' }, { value: 'dusk', label: 'Dusk' }, { value: 'day', label: 'Day' }, { value: 'ember', label: 'Ember' }], info: ['A CHOICE', 'Opens into its options.', 'Scrolling previews each', 'one; backing out keeps', 'it.'] },
      { kind: 'toggle', id: 'basics-stars', label: 'Stars', value: state.stars, info: ['A TOGGLE', 'Flips in place: no', 'submenu for on and off.'] },
      { kind: 'number', id: 'basics-sun', label: 'Sunlight', value: state.sun, min: 0, max: 1.5, step: 0.1, format: function (v) { return Math.round(v / 1.5 * 100) + '%'; }, info: ['A NUMBER', 'Scrolls like a list that', 'never ends, and changes', 'the light as you go.'] },
      { kind: 'action', id: 'basics-wink', label: 'Blink the lamp', info: ['AN ACTION', 'Does one thing. Every', 'confirm flashes, so you', 'know it landed even when', 'the effect is behind you.'] },
      {
        kind: 'submenu', id: 'basics-deeper', label: 'Go deeper',
        info: ['A SUBMENU', 'Its title flies up into', 'the breadcrumbs as you', 'go in, and back down', 'as you come out.'],
        items: [
          { kind: 'info', id: 'basics-deeper-1', label: 'One level in', info: ['ONE LEVEL IN', 'Back out with left, or', 'tap the title.'] },
          {
            kind: 'submenu', id: 'basics-deeper-2', label: 'And another',
            items: [{ kind: 'info', id: 'basics-deeper-3', label: 'The bottom', info: ['THE BOTTOM', 'Three levels down. The', 'rail above shows the', 'way back up.'] }],
          },
        ],
      },
      { kind: 'info', id: 'basics-long', label: 'A label far too long to fit on its row scrolls when selected', info: ['LONG LABELS', 'Cut with ... when not', 'selected; selected, they', 'scroll to the end and', 'back.'] },
      { kind: 'info', id: 'basics-watch', label: 'The watch', info: ['THE WATCH', 'Raise your wrist (Tab',  'off a headset) for the', 'settings you reach for', 'mid-play.'] },
      { kind: 'info', id: 'basics-visor', label: 'The visor', info: ['THE VISOR', 'Hold a hand beside your', 'head (` off a headset).', 'It holds the frame the', 'HUD sits in: Visor ›', 'Adjust.'] },
    ];
  },

  onAction: function (id) {
    if (id !== 'basics-wink') return;
    var was = state.lampOn;
    var steps = 0;
    var timer = setInterval(function () {
      state.lampOn = !state.lampOn;
      applyRoom();
      if (++steps >= 6) { clearInterval(timer); state.lampOn = was; applyRoom(); }
    }, 140);
  },

  enter: function () {
    document.addEventListener('menu-commit', onRow);
    document.addEventListener('menu-preview', onRow);
    applyRoom();
  },

  exit: function () {
    document.removeEventListener('menu-commit', onRow);
    document.removeEventListener('menu-preview', onRow);
    var pm = document.querySelector('#basics-lamp').components['projected-menu'];
    if (pm) pm.close();
    // The room back as it was for the other demos.
    document.querySelector('#showcase-sky').setAttribute('color', SKIES.night);
    document.querySelector('#sun-light').setAttribute('light', 'intensity', 0.7);
    document.querySelector('#basics-stars').object3D.visible = true;
  },

  hud: function (display) {
    widgets = {
      place: display.add('top', {
        id: 'basics-place', state: { name: 'Menus 101' },
        draw: function (ctx, box) { drawText(ctx, box.state.name, box.w / 2, 52, { size: 54, align: 'center', face: 'heading', weight: 900, maxWidth: box.w - 12 }); },
      }),
    };
  },

  tick: function () {},
};
