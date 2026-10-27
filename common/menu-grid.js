// ============================================================
// GRID MENU — the picture-led surface of the shared menu system.
//
// A crossbar is the right shape for a list you scroll past: settings, a
// pause menu, a watch. It is the wrong shape for browsing — a shop, an
// armory, a wardrobe, a toybox of two hundred models — where what you
// want is to SEE many things at once, a picture of each, and room beside
// them to read about the one you are on. That is this:
//
//   +--------------------------------------------+--------------------+
//   | TITLE                       Gold 120  ⊙  X |  [ preview slot ]  |
//   | Shop › Guns              7 / 24            |  NAME              |
//   | [tile] [tile] [tile] [tile]              ▮ |  subtitle          |
//   | [tile] [tile] [tile] [tile]              ▯ |  Damage ▬▬▬▬▭  34  |
//   | [tile] [tile] [tile] [tile]              ▯ |  flavour text ...  |
//   |  W/S/A/D move  Enter pick  Q back  E exit  |  25 Gold   ENTER Buy|
//   +--------------------------------------------+--------------------+
//
// It draws the same menu model (common/menu-model.js) as the crossbar,
// from the same page data, so a page can be a grid on the shop counter
// and still a list on your watch. Levels that ask for `layout: 'grid'`
// are drawn as tiles; any other level (a submenu of settings, a select)
// is drawn as a single column of wide tiles in the same frame, so going
// in and out never swaps one panel for another.
//
// Everything about input is shared too. It registers with the
// menu-stick-control system (menu-crossbar.js) like a crossbar does, so
// reaching for it with a hand, entering it with E, pointing at it with
// the finger laser or the mouse, and projecting it from a trigger with
// projected-menu + projected-crossbar all work unchanged. The one new
// verb is sideways: on a grid, left and right move a column (with
// repeat), and left off the first column is back, as it is everywhere.
//
// Built once, like the crossbar: navigation only changes text, opacity,
// textures and positions on entities that already exist.
// ============================================================

import { createMenu, truncateLabel, marqueeText } from './menu-model.js';
import { getMenuPage, resolveMenuFont, createHoldRing, createPointerConfirm } from './menu-crossbar.js';

