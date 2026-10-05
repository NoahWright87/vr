      // ==============================================================
      // ITEMS: bar
      // The beer bottle and the water jug — both boxy visuals built
      // on the same origin convention (at the neck, where a hand
      // closes around it) that lets holsterable's existing dangle
      // physics swing either one exactly like a pistol, with no
      // bottle-specific physics anywhere. Split out of game.js — see
      // DESIGN.md's "File structure" section. BOTTLE_STRIKE_SPEED/
      // GRACE_MS stay in game.js: match striking (items-vices.js)
      // reuses them too.
      // ==============================================================

      var CAP_HITBOX_RADIUS = 0.035; // meters — the collider that has to make contact
      // ==============================================================
      // COMPONENT: boxy-bottle
      // A beer bottle, built the same "pile of primitives" way as
      // boxy-gun, and following the same origin convention for the
      // same reason: the entity's origin sits at the NECK, where your
      // hand would actually close around it, not at the bottle's
      // center. That one choice is what lets holsterable's existing
      // dangle physics swing a bottle from your trigger finger exactly
      // like a pistol, with no bottle-specific physics anywhere.
      //
      // Two named pieces matter to the "bottle" component: the cap,
      // which carries its own small collider (.cap-hitbox) and has to
      // physically strike something to come off, and the spout, which
      // marks the pouring end the way ".muzzle" marks the shooting end
      // of a gun.
      // ==============================================================
      var BOTTLE_BASE_Y = -0.2225; // local y of the bottom of the bottle
      var BOTTLE_CAP_Y = 0.049;
      var BOTTLE_SPOUT_Y = 0.043;
      var BOTTLE_GLASS_TEXTURE = 'assets/textures/olive-bottle-glass-v1.png';
      var BOTTLE_LABEL_TEXTURES = {
        sunset: 'assets/textures/label-sunset-lager-v1.png',
        canyon: 'assets/textures/label-canyon-ale-v1.png',
        prairie: 'assets/textures/label-prairie-stout-v1.png',
      };

      registerComponent('boxy-bottle', {
        schema: {
          glass: { type: 'color', default: '#3f6b3a' },
          label: { type: 'color', default: '#d9c27a' },
          labelVariant: { type: 'string', default: 'sunset' },
        },

        init: function () {
          var el = this.el;
          var glass = this.data.glass;

          function addCylinder(radius, height, y, color, opacity) {
            var c = document.createElement('a-cylinder');
            c.setAttribute('radius', radius);
            c.setAttribute('height', height);
            c.setAttribute('position', { x: 0, y: y, z: 0 });
            c.setAttribute(
              'material',
              'color: ' + color + '; opacity: ' + (opacity === undefined ? 1 : opacity) + '; transparent: true'
            );
            el.appendChild(c);
            return c;
          }

          var body = addCylinder(0.042, 0.135, -0.155, glass, 0.85); // body
          body.setAttribute('material', { src: BOTTLE_GLASS_TEXTURE, color: glass, opacity: 0.85, transparent: true, shader: 'flat' });
          var label = addCylinder(0.0425, 0.05, -0.16, this.data.label, 1); // paper label
          var labelTexture = BOTTLE_LABEL_TEXTURES[this.data.labelVariant] || BOTTLE_LABEL_TEXTURES.sunset;
          label.setAttribute('material', { src: labelTexture, color: '#ffffff', shader: 'flat' });
          var neck = addCylinder(0.018, 0.075, 0.005, glass, 0.85); // neck
          neck.setAttribute('material', { src: BOTTLE_GLASS_TEXTURE, color: glass, opacity: 0.85, transparent: true, shader: 'flat' });

          var shoulder = document.createElement('a-entity');
          shoulder.setAttribute('geometry', {
            primitive: 'cone',
            radiusBottom: 0.042,
            radiusTop: 0.018,
            height: 0.055,
          });
          shoulder.setAttribute('material', 'color: ' + glass + '; opacity: 0.85; transparent: true');
          shoulder.setAttribute('material', { src: BOTTLE_GLASS_TEXTURE, color: glass, opacity: 0.85, transparent: true, shader: 'flat' });
          shoulder.setAttribute('position', { x: 0, y: -0.06, z: 0 });
          el.appendChild(shoulder);

          // The contents. Beer is infinite here (see the POUR
          // constants), so this never drains — it's just what you see
          // through the glass.
          var liquid = document.createElement('a-cylinder');
          liquid.setAttribute('radius', 0.035);
          liquid.setAttribute('height', 0.125);
          liquid.setAttribute('position', { x: 0, y: -0.15, z: 0 });
          liquid.setAttribute('material', 'color: #c8871f; opacity: 0.95; transparent: true');
          el.appendChild(liquid);

          // The cap, and the small collider that has to make contact
          // with something solid before it'll come off. Both are
          // hidden together once it does.
          var cap = document.createElement('a-entity');
          cap.classList.add('bottle-cap');
          cap.setAttribute('position', { x: 0, y: BOTTLE_CAP_Y, z: 0 });
          el.appendChild(cap);

          var capDisc = document.createElement('a-cylinder');
          capDisc.setAttribute('radius', 0.021);
          capDisc.setAttribute('height', 0.014);
          capDisc.setAttribute('color', '#c9a227');
          cap.appendChild(capDisc);

          var capHitbox = document.createElement('a-sphere');
          capHitbox.setAttribute('radius', CAP_HITBOX_RADIUS);
          capHitbox.setAttribute('material', 'opacity: 0; transparent: true; depthWrite: false');
          capHitbox.classList.add('cap-hitbox');
          cap.appendChild(capHitbox);

          var spout = document.createElement('a-entity');
          spout.setAttribute('position', { x: 0, y: BOTTLE_SPOUT_Y, z: 0 });
          spout.classList.add('spout');
          el.appendChild(spout);

          // Generous, invisible, and the whole reason shooting a
          // tumbling bottle out of the air is satisfying rather than
          // maddening — see createHitbox.
          el.appendChild(createHitbox(0.075, 0.3, { x: 0, y: -0.09, z: 0 }));
        },
      });
      // ==============================================================
      // COMPONENT: boxy-jug
      // A water jug: a fat stoneware body with a handle and an open
      // neck. Origin at the neck like a bottle's, so it grips, dangles
      // and pours through exactly the same code — the only thing that
      // makes it a jug rather than a beer is the word "water" in its
      // pourable, and the fact it was born with no cap.
      // ==============================================================
      var JUG_BASE_Y = -0.28;

      registerComponent('boxy-jug', {
        init: function () {
          var el = this.el;
          var clay = '#9c8466';

          function cylinder(radius, height, y, color) {
            var c = document.createElement('a-cylinder');
            c.setAttribute('radius', radius);
            c.setAttribute('height', height);
            c.setAttribute('position', { x: 0, y: y, z: 0 });
            c.setAttribute('color', color);
            el.appendChild(c);
            return c;
          }

          cylinder(0.075, 0.19, -0.185, clay); // body
          cylinder(0.03, 0.08, -0.05, clay); // neck

          var shoulder = document.createElement('a-entity');
          shoulder.setAttribute('geometry', { primitive: 'cone', radiusBottom: 0.075, radiusTop: 0.03, height: 0.06 });
          shoulder.setAttribute('material', 'color: ' + clay);
          shoulder.setAttribute('position', { x: 0, y: -0.06, z: 0 });
          el.appendChild(shoulder);

          var handle = document.createElement('a-torus');
          handle.setAttribute('radius', 0.045);
          handle.setAttribute('radius-tubular', 0.008);
          handle.setAttribute('color', clay);
          handle.setAttribute('rotation', '0 90 0');
          handle.setAttribute('position', { x: 0.075, y: -0.1, z: 0 });
          el.appendChild(handle);

          var band = document.createElement('a-cylinder');
          band.setAttribute('radius', 0.077);
          band.setAttribute('height', 0.03);
          band.setAttribute('position', { x: 0, y: -0.16, z: 0 });
          band.setAttribute('color', '#5d7fa0');
          el.appendChild(band);

          var spout = document.createElement('a-entity');
          spout.setAttribute('position', { x: 0, y: -0.008, z: 0 });
          spout.classList.add('spout');
          el.appendChild(spout);

          el.appendChild(createHitbox(0.1, 0.34, { x: 0, y: -0.15, z: 0 }));
        },
      });
