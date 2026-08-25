      // ==============================================================
      // WORLD: town / area loading
      // Only the player and shared simulation services live for the whole
      // session. Each destination is an HTML fragment under areas/ and its
      // builder scripts are loaded the first time that destination is used.
      // The old area's entity tree is removed after the next fragment has
      // arrived, so invisible destinations do not render, tick, raycast, or
      // participate in any of the scene-wide interaction scans.
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
        {
          id: 'ghost-town', label: 'Ghost Town', position: { x: 0, y: 0, z: 24 }, rotationY: 0,
          fragment: 'areas/ghost-town.html',
          arrivals: {
            'saloon-entrance': { position: { x: -5.7, y: 0, z: 12 }, rotationY: 90 },
            'sheriff-entrance': { position: { x: -5.45, y: 0, z: 6 }, rotationY: 90 },
            'store-entrance': { position: { x: 6.1, y: 0, z: 6 }, rotationY: -90 },
            'bank-entrance': { position: { x: -6.3, y: 0, z: 0 }, rotationY: 90 },
            'pharmacy-entrance': { position: { x: -6.25, y: 0, z: -12 }, rotationY: 90 },
          },
          scripts: ['js/world-ghost-town-stalls.js', 'js/world-targets.js', 'js/world-ghost-town-gallery.js'],
        },
        {
          id: 'range', label: 'The Range', position: { x: 0, y: 0, z: 0 }, rotationY: 0,
          fragment: 'areas/range.html',
          scripts: ['js/items-siege-weapons.js', 'js/world-saloon-bar.js', 'js/world-shooting-stall.js', 'js/world-targets.js'],
        },
        {
          id: 'saloon', label: 'The Saloon', position: { x: 0, y: 0, z: -60 }, rotationY: 0,
          fragment: 'areas/saloon.html', scripts: ['js/world-saloon-darts.js', 'js/world-saloon-interior.js'],
        },
        {
          id: 'sheriff-office', label: "Sheriff's Office", position: { x: 60, y: 0, z: 0 }, rotationY: 0,
          fragment: 'areas/sheriff-office.html', scripts: ['js/world-hub-interiors.js'],
        },
        {
          id: 'general-store', label: 'General Store', position: { x: 0, y: 0, z: -120 }, rotationY: 0,
          fragment: 'areas/general-store.html', scripts: ['js/world-hub-interiors.js'],
        },
        {
          id: 'bank', label: 'The Bank', position: { x: -120, y: 0, z: 0 }, rotationY: 0,
          fragment: 'areas/bank.html', scripts: ['js/world-hub-interiors.js'],
        },
        {
          id: 'pharmacy', label: 'The Pharmacy', position: { x: 0, y: 0, z: 120 }, rotationY: 0,
          fragment: 'areas/pharmacy.html', scripts: ['js/world-hub-interiors.js'],
        },
        {
          id: 'farm', label: 'The Farm', position: { x: 0, y: 0, z: 60 }, rotationY: 0,
          fragment: 'areas/farm.html', scripts: ['js/world-farm.js'],
        },
        {
          id: 'stable', label: 'The Stable', position: { x: -60, y: 0, z: 0 }, rotationY: 0,
          fragment: 'areas/stable.html', scripts: ['js/world-stable.js'],
        },
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

      var AREA_SCRIPT_PROMISES = {};

      function loadAreaScript(src) {
        if (AREA_SCRIPT_PROMISES[src]) return AREA_SCRIPT_PROMISES[src];
        AREA_SCRIPT_PROMISES[src] = new Promise(function (resolve, reject) {
          var script = document.createElement('script');
          script.src = src;
          script.async = false;
          script.addEventListener('load', resolve, { once: true });
          script.addEventListener('error', function () {
            delete AREA_SCRIPT_PROMISES[src];
            reject(new Error('Could not load area script: ' + src));
          }, { once: true });
          document.body.appendChild(script);
        });
        return AREA_SCRIPT_PROMISES[src];
      }

      function loadAreaScripts(scripts) {
        return scripts.reduce(function (ready, src) {
          return ready.then(function () { return loadAreaScript(src); });
        }, Promise.resolve());
      }

      // Owns the one active destination. A MutationObserver marks effects or
      // projectiles appended directly to the scene. Props keep their original
      // DOM parent while their three.js object is attached to hands and slots,
      // so unloadActiveArea separately moves carried prop elements into a
      // persistent DOM home before removing the area's tree.
      registerComponent('area-manager', {
        init: function () {
          this.host = document.querySelector('#area-host');
          this.carriedHost = document.querySelector('#carried-items');
          this.loadingText = document.querySelector('#area-loading-text');
          this.activeId = null;
          this.activeRoot = null;
          this.switchPromise = null;
          this.observeOwnership();

          var start = function () {
            this.setLoading(true, 'Loading Ghost Town...');
            this.switchTo('ghost-town').then(function () {
              var rig = document.querySelector('#player-rig');
              var hub = rig && rig.components['teleport-hub'];
              var location = findTownLocation('ghost-town');
              if (rig && location) {
                rig.object3D.position.set(location.position.x, location.position.y, location.position.z);
                rig.object3D.rotation.set(0, (location.rotationY * Math.PI) / 180, 0);
              }
              this.setLoading(false);
              if (hub) hub.fadeTo(0, TELEPORT_FADE_IN_MS, function () {});
            }.bind(this)).catch(function (error) {
              this.showLoadError(error);
            }.bind(this));
          }.bind(this);

          if (this.el.hasLoaded) start();
          else this.el.addEventListener('loaded', start, { once: true });
        },

        remove: function () {
          if (this.observer) this.observer.disconnect();
        },

        observeOwnership: function () {
          var self = this;
          this.observer = new MutationObserver(function (mutations) {
            mutations.forEach(function (mutation) {
              Array.prototype.forEach.call(mutation.addedNodes, function (node) {
                if (node.nodeType !== 1) return;
                var persistent = node.closest && node.closest('[data-area-persistent]');
                if (persistent) {
                  self.clearOwnership(node);
                  return;
                }
                if (!self.activeId || node === self.host || (self.host && self.host.contains(node))) return;
                node.setAttribute('data-area-owner', self.activeId);
              });
            });
          });
          this.observer.observe(this.el, { childList: true, subtree: true });
        },

        clearOwnership: function (root) {
          if (root.removeAttribute) root.removeAttribute('data-area-owner');
          if (!root.querySelectorAll) return;
          Array.prototype.forEach.call(root.querySelectorAll('[data-area-owner]'), function (el) {
            el.removeAttribute('data-area-owner');
          });
        },

        setLoading: function (visible, message) {
          if (!this.loadingText) return;
          if (message) this.loadingText.setAttribute('text', 'value', message);
          this.loadingText.setAttribute('visible', visible);
        },

        showLoadError: function (error) {
          this.setLoading(true, 'Could not load area');
          console.error('[pistols] Area load failed:', error);
        },

        switchTo: function (id) {
          if (id === this.activeId) return Promise.resolve(this.activeRoot);
          if (this.switchPromise) return this.switchPromise;

          var loc = findTownLocation(id);
          if (!loc) return Promise.reject(new Error('Unknown area: ' + id));
          this.setLoading(true, 'Loading ' + loc.label + '...');
          this.el.emit('area-loading', { id: id, location: loc }, false);

          var markupPromise = fetch(loc.fragment).then(function (response) {
            if (!response.ok) throw new Error('Could not load ' + loc.fragment + ' (' + response.status + ')');
            return response.text();
          });

          this.switchPromise = Promise.all([loadAreaScripts(loc.scripts || []), markupPromise])
            .then(function (results) {
              this.unloadActiveArea();

              var root = document.createElement('a-entity');
              root.setAttribute('data-area-root', id);
              root.innerHTML = results[1];
              this.host.appendChild(root);
              this.activeId = id;
              this.activeRoot = root;

              return new Promise(function (resolve) {
                if (root.hasLoaded) resolve(root);
                else root.addEventListener('loaded', function () { resolve(root); }, { once: true });
              });
            }.bind(this))
            .then(function (root) {
              this.setLoading(false);
              this.el.emit('area-loaded', { id: id, location: loc, root: root }, false);
              return root;
            }.bind(this))
            .finally(function () {
              this.switchPromise = null;
            }.bind(this));

          return this.switchPromise;
        },

        unloadActiveArea: function () {
          if (!this.activeId) return;
          var oldId = this.activeId;
          this.el.emit('area-unloading', { id: oldId, root: this.activeRoot }, false);
          this.activeId = null;

          this.preservePlayerItems();

          if (this.activeRoot && this.activeRoot.parentNode) this.activeRoot.parentNode.removeChild(this.activeRoot);
          this.activeRoot = null;

          // These are pooled globally for allocation-free effects, so clear
          // their live records rather than carrying fire/smoke to a new town.
          if (typeof resetTransientWorld === 'function') resetTransientWorld();

          Array.prototype.forEach.call(document.querySelectorAll('[data-area-owner="' + oldId + '"]'), function (el) {
            if (!el.closest('[data-area-persistent]') && el.parentNode) el.parentNode.removeChild(el);
          });

          // Area furniture may register a collision surface in its own local
          // frame. Drop any whose entity left the document with the area.
          for (var i = HARD_SURFACES.length - 1; i >= 0; i--) {
            var obj = HARD_SURFACES[i].obj;
            if (obj && obj.el && !obj.el.isConnected) HARD_SURFACES.splice(i, 1);
          }
        },

        preservePlayerItems: function () {
          if (!this.activeRoot || !this.carriedHost) return;
          var self = this;
          Array.prototype.forEach.call(this.activeRoot.querySelectorAll('[holsterable]'), function (el) {
            var holsterable = el.components && el.components.holsterable;
            if (!holsterable || !self.isPlayerOwnedObject(holsterable)) return;

            // Moving the element can make A-Frame briefly adopt object3D into
            // the new DOM parent's graph. Restore its real physics parent and
            // exact local pose afterwards; component state stays untouched.
            var object = el.object3D;
            var objectParent = object.parent;
            var position = object.position.clone();
            var quaternion = object.quaternion.clone();
            var scale = object.scale.clone();
            self.clearOwnership(el);
            self.carriedHost.appendChild(el);
            if (objectParent) objectParent.add(object);
            object.position.copy(position);
            object.quaternion.copy(quaternion);
            object.scale.copy(scale);
          });
        },

        isPlayerOwnedObject: function (holsterable) {
          if (holsterable.hand && holsterable.hand.closest('[data-area-persistent]')) return true;

          var node = holsterable.el.object3D.parent;
          while (node) {
            if (node.el && node.el.closest && node.el.closest('[data-area-persistent]')) return true;
            node = node.parent;
          }
          return false;
        },
      });

      // ==============================================================
      // COMPONENT: teleport-hub
      // Lives on #player-rig. Builds the flat HTML button row from
      // TOWN_LOCATIONS (so a new location is one array entry, not a new
      // button to remember to add) and does the actual move: fade to
      // black, jump position/rotation while nothing is visible, fade
      // back in. No tick — it only ever does anything in response to a
      // button click or a watch menu selection.
      //
      // The watch (common/watch-menu.js, wired up in index.html's
      // hand-with-watch markup) is the in-headset half of teleport —
      // the flat HTML buttons are a desktop/phone convenience, same as
      // the reticle fallback elsewhere in this file, and were never
      // reachable by hand in a headset. Both hands sit inside
      // #player-rig (see index.html's own comment on that), so a
      // menu-item-select from either watch's panel bubbles up through
      // this.el on its way to <a-scene> — no separate listener needed
      // on the watch's own markup. The template (index.html's TELEPORT
      // page) names each destination "teleport-<id>"; this only needs
      // to strip that prefix and hand the id to the exact same
      // teleportTo() the buttons already call.
      // ==============================================================
      registerComponent('teleport-hub', {
        init: function () {
          this.fadeEl = document.querySelector('#teleport-fade');
          this.fading = false;
          this.buildButtons();

          this.onMenuSelect = this.onMenuSelect.bind(this);
          this.el.addEventListener('menu-item-select', this.onMenuSelect);
        },

        remove: function () {
          this.el.removeEventListener('menu-item-select', this.onMenuSelect);
        },

        onMenuSelect: function (evt) {
          var value = evt.detail.value;
          if (value.indexOf('teleport-') !== 0) return;
          this.teleportTo(value.slice('teleport-'.length));
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

        teleportTo: function (id, arrival) {
          if (this.fading) return; // one jump at a time

          var loc = null;
          for (var i = 0; i < TOWN_LOCATIONS.length; i++) {
            if (TOWN_LOCATIONS[i].id === id) {
              loc = TOWN_LOCATIONS[i];
              break;
            }
          }
          if (!loc) return;

          var areaManager = this.el.sceneEl.components['area-manager'];
          if (!areaManager) return;

          this.fading = true;
          var el = this.el;
          this.fadeTo(1, TELEPORT_FADE_OUT_MS, function () {
            areaManager.switchTo(id).then(function () {
              var destination = (arrival && arrival.position) || loc.position;
              var rotationY = arrival && Number.isFinite(arrival.rotationY) ? arrival.rotationY : loc.rotationY;
              el.object3D.position.set(destination.x, destination.y, destination.z);
              el.object3D.rotation.set(0, (rotationY * Math.PI) / 180, 0);

              this.fadeTo(0, TELEPORT_FADE_IN_MS, function () {
                this.fading = false;
              }.bind(this));
            }.bind(this)).catch(function (error) {
              areaManager.showLoadError(error);
              this.fadeTo(0, TELEPORT_FADE_IN_MS, function () {
                this.fading = false;
              }.bind(this));
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

      // A town door owns just one action: once an interaction hint selects
      // it, use the same fade-and-area-switch route as Watch teleport. The
      // hint system is input-source neutral, so keyboard E, gamepad X, and
      // the touch-screen INTERACT button all arrive here as one event.
      registerComponent('town-door', {
        schema: {
          destination: { default: 'saloon' },
          arrival: { default: '' },
        },

        init: function () {
          this.onSemanticAction = this.onSemanticAction.bind(this);
          this.el.addEventListener('semantic-action', this.onSemanticAction);
        },

        onSemanticAction: function (evt) {
          var detail = evt.detail || {};
          if (detail.action !== 'mounted' || detail.phase !== 'start') return;
          var rig = document.querySelector('#player-rig');
          var hub = rig && rig.components['teleport-hub'];
          var location = findTownLocation(this.data.destination);
          var arrival = location && location.arrivals && location.arrivals[this.data.arrival];
          if (hub) hub.teleportTo(this.data.destination, arrival);
        },

        remove: function () {
          this.el.removeEventListener('semantic-action', this.onSemanticAction);
        },
      });