if (typeof AFRAME !== 'undefined') {
  var THREE = AFRAME.THREE;

  var TILE_REST = 0.08;
  var TILE_FOCUS = 0.3;
  var FLASH_MS = 240;
  var FLASH_HOLD = 0.35;
  var FLASH_OPACITY = 0.85;
  // The focused tile stands a little proud of the rest: in a headset a
  // change of size reads from the corner of your eye, where a change of
  // colour on a small tile does not.
  var FOCUS_SCALE = 1.07;
  var LIVE_MS = 250;
  var MAX_CURRENCIES = 3;
  // Breadcrumb segments shown; deeper paths show their last few.
  var MAX_CRUMBS = 4;
  // How much each level above the one you are in fades, as on the
  // crossbar: the level you are in at full, its parent at 70%, on up to
  // the title.
  var LEVEL_FADE = [1, 0.7, 0.49, 0.34, 0.24];

  // ---------- thumbnails ----------
  //
  // Raw three.js rather than a-image, for two reasons. An atlas cell is
  // a UV rectangle, and A-Frame's material component shares one texture
  // between every entity with the same src — so per-entity repeat/offset
  // would fight. And this way one texture per atlas is uploaded once and
  // every tile that shows a cell of it shares it.
  var TEXTURES = new Map();
  var CANVAS_TEXTURES = new WeakMap();

  function normaliseThumbnail(spec) {
    if (!spec) return null;
    if (typeof spec === 'string') return { src: spec, rect: null };
    if (typeof spec.getContext === 'function') return { canvas: spec, rect: null };
    if (spec.src || spec.canvas) return { src: spec.src, canvas: spec.canvas, rect: spec.rect || null };
    return null;
  }

  function textureFor(spec) {
    var texture;
    if (spec.canvas) {
      texture = CANVAS_TEXTURES.get(spec.canvas);
      if (!texture) {
        texture = new THREE.CanvasTexture(spec.canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        CANVAS_TEXTURES.set(spec.canvas, texture);
      }
      return texture;
    }
    texture = TEXTURES.get(spec.src);
    if (!texture) {
      texture = new THREE.TextureLoader().load(spec.src);
      texture.colorSpace = THREE.SRGBColorSpace;
      TEXTURES.set(spec.src, texture);
    }
    return texture;
  }

  function makeThumbnail(size) {
    var mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false })
    );
    mesh.visible = false;
    mesh.userData.thumbKey = '';
    return mesh;
  }

  function setThumbnail(mesh, raw) {
    var spec = normaliseThumbnail(raw);
    if (!spec) {
      mesh.visible = false;
      return false;
    }
    mesh.visible = true;
    var key = (spec.src || '') + '|' + (spec.rect ? spec.rect.join(',') : '');
    if (spec.canvas) key = spec.canvas;
    if (mesh.userData.thumbKey === key) return true;
    mesh.userData.thumbKey = key;
    mesh.material.map = textureFor(spec);
    mesh.material.needsUpdate = true;
    var r = spec.rect || [0, 0, 1, 1];
    var uv = mesh.geometry.attributes.uv;
    // PlaneGeometry's corners: top-left, top-right, bottom-left,
    // bottom-right.
    uv.setXY(0, r[0], r[1] + r[3]);
    uv.setXY(1, r[0] + r[2], r[1] + r[3]);
    uv.setXY(2, r[0], r[1]);
    uv.setXY(3, r[0] + r[2], r[1]);
    uv.needsUpdate = true;
    return true;
  }

  // ---------- text ----------

  // Only touch a label when what it shows actually changes: a-text
  // re-lays-out its whole string on any update.
  function setText(el, props) {
    var cache = el._textCache || (el._textCache = {});
    var change = null;
    for (var key in props) {
      if (cache[key] === props[key]) continue;
      cache[key] = props[key];
      (change = change || {})[key] = props[key];
    }
    if (change) el.setAttribute('text', change);
  }

  // Straight at the mesh, like the crossbar's plates: the flash writes
  // this every frame, and the material component drops a setAttribute
  // back to a value it already believes is current.
  function setPlate(el, opacity, color) {
    var mesh = el.getObject3D('mesh');
    if (!mesh || !mesh.material) {
      el.setAttribute('material', color ? { opacity: opacity, color: color } : { opacity: opacity });
      return;
    }
    mesh.material.opacity = opacity;
    if (color) mesh.material.color.set(color);
  }

  // How tall a label came out, in its parent's units; 0 while it is empty
  // or its font has not loaded.
  function textHeight(el) {
    var cache = el._textCache;
    if (!cache || !cache.value) return 0;
    var mesh = el.getObject3D('text');
    var position = mesh && mesh.geometry && mesh.geometry.attributes && mesh.geometry.attributes.position;
    if (!position || !position.count) return 0;
    mesh.geometry.computeBoundingBox();
    var box = mesh.geometry.boundingBox;
    var height = (box.max.y - box.min.y) * Math.abs(mesh.scale.y);
    return isFinite(height) ? height : 0;
  }

  function textWidth(el) {
    var mesh = el.getObject3D('text');
    var position = mesh && mesh.geometry && mesh.geometry.attributes && mesh.geometry.attributes.position;
    if (!position || !position.count) return 0;
    mesh.geometry.computeBoundingBox();
    var box = mesh.geometry.boundingBox;
    var width = (box.max.x - box.min.x) * Math.abs(mesh.scale.x);
    return isFinite(width) ? width : 0;
  }

  function priceText(price) {
    return price.map(function (p) { return p.text; }).join(' + ');
  }

  // ============================================================
  // COMPONENT: grid-menu
  // ============================================================
  AFRAME.registerComponent('grid-menu', {
    schema: {
      page: { type: 'string' },
      title: { type: 'string', default: '' },
      // The grid: how many columns a grid level folds into (a page or
      // submenu can ask for its own with `columns`), and how many rows
      // show at once.
      columns: { default: 4 },
      rows: { default: 3 },
      tileWidth: { default: 0.3 },
      // 0: tall enough for a square thumbnail and two lines under it.
      tileHeight: { default: 0 },
      gap: { default: 0.03 },
      // Characters across a tile's label. The focused tile scrolls a
      // label that does not fit; the details pane has the full name.
      labelChars: { default: 14 },
      // Metres per character cell for the panel's own text (the header,
      // the wallet, the footer); the title is a size up, captions down.
      textSize: { default: 0.024 },
      // The details pane: which side, how wide, how many characters of
      // body text across it, and the height of the slot at its top for
      // a picture or a game's own 3D preview (see detailsContentEl).
      details: { default: 'right', oneOf: ['right', 'left', 'none'] },
      detailsWidth: { default: 0.8 },
      detailsChars: { default: 30 },
      detailsContentHeight: { default: 0.4 },
      // Show the focused item's thumbnail, large, in that slot. Off when
      // a game puts something better there (the toybox's live model).
      detailsThumbnail: { default: true },
      maxStats: { default: 6 },
      open: { default: true },
      closeBehavior: { default: 'collapse', oneOf: ['collapse', 'hide'] },
      closable: { default: true },
      memory: { default: 'temporary' },
      memoryMs: { default: 60000 },
      stickRange: { default: 0.9 },
      hint: { default: true },
      hintKey: { type: 'string', default: 'E' },
      hintLabel: { type: 'string', default: 'Menu' },
      hintRadius: { default: 1.2 },
      plateOpacity: { default: 0.9 },
      exitKey: { type: 'string', default: 'E' },
      exitButton: { type: 'string', default: 'INTERACT' },
      color: { type: 'color', default: '#dff3ff' },
      accent: { type: 'color', default: '#7fe3ff' },
      deny: { type: 'color', default: '#ff7a7a' },
      font: { default: 'roboto' },
      titleFont: { default: '' },
    },

    init: function () {
      var self = this;
      var data = this.data;
      this.tiles = [];
      this.stats = [];
      this.currencySlots = [];
      this.engagedHand = null;
      this.locked = false;
      this.flashT0 = 0;
      this.flashColor = data.accent;
      this.marquee = null;
      this.liveAt = 0;

      var page = getMenuPage(data.page);
      if (!page) {
        console.warn('[grid-menu] no page registered as "' + data.page + '"');
        page = { title: data.title || '', items: [] };
      }
      this.page = page;
      this.pointerConfirm = createPointerConfirm(this);
      this.menu = createMenu(page, {
        gridColumns: Math.max(1, data.columns),
        gridRows: Math.max(1, data.rows),
        memory: data.memory,
        memoryMs: data.memoryMs,
        chrome: data.closable ? undefined : [],
      });

      this.menu.on('change', function () { self.render(); });
      this.menu.on('activate', function () { self.beginFlash(data.accent); });
      this.menu.on('denied', function (detail) {
        self.beginFlash(data.deny);
        self.el.emit('menu-denied', { id: detail.id, item: detail.item, reason: detail.reason, price: detail.price }, true);
      });
      this.menu.on('open', function () {
        if (typeof page.onOpen === 'function') page.onOpen(self);
      });
      // The same event the crossbar sends, so projected-crossbar puts the
      // panel away when Close is confirmed here too.
      this.menu.on('close', function () { self.el.emit('crossbar-menu-close', {}, false); });
      this.menu.on('action', function (detail) {
        self.el.emit('menu-action', { id: detail.id, item: detail.item }, true);
      });
      this.menu.on('commit', function (detail) {
        self.el.emit('menu-commit', { id: detail.item.id, value: detail.value, item: detail.item }, true);
      });
      this.menu.on('preview', function (detail) {
        self.el.emit('menu-preview', { id: detail.item.id, value: detail.value, item: detail.item }, true);
      });

      this.onFamilyChanged = function () { if (self.locked) self.renderFooter(); self.renderDetails(); };
      this.el.sceneEl.addEventListener('input-family-changed', this.onFamilyChanged);

      this.build();
      this.system = this.el.sceneEl.systems['menu-stick-control'];
      if (this.system) this.system.registerMenu(this);
      if (data.open) this.menu.open();
      this.render();
    },

    // ---------- construction ----------

    text: function (parent, props, role) {
      var face = resolveMenuFont(role === 'title' ? (this.data.titleFont || this.data.font) : this.data.font);
      var el = document.createElement('a-entity');
      // `size` is a glyph cell in metres, which is easier to keep
      // consistent across a panel than a characters-per-line count that
      // depends on each label's own width.
      props = Object.assign({}, props);
      if (props.size) {
        props.wrapCount = Math.max(1, props.width / props.size);
        delete props.size;
      }
      el.setAttribute('text', Object.assign({ font: face.font, negate: face.negate, color: this.data.color }, props));
      parent.appendChild(el);
      return el;
    },

    plane: function (parent, color, opacity, target) {
      var el = document.createElement('a-entity');
      el.setAttribute('geometry', { primitive: 'plane', width: 1, height: 1 });
      el.setAttribute('material', { color: color, shader: 'flat', transparent: true, opacity: opacity, depthWrite: false });
      if (target) el.classList.add('menu-target');
      parent.appendChild(el);
      return el;
    },

    build: function () {
      var data = this.data;
      var self = this;
      var m = this.measure();
      this.metrics = m;

      var content = document.createElement('a-entity');
      this.el.appendChild(content);
      this.contentEl = content;

      var backing = document.createElement('a-plane');
      backing.classList.add('pm-surface');
      backing.setAttribute('id', (this.el.id || 'grid') + '-backing-' + Math.random().toString(36).slice(2, 8));
      backing.setAttribute('material', { color: '#0b1220', shader: 'flat', transparent: true, opacity: data.plateOpacity });
      backing.setAttribute('width', m.width);
      backing.setAttribute('height', m.height);
      backing.setAttribute('position', { x: 0, y: 0, z: -0.012 });
      content.appendChild(backing);
      this.backingEl = backing;

      // ----- header: title, breadcrumb, count, wallet, close -----
      this.titleEl = this.text(content, {
        value: '', align: 'left', anchor: 'left', baseline: 'center', color: data.accent,
        width: m.gridWidth * 0.9, size: m.text * 1.35,
      }, 'title');
      this.titleEl.setAttribute('position', { x: m.gridLeft, y: m.titleY, z: 0.002 });
      // Inside a submenu the title is a way back as well as the corner
      // button and the breadcrumb.
      this.titleTarget = this.plane(content, data.accent, 0, true);
      this.titleTarget.setAttribute('geometry', { primitive: 'plane', width: m.gridWidth * 0.6, height: 0.07 });
      this.titleTarget.setAttribute('position', { x: m.gridLeft + m.gridWidth * 0.3, y: m.titleY, z: 0.001 });
      this.titleTarget.addEventListener('click', function () { self.menu.back(); });
      this.titleTarget.object3D.visible = false;

      // The breadcrumb line is the way back for a pointer: clicking it
      // goes up one level, like the crossbar's rail.
      this.crumbTarget = this.plane(content, data.accent, 0, true);
      this.crumbTarget.addEventListener('click', function () { self.menu.back(); });
      // One label per level, so each can fade by its distance from the
      // level you are in; laid end to end by flowCrumbs.
      this.crumbEl = document.createElement('a-entity');
      content.appendChild(this.crumbEl);
      // The › between them is its own label, centred in the gap, so each
      // segment's measured width is only its words.
      this.crumbSegments = [];
      this.crumbSeparators = [];
      for (var cs = 0; cs < MAX_CRUMBS; cs++) {
        var segment = this.text(this.crumbEl, {
          value: '', align: 'left', anchor: 'left', baseline: 'center', width: m.gridWidth * 0.9, size: m.text,
        });
        segment.addEventListener('object3dset', function () { self.flowCrumbs(); });
        this.crumbSegments.push(segment);
        var separator = this.text(this.crumbEl, {
          value: '›', align: 'left', anchor: 'left', baseline: 'center', width: m.gridWidth * 0.9, size: m.text, opacity: 0.5,
        });
        separator.object3D.visible = false;
        this.crumbSeparators.push(separator);
      }

      this.countEl = this.text(content, {
        value: '', align: 'right', anchor: 'right', baseline: 'center', opacity: 0.6,
        width: m.gridWidth * 0.9, size: m.text,
      });
      this.countEl.setAttribute('position', { x: m.gridRight, y: m.crumbY, z: 0.002 });

      for (var c = 0; c < MAX_CURRENCIES; c++) {
        var slot = document.createElement('a-entity');
        var icon = makeThumbnail(m.currencyIcon);
        slot.object3D.add(icon);
        var label = this.text(slot, {
          value: '', align: 'left', anchor: 'left', baseline: 'center', width: m.gridWidth * 0.9, size: m.text,
        });
        label.setAttribute('position', { x: 0, y: 0, z: 0.002 });
        icon.position.set(m.currencyIcon / 2, 0, 0.003);
        slot.object3D.visible = false;
        content.appendChild(slot);
        this.currencySlots.push({ el: slot, icon: icon, labelEl: label });
      }

      // X at the top of a closable menu; < inside any submenu, closable
      // or not, so there is always a way back up for a pointer.
      var close = this.plane(content, data.accent, 0, true);
      close.setAttribute('geometry', { primitive: 'plane', width: m.closeSize, height: m.closeSize });
      close.setAttribute('position', { x: m.gridRight - m.closeSize / 2 + m.scrollGutter, y: m.titleY, z: 0.002 });
      close.addEventListener('click', function () {
        if (self.menu.depth() > 0) self.menu.back();
        else if (self.data.closable) self.menu.close();
      });
      this.closeGlyphEl = this.text(close, { value: 'X', align: 'center', color: data.accent, width: m.closeSize * 4, size: m.text * 1.35 });
      this.closeGlyphEl.setAttribute('position', { x: 0, y: 0, z: 0.002 });
      this.closeEl = close;

      var rule = this.plane(content, data.accent, 0.45, false);
      rule.setAttribute('geometry', { primitive: 'plane', width: m.width - 2 * m.pad, height: 0.004 });
      rule.setAttribute('position', { x: 0, y: m.ruleY, z: 0.001 });

      // ----- the tiles -----
      var count = Math.max(1, data.columns) * Math.max(1, data.rows);
      for (var i = 0; i < count; i++) this.tiles.push(this.buildTile(content, i));

      this.emptyEl = this.text(content, { value: 'Nothing here', align: 'center', opacity: 0.5, width: m.gridWidth, size: m.text });
      this.emptyEl.setAttribute('position', { x: (m.gridLeft + m.gridRight) / 2, y: m.gridTop - m.gridHeight / 2, z: 0.002 });
      this.emptyEl.object3D.visible = false;

      // ----- scroll bar -----
      this.trackEl = this.plane(content, data.accent, 0.15, false);
      this.trackEl.setAttribute('geometry', { primitive: 'plane', width: m.scrollWidth, height: m.gridHeight });
      this.trackEl.setAttribute('position', { x: m.gridRight + m.scrollGutter / 2, y: m.gridTop - m.gridHeight / 2, z: 0.001 });
      this.thumbEl = this.plane(content, data.accent, 0.8, false);
      this.thumbEl.setAttribute('position', { x: m.gridRight + m.scrollGutter / 2, y: 0, z: 0.002 });

      // ----- the controls footer, while the keys are ours -----
      this.footerEl = this.text(content, {
        value: '', align: 'left', anchor: 'left', baseline: 'center', color: data.accent,
        width: m.gridWidth * 0.95, size: m.text * 0.8,
      });
      this.footerEl.setAttribute('position', { x: m.gridLeft, y: m.footerY, z: 0.002 });
      this.footerEl.object3D.visible = false;

      // ----- the outline that says a hand or the keys have this -----
      var glow = document.createElement('a-entity');
      var gw = m.width + 0.04, gh = m.height + 0.04, bar = 0.008;
      [
        { w: gw, h: bar, x: 0, y: gh / 2 }, { w: gw, h: bar, x: 0, y: -gh / 2 },
        { w: bar, h: gh, x: -gw / 2, y: 0 }, { w: bar, h: gh, x: gw / 2, y: 0 },
      ].forEach(function (edge) {
        var edgeEl = self.plane(glow, data.accent, 0.6, false);
        edgeEl.setAttribute('geometry', { primitive: 'plane', width: edge.w, height: edge.h });
        edgeEl.setAttribute('position', { x: edge.x, y: edge.y, z: -0.006 });
      });
      glow.object3D.visible = false;
      content.appendChild(glow);
      this.glowEl = glow;

      if (data.details !== 'none') this.buildDetails(content);

      // The hold-to-confirm wheel: over the focused tile's picture, or on
      // the corner button for going back.
      var ringEl = document.createElement('a-entity');
      this.holdRing = createHoldRing(m.thumbSize * 0.34, m.thumbSize * 0.1, data.accent);
      ringEl.setObject3D('ring', this.holdRing.object3D);
      content.appendChild(ringEl);
      this.holdRingEl = ringEl;

      var hint = {
        action: 'menu', radius: data.hintRadius, maxReach: data.hintRadius, priority: 5,
        desktopKey: data.hintKey, desktopLabel: data.hintLabel, touchKey: 'TAP', touchLabel: data.hintLabel,
        hintOffset: { x: 0, y: m.height / 2 + 0.12, z: 0 }, highlight: '#' + backing.getAttribute('id'),
      };
      if (data.hint) this.el.setAttribute('hint-zone', hint);
    },

    // Every size the layout needs, worked out once from the schema.
    measure: function () {
      var d = this.data;
      var columns = Math.max(1, d.columns);
      var rows = Math.max(1, d.rows);
      var tw = d.tileWidth;
      var th = d.tileHeight > 0 ? d.tileHeight : tw * 1.28;
      var gap = d.gap;
      var pad = Math.max(0.04, gap * 1.4);
      var gridWidth = columns * tw + (columns - 1) * gap;
      var gridHeight = rows * th + (rows - 1) * gap;
      var scrollWidth = 0.012;
      var scrollGutter = 0.045;
      var header = 0.2;
      var footer = 0.08;
      var detailsWidth = d.details === 'none' ? 0 : d.detailsWidth;
      var width = pad + gridWidth + scrollGutter + pad + (detailsWidth ? detailsWidth + pad : 0);
      var height = pad + header + gridHeight + footer + pad * 0.5;
      var left = -width / 2;
      var gridLeft = d.details === 'left' ? left + pad + detailsWidth + pad : left + pad;
      var top = height / 2;
      var gridTop = top - pad - header;
      return {
        columns: columns, rows: rows, tileWidth: tw, tileHeight: th, gap: gap, pad: pad,
        width: width, height: height, gridWidth: gridWidth, gridHeight: gridHeight,
        gridLeft: gridLeft, gridRight: gridLeft + gridWidth, gridTop: gridTop,
        titleY: top - pad - 0.045, crumbY: top - pad - 0.125, ruleY: gridTop + 0.03,
        footerY: gridTop - gridHeight - footer * 0.55,
        scrollWidth: scrollWidth, scrollGutter: scrollGutter,
        closeSize: 0.075, currencyIcon: d.textSize * 1.9, text: d.textSize,
        detailsLeft: d.details === 'left' ? left + pad : gridLeft + gridWidth + scrollGutter + pad,
        detailsWidth: detailsWidth, detailsTop: top - pad,
        detailsBottom: -height / 2 + pad,
        thumbSize: Math.min(tw * 0.84, th - 0.1),
      };
    },

    buildTile: function (parent, slot) {
      var m = this.metrics;
      var data = this.data;
      var self = this;
      var tile = this.plane(parent, data.accent, TILE_REST, true);
      tile.setAttribute('geometry', { primitive: 'plane', width: m.tileWidth, height: m.tileHeight });
      tile.dataset.tileSlot = String(slot);
      tile.addEventListener('click', function () { self.onTileClick(slot); });
      // A serious tile (a long `hold`) is held, not tapped.
      tile.addEventListener('mousedown', function () {
        var t = self.tiles[slot];
        if (t && t.cell && t.cell.focused) self.pointerConfirm.down();
      });
      tile.addEventListener('mouseup', function () { self.pointerConfirm.up(); });
      tile.addEventListener('mouseleave', function () { self.pointerConfirm.up(); });

      var thumb = makeThumbnail(m.thumbSize);
      thumb.position.set(0, m.tileHeight / 2 - 0.02 - m.thumbSize / 2, 0.003);
      tile.object3D.add(thumb);

      var labelY = -m.tileHeight / 2 + 0.065;
      var label = this.text(tile, {
        value: '', align: 'center', anchor: 'center', baseline: 'center',
        width: m.tileWidth * 0.94, wrapCount: data.labelChars,
      });
      label.setAttribute('position', { x: 0, y: labelY, z: 0.004 });

      var sub = this.text(tile, {
        value: '', align: 'left', anchor: 'left', baseline: 'center', opacity: 0.7,
        width: m.tileWidth * 0.94, size: m.text * 0.72,
      });
      sub.setAttribute('position', { x: -m.tileWidth * 0.45, y: -m.tileHeight / 2 + 0.025, z: 0.004 });

      var price = this.text(tile, {
        value: '', align: 'right', anchor: 'right', baseline: 'center', color: data.accent,
        width: m.tileWidth * 0.94, size: m.text * 0.72,
      });
      price.setAttribute('position', { x: m.tileWidth * 0.45, y: -m.tileHeight / 2 + 0.025, z: 0.004 });

      // A corner tag: NEW, OWNED, x3.
      // Accent text on a dark pill rather than dark text on an accent
      // one: at a tile's size, thin dark glyphs on a bright plate smear
      // into a block.
      var badge = this.plane(tile, '#0b1220', 0.88, false);
      badge.setAttribute('geometry', { primitive: 'plane', width: m.tileWidth * 0.42, height: 0.04 });
      badge.setAttribute('position', { x: m.tileWidth * 0.27, y: m.tileHeight / 2 - 0.03, z: 0.006 });
      var badgeText = this.text(badge, {
        value: '', align: 'center', baseline: 'center', color: data.accent,
        width: m.tileWidth * 0.94, size: m.text * 0.66,
      });
      badgeText.setAttribute('position', { x: 0, y: 0, z: 0.002 });
      badge.object3D.visible = false;

      return {
        el: tile, thumb: thumb, labelEl: label, subEl: sub, priceEl: price, badgeEl: badge, badgeTextEl: badgeText,
        cell: null, labelY: labelY,
      };
    },

    buildDetails: function (parent) {
      var m = this.metrics;
      var data = this.data;
      var pane = document.createElement('a-entity');
      pane.setAttribute('position', { x: m.detailsLeft, y: m.detailsTop, z: 0 });
      parent.appendChild(pane);
      this.detailsEl = pane;
      var w = m.detailsWidth;

      var card = this.plane(pane, '#16233a', 0.6, false);
      var cardHeight = m.detailsTop - m.detailsBottom;
      card.setAttribute('geometry', { primitive: 'plane', width: w, height: cardHeight });
      card.setAttribute('position', { x: w / 2, y: -cardHeight / 2, z: -0.004 });

      var inset = 0.03;
      var ch = Math.max(0, data.detailsContentHeight);
      // A game's own preview hangs here, centred in the slot — the
      // toybox's spinning model. Nothing on it is a target.
      var slot = document.createElement('a-entity');
      slot.classList.add('grid-details-content');
      slot.setAttribute('position', { x: w / 2, y: -inset - ch / 2, z: 0.12 });
      pane.appendChild(slot);
      this.detailsContentEl = slot;
      this.detailsThumb = makeThumbnail(Math.min(ch, w - 2 * inset));
      this.detailsThumb.position.set(w / 2, -inset - ch / 2, 0.003);
      pane.object3D.add(this.detailsThumb);

      var y = -inset - ch - (ch ? 0.03 : 0);
      var textWidth = w - 2 * inset;
      this.detailTitleEl = this.text(pane, {
        value: '', align: 'left', anchor: 'left', baseline: 'top', color: data.accent,
        width: textWidth, size: m.text * 1.3,
      }, 'title');
      this.detailSubEl = this.text(pane, {
        value: '', align: 'left', anchor: 'left', baseline: 'top', opacity: 0.7,
        width: textWidth, wrapCount: data.detailsChars,
      });
      var line = textWidth / data.detailsChars * 1.6;
      this.detailsLine = line;
      this.detailsInset = inset;
      // Where the text column starts; flowDetails stacks down from here.
      this.flowTop = y;

      for (var i = 0; i < data.maxStats; i++) {
        var row = document.createElement('a-entity');
        pane.appendChild(row);
        var label = this.text(row, { value: '', align: 'left', anchor: 'left', baseline: 'center', width: textWidth, wrapCount: data.detailsChars, opacity: 0.85 });
        label.setAttribute('position', { x: inset, y: 0, z: 0.002 });
        var value = this.text(row, { value: '', align: 'right', anchor: 'right', baseline: 'center', width: textWidth, wrapCount: data.detailsChars });
        value.setAttribute('position', { x: w - inset, y: 0, z: 0.002 });
        var barX = inset + textWidth * 0.42;
        var barW = textWidth * 0.36;
        var track = this.plane(row, data.accent, 0.18, false);
        track.setAttribute('geometry', { primitive: 'plane', width: barW, height: line * 0.32 });
        track.setAttribute('position', { x: barX + barW / 2, y: 0, z: 0.001 });
        var fill = this.plane(row, data.accent, 0.9, false);
        fill.setAttribute('geometry', { primitive: 'plane', width: barW, height: line * 0.32 });
        fill.setAttribute('position', { x: barX + barW / 2, y: 0, z: 0.002 });
        row.object3D.visible = false;
        this.stats.push({ el: row, labelEl: label, valueEl: value, trackEl: track, fillEl: fill, barX: barX, barW: barW });
      }

      this.detailTextEl = this.text(pane, {
        value: '', align: 'left', anchor: 'left', baseline: 'top', opacity: 0.9,
        width: textWidth, wrapCount: data.detailsChars,
      });
      // A label's mesh is laid out once its font has loaded, which can be
      // after the first draw; stack the column again whenever one is.
      var self = this;
      [this.detailTitleEl, this.detailSubEl, this.detailTextEl].forEach(function (el) {
        el.addEventListener('object3dset', function () { self.flowDetails(); });
      });

      var bottom = -(cardHeight) + inset;
      this.detailPriceEl = this.text(pane, {
        value: '', align: 'left', anchor: 'left', baseline: 'bottom', color: data.accent,
        width: textWidth, size: m.text * 1.05,
      });
      this.detailPriceEl.setAttribute('position', { x: inset, y: bottom + line * 1.15, z: 0.002 });
      this.detailActionEl = this.text(pane, {
        value: '', align: 'left', anchor: 'left', baseline: 'bottom', opacity: 0.8,
        width: textWidth, wrapCount: data.detailsChars,
      });
      this.detailActionEl.setAttribute('position', { x: inset, y: bottom, z: 0.002 });
    },

    // ---------- drawing ----------

    render: function () {
      var data = this.data;
      var open = this.menu.isOpen;
      var collapsed = !open && data.closeBehavior === 'collapse';
      this.el.object3D.visible = open || collapsed;
      this.contentEl.object3D.visible = open || collapsed;

      var held = this.locked || Boolean(this.engagedHand);
      var above = LEVEL_FADE[Math.min(this.menu.depth(), LEVEL_FADE.length - 1)];
      setText(this.titleEl, { value: (data.title || this.menu.getTitle() || '').toUpperCase(), opacity: open ? (held ? 1 : 0.75) * above : 0.45 });
      this.titleTarget.object3D.visible = open && this.menu.depth() > 0;
      if (!open) {
        for (var h = 0; h < this.tiles.length; h++) this.tiles[h].el.object3D.visible = false;
        [this.crumbEl, this.countEl, this.trackEl, this.thumbEl, this.emptyEl, this.footerEl, this.closeEl, this.detailsEl]
          .forEach(function (el) { if (el) el.object3D.visible = false; });
        this.currencySlots.forEach(function (slot) { slot.el.object3D.visible = false; });
        this.crumbTarget.object3D.visible = false;
        setPlate(this.backingEl, collapsed ? 0.35 : data.plateOpacity);
        return;
      }
      setPlate(this.backingEl, this.locked ? Math.max(0.94, data.plateOpacity) : data.plateOpacity);
      this.crumbEl.object3D.visible = true;
      this.countEl.object3D.visible = true;
      this.closeEl.object3D.visible = data.closable || this.menu.depth() > 0;
      if (this.detailsEl) this.detailsEl.object3D.visible = true;
      this.footerEl.object3D.visible = this.locked;

      var grid = this.menu.getGrid();
      this.grid = grid;
      this.renderTiles(grid);
      this.renderHeader(grid);
      this.renderScroll(grid);
      this.renderDetails();
      if (this.locked) this.renderFooter();
    },

    renderTiles: function (grid) {
      var m = this.metrics;
      var data = this.data;
      var now = this.now();
      var inChrome = this.menu.inChrome();
      // A list in this surface is one column of wide tiles.
      var wide = !grid.grid;
      this.emptyEl.object3D.visible = grid.count === 0;
      for (var i = 0; i < this.tiles.length; i++) {
        var tile = this.tiles[i];
        var cell = grid.cells[i];
        tile.cell = cell || null;
        if (!cell) {
          tile.el.object3D.visible = false;
          continue;
        }
        tile.el.object3D.visible = true;
        var r = cell.row - grid.firstRow;
        var c = wide ? 0 : cell.column;
        var width = wide ? m.gridWidth : m.tileWidth;
        var height = wide ? Math.min(m.tileHeight, (m.gridHeight - (data.rows - 1) * m.gap) / data.rows) : m.tileHeight;
        var stepY = wide ? height + m.gap : m.tileHeight + m.gap;
        var x = m.gridLeft + c * (m.tileWidth + m.gap) + width / 2;
        var y = m.gridTop - r * stepY - height / 2;
        tile.el.object3D.position.set(x, y, cell.focused ? 0.01 : 0);
        tile.el.object3D.scale.set(width / m.tileWidth, height / m.tileHeight, 1).multiplyScalar(cell.focused && !wide ? FOCUS_SCALE : 1);
        // Text is not stretched with a wide tile: undo the scale on it.
        var sx = m.tileWidth / width, sy = m.tileHeight / height;
        [tile.labelEl, tile.subEl, tile.priceEl, tile.badgeEl].forEach(function (el) { el.object3D.scale.set(sx, sy, 1); });

        var hasThumb = setThumbnail(tile.thumb, cell.thumbnail);
        tile.thumb.scale.set(sx, sy, 1);
        if (wide && hasThumb) {
          // Thumbnail at the left end of a wide row.
          tile.thumb.scale.multiplyScalar(Math.min(1, (height * 0.8) / m.thumbSize));
          tile.thumb.position.set(-0.5 * m.tileWidth + (height * 0.5) * sx, 0, 0.003);
        } else {
          tile.thumb.position.set(0, m.tileHeight / 2 - 0.02 - m.thumbSize / 2, 0.003);
        }

        // Without a picture the name is the tile, so it sits in the
        // middle and may take two lines; with one, it is a caption.
        var chars = data.labelChars;
        var label = cell.label;
        var marquee = false;
        var oneLine = hasThumb || wide;
        if (oneLine && label.length > chars) {
          marquee = cell.focused && !inChrome;
          if (marquee && (!this.marquee || this.marquee.tile !== tile || this.marquee.label !== label)) {
            this.marquee = { tile: tile, label: label, since: now, shown: '', chars: wide ? chars * 2 : chars };
          }
          label = marquee ? marqueeText(label, wide ? chars * 2 : chars, now - this.marquee.since) : truncateLabel(label, wide ? chars * 2 : chars);
          if (marquee) this.marquee.shown = label;
        }
        if (cell.focused && !marquee && this.marquee && this.marquee.tile === tile) this.marquee = null;
        var labelX = 0, labelAlign = 'center', labelAnchor = 'center';
        if (wide) {
          labelAlign = 'left'; labelAnchor = 'left';
          labelX = -m.tileWidth * 0.45 + (hasThumb ? height * 1.05 * sx : 0);
        }
        tile.labelEl.object3D.position.set(labelX, wide ? 0 : (hasThumb ? tile.labelY : 0.03), 0.004);
        setText(tile.labelEl, {
          value: label + (wide && cell.hasChildren ? '  ›' : ''),
          align: labelAlign, anchor: labelAnchor,
          // A little slack past the cut, so a caption exactly `chars`
          // long does not wrap onto a second line.
          wrapCount: (wide ? chars * 2 : chars) * (oneLine ? 1.12 : 1),
          color: cell.focused && !inChrome ? data.accent : data.color,
          opacity: cell.disabled ? 0.4 : 1,
        });

        setText(tile.subEl, { value: cell.subtitle || '' });
        var price = cell.price && cell.price.length ? priceText(cell.price) : '';
        setText(tile.priceEl, { value: price, color: cell.affordable ? data.accent : data.deny });
        tile.badgeEl.object3D.visible = Boolean(cell.badge);
        if (cell.badge) setText(tile.badgeTextEl, { value: String(cell.badge).toUpperCase() });

        var resting = cell.focused && !inChrome ? TILE_FOCUS : TILE_REST;
        var flash = cell.focused ? this.flashOpacity(now, resting) : null;
        setPlate(tile.el, flash === null ? resting : flash, flash === null ? data.accent : this.flashColor);
      }
    },

    renderHeader: function (grid) {
      var m = this.metrics;
      var data = this.data;
      var crumbs = [];
      for (var i = 1; i < this.menu.stack.length; i++) crumbs.push(this.menu.stack[i].title);
      crumbs = crumbs.slice(-MAX_CRUMBS);
      for (var k = 0; k < this.crumbSegments.length; k++) {
        var title = crumbs[k];
        var last = k === crumbs.length - 1;
        // Faded by distance from the level you are in, the last one.
        var fade = title ? LEVEL_FADE[Math.min(crumbs.length - 1 - k, LEVEL_FADE.length - 1)] : 0;
        setText(this.crumbSegments[k], { value: title || '', opacity: fade, color: last ? data.accent : data.color });
      }
      this.crumbCount = crumbs.length;
      this.flowCrumbs();
      var level = this.menu.level();
      var focus = grid.count ? level.index + 1 : 0;
      setText(this.countEl, { value: grid.count > 1 ? focus + ' / ' + grid.count : '' });

      // The wallet, right-aligned in the header before the close button,
      // laid out right to left: icon then amount, or name then amount.
      var currencies = this.menu.getCurrencies();
      var x = m.gridRight + m.scrollGutter - m.closeSize - m.text;
      for (var c = 0; c < this.currencySlots.length; c++) {
        var slot = this.currencySlots[c];
        var currency = currencies[currencies.length - 1 - c];
        slot.el.object3D.visible = Boolean(currency);
        if (!currency) continue;
        var hasIcon = setThumbnail(slot.icon, currency.icon);
        var text = hasIcon || currency.formatted ? currency.text : currency.label + ' ' + currency.text;
        setText(slot.labelEl, { value: text, color: data.color });
        var iconWidth = hasIcon ? m.currencyIcon * 1.15 : 0;
        slot.labelEl.object3D.position.x = iconWidth;
        // A glyph is about 0.6 of its cell on average; near enough to
        // space the slots without measuring each mesh.
        var width = iconWidth + text.length * m.text * 0.62;
        x -= width;
        slot.el.object3D.position.set(x, m.titleY, 0.002);
        x -= m.text * 1.5;
      }

      var inChrome = this.menu.inChrome();
      setPlate(this.closeEl, inChrome ? 0.4 : 0);
      setText(this.closeGlyphEl, { value: this.menu.depth() > 0 ? '<' : 'X', opacity: inChrome ? 1 : 0.55 });
    },

    renderScroll: function (grid) {
      var m = this.metrics;
      var scrolls = grid.rowCount > grid.rows;
      this.trackEl.object3D.visible = scrolls;
      this.thumbEl.object3D.visible = scrolls;
      if (!scrolls) return;
      var fraction = grid.rows / grid.rowCount;
      var h = Math.max(0.03, m.gridHeight * fraction);
      var travel = m.gridHeight - h;
      var t = grid.firstRow / Math.max(1, grid.rowCount - grid.rows);
      this.thumbEl.setAttribute('geometry', { primitive: 'plane', width: m.scrollWidth * 1.6, height: h });
      this.thumbEl.object3D.position.y = m.gridTop - h / 2 - travel * t;
    },

    renderDetails: function () {
      if (!this.detailsEl) return;
      var data = this.data;
      var details = this.menu.isOpen ? this.menu.getDetails() : null;
      this.details = details;
      var empty = !details;
      var showThumb = !empty && data.detailsThumbnail && !this.detailsSlotHeld && data.detailsContentHeight > 0;
      setThumbnail(this.detailsThumb, showThumb ? details.thumbnail : null);
      // The full name, wrapping if it must: the tile cut it short, and
      // this is the one place there is room for all of it.
      setText(this.detailTitleEl, { value: empty ? '' : details.title.toUpperCase() });
      setText(this.detailSubEl, { value: empty ? '' : details.subtitle });

      var stats = empty ? [] : details.stats;
      for (var i = 0; i < this.stats.length; i++) {
        var row = this.stats[i];
        var stat = stats[i];
        row.el.object3D.visible = Boolean(stat);
        if (!stat) continue;
        setText(row.labelEl, { value: stat.label });
        var delta = stat.delta ? ' (' + (stat.delta > 0 ? '+' : '') + stat.delta + ')' : '';
        setText(row.valueEl, {
          value: stat.text + delta,
          color: stat.delta > 0 ? '#8dffa8' : (stat.delta < 0 ? data.deny : data.color),
        });
        var bar = stat.max !== null && stat.value !== null;
        row.trackEl.object3D.visible = bar;
        row.fillEl.object3D.visible = bar;
        if (bar) {
          var f = Math.max(0, Math.min(1, stat.value / stat.max));
          row.fillEl.object3D.scale.x = Math.max(0.0001, f);
          row.fillEl.object3D.position.x = row.barX + (row.barW * f) / 2;
        }
      }
      this.detailStatCount = stats.length;
      setText(this.detailTextEl, { value: empty ? '' : details.text });
      this.flowDetails();

      var price = empty ? [] : details.price;
      if (price.length) {
        var short = price.filter(function (p) { return !p.affordable; });
        var text = priceText(price);
        if (short.length) text += '   (have ' + short.map(function (p) { return p.haveText; }).join(' + ') + ')';
        setText(this.detailPriceEl, { value: text, color: short.length ? data.deny : data.accent });
      } else {
        setText(this.detailPriceEl, { value: '' });
      }
      // What confirming would do right now. The title bar is only ever
      // reached at the root, where its one control is Close.
      var action = '';
      if (this.menu.inChrome()) action = this.confirmKey() + '   Close';
      else if (details && details.actionLabel) action = this.confirmKey() + '   ' + details.actionLabel;
      setText(this.detailActionEl, { value: action });
    },

    // Lay the breadcrumb's segments end to end by their measured widths,
    // and size the back target to cover them.
    flowCrumbs: function () {
      var m = this.metrics;
      if (!this.crumbSegments) return;
      var x = m.gridLeft;
      var gap = m.text * 2.2;
      for (var i = 0; i < this.crumbSegments.length; i++) {
        var segment = this.crumbSegments[i];
        var separator = this.crumbSeparators[i];
        segment.object3D.visible = i < this.crumbCount;
        separator.object3D.visible = i < this.crumbCount - 1;
        segment.object3D.position.set(x, m.crumbY, 0.002);
        var cache = segment._textCache;
        if (!cache || !cache.value) continue;
        // Until its font has loaded, a segment's width is guessed from
        // its length; object3dset flows the line again once it has.
        x += textWidth(segment) || cache.value.length * m.text * 0.6;
        // Left-anchored a little past the middle of the gap, less half the
        // glyph: a lone glyph centred on its anchor drifts by its own
        // side bearing.
        separator.object3D.position.set(x + gap * 0.42, m.crumbY, 0.002);
        x += gap;
      }
      this.crumbTarget.object3D.visible = this.crumbCount > 0;
      if (this.crumbCount) {
        var w = Math.min(m.gridWidth * 0.8, x - m.gridLeft);
        this.crumbTarget.setAttribute('geometry', { primitive: 'plane', width: w, height: 0.06 });
        this.crumbTarget.object3D.position.set(m.gridLeft + w / 2, m.crumbY, 0.001);
      }
    },

    // Stack the details column — title, subtitle, stats, text — by the
    // height each label actually came out at, since a title can wrap and
    // line height differs from face to face.
    flowDetails: function () {
      if (!this.detailsEl) return;
      var line = this.detailsLine;
      var inset = this.detailsInset;
      var gap = line * 0.2;
      var y = this.flowTop;
      var place = function (el) {
        el.object3D.position.set(inset, y, 0.002);
        var height = textHeight(el);
        if (height) y -= height + gap;
      };
      place(this.detailTitleEl);
      place(this.detailSubEl);
      y -= gap;
      var count = this.detailStatCount || 0;
      for (var i = 0; i < count; i++) {
        this.stats[i].el.object3D.position.set(0, y - line * 0.5, 0);
        y -= line * 1.1;
      }
      if (count) y -= line * 0.6;
      place(this.detailTextEl);
    },

    // A game that has something better for the details slot than the
    // focused item's picture — a live model, once it has loaded — holds
    // the slot while it shows it, and lets go to get the picture back.
    holdDetailsSlot: function (held) {
      held = Boolean(held);
      if (this.detailsSlotHeld === held) return;
      this.detailsSlotHeld = held;
      this.renderDetails();
    },

    renderFooter: function () {
      setText(this.footerEl, { value: this.controlsHint() });
    },

    inputFamily: function () {
      var mode = this.el.sceneEl.systems['control-mode'];
      if (mode && mode.isMode && mode.isMode('xr')) return 'xr';
      var router = this.el.sceneEl.systems['input-router'];
      return router && typeof router.getActiveFamily === 'function' ? router.getActiveFamily() : 'keyboard';
    },

    confirmKey: function () {
      var family = this.inputFamily();
      if (family === 'xr') return 'TRIGGER';
      if (family === 'touch') return 'TAP';
      if (family === 'gamepad') return 'A';
      return 'ENTER';
    },

    controlsHint: function () {
      return this.inputFamily() === 'touch'
        ? 'Tap a tile, tap again to pick   ' + this.data.exitButton + ' leaves'
        : 'WASD move   Enter pick   Q back   ' + this.data.exitKey + ' exit';
    },

    // ---------- the confirm flash ----------

    now: function () {
      var sceneEl = this.el.sceneEl;
      return (sceneEl && typeof sceneEl.time === 'number') ? sceneEl.time : performance.now();
    },

    beginFlash: function (color) {
      this.flashT0 = this.now() || 1;
      this.flashColor = color;
      this.render();
    },

    flashOpacity: function (time, resting) {
      if (!this.flashT0) return null;
      var progress = (time - this.flashT0) / FLASH_MS;
      if (progress >= 1 || progress < 0) return null;
      var fade = progress < FLASH_HOLD ? 0 : Math.pow((progress - FLASH_HOLD) / (1 - FLASH_HOLD), 2);
      return FLASH_OPACITY + (resting - FLASH_OPACITY) * fade;
    },

    tick: function (time) {
      this.pointerConfirm.tick(performance.now());
      if (this.flashT0) {
        var focused = this.focusedTile();
        var value = focused ? this.flashOpacity(time, TILE_FOCUS) : null;
        if (value === null) {
          this.flashT0 = 0;
          this.render();
        } else {
          setPlate(focused.el, value, this.flashColor);
        }
      }
      var marquee = this.marquee;
      if (marquee && this.menu.isOpen) {
        var text = marqueeText(marquee.label, marquee.chars, time - marquee.since);
        if (text !== marquee.shown) {
          marquee.shown = text;
          setText(marquee.tile.labelEl, { value: text });
        }
      }
      // Wallets, stats and prices are functions of the game, read live:
      // a few times a second is enough to keep a wallet honest while a
      // shop stays open, and the text cache makes an unchanged read free.
      if (this.menu.isOpen && !(time - this.liveAt < LIVE_MS)) {
        this.liveAt = time;
        if (this.grid) this.renderHeader(this.grid);
        this.renderDetails();
        // A label's geometry can be rebuilt after object3dset (a font that
        // was still loading), so measure the stacked text again.
        this.flowCrumbs();
        this.flowDetails();
      }
    },

    focusedTile: function () {
      for (var i = 0; i < this.tiles.length; i++) {
        if (this.tiles[i].cell && this.tiles[i].cell.focused) return this.tiles[i];
      }
      return null;
    },

    // ---------- pointing ----------

    // The crossbar's rule: tapping the focused tile picks it, tapping any
    // other only moves the focus there. A tap is always safe.
    onTileClick: function (slot) {
      var tile = this.tiles[slot];
      if (!tile || !tile.cell) return;
      if (tile.cell.focused) {
        if (!this.pointerConfirm.click()) this.menu.activate();
      } else {
        this.menu.focusIndex(tile.cell.index, { keepScroll: true });
      }
    },

    // Fill the wheel for a hold (menu-stick-control's beginHold), or hide
    // it (null).
    setHold: function (verb, fraction) {
      if (!this.holdRing) return;
      if (verb === null || verb === undefined || fraction === null || fraction === undefined) {
        this.holdRing.set(null);
        return;
      }
      var position = this.holdRingEl.object3D.position;
      if (verb === 'back' || this.menu.inChrome()) {
        if (!this.closeEl.object3D.visible) { this.holdRing.set(null); return; }
        position.copy(this.closeEl.object3D.position);
      } else {
        var tile = this.focusedTile();
        if (!tile) { this.holdRing.set(null); return; }
        // Over the picture, which is where you are looking; a wide list
        // tile has its picture (if any) at its left end.
        tile.el.object3D.updateMatrix();
        position.copy(tile.thumb.position).applyMatrix4(tile.el.object3D.matrix);
        if (!tile.thumb.visible) position.copy(tile.el.object3D.position);
      }
      position.z += 0.02;
      this.holdRing.set(fraction);
    },

    // ---------- what menu-stick-control drives ----------

    step: function (delta) { this.menu.moveGrid(0, delta); },
    // Sideways. A held stick repeats along a row, but leaving the grid
    // off its first column waits for a fresh push, or holding left would
    // back out of every level in turn.
    horizontal: function (dir, repeat) {
      if (repeat && dir < 0 && this.atLeftEdge()) return;
      this.menu.moveGrid(dir, 0);
    },
    horizontalRepeats: function () {
      return this.menu.isGrid() && !this.menu.inChrome();
    },
    atLeftEdge: function () {
      var level = this.menu.level();
      return !this.menu.isGrid() || level.index % this.menu.levelColumns() === 0;
    },
    activate: function () { this.menu.activate(); },
    forward: function () { this.menu.forward(); },
    back: function () { this.menu.back(); },

    setLocked: function (locked) {
      if (this.locked === locked) return;
      this.locked = locked;
      this.glowEl.object3D.visible = locked || Boolean(this.engagedHand);
      this.footerEl.object3D.visible = locked;
      if (locked) this.renderFooter();
      if (this.data.hint) this.el.setAttribute('hint-zone', 'desktopLabel', locked ? 'Exit menu' : this.data.hintLabel);
      this.el.emit(locked ? 'crossbar-menu-locked' : 'crossbar-menu-unlocked', {}, false);
      this.render();
    },

    setEngagedHand: function (handEl) {
      if (this.engagedHand === handEl) return;
      var previous = this.engagedHand;
      this.engagedHand = handEl;
      this.glowEl.object3D.visible = Boolean(handEl) || this.locked;
      if (previous) previous.emit('menu-stick-released', { menuEl: this.el }, false);
      if (handEl) handEl.emit('menu-stick-engaged', { menuEl: this.el }, false);
      this.render();
    },

    getWorldPosition: function (target) {
      return this.el.object3D.getWorldPosition(target);
    },

    remove: function () {
      this.setEngagedHand(null);
      if (this.system) this.system.unregisterMenu(this);
      this.el.sceneEl.removeEventListener('input-family-changed', this.onFamilyChanged);
      this.tiles.forEach(function (tile) { tile.thumb.geometry.dispose(); tile.thumb.material.dispose(); });
    },
  });
}
