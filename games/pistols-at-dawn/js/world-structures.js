      // ==============================================================
      // WORLD: structures
      // Shared scenery-building helpers that more than one town location
      // wants — currently just a roof, used by both the farm's barn and
      // the stable. Nothing here is a component or builds anything on
      // its own; each function takes the parent entity to build into
      // and returns nothing, the same "dumb builder" shape as core.js's
      // particle/geometry helpers. A location-specific file (world-
      // farm.js, world-stable.js, ...) stays the one place that decides
      // WHERE and with WHAT NUMBERS to call these — this file only
      // knows how to build the shape.
      // ==============================================================

      // ==============================================================
      // buildGableRoof
      // Two slabs meeting at a ridge, built from opts:
      //   width, depth, wallHeight, pitchDeg, color, thickness, overhang
      // (all required). Solved from the actual ridge/eave coordinates
      // rather than plugging pitchDeg straight into rotation.x, because
      // the two slabs are NOT mirror images of each other in rotation
      // terms — a box has no direction to its own depth axis, so the
      // far-side slab needs an angle on the far side of 90° from the
      // near-side slab's, not its negative. This is the same "compute
      // both endpoints, find the midpoint and the angle between them"
      // technique boxy-bow's addString uses for the bowstring, just for
      // a fixed shape instead of one that moves every frame. Extending
      // the eave point along the same ridge-to-eave line by `overhang`
      // (rather than just padding the box's depth) is what keeps the
      // slope angle exact while still overhanging the wall.
      // ==============================================================
      function buildGableRoof(parentEl, opts) {
        var halfDepth = opts.depth / 2;
        var pitchRad = (opts.pitchDeg * Math.PI) / 180;
        var rise = halfDepth * Math.tan(pitchRad);
        var ridgeY = opts.wallHeight + rise;

        [-1, 1].forEach(function (sign) {
          var dirY = opts.wallHeight - ridgeY; // = -rise, ridge to eave
          var dirZ = sign * halfDepth;
          var runLength = Math.sqrt(dirY * dirY + dirZ * dirZ);
          var t = (runLength + opts.overhang) / runLength;
          var farY = ridgeY + dirY * t;
          var farZ = dirZ * t;

          var slab = document.createElement('a-box');
          slab.setAttribute('width', opts.width + opts.overhang * 2);
          slab.setAttribute('height', opts.thickness);
          slab.setAttribute('depth', runLength + opts.overhang);
          slab.setAttribute('color', opts.color);
          slab.setAttribute('position', { x: 0, y: (ridgeY + farY) / 2, z: farZ / 2 });
          slab.setAttribute('rotation', { x: (Math.atan2(-dirY, dirZ) * 180) / Math.PI, y: 0, z: 0 });
          parentEl.appendChild(slab);
        });
      }
