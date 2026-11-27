      // ==============================================================
      // WORLD: player body
      // The player's own visible body (boxy-ghost) and the cowboy hat
      // (boxy-hat) it can wear. Split out of game.js — see DESIGN.md's
      // "File structure" section. Note GHOST_RADIUS is also read by
      // core-equip.js's boxy-belt (a worn belt matches the ghost's own
      // pill radius) — fine since every script here only runs inside
      // component init()/tick() callbacks, which fire after every
      // <script> on the page has finished loading, regardless of order.
      // ==============================================================

      var GHOST_RADIUS = 0.16; // meters — the pill's constant radius, and the dome's own radius
      var GHOST_TOP_Y = 0.1; // meters above the camera — matches head-anchor, so the dome just intersects the hat
      var GHOST_FRONT_Z = 0.03; // meters behind the camera that the front surface sits — see comment above
      var GHOST_COLOR = '#f5f3ee';
      var GHOST_OPACITY = 0.88;
      var EYE_COLOR = '#1a1a1a';
      var EYE_RADIUS = 0.02;
      var EYE_SPACING = 0.045; // meters, left/right from center
      var EYE_DROP = 0.05; // meters below GHOST_TOP_Y

      // BODY LENGTH — CYLINDER_HEIGHT is how far the straight pill body
      // runs before the skirt starts. 0.8m is picked so a worn belt
      // (see BELT/WARDROBE below), riding the waist anchor about
      // 0.75m below the headset, lands at roughly that same seam for an average
      // ~1.6-1.7m standing eye height — the belt reading as part of
      // the body rather than floating at some unrelated height.
      var CYLINDER_HEIGHT = 0.8;
      var SKIRT_HEIGHT = 0.2; // meters the wavy points hang below the cylinder's bottom rim
      var SKIRT_TEETH = 6;
      // ==============================================================
      // COMPONENT: boxy-hat
      // A simple cowboy hat: a wide flat brim plus a cylindrical crown,
      // built the same "very simple, boxy" way as boxy-gun. The one
      // thing that isn't simple: unlike boxy-gun (whose origin already
      // sits at a natural grip point, the trigger guard), this hat's
      // true geometric center is offset from its own entity origin by
      // -innerRadius on local X. The origin instead sits at one point
      // along the inner rim of the head-hole — as if a finger were
      // hooked under that one edge, rather than the hat balanced
      // centered on a fingertip. That's the whole trick behind "spin
      // axis like your finger's in the hat, offset to one side": since
      // holsterable's dangle physics always pivots around the entity
      // origin, putting the origin there directly (instead of at the
      // hat's middle) is all it takes — no hat-specific physics code.
      //
      // Because of that offset, holsterable's holsterPosition (set in
      // markup) has to counter it by +innerRadius so the hat renders
      // centered on your head when worn rather than shifted to one
      // side. innerRadius/crownHeight here need to stay in sync with
      // the holsterPosition/comOffset numbers on the hat entity in
      // markup — there's no shared constant linking them, the same way
      // boxy-gun's part dimensions and pistol's comOffset/heldRotation
      // are already just kept consistent by hand.
      // ==============================================================
      registerComponent('boxy-hat', {
        schema: {
          felt: { type: 'string', default: '#2b2320' },
          band: { type: 'string', default: '#5b3a29' },
        },

        init: function () {
          var el = this.el;
          var felt = this.data.felt;
          var band = this.data.band;

          var innerRadius = 0.11; // crown radius / head-hole size
          var crownHeight = 0.13;
          var brimRadius = 0.24;
          var brimThickness = 0.015;
          var cx = -innerRadius; // local x of the hat's true center, relative to the rim point the origin sits at

          var brim = document.createElement('a-cylinder');
          brim.setAttribute('radius', brimRadius);
          brim.setAttribute('height', brimThickness);
          brim.setAttribute('color', felt);
          brim.setAttribute('position', { x: cx, y: 0, z: 0 });
          el.appendChild(brim);

          var crown = document.createElement('a-cylinder');
          crown.setAttribute('radius', innerRadius);
          crown.setAttribute('height', crownHeight);
          crown.setAttribute('color', felt);
          crown.setAttribute('position', { x: cx, y: crownHeight / 2, z: 0 });
          el.appendChild(crown);

          var hatBand = document.createElement('a-cylinder');
          hatBand.setAttribute('radius', innerRadius + 0.004);
          hatBand.setAttribute('height', 0.03);
          hatBand.setAttribute('color', band);
          hatBand.setAttribute('position', { x: cx, y: 0.02, z: 0 });
          el.appendChild(hatBand);

          // A small slot tucked inside the crown's hollow interior —
          // "hide a gun in your hat." Positioned at the crown's true
          // center (cx), not the entity's own rim-edge origin, and
          // low enough to read as sitting down inside the hollow
          // rather than floating above the brim. Being a plain DOM/
          // object3D child of this entity, it automatically follows
          // the hat wherever holsterable reparents it — held, worn,
          // dangling, or resting — with no extra tracking code.
          var innerSlot = document.createElement('a-entity');
          innerSlot.classList.add('anchor-slot');
          innerSlot.setAttribute('anchor-slot', 'size: small');
          innerSlot.setAttribute('position', { x: cx, y: crownHeight * 0.35, z: 0 });
          el.appendChild(innerSlot);
        },
      });

      // ==============================================================
      // COMPONENT: boxy-ghost
      // The player's own body: Pac-Man-ghost simple, on purpose (see
      // the GHOST BODY / BODY LENGTH + BELT constants above for the
      // reasoning behind the exact numbers). A dome, a constant-radius
      // "pill" body (not tapering — see those comments for why), two
      // eyes, and a wavy skirt of pointed teeth around the bottom rim.
      //
      // No belt here any more — the real, swappable one (see `belt`)
      // rides the waist anchor at roughly this same seam height,
      // yaw-tracked rather than camera-child like the rest of this
      // shape (the same everywhere-else-in-the-file tension the hat
      // and the yaw-tracked back/waist anchors already have).
      //
      // Nested directly under the camera in markup (like the hat, not
      // like the yaw-only-tracked waist/back anchors) so it inherits
      // full head rotation for free — there's no separate torso to
      // keep upright independently of your head any more.
      // ==============================================================
      registerComponent('boxy-ghost', {
        init: function () {
          var el = this.el;
          var axisZ = GHOST_FRONT_Z + GHOST_RADIUS; // the shape's central vertical axis — every piece below is positioned relative to this, not to GHOST_FRONT_Z directly, so they stay concentric
          var seamY = GHOST_TOP_Y - CYLINDER_HEIGHT; // the pill/skirt seam

          function primitive(tag, attrs) {
            var e = document.createElement(tag);
            for (var key in attrs) e.setAttribute(key, attrs[key]);
            el.appendChild(e);
            return e;
          }

          // The dome — same radius as the pill so it caps it without a
          // visible step.
          primitive('a-sphere', {
            radius: GHOST_RADIUS,
            color: GHOST_COLOR,
            opacity: GHOST_OPACITY,
            transparent: true,
            position: { x: 0, y: GHOST_TOP_Y, z: axisZ },
          });

          // The straight "pill" body, constant radius all the way down
          // to the skirt seam.
          primitive('a-cylinder', {
            radius: GHOST_RADIUS,
            height: CYLINDER_HEIGHT,
            color: GHOST_COLOR,
            opacity: GHOST_OPACITY,
            transparent: true,
            position: { x: 0, y: GHOST_TOP_Y - CYLINDER_HEIGHT / 2, z: axisZ },
          });

          // Eyes sit right at the front clearance plane, a hair ahead
          // of the dome's own surface so they don't z-fight with it.
          [-1, 1].forEach(function (side) {
            primitive('a-sphere', {
              radius: EYE_RADIUS,
              color: EYE_COLOR,
              position: { x: side * EYE_SPACING, y: GHOST_TOP_Y - EYE_DROP, z: GHOST_FRONT_Z - 0.01 },
            });
          });

          // The wavy skirt: SKIRT_TEETH small cones fanned around the
          // bottom rim, each tapering to a point SKIRT_HEIGHT below the
          // seam. a-cone's radiusTop sits at its own local +Y and
          // radiusBottom at -Y, so radiusBottom: 0 alone gives a
          // downward-pointing tooth with no extra rotation needed.
          // toothRadius is sized a bit past exact edge-to-edge spacing
          // so adjacent teeth overlap slightly rather than leaving gaps.
          var toothChord = GHOST_RADIUS * Math.sin(Math.PI / SKIRT_TEETH);
          var toothRadius = toothChord * 1.3;
          for (var i = 0; i < SKIRT_TEETH; i++) {
            var angle = (i / SKIRT_TEETH) * Math.PI * 2;
            primitive('a-cone', {
              'radius-top': toothRadius,
              'radius-bottom': 0,
              height: SKIRT_HEIGHT,
              color: GHOST_COLOR,
              opacity: GHOST_OPACITY,
              transparent: true,
              position: {
                x: Math.sin(angle) * GHOST_RADIUS,
                y: seamY - SKIRT_HEIGHT / 2,
                z: axisZ + Math.cos(angle) * GHOST_RADIUS,
              },
            });
          }
        },
      });

      // buildHat + the hat-tan item-maker recipe — boxy-hat's own
      // wardrobe-stocked variant, left behind in game.js during the
      // original split, moved here on a later pass.
      // A wardrobe hat variant. Same holsterable numbers as the
      // original hat declared directly in markup (head-anchor's own
      // holsterPosition/heldPosition/comOffset have to agree with
      // boxy-hat's innerRadius offset — see that component's own
      // comment) — just built through the item-maker path instead so a
      // wardrobe peg can produce copies, with a different felt/band.
      function buildHat(el, slotId, felt, band) {
        el.setAttribute('holsterable', {
          holsterSelector: '#' + slotId,
          itemSize: 'medium',
          holsterRotation: { x: 0, y: 0, z: 0 },
          heldRotation: { x: 90, y: 0, z: 0 },
          holsterPosition: { x: 0.11, y: 0, z: 0 },
          heldPosition: { x: -0.1, y: 0, z: 0 },
          grabRadius: 0.35,
          grabPriority: 30,
          comOffset: { x: 0.11, y: -0.065, z: 0 },
        });
        el.setAttribute('boxy-hat', { felt: felt, band: band });
      }

      defineItem(
        'hat-tan',
        function (el, slotId) {
          buildHat(el, slotId, '#c9a86a', '#6b4a2f');
        },
        { keep: true }
      );

      // ==============================================================
      // WARDROBE
      // Your costume is your health bar (docs/pistols-at-dawn/
      // wardrobe.todo.md). You are a ghost and cannot be hurt, but every
      // worn item can be shot off you, and a ghost wearing nothing has
      // lost. The pieces:
      //
      //   anchor-slot `locked`   the body slots (head, chest, waist,
      //                          feet) can't be grabbed out of during
      //                          play. Fixes "reached for my gun,
      //                          grabbed my belt."
      //   wardrobe-slot          marks one of those slots as part of
      //                          the wardrobe: gives it its one hit
      //                          zone, dresses it from the outfit at
      //                          load, and announces changes.
      //   wearable               goes on the ITEM: which kind of slot it
      //                          is worn in, who owns it, and (while
      //                          loose) that it's shootable.
      //   liftable               (core-equip.js) the hat tip.
      //   wardrobeCanWear        THE rule for who may put what back on.
      //   knockOffWardrobe       a shot on a hit zone.
      //   wearItem / takeOffItem the deliberate way to change outfit,
      //                          for the clothier and the watch menu.
      //
      // Events, all on the scene so duel and style code can listen:
      //   wardrobe-changed  { kind: 'knocked-off' | 'worn' | 'removed',
      //                       slot, slotEl, item, shooter, filled, total }
      //   ghost-stripped    { shooter, item, total } -- nothing left on
      //   hat-tipped        (bubbles from the hat) see `liftable`
      // ==============================================================

      var WARDROBE_ZONE_RADIUS = 0.15; // meters. ONE size for every slot, whatever is worn: a sombrero is no easier to hit than a beanie. Tune by eye in a headset (add ?zones to the URL to draw them).
      var WARDROBE_KNOCK_SPEED = 3.2; // m/s along the shot's direction
      var WARDROBE_KNOCK_LIFT = 1.6; // m/s of upward kick on top, so it flies instead of skidding
      var WARDROBE_LOOSE_SHOT_SPEED = 2.4; // shooting a loose hat again sends it on its way
      var WARDROBE_OWNER = 'player'; // until profiles (phase 01-C) there is one wearer
      var WARDROBE_SHOW_ZONES = /[?&]zones\b/.test(window.location.search);

      // The slot list, in the order a status reads. Decided in phase
      // 01-A; see wardrobe.todo.md "Which slots" for why these four.
      var WARDROBE_SLOT_TYPES = ['hat', 'vest', 'belt', 'boots'];

      // Outfit = data: slot type -> item id (a key into ITEM_MAKERS).
      // Everyone starts a match with every slot filled; this is the free
      // rental. Phase 01-C replaces the body of currentOutfit() with the
      // player's chosen outfit; nothing else needs to change.
      var RENTAL_OUTFIT = { hat: 'hat-classic', vest: 'vest-classic', belt: 'belt-classic', boots: 'boots-classic' };

      function currentOutfit() {
        return RENTAL_OUTFIT;
      }

      // Which items are clothing, as data. `slot` is the kind of wardrobe
      // slot it is worn in; `lift` (optional) makes it a `liftable` that
      // announces that event -- the hat tip. A new cosmetic is one row.
      var WARDROBE_ITEMS = {
        'hat-classic': { slot: 'hat', lift: 'hat-tipped' },
        'hat-tan': { slot: 'hat', lift: 'hat-tipped' },
        'vest-classic': { slot: 'vest' },
        'belt-classic': { slot: 'belt' },
        'belt-silver': { slot: 'belt' },
        'boots-classic': { slot: 'boots' },
      };

      // PLACEHOLDER-ASSET: a modelled pair of cowboy boots (three boxes per boot here).
      registerComponent('boxy-boots', {
        schema: { color: { type: 'string', default: '#3b2a1c' }, trim: { type: 'string', default: '#c9962c' } },

        init: function () {
          var el = this.el;
          [-1, 1].forEach(function (side) {
            var shaft = document.createElement('a-box');
            shaft.setAttribute('width', 0.09);
            shaft.setAttribute('height', 0.16);
            shaft.setAttribute('depth', 0.09);
            shaft.setAttribute('color', this.data.color);
            shaft.setAttribute('position', { x: side * 0.1, y: 0.06, z: 0.01 });
            el.appendChild(shaft);

            var toe = document.createElement('a-box');
            toe.setAttribute('width', 0.09);
            toe.setAttribute('height', 0.07);
            toe.setAttribute('depth', 0.14);
            toe.setAttribute('color', this.data.color);
            toe.setAttribute('position', { x: side * 0.1, y: -0.015, z: -0.07 });
            el.appendChild(toe);

            var spur = document.createElement('a-box');
            spur.setAttribute('width', 0.02);
            spur.setAttribute('height', 0.02);
            spur.setAttribute('depth', 0.03);
            spur.setAttribute('color', this.data.trim);
            spur.setAttribute('position', { x: side * 0.1, y: 0.0, z: 0.07 });
            el.appendChild(spur);
          }, this);
        },
      });

      defineItem(
        'boots-classic',
        function (el, slotId) {
          el.setAttribute('holsterable', {
            holsterSelector: '#' + slotId,
            itemSize: 'medium',
            grabRadius: 0.3,
            grabPriority: 30,
            comOffset: { x: 0, y: 0.03, z: 0 },
          });
          el.setAttribute('boxy-boots', '');
        },
        { keep: true }
      );

      defineItem(
        'hat-classic',
        function (el, slotId) {
          buildHat(el, slotId, '#2b2320', '#5b3a29');
        },
        { keep: true }
      );

      // Tag every clothing maker with the wearable (and liftable) it
      // needs, here in one place, instead of editing every maker in every
      // file. `keep` is forced on: loose costume items must not perish
      // during a match, they are somebody's health bar.
      Object.keys(WARDROBE_ITEMS).forEach(function (name) {
        var maker = ITEM_MAKERS[name];
        if (!maker) return;
        var info = WARDROBE_ITEMS[name];
        var build = maker.build;
        maker.keep = true;
        maker.build = function (el, slotId) {
          build(el, slotId);
          el.setAttribute('wearable', 'slot', info.slot);
          if (info.lift) el.setAttribute('liftable', 'event', info.lift);
        };
      });

      // ==============================================================
      // wardrobeCanWear
      // THE rule for putting an item on a locked wardrobe slot by hand,
      // mid-match. The slot already guarantees it's empty (see
      // lockedSlotAdmits); this decides whether THIS item may go on it.
      // Today: "retrieve own" -- the right kind of item, and it must be
      // the wearer's own. Conservation of clothes, anyone's and hardcore
      // (wardrobe.todo.md "Rule options", phases 03-B and 04) replace
      // this one function and nothing else. Do not copy these checks
      // elsewhere.
      // ==============================================================
      function wardrobeCanWear(slotEl, holsterable) {
        var slot = slotEl.components['wardrobe-slot'];
        var wearable = holsterable.el.components.wearable;
        if (!slot || !wearable) return false;
        if (wearable.data.slot !== slot.data.type) return false;
        return wearable.owner === slot.data.owner;
      }

      function wardrobeSlotEls() {
        return Array.prototype.slice.call(document.querySelectorAll('[wardrobe-slot]'));
      }

      // A slot counts as filled while its item is lifted for a hat tip
      // too -- tipping your hat is not losing it.
      function wardrobeSlotFilled(slotEl) {
        var slot = slotEl.components['anchor-slot'];
        if (!slot) return false;
        if (slot.occupants.length) return true;
        var lifted = slot.lifted;
        return !!(lifted && lifted.liftHome === slotEl && lifted.el.isConnected);
      }

      // { filled, total, slots: [{ type, slotEl, item, filled }] } where
      // item is the worn (or lifted) element or null.
      function wardrobeStatus() {
        var slots = wardrobeSlotEls().map(function (slotEl) {
          var slot = slotEl.components['anchor-slot'];
          var holsterable = slot && (slot.occupants[0] || slot.lifted);
          return {
            type: slotEl.components['wardrobe-slot'].data.type,
            slotEl: slotEl,
            item: holsterable ? holsterable.el : null,
            filled: wardrobeSlotFilled(slotEl),
          };
        });
        slots.sort(function (a, b) {
          return WARDROBE_SLOT_TYPES.indexOf(a.type) - WARDROBE_SLOT_TYPES.indexOf(b.type);
        });
        return {
          filled: slots.filter(function (s) { return s.filled; }).length,
          total: slots.length,
          slots: slots,
        };
      }

      function announceWardrobe(kind, slotEl, itemEl, shooter) {
        var status = wardrobeStatus();
        var detail = {
          kind: kind,
          slot: slotEl.components['wardrobe-slot'].data.type,
          slotEl: slotEl,
          item: itemEl,
          shooter: shooter || null,
          filled: status.filled,
          total: status.total,
        };
        var scene = document.querySelector('a-scene');
        scene.emit('wardrobe-changed', detail, false);
        if (kind === 'knocked-off' && status.filled === 0) {
          scene.emit('ghost-stripped', { shooter: detail.shooter, item: itemEl, total: status.total }, false);
        }
        return detail;
      }

      // Which `shot`s are attacks. A gun's bullet always is. A loose
      // object that casts a shot as it flies (see holsterable.checkImpact)
      // only is if somebody THREW it; something merely dropped or shaken
      // loose is not. Otherwise a belt that has just been shot off would
      // fall past your boots and knock them off too, and a pistol spilling
      // from a knocked-off belt would strip you the rest of the way.
      function wardrobeShotCounts(shot) {
        var source = shot && shot.source;
        var holsterable = source && source.components && source.components.holsterable;
        if (!holsterable) return true;
        if (holsterable.state === 'falling' || holsterable.state === 'resting') return !!holsterable.wasThrown;
        return true;
      }

      // A shot on a hit zone: the worn item leaves its slot as an
      // ordinary physical object carrying the shot's direction (the same
      // throw path explosions and hands use, so it is catchable and
      // shootable in flight), and the slot is empty. A belt also drops
      // what was holstered on it (belt's own 'knocked-off' listener).
      function knockOffWardrobe(slotEl, shot) {
        var slot = slotEl.components['anchor-slot'];
        var holsterable = slot && slot.occupants[0];
        if (!holsterable) return false;

        var velocity = new THREE.Vector3(0, 0, -1);
        if (shot && shot.direction && shot.direction.lengthSq() > 1e-6) velocity.copy(shot.direction).normalize();
        velocity.multiplyScalar(WARDROBE_KNOCK_SPEED);
        velocity.y += WARDROBE_KNOCK_LIFT;
        velocity.isHurl = true; // no instant catch-back by the hand that was nearest

        var itemEl = holsterable.el;
        var shooter = (shot && shot.source) || null;
        holsterable.vacateSlot();
        holsterable.throwWithVelocity(velocity);
        itemEl.emit('knocked-off', { item: itemEl, slotEl: slotEl, shooter: shooter }, true);
        announceWardrobe('knocked-off', slotEl, itemEl, shooter);
        return true;
      }

      // ==============================================================
      // wearItem / takeOffItem
      // The deliberate way to change what you're wearing, for the
      // clothier (Boots & Suits, the mirror) and the watch menu's
      // Wardrobe page to call. Grabbing never changes outfit. Both take
      // a slot type ('hat') or a slot element.
      //
      // wearItem puts an existing clothing entity on; whatever was
      // there is displaced and falls (a belt hands its holstered guns on
      // to the new belt first -- see belt's 'displaced' listener).
      // Returns false if the item isn't the right kind of clothing.
      // ==============================================================
      function wardrobeSlotFor(ref) {
        if (ref && ref.nodeType) return ref;
        return wardrobeSlotEls().filter(function (el) {
          return el.components['wardrobe-slot'] && el.components['wardrobe-slot'].data.type === ref;
        })[0] || null;
      }

      function wearItem(ref, itemEl) {
        var slotEl = wardrobeSlotFor(ref);
        var ws = slotEl && slotEl.components['wardrobe-slot'];
        var holsterable = itemEl && itemEl.components.holsterable;
        var wearable = itemEl && itemEl.components.wearable;
        if (!ws || !holsterable || !wearable || wearable.data.slot !== ws.data.type) return false;

        if (holsterable.hand) {
          var rig = holsterable.hand.components['hand-rig'];
          if (rig) rig.discard(itemEl);
        }
        // A hat in the middle of a tip is simply worn again.
        var slotComp = slotEl.components['anchor-slot'];
        if (slotComp.lifted) {
          slotComp.lifted.liftHome = null;
          slotComp.lifted = null;
        }
        holsterable.liftHome = null;
        holsterable.vacateSlot();
        holsterable.state = 'holstered';
        holsterable.hand = null;
        holsterable.angularVelocity.set(0, 0, 0);
        holsterable.occupySlot(slotEl);
        return true;
      }

      // Takes what's in the slot off on purpose: it falls loose at your
      // feet. Returns the item element, or null if the slot was empty.
      function takeOffItem(ref) {
        var slotEl = wardrobeSlotFor(ref);
        var slot = slotEl && slotEl.components['anchor-slot'];
        var holsterable = slot && slot.occupants[0];
        if (!holsterable) return null;
        var itemEl = holsterable.el;
        holsterable.evict();
        announceWardrobe('removed', slotEl, itemEl, null);
        return itemEl;
      }

      // ==============================================================
      // COMPONENT: wearable
      // Goes on a piece of clothing (the WARDROBE_ITEMS tagging above
      // adds it). `slot` is the kind of wardrobe slot it is worn in;
      // `owner` is who it belongs to (set the first time it's worn).
      //
      // Worn, an item is NOT shootable: the slot's hit zone is, so every
      // slot is equally hard to hit whatever's on it. Loose (falling or
      // lying about), it is shootable like anything else, and a shot
      // sends it on its way again.
      // ==============================================================
      registerComponent('wearable', {
        schema: { slot: { type: 'string', default: '' } },

        init: function () {
          this.owner = '';
          this._loose = false;
          this.onShot = this.onShot.bind(this);
          this.el.addEventListener('shot', this.onShot);
        },

        remove: function () {
          this.el.removeEventListener('shot', this.onShot);
        },

        tick: function () {
          var holsterable = this.el.components.holsterable;
          if (!holsterable) return;
          var loose = holsterable.state === 'falling' || holsterable.state === 'resting';
          if (loose === this._loose) return;
          this._loose = loose;
          this.el.classList.toggle('shootable', loose);
        },

        onShot: function (evt) {
          var holsterable = this.el.components.holsterable;
          if (!this._loose || !holsterable) return;
          var direction = evt.detail && evt.detail.direction;
          var velocity = new THREE.Vector3(0, 0, -1);
          if (direction && direction.lengthSq() > 1e-6) velocity.copy(direction).normalize();
          velocity.multiplyScalar(WARDROBE_LOOSE_SHOT_SPEED);
          velocity.y += WARDROBE_KNOCK_LIFT * 0.6;
          velocity.isHurl = true;
          holsterable.throwWithVelocity(velocity);
        },
      });

      // ==============================================================
      // COMPONENT: wardrobe-slot
      // Goes on a body anchor-slot (alongside `locked: true`) to make it
      // a wardrobe slot of the given `type`. It owns that slot's single
      // hit zone: an invisible sphere, the same size for every slot,
      // carrying `.shootable`, which is live only while something is
      // worn there (a shot through a bare chest passes straight on, so
      // the less you wear the less of you there is to hit). It dresses
      // the slot from currentOutfit() at load, and announces every
      // later change.
      // ==============================================================
      registerComponent('wardrobe-slot', {
        schema: {
          type: { type: 'string', default: 'hat' }, // one of WARDROBE_SLOT_TYPES
          owner: { type: 'string', default: WARDROBE_OWNER },
        },

        init: function () {
          this.announcing = false; // quiet until the opening outfit is on, so load doesn't broadcast four "worn" events
          this.dressed = false;
          this.outfitRequested = false;

          var zone = document.createElement('a-entity');
          zone.classList.add('shootable');
          zone.classList.add('wardrobe-zone');
          zone.setAttribute('geometry', {
            primitive: 'sphere',
            radius: WARDROBE_ZONE_RADIUS,
            segmentsWidth: 10,
            segmentsHeight: 8,
          });
          zone.setAttribute(
            'material',
            WARDROBE_SHOW_ZONES
              ? 'shader: flat; color: #ff4d4d; wireframe: true; transparent: true; opacity: 0.5'
              : 'shader: flat; visible: false'
          );
          this.el.appendChild(zone);
          zone.object3D.visible = false;
          this.zone = zone;

          this.onShot = this.onShot.bind(this);
          this.onOccupied = this.onOccupied.bind(this);
          zone.addEventListener('shot', this.onShot);
          this.el.addEventListener('slot-occupied', this.onOccupied);
        },

        remove: function () {
          this.zone.removeEventListener('shot', this.onShot);
          this.el.removeEventListener('slot-occupied', this.onOccupied);
          if (this.zone.parentNode) this.zone.parentNode.removeChild(this.zone);
        },

        tick: function () {
          var slot = this.el.components['anchor-slot'];
          if (!slot) return;

          // The zone is live exactly while something is worn. A hat
          // lifted for a tip is not on the head (nothing there to hit).
          var worn = slot.occupants.length > 0;
          if (this.zone.object3D.visible !== worn) this.zone.object3D.visible = worn;

          if (this.dressed) return;
          if (!this.outfitRequested) {
            this.outfitRequested = true;
            var itemId = currentOutfit()[this.data.type];
            if (itemId && !slot.occupants.length) makeItem(itemId, this.el);
            else this.dressed = true;
          } else if (slot.occupants.length) {
            // The new item claims its slot on its own first tick.
            this.dressed = true;
          }
          if (this.dressed) this.announcing = true;
        },

        onShot: function (evt) {
          if (!wardrobeShotCounts(evt.detail)) return;
          knockOffWardrobe(this.el, evt.detail);
        },

        onOccupied: function (evt) {
          var wearable = evt.detail.item.components.wearable;
          // Putting something on makes it yours (the first time).
          if (wearable && !wearable.owner) wearable.owner = this.data.owner;
          if (this.announcing && !evt.detail.returned) announceWardrobe('worn', this.el, evt.detail.item, null);
        },
      });
