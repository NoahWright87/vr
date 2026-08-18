      // ==============================================================
      // WORLD: town
      // The generic half of teleport: a flat list of named spots
      // (TOWN_LOCATIONS) and teleport-hub, the component on #player-rig
      // that can jump to any of them. Deliberately knows nothing about
      // what's AT any of those spots — the range is the scene's
      // original origin, unchanged; the saloon (world-saloon-darts.js),
      // the farm (world-farm.js) and the stable (world-stable.js) each
      // just look up their own entry by id and build themselves out at
      // its position. Each location is its own file — none of them
      // read or modify another's state, so none of them can disturb
      // each other — placed far enough apart in the world that nothing
      // has to know the rest of the town exists. A few of them share
      // generic scenery code (world-structures.js) without sharing
      // anything location-specific. Adding another stop later is one
      // more entry here plus whatever world-<place>.js builds it, not a
      // change to this file.
      //
      // Split out as its own file (rather than folded into core.js)
      // because it's the one other prototypes could plausibly lift
      // wholesale once a second one wants more than a single room —
      // see DESIGN.md's note about a future shared library.
      // ==============================================================

      var TELEPORT_FADE_OUT_MS = 180; // screen-to-black, before the jump
      var TELEPORT_FADE_IN_MS = 260; // black-to-screen, after it — slightly slower so the new place doesn't slam into view

      // Every place teleport-hub can send the player. id is what a
      // button's click handler names; label is what the button says;
      // position/rotationY is where #player-rig ends up. rotationY only
      // reorients the RIG's own yaw baseline (which way "forward" was
      // when you loaded in) — it can't and shouldn't touch which way
      // your actual head is turned inside the headset.
      var TOWN_LOCATIONS = [
        { id: 'range', label: 'The Range', position: { x: 0, y: 0, z: 0 }, rotationY: 0 },
        { id: 'saloon', label: 'The Saloon', position: { x: 0, y: 0, z: -60 }, rotationY: 0 },
        { id: 'farm', label: 'The Farm', position: { x: 0, y: 0, z: 60 }, rotationY: 0 },
        { id: 'stable', label: 'The Stable', position: { x: -60, y: 0, z: 0 }, rotationY: 0 },
      ];

      // Looked up by id rather than exported as an index — the list is
      // short enough that a linear scan every so often (scene-build
      // time, not per-frame) costs nothing, and it keeps TOWN_LOCATIONS
      // itself the one plain, obviously-editable array. Used by
      // teleport-hub for the jump itself, and by world-saloon-darts.js
      // to build its room at the same spot this list sends the player
      // to, instead of that position being written down twice.
      function findTownLocation(id) {
        for (var i = 0; i < TOWN_LOCATIONS.length; i++) {
          if (TOWN_LOCATIONS[i].id === id) return TOWN_LOCATIONS[i];
        }
        return null;
      }

      // ==============================================================
      // COMPONENT: teleport-hub
      // Lives on #player-rig. Builds the flat HTML button row from
      // TOWN_LOCATIONS (so a new location is one array entry, not a new
      // button to remember to add) and does the actual move: fade to
      // black, jump position/rotation while nothing is visible, fade
      // back in. No tick — it only ever does anything in response to a
      // button click.
      // ==============================================================
      registerComponent('teleport-hub', {
        init: function () {
          this.fadeEl = document.querySelector('#teleport-fade');
          this.fading = false;
          this.buildButtons();
        },

        buildButtons: function () {
          var container = document.querySelector('#teleport-buttons');
          if (!container) return;

          var self = this;
          TOWN_LOCATIONS.forEach(function (loc) {
            var btn = document.createElement('button');
            btn.textContent = loc.label;
            btn.addEventListener('click', function () {
              self.teleportTo(loc.id);
            });
            container.appendChild(btn);
          });
        },

        teleportTo: function (id) {
          if (this.fading) return; // one jump at a time

          var loc = null;
          for (var i = 0; i < TOWN_LOCATIONS.length; i++) {
            if (TOWN_LOCATIONS[i].id === id) {
              loc = TOWN_LOCATIONS[i];
              break;
            }
          }
          if (!loc) return;

          this.fading = true;
          var el = this.el;
          this.fadeTo(1, TELEPORT_FADE_OUT_MS, function () {
            el.object3D.position.set(loc.position.x, loc.position.y, loc.position.z);
            el.object3D.rotation.set(0, (loc.rotationY * Math.PI) / 180, 0);

            this.fadeTo(0, TELEPORT_FADE_IN_MS, function () {
              this.fading = false;
            }.bind(this));
          }.bind(this));
        },

        // Animates the fade plane's opacity via A-Frame's animation
        // component (consistent with how the rest of the codebase
        // handles one-shot property tweens — see pop-target's
        // animation__fall) and calls `done` once it's actually finished
        // rather than firing it early off a fixed timeout, so a slow
        // frame can't jump the position before black is fully up.
        fadeTo: function (opacity, dur, done) {
          if (!this.fadeEl) {
            done();
            return;
          }

          var fadeEl = this.fadeEl;
          var onDone = function () {
            fadeEl.removeEventListener('animationcomplete__fade', onDone);
            done();
          };
          fadeEl.addEventListener('animationcomplete__fade', onDone);
          fadeEl.setAttribute('animation__fade', {
            property: 'material.opacity',
            to: opacity,
            dur: dur,
            easing: 'linear',
          });
        },
      });
