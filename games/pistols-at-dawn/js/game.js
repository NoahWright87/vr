      // ==============================================================
      // SAFE TICKS
      // A-Frame runs every component's tick from one loop, so a single
      // exception anywhere kills the render loop and the whole scene
      // freezes. That is far too sharp an edge for a file whose entire
      // premise is objects combining in ways nobody planned: a stale
      // method name in a respawn path (which is exactly what happened
      // — breakable was still calling cigar.restore() after that moved
      // to burnable) shouldn't take the saloon down with it.
      //
      // So every component registered below gets its tick wrapped. The
      // first failure is reported loudly, that one component's tick is
      // switched off, and everything else keeps running. Losing one
      // prop's behavior is a bug; losing the entire world is an
      // outage.
      // ==============================================================
      function registerComponent(name, definition) {
        var tick = definition.tick;
        if (tick) {
          definition.tick = function (time, dt) {
            if (this._tickFailed) return;
            try {
              tick.call(this, time, dt);
            } catch (error) {
              this._tickFailed = true;
              console.error('[pistols] "' + name + '" tick failed and has been disabled:', error);
            }
          };
        }
        AFRAME.registerComponent(name, definition);
      }

      // ==============================================================
      // LOW-POLY GEOMETRY DEFAULTS
      // A-Frame builds a-cylinder at 36 radial x 18 height segments and
      // a-sphere at 36 x 18, which is ~1300 triangles for a bottle neck
      // and ~1200 for a puff of smoke. Measured on this scene that was
      // 276,000 triangles, 97% of it in cylinders and spheres, for an
      // art style whose entire premise is that everything is a box.
      //
      // Patching the registered primitives' schema defaults here — before
      // the scene initializes — applies to every entity in the file,
      // including ones created at runtime, without touching a single
      // creation site. It also makes A-Frame's geometry cache hit far
      // more often, since fewer distinct parameter sets exist.
      // ==============================================================
      (function lowerPolyBudget() {
        function setDefault(primitive, property, value) {
          var geometry = AFRAME.geometries[primitive];
          if (geometry && geometry.schema[property]) geometry.schema[property].default = value;
        }

        setDefault('cylinder', 'segmentsRadial', 14);
        setDefault('cylinder', 'segmentsHeight', 1);
        setDefault('cone', 'segmentsRadial', 14);
        setDefault('cone', 'segmentsHeight', 1);
        setDefault('sphere', 'segmentsWidth', 12);
        setDefault('sphere', 'segmentsHeight', 8);
        setDefault('circle', 'segments', 20);
        setDefault('torus', 'segmentsRadial', 12);
        setDefault('torus', 'segmentsTubular', 8);
        setDefault('ring', 'segmentsTheta', 20);
      })();

      // ==============================================================
      // TUNING CONSTANTS
      // Everything about "does the twirl feel fun" lives in these few
      // numbers. Expect to adjust them after actually trying it on a
      // headset.
      // ==============================================================
      var GRAB_RADIUS = 0.15; // meters — how close a hand must be to pick something up
      var HIP_HEIGHT = 0.9; // meters off the ground
      var HIP_SIDE_OFFSET = 0.18; // meters, left/right from body centerline
      var BACK_HEIGHT = 1.3; // meters off the ground — the bandolier's anchor sits higher up the torso than the hips
      var BACK_DEPTH_OFFSET = 0.3; // meters behind the body centerline — the headset sits at the FRONT of your head, so a small offset puts the bandolier inside your chest and makes the shotgun nearly impossible to reach
      // GHOST BODY — a proper Pac-Man-style ghost: a dome cap on a
      // constant-radius "pill" body (not tapering — the first version
      // was a cone and came out looking like a dunce cap, and too
      // short besides), finished with a wavy skirt of points around
      // the bottom rim. Nested directly under the camera so it tracks
      // full head rotation like the hat does (not yaw-only like the
      // hips/back — there's no separate torso to stay upright
      // independently of your head any more, it's all one shape).
      // GHOST_FRONT_Z is the key number: the shape's own front surface
      // sits that far BEHIND the camera (+Z, since -Z is forward), just
      // enough to clear the near clip plane, so "the eyes are where the
      // headset is" without actually poking geometry into your own
      // forward view.
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
      // (see BELT/WARDROBE below), riding the waist anchor at
      // HIP_HEIGHT, lands at roughly that same seam for an average
      // ~1.6-1.7m standing eye height — the belt reading as part of
      // the body rather than floating at some unrelated height.
      var CYLINDER_HEIGHT = 0.8;
      var SKIRT_HEIGHT = 0.2; // meters the wavy points hang below the cylinder's bottom rim
      var SKIRT_TEETH = 6;

      // BELT — the first real piece of swappable equipment (see
      // `belt`), worn on the waist anchor. Visual numbers only here;
      // the swap/transfer behavior lives on the component.
      var BELT_TUBE_RADIUS = 0.012;
      var BELT_COLOR = '#4a3220'; // matches the hip holster leather
      var BELT_BUCKLE_COLOR = '#c9962c'; // matches other brass trim (e.g. boxy-sniper's trigger)

      var GRAVITY = 9.8; // real-world value, used for the drop/tumble simulation
      var DANGLE_GRAVITY_TORQUE = 2.5; // how insistently a dangling gun swings back to hanging straight down
      var DANGLE_INERTIA_SCALE = 6; // how strongly flicking your hand imparts spin — crank this up further if it still feels weak
      var DANGLE_DAMPING = 0.999; // per-frame angular velocity decay while swinging — close to 1 = low friction, keeps spinning
      var MAX_ANGULAR_VELOCITY = 40; // rad/s safety clamp so one noisy tracking spike can't fling it into nonsense
      var FALL_DAMPING = 0.99; // per-frame angular velocity decay while tumbling to the ground
      var GROUND_REST_Y = 0.05; // meters — half the gun's resting thickness off the floor

      var PROXIMITY_HAPTIC_RADIUS = 0.2; // meters — a bit past GRAB_RADIUS, so the buzz gives you a heads-up just before you're in range
      var PROXIMITY_HAPTIC_INTENSITY = 0.15; // 0-1, deliberately light ("slight buzz", not a jolt)
      var PROXIMITY_HAPTIC_PULSE_MS = 60; // re-issued every tick while in range, so this just needs to outlast one frame

      // A gun's local -Z (barrel forward) is defined relative to the
      // hand's raw tracked ("grip") orientation, which on Quest Touch
      // controllers does NOT point where your index finger does — this
      // is a well-known WebXR quirk (laser-controls gets away with the
      // same raw orientation because you visually self-correct your
      // aim by watching the laser line; a rigid gun model has no such
      // feedback, so the mismatch just looks wrong). Each pistol's
      // holsterable="...heldRotation: -90 0 0..." markup attribute
      // rotates the held gun to compensate — -90° on X is a reasoned
      // starting estimate (pitching the barrel down out of "grip up"
      // into "pointing forward"), not a verified value; if the barrel
      // still doesn't track your finger, nudge that x value in ~15°
      // steps (or adjust y/z if the mismatch looks like a left/right
      // twist rather than up/down) and reload. The hat has no such
      // problem — it isn't aimed at anything, so its heldRotation is
      // just identity.
      // Defaults for the "firearm" component — a pistol's numbers.
      // Anything bigger (the shotgun) overrides them in its own markup
      // rather than getting its own set of constants here.
      var RECOIL_KICK_DEG = -8; // extra pitch added on top of heldRotation when firing
      var RECOIL_RECOVER_MS = 120; // how long the kick takes to settle back

      var TRACER_COLOR = '#ffe066';
      var TRACER_RADIUS = 0.004; // meters
      var TRACER_LIFETIME_MS = 80;
      var IMPACT_RADIUS = 0.04; // meters
      var IMPACT_LIFETIME_MS = 150;
      var MAX_SHOT_RANGE = 20; // meters — both the raycaster's far distance and the tracer's length on a miss

      // Juggling: an aimed toss, not raw physics. The vertical speed of
      // your hand at release controls how high/long the arc is; the
      // horizontal velocity is discarded and replaced with whatever's
      // needed to land exactly at a target hand's position (see
      // computeThrowVelocity). Which hand is the target is the only
      // thing your actual aim direction decides.
      var MIN_THROW_UPWARD_SPEED = 0.8; // m/s — vertical hand speed floor to count as a deliberate toss at all; below this, a release just falls/holsters as before
      var OTHER_HAND_DOT_THRESHOLD = 0.3; // m/s of horizontal speed toward the other hand needed to target it instead of yourself
      var THROW_VELOCITY_MULTIPLIER = 1.6; // exaggerates real hand vy before clamping, so tosses read as more dramatic than your actual flick
      var THROW_LAUNCH_VY_MIN = 2.2; // m/s — clamps the arc's height floor so even a weak flick gives a reactable toss
      var THROW_LAUNCH_VY_MAX = 6; // m/s — clamps the ceiling so a hard flick doesn't send it flying absurdly high
      var THROW_CATCH_RADIUS = 0.35; // meters — deliberately wide vs. GRAB_RADIUS(0.15): catching something already falling/flying should be far more forgiving than picking something up at rest

      // A hurl is the other kind of throw: not a juggle toss aimed
      // back at a hand, but genuinely getting rid of something —
      // pitching a bottle out over the range to shoot at. It's told
      // apart from a toss purely by direction: move your hand
      // decisively sideways/forward rather than straight up and the
      // aiming is skipped entirely in favour of your real velocity.
      // Without this there was no way to throw anything AWAY, because
      // every release was re-aimed to land back in a hand.
      var HURL_MIN_HORIZONTAL_SPEED = 1; // m/s of sideways hand speed to count as a hurl at all
      var HURL_HORIZONTAL_RATIO = 0.7; // horizontal speed must be at least this much of the vertical, or it's a toss
      var HURL_MULTIPLIER = 1.9; // exaggerates the real flick, since hand speed alone throws disappointingly short
      var HURL_MAX_SPEED = 9; // m/s ceiling
      var HURL_MIN_UP = 1.4; // m/s of loft added if you threw flat, so a hurled bottle arcs instead of skidding
      var HURL_CATCH_COOLDOWN_MS = 500; // catching is suppressed this long after a hurl, or the generous catch radius snatches it straight back out of the air
      var THROW_SPIN_RATE = 7; // rad/s — fixed visual tumble given to a fresh throw
      var SNAP_BLEND_DUR_MS = 130; // ms — how long any snap-into-place (grab, holster, or catch) takes to blend smoothly into its target pose, instead of an instant pop

      // ==============================================================
      // ANCHOR SLOTS
      // Any object holsterable declares an itemSize; any anchor
      // declares a slot size. Small fits in small/medium/large, medium
      // fits medium/large, large fits large only — see the "rank"
      // ordering below. Every distance here (how close counts as "in
      // range to snap," how far out the indicator sphere starts
      // reacting) scales with the slot's own size, so a big slot like
      // the bandolier stays proportionally as generous as a small
      // holster rather than sharing one flat radius for everything.
      // ==============================================================
      var SLOT_SIZE_RANK = { small: 0, medium: 1, large: 2 };
      var SLOT_COLOR = { small: '#ffd93d', medium: '#3ddc84', large: '#2196f3' };
      var SLOT_SPHERE_BASE_RADIUS = { small: 0.03, medium: 0.045, large: 0.06 }; // idle indicator size
      var SLOT_SPHERE_MAX_RADIUS = { small: 0.055, medium: 0.075, large: 0.095 }; // indicator size once a carried item is close enough to snap
      var SLOT_SNAP_RADIUS = { small: 0.22, medium: 0.32, large: 0.45 }; // meters — how close a released/thrown item needs to be to anchor here
      var SLOT_APPROACH_RADIUS = { small: 0.42, medium: 0.55, large: 0.75 }; // meters — how far out the indicator starts growing at all
      var SLOT_CLICK_DUR_MS = 220; // ms — fast "click into place" indicator bounce: overshoot, undershoot, settle

      // ==============================================================
      // STACKS (holding more than one of anything)
      // A hand and an anchor-slot turn out to be the same idea wearing
      // different hats: a place that can hold several things at once.
      // Both fan their contents out so N items read as N items instead
      // of one item z-fighting with itself. The offsets are applied in
      // the *parent's* frame (lateral on x, yaw on y), which is what
      // makes one set of numbers mean something sensible for every
      // object: two pistols in one fist splay into a V, five cigars in
      // your mouth fan out like a hand of cards, four bottles bunch
      // together like you're carrying a round.
      //
      // Nothing below is per-object — an object opts into all of it by
      // existing, which is why "can I hold two guns in one hand?" and
      // "can I grab an armful of bottles?" have the same answer without
      // either being implemented specifically.
      // ==============================================================
      var HAND_CAPACITY = 4; // items one hand can hold at once
      var HAND_STACK_SPREAD = 0.055; // meters between stacked items in a hand
      var HAND_STACK_YAW = 8; // degrees of splay per step out from center
      var THROW_STACK_SPREAD = 0.75; // m/s of extra sideways launch velocity per step, so a thrown handful fans apart in the air instead of flying as one clump
      var DANGLE_STACK_KICK = 3.5; // rad/s of random spin given to the 2nd+ item dangling off one finger, so they don't swing as identical clones
      var REGRIP_WINDOW_MS = 400; // release and re-squeeze inside this and you keep what you were holding — see hand-rig.reclaimStash

      // ==============================================================
      // STOCK AND PERISHING
      // Two halves of one bargain, and neither is safe without the
      // other.
      //
      // A socket can know what belongs in it, and puts one there at
      // scene load. THE ARMOURY'S sockets go further and keep doing it
      // — ten seconds after a peg goes bare, there's another rifle on
      // it. The armoury doesn't care what became of the last one, only
      // that the peg is empty, which is what separates it from the
      // bar's respawn-when-smashed (see breakable).
      //
      // Your holsters do NOT do that. They're stocked once and then
      // they're just pockets: what's in them is whatever you put there.
      // A gunslinger whose hip quietly refills itself isn't carrying a
      // gun, he's standing next to a vending machine — and the armoury
      // is right behind you if you need another.
      //
      // The armoury being an infinite source is what the other half is
      // for: anything the world hands out has a clock on it, and the
      // clock only runs while it's LOOSE — on the floor or in the air.
      // Held, dangling, or sitting in a socket anywhere at all (a
      // holster, the bar, your hat, your teeth) it's yours for as long
      // as you want it. The number of guns in the world is therefore
      // bounded by the number of places to put one, which is a rule
      // nothing has to enforce.
      // ==============================================================
      var IMPACT_MIN_SPEED = 3.2; // m/s a flying object needs before it counts as hitting something rather than being put down near it
      var IMPACT_COOLDOWN_MS = 180; // one contact per swing, not one per frame

      // ==============================================================
      // EXPLOSIONS
      // One function, and nothing that calls it knows what the others
      // are. It shoves a fireball's worth of debris and smoke out,
      // spills burning fuel where it went off (so a blast in the
      // saloon leaves the floor alight and the fire system takes it
      // from there), knocks over every target in range through the
      // same fall() a bullet uses, shatters glass in range through the
      // same shatter() a bullet uses, and throws loose objects
      // outward.
      //
      // That last one is the fun one: the blast doesn't special-case
      // anything, it just hands every loose holsterable a velocity —
      // which is the same thing your arm does. Blowing a rack of
      // bottles across the room is throwing them, as far as the code
      // is concerned.
      // ==============================================================
      var BLAST_RADIUS = 2.4;
      var BLAST_SCORE = 60;
      var BLAST_FUEL = 0.5; // how big a burning patch it leaves
      var BLAST_SHOVE = 9; // m/s handed to a loose object at the centre
      var BLAST_SHARDS = 22;

      // A stick of dynamite is a fuse with a bundle attached, so its
      // numbers are burnable's numbers. The fuse is deliberately long
      // enough to be a decision and short enough to be a mistake: at
      // this rate you get about four seconds, which is plenty to throw
      // it and nowhere near enough to change your mind twice.
      var DYNAMITE_STICK_LENGTH = 0.17;
      var DYNAMITE_FUSE_LENGTH = 0.11;
      var DYNAMITE_FUSE_RATE = 0.028; // meters/second — about four seconds of fuse
      var DYNAMITE_FUSE_MIN = 0.004;

      // ==============================================================
      // THE BOW
      // Two hands, and neither of them presses anything. The bow hand
      // holds and aims it; the other takes hold of the string — which
      // is the *support grip* the shotgun's forend already introduced,
      // just mounted behind the weapon instead of along it, so a drawn
      // bow points down the line between your hands the same way a
      // braced shotgun does, read backwards. Pull that hand away from
      // the bow and the draw is simply how far apart your hands are.
      // Let go of the grip and it looses.
      //
      // What flies is whatever is sitting in the nock, which is an
      // ordinary anchor-slot mounted on the string. It has room for
      // three, and the fan that spreads five cigars across your teeth
      // is what makes three arrows read as three arrows. Nothing
      // anywhere says the nock takes arrows, so it doesn't: a beer
      // bottle, a lit cigar or a stick of dynamite will all sit in it
      // perfectly happily and all leave at the same speed.
      //
      // The aim cheats, deliberately and in the same way an overhand
      // throw does. Where you're LOOKING picks the point it's solving
      // for, and the elevation to reach that point at the speed your
      // draw earned is worked out for you — because judging the arc of
      // an arrow by eye in VR is not fun, and watching one drop onto a
      // target two-thirds of a field away very much is.
      // ==============================================================
      var BOW_REST_DRAW = 0.14; // metres between hands that counts as "not drawn yet"
      var BOW_MAX_DRAW = 0.62; // and a full draw
      var BOW_MIN_LOOSE = 0.18; // below this the string just slips off your fingers, no shot
      var BOW_LIMB_LENGTH = 0.46; // one limb, from the grip
      var BOW_STRING_REST_Z = 0.05; // where the string sits undrawn, behind the grip
      var ARROW_MIN_SPEED = 9; // m/s at the shortest draw that still looses
      var ARROW_MAX_SPEED = 30; // and at a full one
      var ARROW_AIM_ASSIST = 0.85; // 0 = raw bow direction, 1 = solved straight at what you're looking at
      var ARROW_LENGTH = 0.62;
      var ARROW_STACK = 3; // how many the nock will hold at once
      var ARROW_FAN_DEG = 7; // degrees between arrows in a volley, loaded and loosed alike
      var ARMORY_ARROWS = 5; // how many lie in the trough on the bench

      // ==============================================================
      // THE LAUNCHER
      // A tube with a socket in the back. Everything about it is the
      // bow again with a trigger instead of a string, which is why
      // there is so little of it: load, point, press.
      //
      // The rocket flies flat while its motor is lit and then gives up,
      // which is the difference between it and everything else in the
      // air here. It is `armed`, so it goes off on contact with
      // anything rather than needing a fuse — and since it goes off by
      // calling the same detonate() a stick of dynamite does, firing
      // one indoors sets the saloon alight, throws the furniture, and
      // is entirely your own fault.
      // ==============================================================
      var LAUNCHER_LENGTH = 0.95;
      var LAUNCHER_MUZZLE_Z = 0.42; // how far the muzzle sits ahead of the grip
      var LAUNCHER_KICK_DEG = -26; // it is not a comfortable weapon
      var LAUNCHER_RECOVER_MS = 420;
      var LAUNCH_SPEED = 14; // m/s leaving the tube, before the motor does anything
      var ROCKET_THRUST = 34; // m/s² while the motor burns
      var ROCKET_LIFT = 0.85; // fraction of gravity the motor cancels, so it flies flat and then drops
      var ROCKET_BURN_MS = 1400;
      var ROCKET_BLAST_RADIUS = 3.2;
      var ARMORY_ROCKETS = 2;

      // ==============================================================
      // THE SCOPE
      // A real one: a second camera with a narrow field of view,
      // rendering the scene to a texture that is then the glass in the
      // eyepiece. Which is to say it costs an extra pass over the whole
      // scene, and this one is about 160 draw calls.
      //
      // So it only runs when the eyepiece is actually at your eye. That
      // started as the optimisation and turned out to be the mechanic:
      // the glass is dark until you bring the rifle up and put your eye
      // behind it, which is both what a scope does and what stops a
      // magnified view hanging in the middle of the room costing frames
      // while it dangles off your belt. The render target is small on
      // purpose too — a scope image is allowed to look like a scope
      // image.
      // ==============================================================
      var SCOPE_FOV = 11; // degrees — roughly 4x
      var SCOPE_TEXTURE = 256; // square render target; deliberately modest
      var SCOPE_WAKE_DISTANCE = 0.22; // metres from eyepiece to your eye before the glass lights up
      var SCOPE_LENS_RADIUS = 0.026;

      var SNIPER_LENGTH = 1.15;

      // ==============================================================
      // THE TANK AND THE HOSE
      // A backpack with a hatch and a nozzle on the end of a hose, and
      // it is not a flamethrower. It's a thing that sprays whatever is
      // in the tank, and what's in the tank is whatever you last poured
      // in through the open hatch. Water makes it a fire hose. Beer
      // makes it a way to get a room drunk, or to drink from a distance
      // if your aim is poor enough to hit your own face. Fire makes it
      // the obvious thing.
      //
      // None of those are modes. There is no list of what the tank can
      // hold: it takes a droplet's liquid type, whatever that happens
      // to be, and the nozzle sprays droplets of it. Everything after
      // that — burning, dousing, pooling, getting you drunk, catching
      // light off a hot barrel — is the liquid system doing what it
      // already does. Light the beer you're pouring in and you fill the
      // tank with fire; hold a match over an open tank of beer and it
      // catches by itself.
      //
      // THE NOZZLE is a separate object with its home socket on the
      // pack's chest strap, and that placement is the whole answer to
      // "how do I grab the hose rather than the pack". Worn, the tank
      // is behind you and the nozzle is at your chest: reaching over
      // your shoulder takes the pack off, reaching to your chest draws
      // the nozzle. Two different gestures, no rule needed. The hose
      // itself is drawn, not simulated — and if the nozzle ends up
      // loose further away than the hose is long, it reels home.
      // ==============================================================
      var TANK_WIDTH = 0.3;
      var TANK_HEIGHT = 0.34;
      var TANK_DEPTH = 0.17;
      var TANK_MOUTH_RADIUS = 0.09; // how near the hatch a poured droplet has to fall to go in
      var HATCH_OPEN_DEG = -115;
      var HATCH_SPEED_DEG = 420; // degrees/second — a hatch swings, it doesn't snap like a Zippo
      var HATCH_AUTOCLOSE_MS = 12000; // long enough to pour, short enough that you'll be caught out once
      var HOSE_LENGTH = 1.5;
      var HOSE_SEGMENTS = 5;
      var HOSE_SAG = 0.22;
      var SPRAY_RATE = 60; // droplets/second out of the nozzle
      var SPRAY_SPEED = 7.5; // m/s, which is what makes it a jet rather than a pour
      var SPRAY_SPREAD = 0.9; // m/s of sideways scatter at the nozzle, so it cones out
      var LOOSE_ITEM_LIFETIME_MS = 30000;
      var LOOSE_ITEM_FADE_MS = 1200; // it shrinks away over the last of that rather than blinking out

      // ==============================================================
      // BOTTLES AND POURING
      // A bottle starts capped. The cap has its own little collider
      // (see boxy-bottle's .cap-hitbox) and only comes off when THAT
      // is struck down through a hard surface — hook it on the edge of
      // the bar or knock it on the floor. Checking the bottle as a
      // whole was the first version and it popped the cap the instant
      // you picked one up, since the grab blend itself counts as fast
      // downward motion while the base is still at counter height.
      //
      // An open bottle pours whenever it's tipped past horizontal, at
      // a rate that scales with the tilt, forever — beer is infinite
      // here, so there's no fill level to track. Drinking isn't a
      // separate mechanic at all: the poured droplets are real
      // particles, and any that hit your head go down your throat.
      // ==============================================================
      var CAP_HITBOX_RADIUS = 0.035; // meters — the collider that has to make contact
      var BOTTLE_STRIKE_SPEED = 0.9; // m/s downward the cap needs to be travelling
      var BOTTLE_STRIKE_GRACE_MS = 220; // ms after a grab before a strike counts, so the snap-into-hand blend can't open it for you
      var POUR_TILT_START = 0.05; // how far past horizontal the neck must tip before anything comes out
      var POUR_RATE_MAX = 75; // droplets/second when the bottle is straight upside down — dense enough to read as a stream rather than a dribble
      var POUR_SPEED = 0.35; // m/s of initial push out of the neck, on top of the bottle's own motion
      var DROPLET_RADIUS = 0.011;
      var DROPLET_LIFETIME_MS = 3000;
      var DROPLET_SWALLOW_RADIUS = 0.17; // meters around your mouth — a droplet inside this is a drink
      var ALCOHOL_PER_DROPLET = 0.0025; // about five seconds of steady chugging gets you halfway to trouble
      var GLUG_MIN_INTERVAL_MS = 90; // don't retrigger the swallow sound faster than this

      // ==============================================================
      // VICES
      // Two separate meters that do deliberately different things.
      //
      // Nicotine is the shakes: a fast, small tremor on everything you
      // hold. Simple, and it's what makes five cigars at once funny.
      //
      // Alcohol is everything else, and the design rule it's built
      // around is that NONE of it moves the camera. A view that drifts
      // or rolls independently of your head is a vestibular conflict
      // and a reliable way to make someone genuinely ill; a gun barrel
      // that swims is just funny. So alcohol gets: aim drift and
      // overshoot (hand-rig.updateGrip), a head-locked vignette
      // and warm tint that pulse (booze-overlay), and butterfingers —
      // graded so a twirling object slips out well before a properly
      // gripped one does.
      // ==============================================================
      var ALCOHOL_DECAY_PER_S = 0.011; // sober up slowly
      var NICOTINE_DECAY_PER_S = 0.02; // and clear your head a bit faster than that
      var NICOTINE_PER_CIGAR_PASSIVE = 0.02; // per second, per lit cigar just sitting in your mouth
      var NICOTINE_PER_INHALE = 0.1; // per second while actively drawing on one — ~10s of solid puffing to max out
      var NICOTINE_SHAKE_DEG = 5.5; // peak fast tremor at 100% nicotine
      var ALCOHOL_SWAY_DEG = 6; // peak slow sway at 100% alcohol
      var WOBBLE_EASE_MS = 320; // ms after a grab before wobble reaches full strength, so nothing pops the instant a snap-blend finishes

      // Aim drift: your hand chases a spring-damped ghost of itself
      // instead of tracking the controller rigidly. Low damping is
      // what makes it overshoot and swim past where you meant to stop.
      // Applied to the hand rather than to what it's holding, so the
      // two never come apart.
      var DRIFT_STIFFNESS = 42; // spring constant of the ghost hand
      var DRIFT_DAMPING = 5.5; // deliberately under-damped
      var DRIFT_MAX_LAG = 0.15; // meters — clamped, because an unclamped fast wave produced 60 degrees of barrel swing, which isn't drunk, it's broken
      var DRIFT_POSITION_GAIN = 0.5; // how much of the ghost's lag becomes a positional offset
      var DRIFT_ROTATION_GAIN = 110; // degrees of barrel swing per meter of lag — this is what actually ruins your aim

      // Butterfingers, graded: something dangling off one finger is
      // barely held at all, so it goes first; something in a closed
      // fist only goes when you're in real trouble.
      var SLIP_DANGLE_THRESHOLD = 0.25; // alcohol above which twirling things start getting away from you
      var SLIP_DANGLE_CHANCE_PER_S = 1; // at full alcohol
      var SLIP_GRIP_THRESHOLD = 0.7; // alcohol above which even a gripped object can slip
      var SLIP_GRIP_CHANCE_PER_S = 0.5; // at full alcohol
      var SLIP_THROW_SPREAD = 1.4; // m/s of extra random scatter on a drunk throw, at full alcohol

      var BOTTLE_RESPAWN_MS = 5000; // a shattered bottle reappears on its home slot after this

      // ==============================================================
      // CIGARS
      // A lit cigar burns down. Ash creeps up the tip as a grey
      // segment, faster while you're actively drawing on it; a sharp
      // enough shake knocks the ash off and leaves the cigar that much
      // shorter. Smoke it to the band and it's gone, and a fresh one
      // turns up in the tray a few seconds later.
      //
      // Holding the tip at your mouth is "inhaling": nicotine climbs
      // much faster, ash builds faster, and no smoke comes off it —
      // you're drawing it in. Pull it away and you exhale everything
      // you banked.
      // ==============================================================
      var CIGAR_PUFF_INTERVAL_MS = 1100; // how often a lit, un-inhaled cigar coughs up a wisp — five lit at once shouldn't fog the room
      var CIGAR_ASH_RATE = 0.0016; // meters of tip turning to ash per second while lit
      var CIGAR_ASH_INHALE_MULTIPLIER = 6; // how much faster it ashes while you're drawing on it
      var CIGAR_MIN_LENGTH = 0.045; // meters — below this it's a stub and goes out
      var CIGAR_INHALE_RADIUS = 0.16; // meters from the cigar's tip to your mouth
      var CIGAR_SHAKE_SPEED = 1.1; // m/s of tip speed needed for a flick to count
      var CIGAR_SHAKE_REVERSAL = -0.15; // dot product of successive velocities — negative means the direction snapped back, i.e. a shake and not a sweep
      var CIGAR_EXHALE_MAX_PUFFS = 9; // cap on how much banked smoke one exhale can produce
      var CIGAR_TWIRL_ASH_RATE = 11; // rad/s of dangle spin that flings the ash off — a twirl has no velocity reversal for the flick detector to catch, so spinning gets asked about directly
      var CIGAR_RESPAWN_MS = 6000;

      // ==============================================================
      // FIRE-STARTERS
      // Two ways to light something that aren't "borrow a lit cigar"
      // or "point a gun at your own face."
      //
      // A match is a burnable whose head has its own collider, struck
      // the same way a bottle cap is knocked off — the machinery is
      // already there, so a match is barely any new code. It burns
      // fast and doesn't last.
      //
      // A Zippo is the reusable one: flip the lid (trigger, or a flick
      // of the wrist), press a face button to strike it, and the flame
      // is an ignition-source for as long as the lid stays open.
      // ==============================================================
      var MATCH_HEAD_RADIUS = 0.016; // the collider you have to strike against something
      var MATCH_ASH_RATE = 0.011; // meters/sec — a match is gone in a few seconds
      var MATCH_MIN_LENGTH = 0.018;
      var MATCH_COUNT = 4;
      var MATCH_RESPAWN_MS = 5000;

      var ZIPPO_LID_OPEN_DEG = -125; // how far the lid swings back
      var ZIPPO_LID_SPEED_DEG = 900; // degrees/second — a Zippo lid snaps, it doesn't ease
      var ZIPPO_FLICK_SPEED = 1.6; // m/s at the lid for a wrist-flick to open it
      var ZIPPO_FLICK_REVERSAL = -0.1;
      var ZIPPO_FLAME_FLICKER_HZ = 9;

      // ==============================================================
      // PARTICLES, SMOKE, AND WIND
      // One pool, three flavors: 'debris' (glass shards, bottle caps —
      // gravity + bounce), 'smoke' (gun and cigar — buoyant, grows,
      // pushed around by wind), and 'spark'. All of them are ticked in
      // a single loop by world-systems rather than as one component
      // per particle.
      //
      // Wind comes from two places, both of which are just "the player
      // moved something through the air": a hand sweeping past a puff
      // drags it along, and bringing a hot muzzle up in front of your
      // face triggers a gust — the classic blow-the-smoke-off-the-
      // barrel move. (A real breath detector would want mic input;
      // that's a permission prompt and a headset-specific gamble, so
      // the gesture stands in for it.)
      // ==============================================================
      // Two budgets, not one, and the split is by what a particle is
      // FOR rather than what it looks like. Smoke and glass are
      // scenery: run out of room and the oldest puff can simply stop
      // existing, and nobody can tell. Liquid is not scenery — a
      // droplet is a unit of beer that will get you drunk, or a unit of
      // fire that will burn the place down — so deleting one changes
      // the game, not the picture.
      //
      // They used to share one pool of 110 with oldest-dies eviction,
      // which meant a spreading fire (a jumping flame is a droplet, and
      // each burning pool smokes) could fill the whole thing and then
      // eat every drop of beer you poured about an inch out of the
      // bottle. Two budgets means visuals can never evict gameplay.
      //
      // The liquid budget is deliberately large, and it is a MERGE
      // threshold rather than a delete threshold: see
      // relieveLiquidPressure. Over it, the oldest droplet joins its
      // neighbour or lands early, so the liquid is still there — it has
      // just stopped being two things. Nothing is ever simply dropped.
      var MAX_LIQUID_DROPS = 420;
      var MAX_EFFECT_PARTICLES = 150; // smoke, glass and sparks together
      var DROP_MERGE_RADIUS = 0.55; // two droplets further apart than this are different events, not one splitting stream
      var DROP_MERGE_MAX_SCALE = 3.2; // times the liquid's own drop radius, so a merged blob stays a droplet
      var SHARD_COUNT = 16;
      var SHARD_SPEED = 2.8; // m/s initial burst speed
      var SHARD_SIZE = 0.022;
      var SHARD_LIFETIME_MS = 1700;
      var SPARK_LIFETIME_MS = 420;
      var SMOKE_LIFETIME_MS = 2200;
      var SMOKE_START_RADIUS = 0.035;
      var SMOKE_RISE = 0.5; // m/s^2 of buoyancy
      var SMOKE_DRAG = 1.3; // per-second velocity decay
      var SMOKE_GROWTH = 1.9; // how many times its starting size a puff reaches by the end of its life
      var GUN_HEAT_DECAY_PER_S = 0.32; // how fast a barrel cools; firing faster than this is what builds a bigger curl afterwards
      // Firing produces NO smoke at the moment of the shot. The first
      // version puffed on every trigger pull, which buried the targets
      // in cloud and cost frames. Instead the barrel remembers how hard
      // it's been worked, and once you stop shooting for a beat, that
      // much smoke curls up out of the muzzle — which is both the
      // cheaper option and the one that actually looks like a western.
      var BARREL_SMOKE_DELAY_MS = 420; // quiet time after the last shot before the curl starts
      var BARREL_SMOKE_INTERVAL_MS = 130; // spacing between puffs in the curl, so it rises rather than bursting
      var BARREL_SMOKE_MIN_HEAT = 0.12; // one casual shot barely smokes at all
      var BARREL_SMOKE_MAX_PUFFS = 7; // emptying a gun as fast as you can pull
      var MUZZLE_HOT_THRESHOLD = 0.18; // heat above which the barrel will light a cigar
      var WIND_HAND_RADIUS = 0.45; // meters — how close a moving hand has to be to shove a puff
      var WIND_HAND_MIN_SPEED = 0.9; // m/s — below this you're not waving, you're just standing there
      var WIND_HAND_FACTOR = 5; // how strongly a sweeping hand drags smoke with it
      var BLOW_RADIUS = 0.3; // meters from muzzle to mouth to arm the gust
      var BLOW_UP_DOT = 0.3; // how upright the barrel has to be pointed (so raising it to your lips reads differently from just holding it near your chin)
      var BLOW_GUST_RADIUS = 1; // meters of smoke cleared by one puff of breath
      var BLOW_GUST_SPEED = 3.5; // m/s imparted to it
      var IGNITE_RADIUS = 0.075; // meters — cigar tip to a hot thing
      var CIGAR_PUFF_INTERVAL_MS = 750; // how often a lit cigar coughs up a wisp

      // ==============================================================
      // FIRE
      // Fire is a liquid (see the LIQUIDS block): a burning patch of
      // ground is a pool whose size is its remaining fuel, and it
      // throws droplets of flame back into the air. Those droplets
      // land somewhere slightly else and start burning there, which is
      // the entire mechanism by which fire spreads — set FIRE_JUMP_RATE
      // to 0 and fire simply stops travelling.
      // ==============================================================
      var FIRE_MIN_RADIUS = 0.028; // sphere radius of the steady flame on a guttering pool
      var FIRE_MAX_RADIUS = 0.115; // and on a roaring one — roughly 23cm across, 45cm tall once stretched
      var FIRE_WIGGLE_HZ = 6.5; // how fast flames writhe
      var FIRE_SPREAD_RADIUS = 0.4; // how close something hot has to be to set a spill alight
      var FIRE_DAMAGE_RADIUS = 0.5; // meters past the pool's own edge that targets burn
      var FIRE_DAMAGE_DELAY_MS = 600;
      var FIRE_DAMAGE_SCORE = 50;
      var FIRE_ASH_MULTIPLIER = 5; // how much faster a cigar ashes while sitting in a flame
      var FIRE_ASH_RADIUS = 0.3;
      var FIRE_LIGHT_COLOR = '#ff9a3c';
      var FIRE_LIGHT_RANGE = 6;
      var FIRE_LIGHT_MAX = 2.4;
      var FIRE_DROPLET_LIFETIME_MS = 1400; // a flame in the air doesn't last long if it never lands
      var FIRE_LANDING_SPILL = 0.004; // meters a landed flame adds — deliberately less than it cost to jump

      // The jumping. Rate scales with how big the burning patch is, so
      // a small spill spits the occasional tongue and a big one is a
      // constant fountain. This is both the look and the spread — turn
      // it down for a tamer fire, up for a chaotic one.
      var FIRE_JUMP_RATE = 7; // jumps per second at full size
      var FIRE_JUMP_INTERVAL_MS = 1000; // divided by rate*strength to get the gap between jumps
      var FIRE_JUMP_SPEED_MIN = 0.7; // m/s upward from a guttering pool
      var FIRE_JUMP_SPEED_MAX = 2.1; // and from a roaring one
      var FIRE_JUMP_SPREAD = 1.2; // m/s of sideways scatter — this is literally how far fire can reach, since spread is flames landing somewhere new
      var FIRE_JUMP_COST = 0.014; // meters of the source pool spent per jump; must exceed FIRE_LANDING_SPILL or fire is perpetual

      var DROPLET_IGNITE_RADIUS = 0.14; // alcohol passing this close to anything lit catches
      var FIRE_DRINK_NICOTINE = 0.05; // what a mouthful of flame does to you: not much, comedically
      var FIRE_DRINK_BURN_OFF = 0.02; // it does burn off some of what you'd already drunk

      // ==============================================================
      // POOLS
      // Spilled liquid stays put instead of vanishing, so you can pour
      // first and light it afterwards. A drop landing in a puddle joins
      // it; a drop landing anywhere else starts one of its own.
      //
      // Puddles have NO MAXIMUM SIZE. What keeps the count down isn't a
      // cap, it's that overlapping puddles of the same stuff pour into
      // each other and slide together until they're one puddle (see
      // minglePools) — which is both what liquid does and cheaper than
      // it sounds, since a circle overlap test is two multiplies. And
      // what makes them go away isn't a timer, it's drying: each liquid
      // loses radius at its own rate, so a big spill outlasts a splash
      // for the obvious reason.
      // ==============================================================
      var MAX_POOLS = 60; // and when even this runs out, liquid joins the nearest puddle rather than vanishing — see addToPool
      var POOL_ABSORB_SKIN = 0.05; // a drop landing this far outside a puddle still counts as landing in it
      var POOL_START_RADIUS = 0.045;
      var POOL_GROWTH_PER_DROPLET = 0.011; // meters of radius each droplet adds
      var POOL_REFERENCE_RADIUS = 0.45; // what "a big puddle" means for flame size and firelight. NOT a cap — puddles have no maximum size
      var POOL_MIN_RADIUS = 0.012; // below this a puddle is finished
      var POOL_FLOW_RATE = 2.2; // fraction of the smaller puddle's area that pours into the larger, per second, at full overlap
      var POOL_DRIFT_RATE = 0.5; // metres/second two touching puddles slide together (or apart, at negative cohesion)
      var POOL_BURN_RATE = 0.035; // meters of radius consumed per second while alight — how long a spill burns for
      var POOL_SPILL_RADIUS = 0.16; // how much a smashed bottle puts on the floor
      var POOL_RELIGHT_DELAY_MS = 2500; // a doused puddle stays too wet to catch again for this long

      // ==============================================================
      // WATER
      // The jug. Water droplets are the same particles beer is, doing
      // the opposite job: they take fuel out of fires, they sober you
      // up a little, and they pool without being flammable.
      // ==============================================================
      var WATER_DOUSE_RADIUS = 0.35;
      var WATER_DOUSE_FUEL = 1.6; // seconds of fire removed per droplet that reaches it
      var WATER_SOBER_PER_DROPLET = 0.004;

      // ==============================================================
      // OVERHAND THROWS
      // Throwing overhand means you're trying to hit something you're
      // looking at, so the game does the aiming — the same courtesy the
      // juggling toss already extends, pointed outward instead of back
      // at your own hand. Where in the swing you let go picks the arc:
      // release early, on the way up, and it lobs; release near the top
      // and it goes flat and fast.
      // ==============================================================
      var OVERHAND_MIN_HAND_HEIGHT = 0.02; // meters above eye level at release
      var OVERHAND_MIN_SPEED = 1.5; // m/s of hand speed to count as a throw at all
      var OVERHAND_STEEP_DEG = 50; // launch angle at the bottom of the upswing
      var OVERHAND_FLAT_DEG = 12; // launch angle at the top of the arc
      var OVERHAND_AIM_RANGE = 30; // meters of look-ray used to find what you're aiming at
      var OVERHAND_SPEED_REFERENCE = 4; // m/s of hand speed that counts as "a full-strength throw"
      var OVERHAND_MAX_DEFAULT_SPEED = 13; // m/s ceiling for an average object; heavy things override it downward

      // Every hard surface a bottle can be cracked open on. The ground
      // plane is here from the start; saloon-bar pushes its counter
      // top on at init. A surface is just a horizontal rectangle —
      // enough for "did I whack this down onto something solid," and
      // nothing in the scene needs real collision beyond that.
      //
      // A surface may also name an `obj` it's mounted on, in which case
      // its rectangle is in that object's own frame rather than the
      // world's, and every test below brings the point being checked
      // into that frame first. That's what lets the bar counter stay a
      // counter while it revolves. Only yaw is ever involved, so
      // heights need no conversion and `y` stays a world height.
      var HARD_SURFACES = [
        { y: 0, minX: -15, maxX: 15, minZ: -15, maxZ: 15 },
      ];

      var _surfaceLocal = new THREE.Vector3();

      function inSurfaceFrame(surface, worldPos) {
        _surfaceLocal.copy(worldPos);
        if (surface.obj) surface.obj.worldToLocal(_surfaceLocal);
        return _surfaceLocal;
      }

      // Is this point over that rectangle, allowing for a margin? Split
      // out because three different callers ask it and only one of them
      // used to have to think about frames.
      function overSurface(surface, worldPos, margin) {
        margin = margin || 0;
        var p = inSurfaceFrame(surface, worldPos);
        return (
          p.x >= surface.minX - margin &&
          p.x <= surface.maxX + margin &&
          p.z >= surface.minZ - margin &&
          p.z <= surface.maxZ + margin
        );
      }

      // Live vice levels, both 0..1, written by vice-meter and read by
      // every held object (see viceWobble) plus the overlay. A plain
      // module object rather than a component lookup because it's read
      // by everything, every frame.
      var VICES = { alcohol: 0, nicotine: 0 };

      // The particle pool and the per-frame wind snapshot, both owned
      // by world-systems.
      var PARTICLES = [];
      var WIND_HANDS = [];

      // Every currently-held grabbable, refreshed once a frame by
      // world-systems. Each anchor-slot used to scan the whole scene
      // itself every frame to decide how bright its indicator should
      // be, which was fine with four props and five slots and is not
      // fine with thirty of each. The list is nearly always empty or
      // one or two items long, since "held" means literally in a hand.
      var HELD_ITEMS = [];

      // ==============================================================
      // spawnTracer
      // A quick yellow line from the muzzle to wherever the shot ended
      // up (a hit point, or MAX_SHOT_RANGE out into the distance on a
      // miss), plus a small burst at that endpoint. Both are one-shot,
      // throwaway entities — created, shown briefly, removed — so it's
      // a plain function rather than a component.
      // ==============================================================
      function spawnTracer(origin, endPoint) {
        var sceneEl = document.querySelector('a-scene');

        var direction = new THREE.Vector3().subVectors(endPoint, origin);
        var length = direction.length();
        if (length > 0.001) {
          var midpoint = new THREE.Vector3().addVectors(origin, endPoint).multiplyScalar(0.5);
          var quaternion = new THREE.Quaternion().setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            direction.clone().normalize()
          );

          var tracer = document.createElement('a-entity');
          tracer.setAttribute('geometry', { primitive: 'cylinder', radius: TRACER_RADIUS, height: length });
          tracer.setAttribute('material', 'color: ' + TRACER_COLOR + '; shader: flat; opacity: 0.9; transparent: true');
          tracer.object3D.position.copy(midpoint);
          tracer.object3D.quaternion.copy(quaternion);
          sceneEl.appendChild(tracer);
          setTimeout(function () {
            if (tracer.parentNode) tracer.parentNode.removeChild(tracer);
          }, TRACER_LIFETIME_MS);
        }

        var impact = document.createElement('a-sphere');
        impact.setAttribute('radius', IMPACT_RADIUS);
        impact.setAttribute('material', 'color: ' + TRACER_COLOR + '; shader: flat; opacity: 0.9; transparent: true');
        impact.object3D.position.copy(endPoint);
        impact.setAttribute('animation__shrink', {
          property: 'scale',
          to: '0.001 0.001 0.001',
          dur: IMPACT_LIFETIME_MS,
          easing: 'easeInQuad',
        });
        sceneEl.appendChild(impact);
        setTimeout(function () {
          if (impact.parentNode) impact.parentNode.removeChild(impact);
        }, IMPACT_LIFETIME_MS + 20);
      }

      // ==============================================================
      // castShot / resolveShootable
      // The single "what did this bullet hit" primitive, shared by
      // every gun. Anything with class "shootable" is fair game — a
      // scoring ring, a bottle on the shelf, a cigar clenched in your
      // own teeth — and each one decides for itself what a hit means
      // by listening for the "shot" event. That's the only contract:
      // guns know nothing about targets, bottles, or cigars.
      //
      // Raycasts recursively into each shootable's whole subtree (a
      // ring is a single mesh, but a bottle is a pile of them), then
      // walks back up from the hit mesh to the entity that actually
      // carries the class. Objects can therefore include an invisible
      // oversized "hitbox" child to be generous about being hit —
      // which is exactly how you can plausibly shoot a thrown bottle
      // out of the air, or a cigar as thin as a pencil.
      // ==============================================================
      function resolveShootable(hitObject) {
        var node = hitObject;
        while (node) {
          if (node.el && node.el.classList && node.el.classList.contains('shootable')) return node.el;
          node = node.parent;
        }
        return null;
      }

      // Everything that casts a ray shares one scan of the scene, and
      // the first caster in a frame pays for it. That used to be a
      // shotgun handing its own list to six pellets; now it's also
      // every projectile in the air asking what it's about to hit, and
      // there can be a lot of those the moment a stick of dynamite
      // throws a rack of bottles across the room. FRAME_STAMP is
      // bumped once per frame by world-systems.
      var SHOOTABLE_ROOTS = [];
      var SHOOTABLE_STAMP = -1;
      var FRAME_STAMP = 0;

      function gatherShootableRoots() {
        if (SHOOTABLE_STAMP === FRAME_STAMP) return SHOOTABLE_ROOTS;
        SHOOTABLE_STAMP = FRAME_STAMP;

        var shootables = document.querySelectorAll('.shootable');
        SHOOTABLE_ROOTS.length = 0;
        for (var i = 0; i < shootables.length; i++) {
          if (shootables[i].object3D && shootables[i].object3D.visible) SHOOTABLE_ROOTS.push(shootables[i].object3D);
        }
        return SHOOTABLE_ROOTS;
      }

      // `roots` is optional; a shotgun gathers the list once and hands
      // it to all six pellets rather than re-querying the whole scene
      // per pellet. `range` and `ignoreEl` are for the slow kind of
      // shot — see PROJECTILES — where the cast only covers the little
      // bit of ground the thing moved this frame, and the thing doing
      // the moving mustn't shoot itself.
      var _castRay = new THREE.Raycaster();

      function castShot(origin, direction, roots, range, ignoreEl) {
        roots = roots || gatherShootableRoots();

        _castRay.set(origin, direction);
        _castRay.near = 0;
        _castRay.far = range || MAX_SHOT_RANGE;

        var hits = _castRay.intersectObjects(roots, true);
        for (var h = 0; h < hits.length; h++) {
          var el = resolveShootable(hits[h].object);
          if (el && el !== ignoreEl && !(ignoreEl && ignoreEl.contains(el))) {
            return { el: el, point: hits[h].point };
          }
        }
        return null;
      }

      // ==============================================================
      // PARTICLES
      // One pool for glass, sparks, smoke, and beer — see the constants
      // block for why. spawn* below only acquires and seeds them;
      // world-systems.tick does all the integrating in one loop.
      //
      // Entities are RECYCLED rather than created and destroyed. The
      // first version made a fresh a-sphere per puff and removed it on
      // expiry, and creating A-Frame entities is expensive enough that
      // a couple of seconds of sustained fire visibly hitched the
      // frame. Now there are two free lists (one per shape), every
      // particle is built once at unit size with a deliberately
      // low-poly sphere, and size comes from object3D.scale — so
      // nothing allocates geometry, nothing touches the DOM, and a
      // "dead" particle is just an invisible entity waiting to be
      // handed back out.
      //
      // Materials are mutated directly (mesh.material.opacity) rather
      // than through setAttribute, for the same reason the physics in
      // holsterable writes object3D directly: this runs on dozens of
      // entities every frame and A-Frame's attribute path allocates on
      // each call.
      // ==============================================================
      var PARTICLE_POOL = { box: [], sphere: [] };

      function acquireParticleEl(shape) {
        var el = PARTICLE_POOL[shape].pop();
        if (el) {
          el.object3D.visible = true;
          return el;
        }

        el = document.createElement(shape === 'box' ? 'a-box' : 'a-sphere');
        if (shape === 'box') {
          el.setAttribute('geometry', { primitive: 'box', width: 1, height: 1, depth: 1 });
        } else {
          // 6x4 segments: a faceted blob, which is all a 3cm puff of
          // smoke or a droplet of beer ever needs to be, and a
          // fraction of the vertices of A-Frame's default sphere.
          el.setAttribute('geometry', { primitive: 'sphere', radius: 1, segmentsWidth: 6, segmentsHeight: 4 });
        }
        el.setAttribute('material', 'shader: flat; transparent: true; depthWrite: false; opacity: 1');
        document.querySelector('a-scene').appendChild(el);
        return el;
      }

      function releaseParticleEl(el, shape) {
        el.object3D.visible = false;
        PARTICLE_POOL[shape].push(el);
      }

      // Seeds one particle and hands back the record world-systems
      // will integrate. `scale` is a Vector3-ish or a number.
      function addParticle(shape, worldPos, color, scale, particle) {
        var el = acquireParticleEl(shape);
        el.object3D.position.copy(worldPos);
        el.object3D.rotation.set(0, 0, 0);
        if (typeof scale === 'number') el.object3D.scale.setScalar(scale);
        else el.object3D.scale.set(scale.x, scale.y, scale.z);

        particle.el = el;
        particle.shape = shape;
        particle.color = color;
        particle.age = 0;
        particle.dead = false;
        particle.baseScale = typeof scale === 'number' ? scale : 1;
        particle.needsColor = true;

        PARTICLES.push(particle);
        LIVE_PARTICLES[bucketOf(particle)]++;

        // Nothing is ever spliced out here. Removing it would renumber
        // the array underneath world-systems.updateParticles, which
        // spawns debris and sparks from inside its own iteration — the
        // wrong particle would then be retired, and an element could
        // end up owned by two particles at once. Things are marked
        // dead, skipped, and swept up at the end of the frame.
        if (particle.kind === 'liquid') {
          if (LIVE_PARTICLES.liquid > MAX_LIQUID_DROPS) relieveLiquidPressure();
        } else if (LIVE_PARTICLES.effect > MAX_EFFECT_PARTICLES) {
          killOldest('effect');
        }
        return particle;
      }

      // Which budget a particle draws on. Everything that isn't liquid
      // is scenery.
      function bucketOf(particle) {
        return particle.kind === 'liquid' ? 'liquid' : 'effect';
      }

      function killOldest(bucket) {
        for (var i = 0; i < PARTICLES.length; i++) {
          if (PARTICLES[i].dead || bucketOf(PARTICLES[i]) !== bucket) continue;
          killParticle(PARTICLES[i]);
          return PARTICLES[i];
        }
        return null;
      }

      // What happens instead of culling a droplet, and the whole reason
      // the liquid budget can be a number rather than a compromise.
      //
      // The oldest drop in the air gives up being its own object, but
      // not being liquid. First choice: it merges into the next drop of
      // the same stuff nearby, which grows to hold both — volume adds,
      // so the radius goes as the cube root, and a dense pour turns
      // into fewer, fatter drops rather than fewer drops. Second
      // choice, if there's nothing near enough to join: it lands where
      // it is, onto whatever surface is underneath, and becomes puddle
      // early. Either way the beer is still beer and the fire is still
      // fire; the count came down and the liquid didn't.
      function relieveLiquidPressure() {
        var oldest = null;
        var oldestIndex = -1;
        for (var i = 0; i < PARTICLES.length; i++) {
          if (PARTICLES[i].dead || PARTICLES[i].kind !== 'liquid') continue;
          oldest = PARTICLES[i];
          oldestIndex = i;
          break;
        }
        if (!oldest) return;

        var target = null;
        var bestDist = DROP_MERGE_RADIUS;
        var ceiling = (LIQUIDS[oldest.liquid] || LIQUIDS.beer).dropRadius * DROP_MERGE_MAX_SCALE;
        for (var j = oldestIndex + 1; j < PARTICLES.length; j++) {
          var other = PARTICLES[j];
          if (other.dead || other.kind !== 'liquid' || other.liquid !== oldest.liquid) continue;
          // A drop that's already as fat as a drop is allowed to get
          // can't absorb any more without the surplus being quietly
          // clamped away, which is the culling this whole thing exists
          // to avoid. It lands instead.
          if (other.baseScale >= ceiling - 0.0001) continue;
          var d = other.el.object3D.position.distanceTo(oldest.el.object3D.position);
          if (d >= bestDist) continue;
          target = other;
          bestDist = d;
        }

        if (target) {
          mergeDroplets(oldest, target);
        } else {
          landDropletEarly(oldest);
        }
        killParticle(oldest);
      }

      function mergeDroplets(from, into) {
        var liquid = LIQUIDS[into.liquid] || LIQUIDS.beer;
        var ceiling = liquid.dropRadius * DROP_MERGE_MAX_SCALE;
        var merged = Math.cbrt(Math.pow(into.baseScale, 3) + Math.pow(from.baseScale, 3));

        // Any volume that won't fit under the ceiling is spilled rather
        // than rounded off — see landDropletEarly. Rounding it off is
        // how liquid goes missing.
        if (merged > ceiling) {
          var surplus = Math.pow(merged, 3) - Math.pow(ceiling, 3);
          spillSurplus(from, Math.cbrt(surplus));
          merged = ceiling;
        }

        into.baseScale = merged;
        into.el.object3D.scale.setScalar(into.baseScale);
        // It also inherits the older drop's remaining life, so merging
        // never shortens how long that liquid stays in the air.
        into.age = Math.min(into.age, from.age);
      }

      function landDropletEarly(drop) {
        spillSurplus(drop, drop.baseScale);
      }

      // A drop's worth of liquid arriving on the ground under `drop`,
      // scaled by how much of a drop it actually is.
      function spillSurplus(drop, radius) {
        var pos = drop.el.object3D.position;
        var type = drop.liquid || 'beer';
        var liquid = LIQUIDS[type] || LIQUIDS.beer;
        var full = liquid.isFire ? FIRE_LANDING_SPILL : POOL_GROWTH_PER_DROPLET;
        var share = liquid.dropRadius > 0 ? Math.pow(radius / liquid.dropRadius, 3) : 1;
        // `full` is a radius and `share` is a volume, so it goes in
        // under a square root: see poolArea.
        addToPool(pos, surfaceUnder(pos), type, full * Math.sqrt(share));
      }

      // Retiring a particle is always "mark it and move on"; the sweep
      // at the end of the frame is the only thing that ever changes the
      // array's shape.
      var LIVE_PARTICLES = { liquid: 0, effect: 0 };

      function killParticle(particle) {
        if (particle.dead) return;
        particle.dead = true;
        LIVE_PARTICLES[bucketOf(particle)]--;
        releaseParticleEl(particle.el, particle.shape);
      }

      function sweepParticles() {
        var write = 0;
        for (var i = 0; i < PARTICLES.length; i++) {
          if (PARTICLES[i].dead) continue;
          PARTICLES[write++] = PARTICLES[i];
        }
        PARTICLES.length = write;
      }

      function randomUnitVector() {
        var v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
        if (v.lengthSq() < 0.0001) v.set(0, 1, 0);
        return v.normalize();
      }

      // A burst of little tumbling chips: broken glass, a bottle cap
      // spinning away, whatever else wants to physically come apart.
      function spawnDebris(worldPos, options) {
        var count = options.count || 8;
        var color = options.color || '#cfd8d0';
        var size = options.size || SHARD_SIZE;
        var speed = options.speed || SHARD_SPEED;
        var life = options.life || SHARD_LIFETIME_MS;

        for (var i = 0; i < count; i++) {
          var dir = randomUnitVector();
          dir.y = Math.abs(dir.y) * 0.8 + 0.25; // bias upward and outward, so a break sprays rather than sinks

          addParticle(
            'box',
            worldPos,
            color,
            {
              x: size * (0.5 + Math.random()),
              y: size * (0.5 + Math.random()),
              z: size * (0.3 + Math.random() * 0.4),
            },
            {
              kind: 'debris',
              vel: dir.multiplyScalar(speed * (0.4 + Math.random() * 0.9)),
              angVel: randomUnitVector().multiplyScalar(6 + Math.random() * 10),
              life: life * (0.7 + Math.random() * 0.6),
              opacity: 0.95,
              restY: GROUND_REST_Y * 0.4,
            }
          );
        }
      }

      function spawnSparks(worldPos, count) {
        for (var i = 0; i < count; i++) {
          addParticle('sphere', worldPos, '#ffcf5c', 0.006 + Math.random() * 0.005, {
            kind: 'debris',
            vel: randomUnitVector().multiplyScalar(1.2 + Math.random() * 1.8),
            angVel: null,
            life: SPARK_LIFETIME_MS * (0.6 + Math.random() * 0.8),
            opacity: 1,
            restY: GROUND_REST_Y * 0.2,
          });
        }
      }

      // A single puff. `drift` seeds it with some initial motion (a
      // barrel pushes its smoke up and out; a cigar just lets it
      // curl), and `scale` makes a shotgun's cloud read as heavier
      // than a cigar's wisp without needing a second system.
      function spawnSmoke(worldPos, drift, scale) {
        scale = scale || 1;
        var vel = randomUnitVector().multiplyScalar(0.12);
        if (drift) vel.add(drift);

        var pos = worldPos.clone().addScaledVector(randomUnitVector(), 0.02 * scale);

        return addParticle('sphere', pos, '#d9d5cc', SMOKE_START_RADIUS * scale * (0.7 + Math.random() * 0.6), {
          kind: 'smoke',
          vel: vel,
          angVel: null,
          life: SMOKE_LIFETIME_MS * (0.7 + Math.random() * 0.6),
          opacity: 0.26,
        });
      }

      // ==============================================================
      // LIQUIDS
      // One system for everything that flows, with fire as a member of
      // it rather than a special case bolted on the side.
      //
      // A liquid exists in exactly two states:
      //
      //   DROPLET — in the air. A small sphere with a velocity, falling
      //     under its own type's gravity and spreading out a little as
      //     it goes, which is what makes a poured stream read as a
      //     spray rather than a wire.
      //   POOL — resting on a surface. A flat disc. Drops landing near
      //     an existing pool join it and it grows, so a five-second
      //     pour is one object instead of four hundred.
      //
      // A liquid TYPE is nothing but data (see LIQUIDS below): colour,
      // weight, how much it spreads, how long it lasts, and what it
      // does when it hits you or hits something hot. Adding a new one
      // — gasoline, blood, whiskey — is a data blob and nothing else,
      // and it immediately inherits pouring, pooling, merging,
      // drinking, dousing and burning.
      //
      // FIRE IS A LIQUID. That's the whole trick of this file:
      //   - a fire droplet is a flame in the air; it falls, lazily;
      //   - a fire pool is a burning patch of ground, and its size IS
      //     its remaining fuel;
      //   - a fire pool throws droplets back up into the air, more
      //     often and higher the bigger it is;
      //   - those droplets land somewhere slightly else and make more
      //     burning ground.
      // That last step is the entire implementation of fire spreading.
      // There is no spread function. Fire crawls along a spill because
      // its droplets physically land further along it, and a flame
      // blown sideways by the wind that already pushes smoke will
      // spread downwind for free.
      //
      // Alcohol meeting fire doesn't "catch" in any special sense
      // either: the pool changes type, and its volume becomes fuel.
      // ==============================================================
      var LIQUIDS = {
        beer: {
          dropColor: '#d99a25',
          poolColor: '#c8871f',
          dropRadius: 0.011,
          gravity: 1,
          dispersion: 0.55, // m/s of sideways spread given at birth — this is what makes a pour a spray
          startRadius: 0.045,
          poolOpacity: 0.55,
          dryRate: 0.006, // metres of radius per second: a hand-sized spill is around for half a minute, a lake for a lot longer
          cohesion: 0.6, // touching puddles pull together, the way beer does
          flow: 1,
          flammable: true,
          fuelMultiplier: 1.6, // a spill of this makes rather more fire than its own size
          drink: 'alcohol',
        },
        water: {
          dropColor: '#7fb6d4',
          poolColor: '#6ea8c6',
          dropRadius: 0.011,
          gravity: 1,
          dispersion: 0.5,
          startRadius: 0.045,
          poolOpacity: 0.45,
          dryRate: 0.013, // water goes twice as fast as beer, being mostly water
          cohesion: 0.9, // and pulls together harder: drops touch and become one drop
          flow: 1.4,
          douses: true,
          drink: 'sober',
        },
        fire: {
          dropColor: '#ff6a1a',
          poolColor: '#2c1a12', // the scorch under the flames
          dropRadius: 0.042, // bigger than a liquid drop so a jumped flame reads as a tongue of fire, not a spark
          gravity: 0.45, // flame falls, but lazily — it has somewhere to be
          dispersion: 0.9, // and scatters much more widely, which is how far fire can reach
          drift: 1.2, // plus ongoing meander in the air
          // A landed flame starts a deliberately tiny patch. Bigger and
          // fire sustains itself on bare ground forever, since each
          // patch lives long enough to throw the flame that makes the
          // next one.
          startRadius: 0.012,
          poolOpacity: 0.75,
          dryRate: 0, // fire doesn't dry out, it burns down — see POOL_BURN_RATE
          // Negative, so patches of fire shove each other apart instead
          // of balling up. A fire that coalesced the way water does
          // would sit still and go out; one that pushes outward crawls.
          cohesion: -0.45,
          flow: 0.55,
          isFire: true,
          drink: 'burn',
        },
        scorch: {
          poolColor: '#241610',
          poolOpacity: 0.6,
          dryRate: 0.005, // a scorch mark weathers away slowly
          cohesion: 0.2,
          flow: 0.6,
          inert: true,
        },
      };

      var POOLS = [];
      var POOL_POOL = []; // recycled pool entities (a disc and, for fire, a flame)
      var HOT_POINTS = []; // every lit tip, burning pool and airborne flame, refreshed once a frame

      // One shared point light, moved to whichever fire is biggest.
      // Real per-fire lights would mean a material recompile and
      // per-fragment cost each; one light that follows the action buys
      // the flicker on the bar for the price of one. Added as a raw
      // three.js light rather than an <a-light>, because adding an
      // A-Frame light makes it tear out the scene's default rig.
      var fireLight = null;

      function ensureFireLight(sceneEl) {
        if (fireLight) return fireLight;
        fireLight = new THREE.PointLight(FIRE_LIGHT_COLOR, 0, FIRE_LIGHT_RANGE);
        sceneEl.object3D.add(fireLight);
        return fireLight;
      }

      // ---------------------------------------------------------------
      // Droplets
      // ---------------------------------------------------------------
      function spawnDroplet(worldPos, velocity, type) {
        type = LIQUIDS[type] ? type : 'beer';
        var liquid = LIQUIDS[type];
        var scale = liquid.dropRadius * (0.7 + Math.random() * 0.6);

        // Dispersion is seeded once, at birth, as a fixed sideways
        // nudge. Applying it as per-frame noise instead makes a random
        // walk that averages back to zero — measured, that was five
        // millimetres of spread over a whole fall. A stream is a cone
        // because each drop leaves on a slightly different heading.
        var vel = velocity.clone();
        if (liquid.dispersion) {
          vel.x += (Math.random() - 0.5) * liquid.dispersion;
          vel.z += (Math.random() - 0.5) * liquid.dispersion;
        }

        return addParticle('sphere', worldPos, liquid.dropColor, scale, {
          kind: 'liquid',
          liquid: type,
          vel: vel,
          angVel: null,
          life: liquid.isFire ? FIRE_DROPLET_LIFETIME_MS : DROPLET_LIFETIME_MS,
          opacity: liquid.isFire ? 0.9 : 0.85,
          restY: 0.01,
          phase: Math.random() * 100,
        });
      }

      // ---------------------------------------------------------------
      // Pools
      // ---------------------------------------------------------------
      function acquirePoolEl() {
        var el = POOL_POOL.pop();
        if (el) {
          el.object3D.visible = true;
          return el;
        }

        el = document.createElement('a-entity');

        var disc = document.createElement('a-circle');
        disc.setAttribute('radius', 1);
        disc.setAttribute('rotation', '-90 0 0');
        disc.setAttribute('material', 'shader: flat; transparent: true; opacity: 0.55; depthWrite: false; side: double');
        disc.classList.add('pool-disc');
        el.appendChild(disc);

        // The steady flame every burning pool keeps, on top of the
        // droplets it throws. Without it a fire reads as popcorn; with
        // it, the jumping droplets are tongues coming off something
        // solid. Set FIRE_JUMP_RATE to 0 and only this remains.
        var flame = document.createElement('a-entity');
        flame.classList.add('pool-flame');
        flame.setAttribute('visible', false);

        var outer = document.createElement('a-sphere');
        outer.setAttribute('radius', 1);
        outer.setAttribute('material', 'color: #ff6a1a; shader: flat; transparent: true; opacity: 0.72; depthWrite: false');
        flame.appendChild(outer);

        var inner = document.createElement('a-sphere');
        inner.setAttribute('radius', 0.55);
        inner.setAttribute('material', 'color: #ffd84a; shader: flat; transparent: true; opacity: 0.9; depthWrite: false');
        flame.appendChild(inner);

        el.appendChild(flame);
        document.querySelector('a-scene').appendChild(el);
        return el;
      }

      function releasePool(index) {
        var pool = POOLS[index];
        pool.el.object3D.visible = false;
        POOL_POOL.push(pool.el);
        POOLS.splice(index, 1);
      }

      // ==============================================================
      // HOW MUCH LIQUID IS IN A PUDDLE
      // Area, not radius. A puddle twice as wide holds four times the
      // beer, so everything that adds or removes liquid has to do it in
      // those terms: a drop adds a drop's worth of AREA. Getting this
      // wrong stops being subtle once puddles have no maximum size —
      // adding radius per drop turned two seconds of pouring into a
      // metre-and-a-half lake.
      //
      // Amounts are still quoted as radii, because "a drop is 11mm" is
      // easier to reason about than "a drop is 0.00038 square metres".
      // ==============================================================
      function poolArea(radius) {
        return Math.PI * radius * radius;
      }

      function poolRadiusFor(area) {
        return Math.sqrt(Math.max(area, 0) / Math.PI);
      }

      function growPool(pool, amount, times) {
        pool.radius = poolRadiusFor(poolArea(pool.radius) + poolArea(amount) * (times === undefined ? 1 : times));
      }

      function shrinkPool(pool, amount) {
        pool.radius = poolRadiusFor(poolArea(pool.radius) - poolArea(amount));
      }

      // Liquid arriving on a surface. Joins whatever compatible pool is
      // already there, or starts a new one. Merging is what keeps the
      // count in the dozens however much you spill — and it's also why
      // fire spreads as a growing patch rather than a scattering of
      // separate flames.
      function addToPool(worldPos, surfaceY, type, amount) {
        for (var i = 0; i < POOLS.length; i++) {
          var pool = POOLS[i];
          if (Math.abs(pool.y - surfaceY) > 0.06) continue; // the bar and the floor are different places
          var dx = pool.x - worldPos.x;
          var dz = pool.z - worldPos.z;
          var reach = pool.radius + POOL_ABSORB_SKIN;
          if (dx * dx + dz * dz > reach * reach) continue;

          // Fire landing in beer converts the whole spill to fuel; beer
          // landing in fire just feeds it. Either way one pool, not two
          // overlapping ones arguing about which is on top.
          if (pool.type !== type) {
            if (!mixPools(pool, type, amount)) continue;
            return pool;
          }

          growPool(pool, amount);
          pool.age = 0;
          // Creeps toward whatever is feeding it, so a moving pour
          // draws a trail instead of growing one blob.
          pool.x += (worldPos.x - pool.x) * 0.12;
          pool.z += (worldPos.z - pool.z) * 0.12;
          return pool;
        }

        // Out of puddles. The liquid does NOT disappear: it joins
        // whichever puddle is nearest, however far that is. A spill
        // arriving in slightly the wrong place is a small lie; a spill
        // arriving nowhere is a bucket of beer the game quietly threw
        // away, and that used to be what happened.
        if (POOLS.length >= MAX_POOLS) {
          var nearest = null;
          var nearestDist = Infinity;
          for (var n = 0; n < POOLS.length; n++) {
            if (POOLS[n].type !== type) continue;
            var ndx = POOLS[n].x - worldPos.x;
            var ndz = POOLS[n].z - worldPos.z;
            var nd = ndx * ndx + ndz * ndz;
            if (nd >= nearestDist) continue;
            nearest = POOLS[n];
            nearestDist = nd;
          }
          if (!nearest) return null;
          growPool(nearest, amount);
          nearest.age = 0;
          return nearest;
        }

        var el = acquirePoolEl();
        var created = {
          el: el,
          disc: el.querySelector('.pool-disc'),
          flame: el.querySelector('.pool-flame'),
          x: worldPos.x,
          y: surfaceY,
          z: worldPos.z,
          radius: poolRadiusFor(poolArea(LIQUIDS[type].startRadius || POOL_START_RADIUS) + poolArea(amount)),
          type: type,
          age: 0,
          dousedUntil: 0,
          jumpTimer: 0,
          phase: Math.random() * 100,
          needsColor: true,
        };
        POOLS.push(created);
        return created;
      }

      // What happens when one liquid lands in a pool of another. Kept
      // in one place so the interactions are legible rather than
      // scattered through the update loop.
      function mixPools(pool, incomingType, amount) {
        var incoming = LIQUIDS[incomingType];
        var existing = LIQUIDS[pool.type];

        // Fire meeting something flammable: the spill becomes fuel.
        if (incoming.isFire && existing.flammable) {
          if (pool.dousedUntil > 0) return false;
          ignitePool(pool);
          return true;
        }

        // Something flammable poured onto fire: more fuel.
        if (existing.isFire && incoming.flammable) {
          growPool(pool, amount, incoming.fuelMultiplier);
          return true;
        }

        // Water on fire: puts it out and leaves the scorch behind.
        if (incoming.douses && existing.isFire) {
          dousePool(pool);
          return true;
        }

        // Fire meeting water, or anything meeting a scorch mark: the
        // arrival simply doesn't stick.
        if (incoming.isFire && (existing.douses || existing.inert)) return true;
        if (existing.inert) {
          pool.type = incomingType;
          pool.needsColor = true;
          pool.age = 0;
          return true;
        }

        return false;
      }

      function ignitePool(pool) {
        if (LIQUIDS[pool.type].isFire || pool.dousedUntil > 0) return;
        if (!LIQUIDS[pool.type].flammable) return;

        pool.radius = poolRadiusFor(poolArea(pool.radius) * LIQUIDS[pool.type].fuelMultiplier);
        pool.type = 'fire';
        pool.needsColor = true;
        pool.age = 0;
        spawnSparks(poolPosition(pool, _poolScratch), 6);
      }

      function dousePool(pool) {
        if (!LIQUIDS[pool.type].isFire) return;
        pool.type = 'scorch';
        pool.needsColor = true;
        pool.dousedUntil = POOL_RELIGHT_DELAY_MS;
        pool.age = 0;
        if (pool.flame) pool.flame.setAttribute('visible', false);
        spawnSmoke(poolPosition(pool, _poolScratch), null, 0.7);
      }

      var _poolScratch = new THREE.Vector3();

      function poolPosition(pool, out) {
        return out.set(pool.x, pool.y, pool.z);
      }

      // Which surface is under a point — the bar top if you're over it,
      // the floor otherwise. Shared by anything that needs to know
      // where liquid would land.
      function surfaceUnder(worldPos) {
        var best = 0;
        for (var i = 0; i < HARD_SURFACES.length; i++) {
          var s = HARD_SURFACES[i];
          if (s.y <= best || s.y > worldPos.y + 0.02) continue;
          if (!overSurface(s, worldPos)) continue;
          best = s.y;
        }
        return best;
      }

      // Used by anything that spills without pouring — a bottle
      // smashing, a flame landing.
      function spillPuddle(worldPos, type, amount) {
        return addToPool(worldPos, surfaceUnder(worldPos), type, amount);
      }

      // The nearest burning thing, for anything that wants to know if
      // it's standing in a fire (see burnable).
      function nearestFire(worldPos, maxDistance) {
        var bestDist = maxDistance;
        var best = null;

        for (var i = 0; i < POOLS.length; i++) {
          if (!LIQUIDS[POOLS[i].type].isFire) continue;
          var d = poolPosition(POOLS[i], _poolScratch).distanceTo(worldPos);
          if (d - POOLS[i].radius < bestDist) {
            bestDist = Math.max(d - POOLS[i].radius, 0);
            best = POOLS[i];
          }
        }

        return best;
      }

      // Water's whole job, and the jug's reason to exist. Puts out both
      // the flames in the air and the ground burning underneath them —
      // dousing only the flame meant the spill relit itself the next
      // frame, which is realistic and infuriating.
      function douseFires(worldPos, radius, amount) {
        var doused = false;

        for (var i = 0; i < POOLS.length; i++) {
          var pool = POOLS[i];
          if (!LIQUIDS[pool.type].isFire) continue;
          var dx = pool.x - worldPos.x;
          var dz = pool.z - worldPos.z;
          var reach = radius + pool.radius;
          if (dx * dx + dz * dz > reach * reach) continue;

          pool.radius -= amount;
          if (pool.radius <= 0.02) dousePool(pool);
          doused = true;
        }

        // Flames in mid-air are put out too, otherwise a thrown jug
        // leaves the sparks it was aimed at still hanging there.
        for (var j = 0; j < PARTICLES.length; j++) {
          var p = PARTICLES[j];
          if (p.dead || p.kind !== 'liquid' || p.liquid !== 'fire') continue;
          if (p.el.object3D.position.distanceTo(worldPos) > radius) continue;
          killParticle(p);
          doused = true;
        }

        return doused;
      }

      // Fire's party trick, and the reason it's a liquid at all: a
      // burning patch spits flame back into the air. Bigger patch means
      // more often, higher and larger, so a big spill looks like a
      // proper blaze rather than a scaled-up candle — and since those
      // droplets land somewhere slightly else, this IS how fire
      // spreads.
      function jumpFlame(pool) {
        var strength = Math.min(pool.radius / POOL_REFERENCE_RADIUS, 1);
        var spread = pool.radius * 0.8;

        _poolScratch.set(
          pool.x + (Math.random() - 0.5) * spread,
          pool.y + 0.02,
          pool.z + (Math.random() - 0.5) * spread
        );

        var up = FIRE_JUMP_SPEED_MIN + (FIRE_JUMP_SPEED_MAX - FIRE_JUMP_SPEED_MIN) * strength;
        var velocity = new THREE.Vector3(
          (Math.random() - 0.5) * FIRE_JUMP_SPREAD,
          up * (0.7 + Math.random() * 0.6),
          (Math.random() - 0.5) * FIRE_JUMP_SPREAD
        );

        // A jump costs the pool more fuel than the landing gives back,
        // so a fire always runs down. Spread comes from a flame landing
        // on something ELSE that will burn, never from fire creating
        // its own fuel.
        shrinkPool(pool, FIRE_JUMP_COST);

        var droplet = spawnDroplet(_poolScratch, velocity, 'fire');
        if (droplet) droplet.baseScale *= 0.7 + strength * 0.8;
        return droplet;
      }

      // ==============================================================
      // SOUND
      // There are no audio assets in this repo and no good reason to
      // add any: a glug, a clink, and breaking glass are all short,
      // noisy, and easy to synthesize outright. Everything below is a
      // few oscillators and a noise burst through a filter, built on
      // demand. Browsers won't start an AudioContext without a user
      // gesture, so it's created lazily on the first sound — by which
      // point the player has necessarily pressed something (or entered
      // VR, which is itself a gesture).
      // ==============================================================
      var audioCtx = null;

      function getAudio() {
        if (!audioCtx) {
          var Ctor = window.AudioContext || window.webkitAudioContext;
          if (!Ctor) return null;
          audioCtx = new Ctor();
        }
        if (audioCtx.state === 'suspended') audioCtx.resume();
        return audioCtx;
      }

      // One shaped tone. `sweep` is the frequency it slides to, which
      // is what separates a "glug" (drops in pitch, like air replacing
      // liquid) from a "clink" (stays put and rings).
      function playTone(options) {
        var ctx = getAudio();
        if (!ctx) return;

        var now = ctx.currentTime;
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();

        osc.type = options.type || 'sine';
        osc.frequency.setValueAtTime(options.freq, now);
        if (options.sweep) osc.frequency.exponentialRampToValueAtTime(options.sweep, now + options.duration);

        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(options.volume, now + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + options.duration);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + options.duration + 0.02);
      }

      // A burst of filtered white noise — the "shhh" half of a sound,
      // used on its own for breaking glass.
      function playNoise(options) {
        var ctx = getAudio();
        if (!ctx) return;

        var now = ctx.currentTime;
        var frames = Math.floor(ctx.sampleRate * options.duration);
        var buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
        var data = buffer.getChannelData(0);
        for (var i = 0; i < frames; i++) {
          data[i] = (Math.random() * 2 - 1) * (1 - i / frames); // decays across the burst
        }

        var source = ctx.createBufferSource();
        source.buffer = buffer;

        var filter = ctx.createBiquadFilter();
        filter.type = options.filterType || 'bandpass';
        filter.frequency.value = options.freq;
        filter.Q.value = options.q || 1;

        var gain = ctx.createGain();
        gain.gain.value = options.volume;

        source.connect(filter);
        filter.connect(gain);
        gain.connect(ctx.destination);
        source.start(now);
      }

      // The one the whole saloon was waiting for: a descending blip
      // with a little noise on it, which is close enough to the sound
      // of a bottle emptying into a cowboy.
      function playGlug() {
        var base = 320 + Math.random() * 90;
        playTone({ type: 'sine', freq: base, sweep: base * 0.45, duration: 0.13, volume: 0.16 });
        playNoise({ duration: 0.06, freq: 700, q: 0.8, volume: 0.05 });
      }

      function playClink() {
        playTone({ type: 'square', freq: 1800 + Math.random() * 400, duration: 0.07, volume: 0.05 });
        playTone({ type: 'sine', freq: 2600, duration: 0.05, volume: 0.03 });
      }

      function playSmash() {
        playNoise({ duration: 0.28, freq: 4200, q: 0.6, volume: 0.11, filterType: 'highpass' });
        playTone({ type: 'triangle', freq: 900, sweep: 300, duration: 0.09, volume: 0.05 });
      }

      // Struck brass: a bright partial over a body tone, both left to
      // ring out well past the hit.
      function playClang() {
        playTone({ type: 'triangle', freq: 1180, duration: 0.9, volume: 0.09 });
        playTone({ type: 'sine', freq: 1790, duration: 0.6, volume: 0.05 });
        playNoise({ duration: 0.05, freq: 3000, q: 0.7, volume: 0.06, filterType: 'highpass' });
      }

      // Heavy machinery under the floorboards, for as long as it takes.
      function playRumble(durationMs) {
        var seconds = durationMs / 1000;
        playNoise({ duration: seconds, freq: 130, q: 1.4, volume: 0.09, filterType: 'lowpass' });
        playTone({ type: 'sawtooth', freq: 46, sweep: 70, duration: seconds, volume: 0.05 });
      }

      // Show the muzzle flash on anything that has one, briefly. Two
      // components want this now, so it stopped being the firearm's.
      function flashMuzzle(el) {
        var flash = el.querySelector('.muzzle-flash');
        if (!flash) return;
        flash.setAttribute('visible', true);
        clearTimeout(el._flashTimeout);
        el._flashTimeout = setTimeout(function () {
          flash.setAttribute('visible', false);
        }, 80);
      }

      // A bowstring. Pitched by how far you drew it, and a dry slap
      // rather than a note if there was nothing on the string.
      function playBowstring(power, loaded) {
        var base = 150 + power * 130;
        playTone({ type: 'triangle', freq: base, sweep: base * 0.55, duration: loaded ? 0.2 : 0.09, volume: 0.11 });
        playNoise({ duration: 0.07, freq: 1400, q: 1.2, volume: 0.06 });
      }

      // Something driven into something else and staying there.
      function playThunk() {
        playTone({ type: 'sine', freq: 210, sweep: 90, duration: 0.1, volume: 0.13 });
        playNoise({ duration: 0.05, freq: 900, q: 1.5, volume: 0.07 });
      }

      // A stick of dynamite. Mostly noise with a low thud under it,
      // and a long tail so it sounds like it happened to the room
      // rather than to a speaker.
      function playBoom() {
        playNoise({ duration: 0.7, freq: 260, q: 0.5, volume: 0.28, filterType: 'lowpass' });
        playTone({ type: 'sine', freq: 120, sweep: 32, duration: 0.6, volume: 0.3 });
        playTone({ type: 'sawtooth', freq: 70, sweep: 24, duration: 0.35, volume: 0.14 });
      }

      // And the thump of it arriving.
      function playClunk() {
        playTone({ type: 'sine', freq: 96, sweep: 42, duration: 0.22, volume: 0.16 });
        playNoise({ duration: 0.11, freq: 320, q: 0.8, volume: 0.09, filterType: 'lowpass' });
      }

      // ==============================================================
      // findHardSurfaceStrike
      // "Did this small collider just get driven down through
      // something solid?" — used by a bottle cap, and deliberately
      // generic enough that anything else wanting a satisfying
      // physical slam can ask the same question. Surfaces are plain
      // horizontal rectangles registered in HARD_SURFACES; there's no
      // real collision anywhere in this scene and this doesn't add
      // any.
      //
      // It needs the PREVIOUS position as well as the current one,
      // because the test that matters is a crossing — clear of the
      // surface last frame, in contact with it now. Proximity alone
      // was the first version and it fired constantly for anything
      // resting on the bar in the first place.
      // ==============================================================
      function findHardSurfaceStrike(prevPos, worldPos, downwardSpeed, radius) {
        if (downwardSpeed < BOTTLE_STRIKE_SPEED) return null;

        for (var i = 0; i < HARD_SURFACES.length; i++) {
          var s = HARD_SURFACES[i];
          var contactY = s.y + radius;
          if (prevPos.y <= contactY) continue; // wasn't clear of it to begin with
          if (worldPos.y > contactY) continue; // still hasn't reached it
          if (worldPos.y < s.y - radius * 3) continue; // already well past — a stale frame, not a strike
          if (!overSurface(s, worldPos, radius)) continue;
          return s;
        }
        return null;
      }

      // ==============================================================
      // fanOffset / viceWobble
      // The two tiny bits of math that make "more than one of a thing"
      // and "too much of a good thing" work everywhere at once.
      //
      // fanOffset spreads item `index` of `count` symmetrically around
      // its parent's origin — used for both hand stacks and slot
      // stacks, on position and on yaw.
      //
      // viceWobble is the single unsteady-hands signal every HELD
      // object adds to its own pose. The two vices contribute
      // different frequencies on purpose: alcohol is a slow sway you
      // can almost ride out, nicotine is a fast tremor you can't. They
      // sum into one output, so being both drunk and jittery stacks
      // the way you'd hope. Note it perturbs held OBJECTS and never
      // the camera — a swaying view is a motion-sickness generator,
      // while a swaying pistol barrel is just funny and still entirely
      // your own fault.
      // ==============================================================
      function fanOffset(index, count, step) {
        if (!count || count < 2) return 0;
        return (index - (count - 1) / 2) * step;
      }

      function viceWobble(seed, timeMs, out) {
        var t = timeMs / 1000;
        var sway = VICES.alcohol * ALCOHOL_SWAY_DEG;
        var shake = VICES.nicotine * NICOTINE_SHAKE_DEG;

        out.x = sway * Math.sin(t * 1.3 + seed) + shake * Math.sin(t * 21.7 + seed * 3);
        out.y = sway * Math.sin(t * 0.9 + seed * 2) + shake * Math.sin(t * 27.3 + seed);
        out.z = sway * 0.6 * Math.sin(t * 1.7 + seed) + shake * 0.5 * Math.sin(t * 31.1 + seed * 5);
        return out;
      }

      // ==============================================================
      // createHitbox
      // An invisible, deliberately oversized collider child. Fully
      // transparent rather than visible:false, because three.js skips
      // invisible objects when raycasting but happily hits a
      // zero-opacity one — and depthWrite:false keeps it from
      // occluding what's behind it. This is what makes small or
      // fast-moving shootables (a thrown bottle, a cigar) hittable
      // without making the guns any more forgiving in general.
      // ==============================================================
      function createHitbox(radius, height, position, rotation) {
        var box = document.createElement('a-cylinder');
        box.setAttribute('radius', radius);
        box.setAttribute('height', height);
        box.setAttribute('material', 'opacity: 0; transparent: true; depthWrite: false');
        box.setAttribute('position', position);
        if (rotation) box.setAttribute('rotation', rotation);
        return box;
      }

      // Every face button on both Touch controllers, since they all do
      // the same thing here and nothing needs to care which is which.
      var FACE_BUTTON_EVENTS = ['abuttondown', 'bbuttondown', 'xbuttondown', 'ybuttondown'];

      // ==============================================================
      // useHeldObject
      // Generic "the player pressed something while holding this."
      // Rather than hand-rig knowing about guns and lighters, it calls
      // a named method on every component of the held entity that
      // happens to implement it — firearm.onTriggerUse fires,
      // zippo.onTriggerUse flips the lid, zippo.onFaceButtonUse
      // strikes it. A new prop opts in by defining the method.
      // ==============================================================
      function useHeldObject(el, method) {
        var components = el.components;
        for (var name in components) {
          var component = components[name];
          if (component && typeof component[method] === 'function') component[method]();
        }
      }

      // ==============================================================
      // createFlickDetector
      // "Did the player just snap their wrist?" — a sharp reversal in
      // the tracked speed of some point, which is what a flick is and
      // a sweep isn't. Shared by knocking ash off a cigar and by
      // flipping a Zippo's lid open, since they're the same gesture
      // wanting the same answer.
      // ==============================================================
      function createFlickDetector(minSpeed, reversalDot) {
        var prevPos = new THREE.Vector3();
        var vel = new THREE.Vector3();
        var prevVel = new THREE.Vector3();
        var seeded = false;

        return {
          reset: function () {
            seeded = false;
          },
          update: function (worldPos, dtSeconds) {
            if (!seeded || dtSeconds <= 0) {
              prevPos.copy(worldPos);
              seeded = true;
              return false;
            }

            prevVel.copy(vel);
            vel.copy(worldPos).sub(prevPos).divideScalar(dtSeconds);
            prevPos.copy(worldPos);

            var speed = vel.length();
            var prevSpeed = prevVel.length();
            if (speed < minSpeed || prevSpeed < minSpeed) return false;

            // Normalized dot of successive velocities: strongly
            // negative means the direction snapped back.
            return vel.dot(prevVel) / (speed * prevSpeed) < reversalDot;
          },
        };
      }

      // ==============================================================
      // gripObjectOf
      // Where an object held by this hand should actually hang. Not
      // the hand entity itself: hand-rig keeps a child "grip" that
      // carries the drink sway, the cigar tremor and the drunk aim
      // drift (see hand-rig.updateGrip), so that a wobbling hand takes
      // whatever it's holding along with it instead of the object
      // swimming inside a steady fist.
      // ==============================================================
      function gripObjectOf(handEl) {
        var handRig = handEl && handEl.components['hand-rig'];
        return handRig ? handRig.gripObject3D() : handEl.object3D;
      }

      // ==============================================================
      // findOtherHand
      // The `.hand` element that isn't handEl — with exactly two hands
      // in the scene this is just "the other one," found generically
      // rather than assuming which is left/right.
      // ==============================================================
      function findOtherHand(handEl) {
        var hands = document.querySelectorAll('.hand');
        for (var i = 0; i < hands.length; i++) {
          if (hands[i] !== handEl) return hands[i];
        }
        return null;
      }

      // ==============================================================
      // computeThrowVelocity
      // Decides whether a grip-release counts as a deliberate upward
      // toss and, if so, returns the launch velocity to use — or null
      // if it's just a normal release (too slow, or not upward enough)
      // that should fall through to the usual holster/drop logic.
      //
      // This is an aimed toss, not raw physics: real hand velocity at
      // release is unreliable for anyone to consistently land a catch
      // with, so only the vertical component (how hard you flicked
      // upward, clamped to a reactable range) survives untouched. The
      // horizontal component is discarded and replaced with whatever's
      // needed to land exactly on a target hand — your own hand's
      // current position for a "basically straight up" release, or the
      // other hand's current position if there's meaningful sideways
      // velocity toward it. Both targets are fixed at this instant;
      // the arc doesn't re-aim later if a hand moves (see
      // holsterable.updateFall/checkCatch for how catching still stays
      // generous regardless of exactly where the arc ends up).
      //
      // stackIndex/stackCount handle a whole fistful released at once
      // (see HAND_CAPACITY): each item gets a nudge of sideways
      // velocity out from the center of the arc and a slightly
      // different launch height, so five bottles thrown together
      // separate into five shootable targets in the air instead of one
      // overlapping clump. This is the entire implementation of "toss
      // a handful of bottles up and shoot them before they land."
      // ==============================================================
      function computeThrowVelocity(handEl, stackIndex, stackCount, holsterable) {
        var handRig = handEl.components['hand-rig'];
        if (!handRig) return null;

        // Checked first: an overhand throw is the most deliberate of
        // the three and the only one that involves aiming at the world.
        var overhand = computeOverhandVelocity(handEl, handRig, holsterable);
        if (overhand) return overhand;

        var hurl = computeHurlVelocity(handRig, stackIndex, stackCount);
        if (hurl) return hurl;

        var vy = handRig.velocity.y;
        if (vy < MIN_THROW_UPWARD_SPEED) return null;
        vy = Math.min(Math.max(vy * THROW_VELOCITY_MULTIPLIER, THROW_LAUNCH_VY_MIN), THROW_LAUNCH_VY_MAX);

        var releasePos = new THREE.Vector3();
        handEl.object3D.getWorldPosition(releasePos);

        var targetPos = releasePos.clone();
        var otherHandEl = findOtherHand(handEl);

        if (otherHandEl) {
          var otherPos = new THREE.Vector3();
          otherHandEl.object3D.getWorldPosition(otherPos);

          var towardOther = new THREE.Vector3(otherPos.x - releasePos.x, 0, otherPos.z - releasePos.z);
          if (towardOther.lengthSq() > 0.0001) {
            towardOther.normalize();
            var towardOtherSpeed = handRig.velocity.x * towardOther.x + handRig.velocity.z * towardOther.z;
            if (towardOtherSpeed > OTHER_HAND_DOT_THRESHOLD) {
              targetPos = otherPos;
            }
          }
        }

        var spread = fanOffset(stackIndex || 0, stackCount || 1, THROW_STACK_SPREAD);
        vy *= 1 + fanOffset(stackIndex || 0, stackCount || 1, 0.09); // vary the arc heights too, so they don't all peak at once

        var flightTime = (2 * vy) / GRAVITY; // time to fall back to launch height under gravity
        var velocity = new THREE.Vector3(
          (targetPos.x - releasePos.x) / flightTime,
          vy,
          (targetPos.z - releasePos.z) / flightTime
        );

        if (spread) {
          // Sideways relative to the throw itself, so a handful fans
          // out across your view rather than always along world X.
          var lateral = new THREE.Vector3(-velocity.z, 0, velocity.x);
          if (lateral.lengthSq() < 0.0001) lateral.set(1, 0, 0);
          velocity.addScaledVector(lateral.normalize(), spread);
        }

        return velocity;
      }

      // ==============================================================
      // computeOverhandVelocity
      // The aimed throw. Bringing your hand up past your own eyeline
      // and swinging it forward means you're trying to hit something
      // you're looking at, so the game does what the juggling toss
      // already does — solves for a velocity that lands where you
      // want — except pointed out at the world instead of back at your
      // own hand.
      //
      // Two things you actually control. Where you're LOOKING picks
      // the target: a ray from the camera against everything
      // shootable, falling back to the ground. And WHEN in the swing
      // you let go picks the arc: release early, while your hand is
      // still rising, and it lobs high; release near the top, where
      // your hand is moving forward rather than up, and it goes flat
      // and fast. How hard you threw scales the speed cap, so a gentle
      // lob stays gentle and something heavy can't be rifled.
      //
      // The physics is the standard "hit a point at a fixed angle"
      // solve: for a launch angle theta, horizontal distance d and
      // height difference h,
      //     v^2 = g*d^2 / (2*cos^2(theta) * (d*tan(theta) - h))
      // and where that has no solution (the target is too high for
      // this angle) or wants more speed than you've got, it throws as
      // hard as it can and lets it fall short honestly.
      // ==============================================================
      function computeOverhandVelocity(handEl, handRig, holsterable) {
        var cameraEl = document.querySelector('#head-camera');
        if (!cameraEl) return null;

        var speed = handRig.velocity.length();
        if (speed < OVERHAND_MIN_SPEED) return null;

        var handPos = new THREE.Vector3();
        var headPos = new THREE.Vector3();
        handEl.object3D.getWorldPosition(handPos);
        cameraEl.object3D.getWorldPosition(headPos);
        if (handPos.y < headPos.y + OVERHAND_MIN_HAND_HEIGHT) return null;

        var target = findLookTarget(cameraEl, headPos);
        if (!target) return null;

        // Where in the swing: +1 still going up, -1 already coming
        // down. Rising means a lob, level-or-falling means a bullet.
        var rise = handRig.velocity.y / speed;
        var steepness = Math.min(Math.max((rise + 0.35) / 1.1, 0), 1);
        var angle = ((OVERHAND_FLAT_DEG + (OVERHAND_STEEP_DEG - OVERHAND_FLAT_DEG) * steepness) * Math.PI) / 180;

        var flat = new THREE.Vector3(target.x - handPos.x, 0, target.z - handPos.z);
        var d = flat.length();
        if (d < 0.4) return null;
        flat.divideScalar(d);

        var h = target.y - handPos.y;
        var g = GRAVITY * (holsterable ? holsterable.data.gravityScale : 1);
        var maxSpeed = (holsterable ? holsterable.data.maxThrowSpeed : OVERHAND_MAX_DEFAULT_SPEED) *
          Math.min(speed / OVERHAND_SPEED_REFERENCE, 1.15);

        var denominator = 2 * Math.cos(angle) * Math.cos(angle) * (d * Math.tan(angle) - h);
        var launchSpeed;
        if (denominator <= 0.0001) {
          launchSpeed = maxSpeed; // can't reach it at this angle; throw as hard as you can
        } else {
          launchSpeed = Math.sqrt((g * d * d) / denominator);
          if (!isFinite(launchSpeed)) launchSpeed = maxSpeed;
        }
        launchSpeed = Math.min(launchSpeed, maxSpeed);

        var velocity = new THREE.Vector3(
          flat.x * Math.cos(angle) * launchSpeed,
          Math.sin(angle) * launchSpeed,
          flat.z * Math.cos(angle) * launchSpeed
        );
        velocity.isHurl = true; // same catch suppression a hurl gets
        return velocity;
      }

      // ==============================================================
      // solveArcAtSpeed
      // The other half of the same problem computeOverhandVelocity
      // solves, from the other end. That one fixes the ANGLE (which
      // your swing picked) and solves for the speed; this one fixes
      // the SPEED (which your draw earned) and solves for the angle —
      // which is what a bow wants, since how hard you pulled is not
      // negotiable but where you point it is.
      //
      // Standard projectile solve: for speed v, horizontal distance d
      // and height difference h,
      //     tan(theta) = (v² ± sqrt(v⁴ - g(g·d² + 2·h·v²))) / (g·d)
      // and the minus root is the flat, fast trajectory rather than
      // the mortar shot. A negative discriminant means it's simply out
      // of range at that speed, in which case the honest answer is 45
      // degrees — the angle that gets furthest — and it falls short
      // where you can see it fall short.
      // ==============================================================
      function solveArcAtSpeed(fromPos, target, speed, gravity, out) {
        var dx = target.x - fromPos.x;
        var dz = target.z - fromPos.z;
        var d = Math.sqrt(dx * dx + dz * dz);
        if (d < 0.2) return null;

        var h = target.y - fromPos.y;
        var v2 = speed * speed;
        var discriminant = v2 * v2 - gravity * (gravity * d * d + 2 * h * v2);
        var angle;
        if (discriminant < 0) {
          angle = Math.PI / 4;
        } else {
          angle = Math.atan((v2 - Math.sqrt(discriminant)) / (gravity * d));
        }

        var flat = Math.cos(angle) * speed;
        return out.set((dx / d) * flat, Math.sin(angle) * speed, (dz / d) * flat);
      }

      // What you're looking at: the first shootable thing along the
      // camera's forward ray, or failing that the point where that ray
      // meets the ground. Never null unless you're staring at the sky
      // from below, in which case the caller falls through to a normal
      // throw.
      function findLookTarget(cameraEl, headPos) {
        var quat = new THREE.Quaternion();
        cameraEl.object3D.getWorldQuaternion(quat);
        var forward = new THREE.Vector3(0, 0, -1).applyQuaternion(quat).normalize();

        var hit = castShot(headPos, forward);
        if (hit) return hit.point;

        if (forward.y < -0.02) {
          var t = -headPos.y / forward.y; // where the ray crosses y = 0
          if (t > 0 && t < OVERHAND_AIM_RANGE) return headPos.clone().addScaledVector(forward, t);
        }

        return headPos.clone().addScaledVector(forward, OVERHAND_AIM_RANGE);
      }

      // ==============================================================
      // computeHurlVelocity
      // The "get rid of it" throw, checked before the juggle toss. If
      // your hand is moving decisively across rather than up, the
      // aiming is abandoned and your actual velocity is used, scaled
      // up (bare hand speed throws disappointingly short) and given a
      // little loft if you threw flat. Returns null when the release
      // doesn't look like a hurl, which lets computeThrowVelocity fall
      // through to the aimed toss it always had.
      // ==============================================================
      function computeHurlVelocity(handRig, stackIndex, stackCount) {
        var v = handRig.velocity;
        var horizontalSpeed = Math.sqrt(v.x * v.x + v.z * v.z);

        if (horizontalSpeed < HURL_MIN_HORIZONTAL_SPEED) return null;
        if (horizontalSpeed < Math.abs(v.y) * HURL_HORIZONTAL_RATIO) return null;

        var velocity = v.clone().multiplyScalar(HURL_MULTIPLIER);
        if (velocity.length() > HURL_MAX_SPEED) velocity.setLength(HURL_MAX_SPEED);
        if (velocity.y < HURL_MIN_UP) velocity.y = HURL_MIN_UP;

        // A whole handful hurled at once fans out across the throw, so
        // they separate into several targets rather than one clump.
        var spread = fanOffset(stackIndex || 0, stackCount || 1, THROW_STACK_SPREAD);
        if (spread) {
          var lateral = new THREE.Vector3(-velocity.z, 0, velocity.x);
          if (lateral.lengthSq() > 0.0001) velocity.addScaledVector(lateral.normalize(), spread);
        }

        velocity.isHurl = true;
        return velocity;
      }

      // ==============================================================
      // findCatchingHand
      // Generous catch detection for anything falling/flying (a
      // dropped or thrown holsterable prop — this doesn't know or care
      // which one, it just checks `.hand` elements' public hand-rig
      // state). A hand can catch by gripping (any grip currently held, not
      // just a fresh press) within THROW_CATCH_RADIUS, or by resting a
      // finger on the trigger within that same radius — the two modes
      // the caller uses to decide "snap into hand" vs. "land on the
      // finger and dangle." Skips any hand with no room left, which
      // since hands hold several things now means catching a second
      // pistol into the fist already holding one is a legal (and
      // strongly encouraged) move.
      // ==============================================================
      function findCatchingHand(worldPos, radius) {
        var hands = document.querySelectorAll('.hand');
        var handPos = new THREE.Vector3();
        var best = null;
        var bestDist = radius;

        for (var i = 0; i < hands.length; i++) {
          var handEl = hands[i];
          var handRig = handEl.components['hand-rig'];
          if (!handRig) continue;
          if (handRig.isFull()) continue;

          var mode = handRig.gripHeld ? 'grip' : handRig.fingerOnTrigger ? 'trigger' : null;
          if (!mode) continue;

          handEl.object3D.getWorldPosition(handPos);
          var d = handPos.distanceTo(worldPos);
          if (d < bestDist) {
            bestDist = d;
            best = { handEl: handEl, mode: mode };
          }
        }

        return best;
      }

      // ==============================================================
      // findContainerHolsterable
      // Walks a slot entity's object3D ancestors (NOT the DOM — a
      // holsterable object's DOM parent is left alone when it's
      // reparented at runtime, see holsterable's own comment) to find
      // the holsterable component of whatever object this slot is
      // physically attached to, if any. Returns null for a slot that's
      // just a free-standing body anchor (hips, head, back) rather
      // than a slot nested inside another grabbable item (like the
      // hat's inner slot) — that distinction is exactly what
      // findCatchingSlot uses to decide what's allowed to passively
      // "catch" a falling item and what isn't.
      // ==============================================================
      function findContainerHolsterable(slotEl) {
        var node = slotEl.object3D.parent;
        while (node) {
          if (node.el && node.el.components && node.el.components.holsterable) {
            return node.el.components.holsterable;
          }
          node = node.parent;
        }
        return null;
      }

      // ==============================================================
      // findCatchingSlot
      // The "throw your gun up, take off your hat, and use it to catch
      // the gun" mechanic. Only a slot that's nested inside another
      // object AND currently actively gripped in a hand (state ===
      // 'held', per findContainerHolsterable) counts — a slot worn,
      // holstered, or resting is a deliberate-release target only (see
      // holsterable.tryHolsterElse/findNearestSlot), not a passive
      // basket that scoops up anything that flies near it.
      // ==============================================================
      function findCatchingSlot(worldPos, itemSize) {
        var itemRank = SLOT_SIZE_RANK[itemSize];
        var slots = document.querySelectorAll('.anchor-slot');
        var slotPos = new THREE.Vector3();
        var best = null;
        var bestDist = Infinity;

        for (var i = 0; i < slots.length; i++) {
          var slotEl = slots[i];
          var slotComp = slotEl.components['anchor-slot'];
          if (!slotComp || slotComp.isFull()) continue;

          var slotRank = SLOT_SIZE_RANK[slotComp.data.size];
          if (slotRank < itemRank) continue;

          var container = findContainerHolsterable(slotEl);
          if (!container || container.state !== 'held') continue;

          slotEl.object3D.getWorldPosition(slotPos);
          var d = slotPos.distanceTo(worldPos);
          if (d < SLOT_SNAP_RADIUS[slotComp.data.size] && d < bestDist) {
            best = slotEl;
            bestDist = d;
          }
        }

        return best;
      }

      // ==============================================================
      // clickEnvelope
      // A fast "click into place" bounce for the anchor-slot indicator
      // sphere: rises past its target size, dips back below it, then
      // settles — a quick buzz rather than a dramatic wiggle, since
      // controller vibration doesn't reliably work everywhere. Input
      // t is 0..1 progress through SLOT_CLICK_DUR_MS; output is a
      // multiplier on the sphere's fully-expanded radius.
      // ==============================================================
      function clickEnvelope(t) {
        if (t < 0.35) return 1 + 0.35 * (t / 0.35); // quick rise to 1.35x (overshoot)
        if (t < 0.7) return 1.35 - 0.55 * ((t - 0.35) / 0.35); // fall through to 0.8x (undershoot)
        return 0.8 + 0.2 * ((t - 0.7) / 0.3); // settle back to 1x
      }

      // ==============================================================
      // COMPONENT: boxy-gun
      // Builds a very simple, low-poly pistol out of boxes, sized for a
      // hand-held scale (roughly 20cm long). Local space is defined so
      // the entity's own origin sits at the grip/trigger-guard area —
      // that's what lets holsterable's dangle physics (a separate
      // component, attached alongside this one) treat "pivot around
      // the entity origin" as "pivot around the trigger guard" without
      // needing a separate offset. See boxy-hat, below, for the same
      // trick applied to a very differently-shaped object.
      // ==============================================================
      registerComponent('boxy-gun', {
        init: function () {
          var el = this.el;
          var metal = '#2b2b2f';
          var wood = '#4a2f1c';
          var brass = '#c9962c';

          function addBox(w, h, d, pos, color, rot) {
            var box = document.createElement('a-box');
            box.setAttribute('width', w);
            box.setAttribute('height', h);
            box.setAttribute('depth', d);
            box.setAttribute('position', pos);
            box.setAttribute('color', color);
            if (rot) box.setAttribute('rotation', rot);
            el.appendChild(box);
            return box;
          }

          addBox(0.045, 0.13, 0.05, '0 -0.05 0.02', wood, '12 0 0'); // grip
          addBox(0.045, 0.05, 0.14, '0 0.02 -0.04', metal); // frame
          addBox(0.042, 0.045, 0.22, '0 0.058 -0.12', metal); // slide
          addBox(0.045, 0.006, 0.06, '0 -0.028 -0.02', metal); // trigger guard (bottom)
          addBox(0.045, 0.05, 0.006, '0 -0.005 -0.05', metal); // trigger guard (front)
          addBox(0.008, 0.03, 0.008, '0 -0.01 -0.035', brass); // trigger
          addBox(0.03, 0.025, 0.012, '0 0.075 0.025', metal, '20 0 0'); // hammer
          addBox(0.008, 0.012, 0.008, '0 0.085 -0.22', metal); // front sight
          addBox(0.03, 0.01, 0.012, '0 0.083 -0.03', metal); // rear sight

          var flash = document.createElement('a-circle');
          flash.setAttribute('radius', 0.03);
          flash.setAttribute('material', 'color: #ffe066; shader: flat; opacity: 0.9');
          flash.setAttribute('position', '0 0.058 -0.24');
          flash.setAttribute('visible', false);
          flash.classList.add('muzzle-flash');
          el.appendChild(flash);

          var muzzle = document.createElement('a-entity');
          muzzle.setAttribute('position', '0 0.058 -0.235');
          muzzle.classList.add('muzzle');
          el.appendChild(muzzle);
        },
      });

      // ==============================================================
      // COMPONENT: boxy-shotgun
      // Same boxy-box-of-boxes approach and the same "origin sits at
      // the trigger guard" convention as boxy-gun (so it dangles/
      // twirls with zero extra physics code), just a lot longer: a
      // long barrel, a pump forend under it, and a stock out the back
      // for shouldering flavor. This is also why it needs a large
      // anchor-slot (see the bandolier in markup) rather than a small
      // one like the pistols — it's sized to obviously not fit in a
      // hip holster.
      // ==============================================================
      registerComponent('boxy-shotgun', {
        init: function () {
          var el = this.el;
          var metal = '#2b2b2f';
          var wood = '#4a2f1c';
          var brass = '#c9962c';

          function addBox(w, h, d, pos, color, rot) {
            var box = document.createElement('a-box');
            box.setAttribute('width', w);
            box.setAttribute('height', h);
            box.setAttribute('depth', d);
            box.setAttribute('position', pos);
            box.setAttribute('color', color);
            if (rot) box.setAttribute('rotation', rot);
            el.appendChild(box);
            return box;
          }

          addBox(0.05, 0.14, 0.055, '0 -0.05 0.02', wood, '10 0 0'); // grip
          addBox(0.05, 0.06, 0.18, '0 0.02 -0.06', metal); // receiver
          addBox(0.035, 0.035, 0.45, '0 0.05 -0.36', metal); // barrel
          addBox(0.055, 0.045, 0.16, '0 0.01 -0.22', wood); // pump forend
          addBox(0.06, 0.09, 0.28, '0 -0.02 0.24', wood, '-6 0 0'); // stock
          addBox(0.045, 0.006, 0.06, '0 -0.028 -0.02', metal); // trigger guard (bottom)
          addBox(0.045, 0.05, 0.006, '0 -0.005 -0.05', metal); // trigger guard (front)
          addBox(0.008, 0.03, 0.008, '0 -0.01 -0.035', brass); // trigger
          addBox(0.01, 0.014, 0.01, '0 0.085 -0.58', metal); // front sight bead

          var flash = document.createElement('a-circle');
          flash.setAttribute('radius', 0.045);
          flash.setAttribute('material', 'color: #ffe066; shader: flat; opacity: 0.9');
          flash.setAttribute('position', '0 0.05 -0.6');
          flash.setAttribute('visible', false);
          flash.classList.add('muzzle-flash');
          el.appendChild(flash);

          var muzzle = document.createElement('a-entity');
          muzzle.setAttribute('position', '0 0.05 -0.585');
          muzzle.classList.add('muzzle');
          el.appendChild(muzzle);
        },
      });

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

      // ==============================================================
      // COMPONENT: body-anchor
      // Drives an invisible entity to sit at roughly a fixed spot on
      // the player's body, following the headset's horizontal position
      // and yaw only (deliberately ignoring pitch/roll, so looking up
      // or tilting your head doesn't drag it around) — there's no real
      // body tracking on a Quest, so this is an approximation for both
      // spots it's used for: the waist and the back-center bandolier
      // point. Also builds each spot's own bit of simple "boxy" flavor
      // geometry (a diagonal strap for the back; the waist gets none —
      // see `belt`, which is what's actually visible there) so it's
      // visually obvious where things are meant to go — purely
      // cosmetic, no bearing on the actual anchor-slot component
      // (added separately in markup) that does the real snapping work.
      //
      // The two hips used to be a third/fourth case here (side: left/
      // right), each with its own holster-pouch flavor geometry. Both
      // moved onto `belt` instead — a belt is what actually carries hip
      // slots now, built at ±HIP_SIDE_OFFSET in ITS OWN local frame, so
      // a body-anchor for "the left hip" specifically stopped meaning
      // anything once the belt could be swapped out from under it.
      // ==============================================================
      registerComponent('body-anchor', {
        schema: {
          side: { type: 'string', default: 'waist' }, // 'waist' | 'back'
        },

        init: function () {
          this.camera = document.querySelector('#head-camera');
          this.camPos = new THREE.Vector3();
          this.camQuat = new THREE.Quaternion();
          this.camEuler = new THREE.Euler();
          this.offsetVec = new THREE.Vector3();

          if (this.data.side === 'back') {
            this.localOffset = new THREE.Vector3(0, 0, BACK_DEPTH_OFFSET); // local +Z is behind the player
            this.height = BACK_HEIGHT;
          } else {
            this.localOffset = new THREE.Vector3(0, 0, 0);
            this.height = HIP_HEIGHT;
          }

          this.buildProps();
        },

        tick: function () {
          if (!this.camera || !this.camera.object3D) return;

          this.camera.object3D.getWorldPosition(this.camPos);
          this.camera.object3D.getWorldQuaternion(this.camQuat);
          this.camEuler.setFromQuaternion(this.camQuat, 'YXZ');
          var yaw = this.camEuler.y;

          this.offsetVec.copy(this.localOffset).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);

          this.el.object3D.position.set(
            this.camPos.x + this.offsetVec.x,
            this.height,
            this.camPos.z + this.offsetVec.z
          );
          this.el.object3D.rotation.set(0, yaw, 0);
        },

        // Cheap, "shitty" flavor geometry — just the back's diagonal
        // bandolier strap now (see the class comment for where the
        // hips' holster pouches went). Estimated proportions, not
        // measured against a real body; expect this to want eyes-on
        // tuning.
        buildProps: function () {
          if (this.data.side !== 'back') return;

          var strap = document.createElement('a-box');
          strap.setAttribute('width', 0.09);
          strap.setAttribute('height', 0.9);
          strap.setAttribute('depth', 0.03);
          strap.setAttribute('color', '#5b3a29');
          strap.setAttribute('rotation', '0 0 35');
          this.el.appendChild(strap);
        },
      });

      // ==============================================================
      // COMPONENT: boxy-belt
      // What a belt looks like: a ring at the ghost's own pill radius
      // (so it wraps the body snugly regardless of which belt is worn)
      // plus a buckle on the front. Schema'd by color so belt-classic
      // and belt-silver (see the item makers) are one component with
      // two paint jobs, not two components.
      // ==============================================================
      registerComponent('boxy-belt', {
        schema: {
          color: { type: 'string', default: BELT_COLOR },
          buckleColor: { type: 'string', default: BELT_BUCKLE_COLOR },
        },

        init: function () {
          var el = this.el;

          var ring = document.createElement('a-torus');
          ring.setAttribute('radius', GHOST_RADIUS);
          ring.setAttribute('radius-tubular', BELT_TUBE_RADIUS);
          ring.setAttribute('color', this.data.color);
          ring.setAttribute('rotation', '90 0 0');
          el.appendChild(ring);

          var buckle = document.createElement('a-box');
          buckle.setAttribute('width', 0.05);
          buckle.setAttribute('height', 0.04);
          buckle.setAttribute('depth', 0.015);
          buckle.setAttribute('color', this.data.buckleColor);
          buckle.setAttribute('position', { x: 0, y: 0, z: -GHOST_RADIUS }); // -Z is the front, same convention as everything else
          el.appendChild(buckle);
        },
      });

      var beltHipSerial = 0; // unique ids for each belt's own hip slots — see the id comment inside belt's init

      // ==============================================================
      // COMPONENT: belt
      // What a belt DOES: carries its own two hip anchor-slots (small,
      // pistol-sized, at ±HIP_SIDE_OFFSET — the exact spot the old
      // standalone hip-left/hip-right body-anchors used to sit) so that
      // holstering is still "release near your hip" no matter which
      // belt is currently worn.
      //
      // The waist anchor it's worn on (see markup) has anchor-slot's
      // `swap` flag set, so putting a new belt on doesn't require
      // taking the old one off by hand first — holsterable.occupySlot
      // evicts it automatically. That alone would just drop your guns
      // on the floor along with the belt, though, which is why this
      // listens for the 'displaced' event occupySlot fires right
      // before evicting: the OLD belt gets first refusal to hand its
      // hip contents on to the NEW one, matched left-to-left and
      // right-to-right by build order.
      // ==============================================================
      registerComponent('belt', {
        schema: {
          stockHips: { type: 'boolean', default: false }, // only the belt that starts already worn needs its hips pre-stocked with pistols — see markup
        },

        init: function () {
          var el = this.el;
          this.hipSlots = [];

          [-1, 1].forEach(function (side) {
            var slot = document.createElement('a-entity');
            slot.setAttribute('id', 'belt-hip-' + beltHipSerial++); // stocked/makeItem require a real id to build into — an easy silent no-op to miss, see makeItem's own early-out
            slot.classList.add('anchor-slot');
            slot.setAttribute('anchor-slot', 'size: small');
            slot.setAttribute('position', { x: side * HIP_SIDE_OFFSET, y: 0, z: 0 });
            if (this.data.stockHips) slot.setAttribute('stocked', 'item: pistol');
            el.appendChild(slot);
            this.hipSlots.push(slot);
          }, this);

          this.onDisplaced = this.onDisplaced.bind(this);
          el.addEventListener('displaced', this.onDisplaced);
        },

        remove: function () {
          this.el.removeEventListener('displaced', this.onDisplaced);
        },

        onDisplaced: function (evt) {
          var newBelt = evt.detail.by.components.belt;
          if (!newBelt) return; // whatever replaced this wasn't a belt (shouldn't happen — only belts fit the waist anchor's medium size the way a belt does — but nothing here should assume it)

          this.hipSlots.forEach(function (oldSlotEl, i) {
            var newSlotEl = newBelt.hipSlots[i];
            var oldSlotComp = oldSlotEl.components['anchor-slot'];
            if (!oldSlotComp || !newSlotEl) return;

            // Slice a copy first — vacateSlot (called via occupySlot's
            // own swap handling, since the new hip slot isn't a swap
            // slot itself but IS currently empty) mutates the array
            // we'd otherwise be iterating.
            oldSlotComp.occupants.slice().forEach(function (occupant) {
              occupant.vacateSlot();
              occupant.state = 'holstered';
              occupant.snapTo(newSlotEl.object3D, occupant.data.holsterPosition, occupant.data.holsterRotation);
              occupant.occupySlot(newSlotEl);
            });
          });
        },
      });

      // ==============================================================
      // COMPONENT: anchor-slot
      // The generic "you can snap a compatible item here" socket.
      // Purely declarative on its own (just a size — small/medium/
      // large) plus a translucent sphere that visually marks the spot
      // and reacts as a compatible carried item approaches; the actual
      // matching/snapping logic lives in holsterable (findNearestSlot)
      // and the free functions above (findCatchingSlot). `occupants`
      // is the one piece of real state here: the holsterable
      // components currently claiming this slot, so items can't pile
      // invisibly into the same spot and so the indicator hides itself
      // once the slot is full.
      //
      // Capacity is what turns "your mouth" into a place five cigars
      // can go at once (see the mouth-anchor in markup) without a
      // single line of cigar-specific code — the occupants are simply
      // fanned out around the slot's origin by fanSpread/fanYaw, and
      // reflow() re-fans everything whenever one arrives or leaves, so
      // pulling the middle cigar out closes the gap.
      // ==============================================================
      registerComponent('anchor-slot', {
        schema: {
          size: { type: 'string', default: 'small' }, // 'small' | 'medium' | 'large'
          capacity: { type: 'number', default: 1 },
          fanSpread: { type: 'number', default: 0.045 }, // meters between stacked occupants
          fanAxis: { type: 'string', default: 'x' }, // which of the slot's own axes they spread along. A row of cigars in your teeth goes across (x); arrows on a bowstring go up it (y)
          fanYaw: { type: 'number', default: 0 }, // degrees of splay per step — only meaningful for things with a long axis, like cigars or barrels
          idleHidden: { type: 'boolean', default: false }, // hide the indicator entirely until a compatible item is on the way in
          indicatorScale: { type: 'number', default: 1 }, // shrink the indicator sphere — a slot right in front of your eyes wants to be a dot, not a ball
          revealDistance: { type: 'number', default: 0 }, // with idleHidden, how close a compatible item must be before the indicator appears at all (0 = the slot's usual approach radius)
          swap: { type: 'boolean', default: false }, // a full slot normally just isn't a candidate (see holsterable.findNearestSlot) — a swap slot stays one, and holsterable.occupySlot evicts whatever was there instead of refusing the newcomer. Built for the waist anchor (see `belt`), so bringing a new belt to an already-worn one replaces it rather than needing it taken off by hand first.
        },

        init: function () {
          this.occupants = [];
          this.wasInRange = false;
          this.clickElapsed = null; // ms into the click bounce, or null when idle

          this.sphere = document.createElement('a-sphere');
          this._shownRadius = SLOT_SPHERE_BASE_RADIUS[this.data.size] * this.data.indicatorScale;
          this._shownOpacity = 0.35;
          this.sphere.setAttribute('radius', this._shownRadius);
          this.sphere.setAttribute(
            'material',
            'color: ' + SLOT_COLOR[this.data.size] + '; shader: flat; opacity: 0.35; transparent: true; depthWrite: false'
          );
          this.el.appendChild(this.sphere);

          this._slotPos = new THREE.Vector3();
          this._itemPos = new THREE.Vector3();
        },

        isFull: function () {
          return this.occupants.length >= this.data.capacity;
        },

        // Called by holsterable whenever this slot's contents change.
        // Re-poses every occupant for its new index in the fan; each
        // one blends there via its own snapTo, so items shuffle over
        // to make room rather than teleporting.
        reflow: function () {
          var self = this;
          this.occupants.forEach(function (holsterable, i) {
            holsterable.setSlotStack(i, self.occupants.length);
            holsterable.applySlotPose(self.el);
          });
        },

        tick: function (time, dt) {
          // A swap slot stays "live" even while full — the indicator
          // should still glow as a replacement approaches, the same
          // invitation an empty slot gives.
          if (this.isFull() && !this.data.swap) {
            this.sphere.setAttribute('visible', false);
            this.wasInRange = false;
            this.clickElapsed = null;
            return;
          }

          var nearestDist = this.findNearestCompatibleHeldDistance();
          var snapRadius = SLOT_SNAP_RADIUS[this.data.size];
          var approachRadius = SLOT_APPROACH_RADIUS[this.data.size];

          // A slot sitting right in front of your eyes (the mouth)
          // would otherwise be a permanent bright ball in the middle
          // of your vision — the approach radius is nearly half a
          // meter, and anything you carry passes through that
          // constantly. So idleHidden slots can set their own, much
          // tighter, reveal distance.
          var revealDist = this.data.revealDistance || approachRadius;
          if (this.data.idleHidden && nearestDist > revealDist && this.clickElapsed === null) {
            this.sphere.setAttribute('visible', false);
            this.wasInRange = false;
            return;
          }
          this.sphere.setAttribute('visible', true);

          var baseR = SLOT_SPHERE_BASE_RADIUS[this.data.size];
          var maxR = SLOT_SPHERE_MAX_RADIUS[this.data.size];

          var inRange = nearestDist <= snapRadius;
          if (inRange && !this.wasInRange) this.clickElapsed = 0;
          this.wasInRange = inRange;

          var t = 0;
          if (isFinite(nearestDist)) {
            t = 1 - (nearestDist - snapRadius) / (approachRadius - snapRadius);
            t = Math.min(Math.max(t, 0), 1);
          }
          var radius = (baseR + (maxR - baseR) * t) * this.data.indicatorScale;
          var opacity = 0.25 + (0.6 - 0.25) * t;

          if (this.clickElapsed !== null) {
            this.clickElapsed += dt || 16;
            if (this.clickElapsed >= SLOT_CLICK_DUR_MS) {
              this.clickElapsed = null;
            } else {
              radius = maxR * this.data.indicatorScale * clickEnvelope(this.clickElapsed / SLOT_CLICK_DUR_MS);
              opacity = 0.6;
            }
          }

          this.setIndicator(radius, opacity);
        },

        // Writing `radius` rebuilds the sphere's geometry outright, so
        // it's only written when the number has actually moved. That
        // was free with five slots in the scene; with the armoury's
        // rack of empty sockets — none of which are ever full, so none
        // of which take the early-out above — it's forty spheres a
        // frame being rebuilt to the same size they already were.
        setIndicator: function (radius, opacity) {
          if (Math.abs(radius - this._shownRadius) > 0.0004) {
            this._shownRadius = radius;
            this.sphere.setAttribute('radius', radius);
          }
          if (Math.abs(opacity - this._shownOpacity) > 0.004) {
            this._shownOpacity = opacity;
            this.sphere.setAttribute('material', 'opacity', opacity);
          }
        },

        // Nearest currently-HELD (actively gripped, not dangling —
        // that's a twirl in progress, not "aiming for a slot")
        // grabbable item whose itemSize actually fits this slot.
        // Infinity if nothing qualifies, which reads as "stay idle."
        // Reads the shared HELD_ITEMS snapshot rather than searching
        // the scene itself — see that list's comment.
        findNearestCompatibleHeldDistance: function () {
          if (!HELD_ITEMS.length) return Infinity;

          var slotRank = SLOT_SIZE_RANK[this.data.size];
          var best = Infinity;
          this.el.object3D.getWorldPosition(this._slotPos);

          for (var i = 0; i < HELD_ITEMS.length; i++) {
            if (HELD_ITEMS[i].rank > slotRank) continue;
            var d = HELD_ITEMS[i].pos.distanceTo(this._slotPos);
            if (d < best) best = d;
          }

          return best;
        },
      });

      // ==============================================================
      // COMPONENT: holsterable
      // The shared state machine and physics behind every grabbable
      // prop in the scene (currently the two pistols and the hat):
      //   holstered -> held (grabbed) -> dangling (grip released while
      //   a finger is still resting on the trigger) -> held again
      //   (caught) or holstered/falling (finger comes off the trigger
      //   too — holstered if that happens near a matching anchor,
      //   falling otherwise) -> resting (on the ground, grabbable
      //   again).
      //
      //   Releasing the grip with NO finger on the trigger and a
      //   deliberate upward hand speed is a throw instead — same
      //   "falling" state, just seeded with a real launch velocity
      //   (see release()/throwWithVelocity()/computeThrowVelocity()).
      //   A calm release with no throw checks the holster immediately
      //   (see release()). A release WITH a finger still on the
      //   trigger always dangles, deliberately skipping both the throw
      //   and holster checks at that moment — those only happen later,
      //   in endDangle(), when the finger actually comes off the
      //   trigger. That's what lets a dangling, spinning object be
      //   aimed into its holster as its own move, rather than only
      //   ever holstering from a plain grip-release.
      //
      //   While falling (dropped OR thrown — same state), it's
      //   generously catchable by either hand: see checkCatch(),
      //   catchThrown(), and catchIntoDangle().
      //
      // Schema is what makes this reusable rather than gun-specific:
      // itemSize is this object's size class (small/medium/large) —
      // see findNearestSlot for how that decides which anchor-slot
      // entities in the scene it's allowed to snap into, generically,
      // with no per-object list of "which holsters" to maintain;
      // holsterPosition/holsterRotation and heldPosition/heldRotation
      // are the local poses snapped to when holstered/held (the same
      // holsterPosition/holsterRotation apply no matter which slot it
      // lands in — a gun tucked into a hat ends up in the same jaunty
      // barrel-down pose it holsters at your hip in, which is a
      // feature, not a bug, for a game this silly); grabRadius is how
      // close a hand needs to be to pick it up (wider than the
      // object's own origin-to-edge distance for something like the
      // hat, whose origin sits well inside its visual silhouette — see
      // the hat's markup comment); comOffset is where this object's
      // true center of mass sits
      // relative to its own entity origin. That origin, per
      // boxy-gun/boxy-hat, is deliberately NOT the object's geometric
      // center but its natural grip/pivot point — the trigger guard
      // for a gun, one edge of the inner brim for a hat — and comOffset
      // (which the dangle physics uses to work out which way "down"
      // pulls it) is the whole reason the same twirl mechanic works
      // for a completely different-shaped object with zero
      // object-specific physics code.
      //
      // Every "snap into a new spot" transition (grab, holster, catch)
      // goes through snapTo(), which blends smoothly over
      // SNAP_BLEND_DUR_MS rather than popping instantly into place —
      // see snapTo/updatePoseBlend.
      //
      // Visual geometry (boxy-gun, boxy-hat, boxy-bottle, boxy-cigar)
      // is a separate component attached alongside this one in markup
      // — this component neither knows nor cares what the object looks
      // like. Behavior isn't here either: firing (firearm), drinking
      // (bottle), and lighting (cigar) are all small companion
      // components that read this one's state and, at most, write into
      // its extraPitchDeg. That's why a bottle is a gun that can't
      // shoot and a cigar is a bottle you can't drink — they're the
      // same object with different companions bolted on.
      //
      // Reparenting is done directly on the three.js object3D graph
      // via Object3D.attach(), which reparents while preserving the
      // object's current world transform — the DOM tree is left alone,
      // since nothing here depends on DOM nesting.
      // ==============================================================
      registerComponent('holsterable', {
        schema: {
          holsterSelector: { type: 'selector' }, // starting holster anchor
          itemSize: { type: 'string', default: 'small' }, // 'small' | 'medium' | 'large' — which anchor-slot sizes this object fits into
          holsterPosition: { type: 'vec3', default: { x: 0, y: 0, z: 0 } },
          holsterRotation: { type: 'vec3', default: { x: 0, y: 0, z: 0 } },
          heldPosition: { type: 'vec3', default: { x: 0, y: 0, z: 0 } },
          heldRotation: { type: 'vec3', default: { x: 0, y: 0, z: 0 } },
          grabRadius: { type: 'number', default: GRAB_RADIUS },
          // Most props are grabbed by their one natural handle, so the
          // grab test is a sphere around the origin. Long thin ones are
          // not: an arrow's origin is at its nock, and being unable to
          // pick one up by the middle of the shaft is maddening.
          // grabSpan is a second point in local space, and the test
          // becomes the distance to the SEGMENT between the two — a
          // capsule rather than a ball, for a couple of dot products.
          grabSpan: { type: 'vec3', default: { x: 0, y: 0, z: 0 } },
          comOffset: { type: 'vec3', default: { x: 0, y: 0, z: 0 } }, // center of mass, relative to the entity origin
          maxThrowSpeed: { type: 'number', default: OVERHAND_MAX_DEFAULT_SPEED }, // how hard this particular object can be thrown, whatever your arm does
          gravityScale: { type: 'number', default: 1 }, // multiplies gravity while falling — under 1 keeps a thrown object up longer, which is what makes shooting bottles out of the air possible
          supportGrip: { type: 'vec3', default: { x: 0, y: 0, z: 0 } }, // local position of a second place to hold this, if any
          supportRadius: { type: 'number', default: 0 }, // 0 disables the second grip entirely
          supportAims: { type: 'boolean', default: true }, // does the second hand steer this? A shotgun forend does — the barrel follows the line between your hands. A bowstring does NOT: the bow hand alone aims it, and the string hand only says how far it's drawn
          supportGrab: { type: 'string', default: 'grip' }, // 'grip' or 'trigger' — which button the second hand uses. A forend is held; a bowstring is drawn, and drawing wants the finger that shoots so that gripping can still mean "take the arrow off it"
        },

        init: function () {
          this.state = 'holstered';
          this.hand = null; // the hand entity currently holding/dangling this object
          this.supportHand = null; // a SECOND hand steadying it by its support grip, if it has one
          this.currentSlotEl = null; // the anchor-slot entity this object currently occupies, if holstered

          // Where this object sits in whatever stack currently holds
          // it — a hand's fistful or a slot's fan. Both default to
          // "the only one here," which is the single-item behavior
          // this component had before stacks existed.
          this.stackIndex = 0;
          this.stackCount = 1;
          this.slotIndex = 0;
          this.slotCount = 1;

          // Composed on top of the held pose every frame by firearm,
          // which writes its recoil kick here rather than fighting
          // over the same object3D. Unsteady hands are NOT applied
          // here any more — they belong to the hand (see
          // hand-rig.updateGrip), and this object inherits them by
          // being parented to it.
          this.extraPitchDeg = 0;
          this._heldElapsed = 0;

          // Whether the last release was a real throw. hand-rig's
          // quick-re-grip window reads this so that re-gripping right
          // after flinging a bottle skyward doesn't yank it back out
          // of the air.
          this.wasThrown = false;

          this.angularVelocity = new THREE.Vector3();
          this.fallVelocity = new THREE.Vector3();
          this.catchCooldown = 0; // ms left during which this can't be caught — see throwWithVelocity
          this.impactCooldown = 0; // ms left during which it can't hit anything again — see checkImpact
          this._impactDir = new THREE.Vector3();
          this.prevPivotPos = new THREE.Vector3();
          this.prevPivotVelocity = new THREE.Vector3();

          this._pivot = new THREE.Vector3();
          this._pivotVelocity = new THREE.Vector3();
          this._pivotAccel = new THREE.Vector3();
          this._comLocal = new THREE.Vector3(this.data.comOffset.x, this.data.comOffset.y, this.data.comOffset.z);
          this._comWorld = new THREE.Vector3();
          this._down = new THREE.Vector3(0, -1, 0);
          this._torque = new THREE.Vector3();
          this._deltaQuat = new THREE.Quaternion();
          this._worldPos = new THREE.Vector3();
          this._holsterPos = new THREE.Vector3();
          this._gripWorld = new THREE.Vector3();
          this._supportWorld = new THREE.Vector3();
          this._aimUp = new THREE.Vector3();
          this._aimMatrix = new THREE.Matrix4();
          this._aimQuat = new THREE.Quaternion();
          this._parentQuat = new THREE.Quaternion();
          this._grabA = new THREE.Vector3();
          this._grabB = new THREE.Vector3();
          this._grabAxis = new THREE.Vector3();
          this._grabScratch = new THREE.Vector3();

          // Smooth pose blend (see snapTo/updatePoseBlend). Starts
          // "already finished" so nothing plays on scene load.
          this._poseBlendFromPos = new THREE.Vector3();
          this._poseBlendFromQuat = new THREE.Quaternion();
          this._poseBlendToPos = new THREE.Vector3();
          this._poseBlendToQuat = new THREE.Quaternion();
          this._poseBlendElapsed = SNAP_BLEND_DUR_MS;

          if (this.data.holsterSelector) {
            // The very first placement, at scene load — instant, via
            // attachTo directly, since there's nothing meaningful to
            // blend from before the object has ever been anywhere.
            this.attachTo(this.data.holsterSelector.object3D, this.data.holsterPosition, this.data.holsterRotation);
          }
        },

        // The pose blend runs regardless of state (held or holstered
        // are both valid snap targets) — cheap to check unconditionally
        // since it's a no-op once finished.
        //
        // The initial slot claim (registering this object as the
        // occupant of whatever it starts holstered on) happens here,
        // on the first tick, rather than in init() — init() order
        // across sibling entities isn't guaranteed, so the target
        // anchor-slot's own component might not have attached yet if
        // checked from init(). By the first tick, the whole scene's
        // initial entities are guaranteed live, and object3D.parent.el
        // reliably points back to whatever this object actually ended
        // up parented under (the same "el" back-reference A-Frame
        // already sets on any object3D/mesh, used elsewhere in this
        // file e.g. for scoring-ring's raycast hits).
        tick: function (time, dt) {
          if (!this._didInitialSlotClaim) {
            this._didInitialSlotClaim = true;
            if (this.state === 'holstered' && !this.currentSlotEl) {
              var parentObj = this.el.object3D.parent;
              var parentEl = parentObj && parentObj.el;
              if (parentEl && parentEl.components && parentEl.components['anchor-slot']) {
                this.occupySlot(parentEl);
              }
            }
          }

          var dtSeconds = Math.min((dt || 16) / 1000, 0.05);
          this.updatePoseBlend(dtSeconds);
          if (this.state === 'dangling') {
            this.updateDangle(dtSeconds);
            this.checkSlip(dtSeconds, SLIP_DANGLE_THRESHOLD, SLIP_DANGLE_CHANCE_PER_S);
          } else if (this.state === 'falling') {
            this.updateFall(dtSeconds);
          } else if (this.state === 'held') {
            this.applyHeldPose(time, dtSeconds);
            this.checkSlip(dtSeconds, SLIP_GRIP_THRESHOLD, SLIP_GRIP_CHANCE_PER_S);
          } else {
            this._heldElapsed = 0;
          }
        },

        // The one place a held object's pose is written: the base held
        // pose, its offset in the hand's fan, and whatever recoil kick
        // firearm has asked for. Unsteadiness doesn't appear here at
        // all — the grip this object is parented to is already
        // wobbling (see hand-rig.updateGrip), so it comes along for
        // free and, crucially, the hand and the gun move together.
        // Skipped entirely while a snap blend is running, since the
        // blend owns the pose until it finishes.
        applyHeldPose: function (time, dtSeconds) {
          this._heldElapsed += dtSeconds * 1000;
          if (this._poseBlendElapsed < SNAP_BLEND_DUR_MS) return;
          if (this.supportHand && this.data.supportAims) return this.applyTwoHandedPose();

          var d = this.data;
          this.el.object3D.position.set(
            d.heldPosition.x + fanOffset(this.stackIndex, this.stackCount, HAND_STACK_SPREAD),
            d.heldPosition.y,
            d.heldPosition.z
          );
          this.el.object3D.rotation.set(
            ((d.heldRotation.x + this.extraPitchDeg) * Math.PI) / 180,
            ((d.heldRotation.y + fanOffset(this.stackIndex, this.stackCount, HAND_STACK_YAW)) * Math.PI) / 180,
            (d.heldRotation.z * Math.PI) / 180
          );
        },

        // Butterfingers. Something dangling off one finger is barely
        // held at all, so it starts getting away from you at a much
        // lower blood alcohol than something in a closed fist — the
        // thresholds and rates are passed in by the caller rather than
        // read here, since "how firmly is this being held" is the
        // state machine's business, not this function's.
        checkSlip: function (dtSeconds, threshold, chancePerSecond) {
          if (VICES.alcohol <= threshold) return;

          var over = (VICES.alcohol - threshold) / (1 - threshold);
          if (Math.random() > over * chancePerSecond * dtSeconds) return;

          if (this.hand) {
            var handRig = this.hand.components['hand-rig'];
            if (handRig) handRig.forget(this.el);
          }
          this.startFalling();
        },

        // Two hands on one gun. The near hand still owns the position
        // — the object stays exactly where your trigger hand is — but
        // the ORIENTATION comes from the line between the two hands,
        // so the barrel points wherever your off hand puts it. That's
        // what makes it steadier: a shotgun braced at two points can't
        // wander the way one on a single wrist does, and the effect
        // falls out of the geometry rather than from any damping.
        //
        // Roll comes from the near hand, so twisting your grip still
        // rolls the gun. Only the near hand can fire it (see
        // hand-rig.onTriggerDown) — the support hand is holding a
        // forend, not a trigger.
        applyTwoHandedPose: function () {
          var d = this.data;
          this.el.object3D.position.set(d.heldPosition.x, d.heldPosition.y, d.heldPosition.z);

          var parent = this.el.object3D.parent;
          if (!parent) return;

          parent.getWorldPosition(this._gripWorld);
          this.supportHand.object3D.getWorldPosition(this._supportWorld);
          if (this._gripWorld.distanceToSquared(this._supportWorld) < 0.0004) return;

          // Matrix4.lookAt builds a rotation whose -Z points from eye
          // to target, and the object's own -Z is its barrel, so this
          // aims the gun straight down the line between your hands.
          this._aimUp.set(0, 1, 0).applyQuaternion(parent.getWorldQuaternion(this._parentQuat));
          this._aimMatrix.lookAt(this._gripWorld, this._supportWorld, this._aimUp);
          this._aimQuat.setFromRotationMatrix(this._aimMatrix);

          // Into the parent's frame, since that's where local
          // rotations are expressed.
          parent.getWorldQuaternion(this._parentQuat);
          this.el.object3D.quaternion.copy(this._parentQuat.invert()).multiply(this._aimQuat);

          if (this.extraPitchDeg) this.el.object3D.rotateX((this.extraPitchDeg * Math.PI) / 180);
        },

        // Distance from a point to the part of this object you could
        // actually take hold of: its origin, or anywhere along its
        // grabSpan if it has one.
        grabDistanceTo: function (worldPos) {
          this.el.object3D.getWorldPosition(this._grabA);
          var span = this.data.grabSpan;
          if (!span.x && !span.y && !span.z) return this._grabA.distanceTo(worldPos);

          this._grabB.set(span.x, span.y, span.z);
          this.el.object3D.localToWorld(this._grabB);

          this._grabAxis.copy(this._grabB).sub(this._grabA);
          var lengthSq = this._grabAxis.lengthSq();
          if (lengthSq < 0.000001) return this._grabA.distanceTo(worldPos);

          var t = this._grabScratch.copy(worldPos).sub(this._grabA).dot(this._grabAxis) / lengthSq;
          t = Math.min(Math.max(t, 0), 1);
          return this._grabScratch.copy(this._grabA).addScaledVector(this._grabAxis, t).distanceTo(worldPos);
        },

        // World position of this object's second grip, if it declares
        // one. Used both to decide whether an off hand is close enough
        // to take hold and to draw the marker showing where it is.
        supportGripWorldPosition: function (out) {
          out.set(this.data.supportGrip.x, this.data.supportGrip.y, this.data.supportGrip.z);
          this.el.object3D.localToWorld(out);
          return out;
        },

        canSupport: function (handEl) {
          if (this.data.supportRadius <= 0) return false;
          if (this.state !== 'held') return false;
          if (this.supportHand || this.hand === handEl) return false;
          return true;
        },

        grabSupport: function (handEl) {
          this.supportHand = handEl;
        },

        // Announced rather than acted on, like everything else here:
        // letting go of a forend means nothing, and letting go of a
        // bowstring means an arrow leaves. holsterable knows about
        // neither.
        releaseSupport: function () {
          if (!this.supportHand) return;
          // Measured BEFORE letting go, obviously — supportDraw is the
          // distance to a hand that is about to stop existing as far as
          // this object is concerned.
          var draw = this.supportDraw();
          this.supportHand = null;
          this.el.emit('support-released', { draw: draw }, false);
        },

        // How far the second hand has been pulled from the first, in
        // metres. Zero when there's nobody on it.
        supportDraw: function () {
          if (!this.supportHand || !this.el.object3D.parent) return 0;
          this.el.object3D.parent.getWorldPosition(this._gripWorld);
          this.supportHand.object3D.getWorldPosition(this._supportWorld);
          return this._gripWorld.distanceTo(this._supportWorld);
        },

        setHandStack: function (index, count) {
          this.stackIndex = index;
          this.stackCount = count;
        },

        setSlotStack: function (index, count) {
          this.slotIndex = index;
          this.slotCount = count;
        },

        // Snap (blended) into the given slot at this object's current
        // place in that slot's fan. Split out from tryHolsterElse so
        // anchor-slot.reflow can re-pose occupants when the fan
        // changes shape around them.
        applySlotPose: function (slotEl) {
          var slotComp = slotEl.components['anchor-slot'];
          var spread = slotComp ? slotComp.data.fanSpread : 0;
          var yaw = slotComp ? slotComp.data.fanYaw : 0;
          var axis = slotComp ? slotComp.data.fanAxis : 'x';
          var step = fanOffset(this.slotIndex, this.slotCount, spread);
          var d = this.data;

          this.snapTo(
            slotEl.object3D,
            {
              x: d.holsterPosition.x + (axis === 'x' ? step : 0),
              y: d.holsterPosition.y + (axis === 'y' ? step : 0),
              z: d.holsterPosition.z + (axis === 'z' ? step : 0),
            },
            {
              x: d.holsterRotation.x,
              y: d.holsterRotation.y + fanOffset(this.slotIndex, this.slotCount, yaw),
              z: d.holsterRotation.z,
            }
          );
        },

        // Instant reparent + pose set, no blend — used only for the
        // very first placement at scene load. Every runtime transition
        // uses snapTo() instead.
        attachTo: function (parentObject3D, localPos, localRotDeg) {
          parentObject3D.attach(this.el.object3D);
          if (localPos) this.el.object3D.position.set(localPos.x, localPos.y, localPos.z);
          if (localRotDeg) {
            this.el.object3D.rotation.set(
              (localRotDeg.x * Math.PI) / 180,
              (localRotDeg.y * Math.PI) / 180,
              (localRotDeg.z * Math.PI) / 180
            );
          }
        },

        // Reparents (preserving current world pose as the blend's
        // starting local pose, via Object3D.attach), then smoothly
        // interpolates to the given target local pose over
        // SNAP_BLEND_DUR_MS instead of popping there instantly. Used
        // for every runtime "snap into a new spot" moment: grabbing,
        // holstering, and catching something thrown.
        snapTo: function (parentObject3D, targetLocalPos, targetLocalRotDeg) {
          parentObject3D.attach(this.el.object3D);
          this._poseBlendFromPos.copy(this.el.object3D.position);
          this._poseBlendFromQuat.copy(this.el.object3D.quaternion);

          this._poseBlendToPos.set(targetLocalPos.x, targetLocalPos.y, targetLocalPos.z);
          this._poseBlendToQuat.setFromEuler(
            new THREE.Euler(
              (targetLocalRotDeg.x * Math.PI) / 180,
              (targetLocalRotDeg.y * Math.PI) / 180,
              (targetLocalRotDeg.z * Math.PI) / 180
            )
          );
          this._poseBlendElapsed = 0;
        },

        // Same direct-object3D-write approach used throughout this
        // component rather than through A-Frame's animation component,
        // since that animates the core "rotation" component's own
        // cached state — which everything here bypasses by writing
        // object3D.rotation/quaternion directly — and the two caches
        // falling out of sync is exactly the kind of thing that
        // produces an object that's rotated wrong for no visible
        // reason.
        updatePoseBlend: function (dtSeconds) {
          if (this._poseBlendElapsed >= SNAP_BLEND_DUR_MS) return;

          this._poseBlendElapsed = Math.min(this._poseBlendElapsed + dtSeconds * 1000, SNAP_BLEND_DUR_MS);
          var t = this._poseBlendElapsed / SNAP_BLEND_DUR_MS;

          this.el.object3D.position.lerpVectors(this._poseBlendFromPos, this._poseBlendToPos, t);
          this.el.object3D.quaternion.slerpQuaternions(this._poseBlendFromQuat, this._poseBlendToQuat, t);
        },

        // Called by hand-rig: either a fresh pickup (from a holster or
        // the ground) or catching this same object mid-dangle — both
        // are "snap rigidly into this hand" and need no other
        // distinction. vacateSlot() is a no-op unless this object was
        // actually anchored somewhere (holstered state is the only way
        // in to grab(), so it's the one place a slot ever needs to be
        // freed up again).
        grab: function (handEl) {
          this.state = 'held';
          this.hand = handEl;
          this.vacateSlot();
          this.applyHandPose(handEl);
          this.angularVelocity.set(0, 0, 0);
          this.extraPitchDeg = 0;
          this._heldElapsed = 0;
        },

        // The held-hand equivalent of applySlotPose: snap into this
        // hand at whatever place in its fistful this object currently
        // holds. hand-rig calls it again for every item whenever that
        // fistful changes size.
        applyHandPose: function (handEl) {
          var d = this.data;
          this.snapTo(
            gripObjectOf(handEl),
            {
              x: d.heldPosition.x + fanOffset(this.stackIndex, this.stackCount, HAND_STACK_SPREAD),
              y: d.heldPosition.y,
              z: d.heldPosition.z,
            },
            {
              x: d.heldRotation.x,
              y: d.heldRotation.y + fanOffset(this.stackIndex, this.stackCount, HAND_STACK_YAW),
              z: d.heldRotation.z,
            }
          );
        },

        // Called by hand-rig when the hand currently holding this
        // object releases its grip. fingerOnTrigger reflects whether
        // that hand's finger is resting on (not necessarily pulling)
        // the trigger at that moment. See the state-machine comment
        // above for why the holster and throw checks are both skipped
        // here when a finger is still on the trigger.
        //
        // A throw takes priority over the holster check — a real flick
        // upward is a strong, deliberate signal that shouldn't get
        // reinterpreted as "must be holstering" just because it
        // happened near an anchor.
        release: function (fingerOnTrigger) {
          this.wasThrown = false;
          if (fingerOnTrigger) {
            this.startDangling();
            return;
          }

          var throwVelocity = computeThrowVelocity(this.hand, this.stackIndex, this.stackCount, this);
          if (throwVelocity) {
            this.wasThrown = true;
            this.throwWithVelocity(throwVelocity);
            return;
          }

          this.tryHolsterElse(this.startFalling.bind(this));
        },

        // Called directly by hand-rig when the finger lifts off the
        // trigger while this object is dangling from that hand — the
        // moment that decides whether it lands in a holster, gets
        // thrown, or falls. Mirrors release()'s own priority order: a
        // real upward flick while twirling should send it flying,
        // spin and all, not just drop it straight down.
        endDangle: function () {
          this.wasThrown = false;
          var throwVelocity = computeThrowVelocity(this.hand, this.stackIndex, this.stackCount, this);
          if (throwVelocity) {
            this.wasThrown = true;
            this.throwWithVelocity(throwVelocity);
            return;
          }

          this.tryHolsterElse(this.startFalling.bind(this));
        },

        tryHolsterElse: function (fallback) {
          this.el.object3D.getWorldPosition(this._worldPos);
          var nearestSlot = this.findNearestSlot(this._worldPos);

          if (nearestSlot) {
            this.state = 'holstered';
            this.hand = null;
            this.occupySlot(nearestSlot); // claims a place in the fan, then poses to it
            return;
          }

          fallback();
        },

        // Several items released off one finger at once all pivot
        // around the same point, so anything past the first gets a
        // random spin kick — otherwise they'd swing as perfectly
        // synchronized clones and read as one object.
        startDangling: function () {
          this.state = 'dangling';
          this.el.sceneEl.object3D.attach(this.el.object3D);
          this.el.object3D.getWorldPosition(this.prevPivotPos);
          this.prevPivotVelocity.set(0, 0, 0);
          if (this.stackCount > 1) {
            this.angularVelocity.addScaledVector(randomUnitVector(), DANGLE_STACK_KICK);
          }
          // this.hand stays set — we're still dangling from it
        },

        // Called when nothing is left holding this object up: either
        // tryHolsterElse's fallback, or updateDangle's own safety net
        // below if this.hand ever goes missing mid-dangle.
        startFalling: function () {
          this.state = 'falling';
          this.hand = null;
          this.el.sceneEl.object3D.attach(this.el.object3D); // no-op if already world-parented
          this.fallVelocity.set(0, 0, 0);
        },

        // A throw: the same "falling" state a plain drop uses, just
        // seeded with a real (aimed) launch velocity instead of zero,
        // plus a fixed visual tumble so it reads as a toss rather than
        // an object sliding through the air. updateFall's own gravity
        // integration and catch-check take it from here. Seeds a fresh
        // throw's spin, but if it's already spinning faster than the
        // fixed toss tumble (e.g. thrown straight out of a twirl via
        // endDangle), keeps the existing spin rather than clobbering
        // it — a spinning object thrown should keep spinning, just as
        // hard, not reset to a slower default.
        throwWithVelocity: function (velocity) {
          this.state = 'falling';
          this.hand = null;
          this.releaseSupport();
          this.el.sceneEl.object3D.attach(this.el.object3D);
          this.fallVelocity.copy(velocity);
          // Catching is generous by design, which is exactly wrong for
          // the throw where you're trying to get the thing away from
          // you — without this pause a hurled bottle is plucked back
          // out of the air by the hand that just let go of it.
          this.catchCooldown = velocity.isHurl ? HURL_CATCH_COOLDOWN_MS : 0;
          if (VICES.alcohol > 0) {
            // Drunk throws scatter. Same butterfingers idea as
            // checkSlip, applied to the one moment where your aim was
            // going to matter most.
            this.fallVelocity.x += (Math.random() - 0.5) * SLIP_THROW_SPREAD * VICES.alcohol;
            this.fallVelocity.z += (Math.random() - 0.5) * SLIP_THROW_SPREAD * VICES.alcohol;
          }
          if (this.angularVelocity.length() < THROW_SPIN_RATE) {
            this.angularVelocity.set(THROW_SPIN_RATE, 0, 0);
          }
        },

        // Grip-catch: snaps rigidly into handEl, but blends smoothly
        // into the canonical held pose over SNAP_BLEND_DUR_MS instead
        // of an instant snap (see snapTo/updatePoseBlend) — this is
        // the one reserved for something already falling/flying,
        // deliberately different from grab()'s instant pickup snap.
        // Also updates the catching hand's own bookkeeping directly,
        // since this catch wasn't initiated by that hand's own
        // gripdown handler.
        catchThrown: function (handEl) {
          this.state = 'held';
          this.hand = handEl;
          this.angularVelocity.set(0, 0, 0);
          this.extraPitchDeg = 0;
          this._heldElapsed = 0;
          this.applyHandPose(handEl);

          var handRig = handEl.components['hand-rig'];
          if (handRig) handRig.take(this.el);
        },

        // Catches a falling/flying object directly onto handEl's
        // trigger finger, dangling — no grip needed. angularVelocity
        // is deliberately left alone rather than reset: whatever
        // tumble it had mid-flight carries straight into the twirl.
        catchIntoDangle: function (handEl) {
          this.state = 'dangling';
          this.hand = handEl;
          this.el.object3D.getWorldPosition(this.prevPivotPos);
          this.prevPivotVelocity.set(0, 0, 0);

          var handRig = handEl.components['hand-rig'];
          if (handRig) handRig.takeDangling(this.el);
        },

        // Passively caught by a slot belonging to something another
        // hand is actively holding — "use your hat to catch your gun."
        // See findCatchingSlot for the eligibility rules. Lands
        // straight in 'holstered', occupying the slot, blended in via
        // the usual snapTo rather than an instant pop.
        catchIntoSlot: function (slotEl) {
          this.state = 'holstered';
          this.hand = null;
          this.angularVelocity.set(0, 0, 0);
          this.occupySlot(slotEl);
        },

        // Claiming and releasing a place in a slot's fan. Both end in
        // a reflow, so the slot's other occupants shuffle over to make
        // room (or close the gap) rather than staying where they were.
        occupySlot: function (slotEl) {
          this.currentSlotEl = slotEl;
          var slotComp = slotEl.components['anchor-slot'];
          if (!slotComp) return;

          // A swap slot only ever holds one thing. Whatever's already
          // here gets a chance to react first (see `belt`'s own
          // 'displaced' listener, which is how a belt hands its hip
          // contents on to whatever's replacing it) and then falls —
          // same as letting go of anything else, not a special vanish.
          if (slotComp.data.swap) {
            slotComp.occupants.slice().forEach(function (other) {
              if (other === this) return;
              other.el.emit('displaced', { by: this.el });
              other.evict();
            }, this);
          }

          if (slotComp.occupants.indexOf(this) === -1) slotComp.occupants.push(this);
          slotComp.reflow();
        },

        // Forced out of a slot by something else claiming it (see
        // occupySlot's swap handling) — not a throw, not a drop you
        // chose, just no longer holstered. Same end state either way:
        // it falls, and is generously catchable on the way down like
        // anything else in this state.
        evict: function () {
          this.vacateSlot();
          this.startFalling();
        },

        vacateSlot: function () {
          if (!this.currentSlotEl) return;
          var slotComp = this.currentSlotEl.components['anchor-slot'];
          this.currentSlotEl = null;

          if (!slotComp) return;
          var i = slotComp.occupants.indexOf(this);
          if (i !== -1) slotComp.occupants.splice(i, 1);
          this.setSlotStack(0, 1);
          slotComp.reflow();
        },

        // Checked every frame while falling: is either hand positioned
        // and ready (gripping, or fingertip resting on the trigger)
        // within this object's own catch radius? If so, catch it and
        // report true so updateFall skips the rest of this frame's
        // fall physics. The radius scales with grabRadius so a bigger
        // object (like the hat) stays proportionally as generous to
        // catch as it is to grab, instead of falling back to the
        // gun-sized default. Hand-catching is checked first; only if
        // neither hand is ready does a nearby held item's own slot
        // (see findCatchingSlot) get a shot at it.
        checkCatch: function () {
          this.el.object3D.getWorldPosition(this._worldPos);
          var radius = this.data.grabRadius + (THROW_CATCH_RADIUS - GRAB_RADIUS);
          var handMatch = findCatchingHand(this._worldPos, radius);
          if (handMatch) {
            if (handMatch.mode === 'grip') this.catchThrown(handMatch.handEl);
            else this.catchIntoDangle(handMatch.handEl);
            return true;
          }

          var slotEl = findCatchingSlot(this._worldPos, this.data.itemSize);
          if (slotEl) {
            this.catchIntoSlot(slotEl);
            return true;
          }

          return false;
        },

        // Every anchor-slot in the scene this object's itemSize could
        // fit into, that isn't already claimed by something else, and
        // that's within ITS OWN size's snap radius. Among those,
        // "prefer the smallest slot in range, but the closest one
        // among slots of that same size" — a pistol in range of both a
        // hip holster and the (much larger) bandolier goes in the
        // holster, and between two equally-sized options it's whichever
        // is physically nearer. The object3D ancestry walk guards
        // against a future object nesting into a slot that's actually
        // one of its own descendants (not reachable with today's
        // objects, since nothing with a child slot has a small enough
        // itemSize to fit inside its own slot, but cheap to rule out
        // outright rather than rely on that staying true).
        findNearestSlot: function (worldPos) {
          var itemRank = SLOT_SIZE_RANK[this.data.itemSize];
          var slots = document.querySelectorAll('.anchor-slot');
          var best = null;
          var bestRank = Infinity;
          var bestDist = Infinity;

          for (var i = 0; i < slots.length; i++) {
            var slotEl = slots[i];
            var slotComp = slotEl.components['anchor-slot'];
            if (!slotComp) continue;
            if (slotComp.isFull() && slotComp.occupants.indexOf(this) === -1 && !slotComp.data.swap) continue;

            var slotRank = SLOT_SIZE_RANK[slotComp.data.size];
            if (slotRank < itemRank) continue;

            var ancestor = slotEl.object3D;
            var isOwnDescendant = false;
            while (ancestor) {
              if (ancestor === this.el.object3D) {
                isOwnDescendant = true;
                break;
              }
              ancestor = ancestor.parent;
            }
            if (isOwnDescendant) continue;

            slotEl.object3D.getWorldPosition(this._holsterPos);
            var d = this._holsterPos.distanceTo(worldPos);
            if (d > SLOT_SNAP_RADIUS[slotComp.data.size]) continue;

            if (slotRank < bestRank || (slotRank === bestRank && d < bestDist)) {
              best = slotEl;
              bestRank = slotRank;
              bestDist = d;
            }
          }

          return best;
        },

        // Spherical-pendulum-ish swing around a moving pivot (the
        // hand). Because the object's own origin IS the pivot point
        // (see boxy-gun/boxy-hat), position just tracks the hand
        // exactly each frame — only the orientation swings. Gravity
        // pulls the center of mass (comOffset) toward hanging straight
        // down; the pivot's own acceleration (how fast you're flicking
        // your hand around) injects extra spin, which is what makes a
        // sharp wrist flick throw the object into a twirl. This is a
        // tuned-for-feel approximation, not a rigorous rigid-body
        // simulation.
        updateDangle: function (dt) {
          if (!this.hand) {
            this.startFalling();
            return;
          }

          gripObjectOf(this.hand).getWorldPosition(this._pivot);

          this._pivotVelocity.copy(this._pivot).sub(this.prevPivotPos).divideScalar(dt);
          this._pivotAccel.copy(this._pivotVelocity).sub(this.prevPivotVelocity).divideScalar(dt);
          this.prevPivotVelocity.copy(this._pivotVelocity);
          this.prevPivotPos.copy(this._pivot);

          this._comWorld.copy(this._comLocal).applyQuaternion(this.el.object3D.quaternion).normalize();

          this._torque.crossVectors(this._comWorld, this._down).multiplyScalar(DANGLE_GRAVITY_TORQUE);
          this.angularVelocity.addScaledVector(this._torque, dt);

          this._torque.crossVectors(this._comWorld, this._pivotAccel).multiplyScalar(-DANGLE_INERTIA_SCALE);
          this.angularVelocity.addScaledVector(this._torque, dt);

          this.angularVelocity.multiplyScalar(DANGLE_DAMPING);
          if (this.angularVelocity.length() > MAX_ANGULAR_VELOCITY) {
            this.angularVelocity.setLength(MAX_ANGULAR_VELOCITY);
          }

          this.integrateRotation(dt);
          this.el.object3D.position.copy(this._pivot);
          this.el.object3D.position.x += fanOffset(this.stackIndex, this.stackCount, HAND_STACK_SPREAD);
        },

        // Free-fall under gravity — covers both a plain drop (zero
        // initial velocity) and a throw (see throwWithVelocity), since
        // both are just this same integration seeded differently.
        // Keeps whatever spin it had so it tumbles rather than just
        // sinking straight down. Checked every frame for a generous
        // catch (see checkCatch) before falling through to the normal
        // ground-settle.
        updateFall: function (dt) {
          this.fallVelocity.y -= GRAVITY * this.data.gravityScale * dt;
          this.el.object3D.position.addScaledVector(this.fallVelocity, dt);
          this.angularVelocity.multiplyScalar(FALL_DAMPING);
          this.integrateRotation(dt);

          if (this.catchCooldown > 0) {
            this.catchCooldown -= dt * 1000;
          } else if (this.checkCatch()) {
            return;
          }

          this.checkImpact(dt);

          if (this.el.object3D.position.y <= GROUND_REST_Y) {
            var impactSpeed = this.fallVelocity.length();
            this.el.object3D.position.y = GROUND_REST_Y;
            this.fallVelocity.set(0, 0, 0);
            this.angularVelocity.set(0, 0, 0);
            this.state = 'resting';
            // Announced rather than acted on: this component has no
            // opinion about what landing hard means. A gun ignores it;
            // a bottle (see breakable) does not.
            this.el.emit('landed', { speed: impactSpeed }, false);
          }
        },

        // ==========================================================
        // PROJECTILES
        // A thrown thing is a slow bullet. Anything moving fast enough
        // casts along the little bit of ground it covered this frame,
        // and if it crosses something shootable it emits the very same
        // `shot` event a pistol would — so a bottle hurled at a target
        // knocks it over, an arrow scores, and none of that needed a
        // word of new target code. What the impact means to the THING
        // THAT HIT is announced separately, as `impact`, and left to
        // whatever companion cares: glass shatters, dynamite goes off,
        // a pistol just clatters onward.
        //
        // The speed floor is what keeps this from being a menace.
        // Setting a gun down on a bar covered in bottles is not an
        // attack, and without a floor every gentle release next to the
        // shelf would smash something.
        // ==========================================================
        checkImpact: function (dt) {
          if (this.impactCooldown > 0) {
            this.impactCooldown -= dt * 1000;
            return;
          }

          var speed = this.fallVelocity.length();
          if (speed < IMPACT_MIN_SPEED) return;

          this._impactDir.copy(this.fallVelocity).divideScalar(speed);
          this.el.object3D.getWorldPosition(this._worldPos);
          // Back up to where it started the frame, so a fast thing
          // can't tunnel through a target between two positions.
          this._worldPos.addScaledVector(this._impactDir, -speed * dt);

          var hit = castShot(this._worldPos, this._impactDir, gatherShootableRoots(), speed * dt + this.data.grabRadius, this.el);
          if (!hit) return;

          this.impactCooldown = IMPACT_COOLDOWN_MS;
          hit.el.emit('shot', { point: hit.point.clone(), direction: this._impactDir.clone() }, false);
          this.el.emit('impact', { point: hit.point.clone(), speed: speed, hitEl: hit.el }, false);

          // Whatever it hit took most of the energy out of it. If it
          // was something that ends on contact, its own impact handler
          // has already dealt with it and this is moot.
          this.fallVelocity.multiplyScalar(-0.15);
        },

        // Standard dq/dt = 0.5 * omega-as-pure-quaternion * q integration.
        integrateRotation: function (dt) {
          var q = this.el.object3D.quaternion;
          this._deltaQuat.set(
            this.angularVelocity.x * dt,
            this.angularVelocity.y * dt,
            this.angularVelocity.z * dt,
            0
          );
          this._deltaQuat.multiply(q);
          q.set(
            q.x + 0.5 * this._deltaQuat.x,
            q.y + 0.5 * this._deltaQuat.y,
            q.z + 0.5 * this._deltaQuat.z,
            q.w + 0.5 * this._deltaQuat.w
          ).normalize();
        },
      });

      // ==============================================================
      // ITEM MAKERS
      // A rack that restocks itself has to be able to BUILD the thing
      // it's short of, which means "what a pistol is" can't only exist
      // as a line of markup. So it lives here, once, and the armoury's
      // opening stock, your hip holsters and every later restock all
      // go through the same maker — there is no such thing as the
      // original pistol any more, only the current one.
      //
      // A maker gets a bare entity and the id of the socket it's being
      // built into, and does exactly what the markup used to do:
      // choose components. Everything a maker produces is perishable,
      // which is not the maker's business to opt into — see the
      // RESTOCKING AND PERISHING note for why the two always come as
      // a pair.
      // ==============================================================
      var ITEM_MAKERS = {};

      // `keep` marks something that is PART OF A RIG rather than loot —
      // a hose nozzle belongs to its tank the way a trigger belongs to
      // a gun. Those don't perish, because a nozzle rotting off the end
      // of your hose isn't a consequence, it's breakage.
      function defineItem(name, build, options) {
        ITEM_MAKERS[name] = { build: build, keep: !!(options && options.keep) };
      }

      function makeItem(name, slotEl) {
        var maker = ITEM_MAKERS[name];
        if (!maker || !slotEl || !slotEl.id) return null;

        var el = document.createElement('a-entity');
        el.classList.add('grabbable');
        maker.build(el, slotEl.id);
        if (!maker.keep) el.setAttribute('perishable', '');
        document.querySelector('a-scene').appendChild(el);
        return el;
      }

      // itemSize is the only thing deciding which sockets a gun can go
      // in (see holsterable.findNearestSlot) — there's no per-object
      // list of "which anchors" anywhere. A pistol is small and fits
      // everything, up to and including your mouth and the crown of
      // your hat; a shotgun is large and only the bandolier and the
      // armoury's cradles will take it.
      defineItem('pistol', function (el, slotId) {
        el.setAttribute('holsterable', {
          holsterSelector: '#' + slotId,
          itemSize: 'small',
          holsterRotation: { x: -90, y: 0, z: 0 },
          heldRotation: { x: -90, y: 0, z: 0 },
          heldPosition: { x: 0, y: 0, z: 0 },
          grabRadius: 0.15,
          comOffset: { x: 0, y: 0.03, z: -0.08 },
        });
        el.setAttribute('firearm', '');
        el.setAttribute('ignition-source', { tipSelector: '.muzzle' });
        el.setAttribute('boxy-gun', '');
      });

      // Belts. `keep: true` because a belt is equipment, not loot — the
      // same reasoning the nozzle gets (see defineItem's own comment):
      // it doesn't perish lying on the floor after being swapped out,
      // it just sits there until picked back up.
      //
      // stockHips is true only for belt-classic, and only because it's
      // the one named directly in the waist anchor's own `stocked` —
      // see markup. Wardrobe spares start empty; swapping one in is
      // what fills its hips, via `belt`'s own 'displaced' handling.
      function buildBelt(el, slotId, color, buckleColor, stockHips) {
        el.setAttribute('holsterable', {
          holsterSelector: '#' + slotId,
          itemSize: 'medium',
          grabRadius: 0.22,
        });
        el.setAttribute('boxy-belt', { color: color, buckleColor: buckleColor });
        el.setAttribute('belt', { stockHips: !!stockHips });
      }

      defineItem(
        'belt-classic',
        function (el, slotId) {
          buildBelt(el, slotId, BELT_COLOR, BELT_BUCKLE_COLOR, true);
        },
        { keep: true }
      );

      defineItem(
        'belt-silver',
        function (el, slotId) {
          buildBelt(el, slotId, '#2b2b2f', '#c9d3d8');
        },
        { keep: true }
      );

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

      // The same declaration with different numbers, which is the
      // point of firearm having a schema at all: a pistol is
      // pellets:1, coneDeg:0, and the spread is the only thing that
      // makes this a shotgun.
      //
      // supportGrip/supportRadius are what put a second place to hold
      // it at the forend: grip near there with your off hand and the
      // barrel points along the line between your two hands instead of
      // wherever one wrist happens to be. Steadier by geometry rather
      // than by damping, and only the hand on the actual grip can fire
      // it.
      defineItem('shotgun', function (el, slotId) {
        el.setAttribute('holsterable', {
          holsterSelector: '#' + slotId,
          itemSize: 'large',
          holsterRotation: { x: -90, y: 0, z: 0 },
          heldRotation: { x: -90, y: 0, z: 0 },
          heldPosition: { x: 0, y: 0, z: 0 },
          grabRadius: 0.28,
          grabSpan: { x: 0, y: 0, z: -0.5 },
          comOffset: { x: 0, y: 0.02, z: -0.2 },
          supportGrip: { x: 0, y: 0.01, z: -0.22 },
          supportRadius: 0.22,
          maxThrowSpeed: 7,
        });
        el.setAttribute('firearm', { pellets: 6, coneDeg: 4, kickDeg: -16, recoverMs: 200, heatPerShot: 0.4 });
        el.setAttribute('ignition-source', { tipSelector: '.muzzle' });
        el.setAttribute('boxy-shotgun', '');
      });

      // The bow declares the second grip BEHIND itself, which is the
      // one line that turns the shotgun's forend into a bowstring.
      // Everything else about drawing and loosing is in the `bow`
      // component, and everything about holding, holstering, twirling
      // and catching it is holsterable's, unchanged.
      defineItem('bow', function (el, slotId) {
        el.setAttribute('holsterable', {
          holsterSelector: '#' + slotId,
          itemSize: 'large',
          // Unlike the guns, a bow racks FLAT: limbs up, string toward
          // you. That reads as a bow slung on your back in the
          // bandolier, and the armoury's cradle rolls the socket a
          // quarter turn to lay the same pose down on the bench.
          holsterRotation: { x: 0, y: 0, z: 0 },
          heldRotation: { x: -90, y: 0, z: 0 },
          grabRadius: 0.2,
          grabSpan: { x: 0, y: BOW_LIMB_LENGTH * 0.8, z: 0 }, // the upper limb counts as the bow
          comOffset: { x: 0, y: 0.02, z: 0 },
          supportGrip: { x: 0, y: 0, z: BOW_STRING_REST_Z },
          supportRadius: 0.24,
          // The bow does NOT swing to face the string hand. It's held
          // in one hand and aimed with that hand; the other hand just
          // pulls. Letting the string hand steer it meant the whole bow
          // snapped back into place the instant you loosed, which read
          // as the weapon flinching.
          supportAims: false,
          supportGrab: 'trigger', // draw with the finger that shoots; grip stays free to take the arrow back off the string
          maxThrowSpeed: 8,
        });
        el.setAttribute('boxy-bow', '');
        el.setAttribute('bow', '');
      });

      // An arrow is a small holsterable with a point on it. It's
      // lightable, so every existing way of setting something alight
      // sets an arrow alight, and an ignition-source, so a lit one
      // sets alight whatever it lands in — including a puddle of
      // spilled beer on the far side of the room, which is a sentence
      // nobody had to write any code for.
      defineItem('arrow', function (el, slotId) {
        el.setAttribute('holsterable', {
          holsterSelector: '#' + slotId,
          itemSize: 'small',
          holsterRotation: { x: 0, y: 0, z: 0 }, // point-first, which is right on a bowstring and on your back; a rack that wants them any other way rolls its own socket
          heldRotation: { x: -90, y: 0, z: 0 },
          grabRadius: 0.13,
          grabSpan: { x: 0, y: 0, z: -ARROW_LENGTH }, // grab it anywhere along the shaft, not just by the nock
          comOffset: { x: 0, y: 0, z: -0.2 },
          gravityScale: 0.85,
          maxThrowSpeed: 9, // by hand it's a poor javelin; off a string it's something else
        });
        el.setAttribute('boxy-arrow', '');
        el.setAttribute('arrow', '');
        el.setAttribute('lightable', { tipSelector: '.ember' });
        el.setAttribute('ignition-source', { tipSelector: '.ember' });
      });

      // The pack and the nozzle. Note that neither declaration says
      // anything about fire, water or beer: the tank holds a liquid
      // type and the nozzle sprays it, and which one it is arrives
      // later, through the hatch, as ordinary droplets.
      defineItem('tank', function (el, slotId) {
        el.setAttribute('holsterable', {
          holsterSelector: '#' + slotId,
          itemSize: 'large',
          holsterRotation: { x: 0, y: 0, z: 0 },
          heldRotation: { x: -90, y: 0, z: 0 },
          holsterPosition: { x: 0, y: 0, z: 0.06 },
          grabRadius: 0.24,
          comOffset: { x: 0, y: -0.1, z: 0 },
          maxThrowSpeed: 5,
        });
        el.setAttribute('boxy-tank', '');
        el.setAttribute('hatch', '');
        el.setAttribute('liquid-tank', '');
      });

      // Marked `keep`, and its clip is stocked once rather than
      // refilling: between them that's the fix for a hose that grew a
      // second hose every five seconds you spent holding the first one.
      defineItem('nozzle', function (el, slotId) {
        el.setAttribute('holsterable', {
          holsterSelector: '#' + slotId,
          itemSize: 'small',
          holsterRotation: { x: -60, y: 0, z: 0 },
          heldRotation: { x: -90, y: 0, z: 0 },
          grabRadius: 0.17, // generous, because this is the thing you mean to grab
          comOffset: { x: 0, y: 0, z: -0.1 },
        });
        el.setAttribute('boxy-nozzle', '');
        el.setAttribute('nozzle', '');
      }, { keep: true });

      // The rifle. A `firearm` with a tighter cone and a heavier kick,
      // and a `scope` — which is a separate component precisely
      // because seeing through a tube has nothing to do with firing
      // one. The support grip at the forestock matters more here than
      // anywhere else: one wrist cannot hold a magnified view still.
      defineItem('sniper', function (el, slotId) {
        el.setAttribute('holsterable', {
          holsterSelector: '#' + slotId,
          itemSize: 'large',
          holsterRotation: { x: -90, y: 0, z: 0 },
          heldRotation: { x: -90, y: 0, z: 0 },
          grabRadius: 0.24,
          grabSpan: { x: 0, y: 0, z: -0.7 },
          comOffset: { x: 0, y: 0.02, z: -0.28 },
          supportGrip: { x: 0, y: 0.005, z: -0.28 },
          supportRadius: 0.22,
          maxThrowSpeed: 6,
        });
        el.setAttribute('firearm', { pellets: 1, coneDeg: 0, kickDeg: -13, recoverMs: 320, heatPerShot: 0.5 });
        el.setAttribute('ignition-source', { tipSelector: '.muzzle' });
        el.setAttribute('boxy-sniper', '');
        el.setAttribute('scope', { offset: { x: 0, y: 0.115, z: 0.03 } });
      });

      // The launcher, and the thing that goes in it. Note how little
      // either declaration says: the tube is a holsterable with a
      // socket and a trigger hook, and the rocket is an armed
      // explosive with a motor. Neither mentions the other.
      defineItem('launcher', function (el, slotId) {
        el.setAttribute('holsterable', {
          holsterSelector: '#' + slotId,
          itemSize: 'large',
          holsterRotation: { x: -90, y: 0, z: 0 },
          heldRotation: { x: -90, y: 0, z: 0 },
          grabRadius: 0.26,
          grabSpan: { x: 0, y: 0.06, z: -0.4 },
          comOffset: { x: 0, y: 0.03, z: -0.18 },
          supportGrip: { x: 0, y: 0.02, z: -0.24 },
          supportRadius: 0.22,
          maxThrowSpeed: 6,
        });
        el.setAttribute('boxy-launcher', '');
        el.setAttribute('launcher', '');
      });

      defineItem('rocket', function (el, slotId) {
        el.setAttribute('holsterable', {
          holsterSelector: '#' + slotId,
          itemSize: 'small',
          holsterRotation: { x: -90, y: 0, z: 0 },
          heldRotation: { x: -90, y: 0, z: 0 },
          grabRadius: 0.13,
          comOffset: { x: 0, y: 0, z: -0.02 },
          maxThrowSpeed: 8, // thrown by hand it is a poor club with a warhead on it
        });
        el.setAttribute('boxy-rocket', '');
        el.setAttribute('rocket', '');
        el.setAttribute('explosive', { armed: true, radius: ROCKET_BLAST_RADIUS, fuel: 0.75 });
        el.classList.add('shootable');
      });

      // A stick of dynamite, which is almost entirely other people's
      // components. `lightable` and `burnable` are the fuse — the same
      // pair a match is made of — so every way of lighting anything in
      // this scene already lights it, and the fuse ashes down and can
      // even have its light flicked off. `holsterable` is the throw.
      // `explosive` is the two lines at the end. There is no dynamite
      // code as such, which is the point.
      defineItem('dynamite', function (el, slotId) {
        el.setAttribute('holsterable', {
          holsterSelector: '#' + slotId,
          itemSize: 'small',
          holsterRotation: { x: 0, y: 0, z: 0 },
          heldRotation: { x: -90, y: 0, z: 0 },
          grabRadius: 0.14,
          grabSpan: { x: 0, y: 0, z: DYNAMITE_STICK_LENGTH * 0.8 },
          comOffset: { x: 0, y: 0, z: -0.08 },
          maxThrowSpeed: 11,
        });
        el.setAttribute('boxy-dynamite', '');
        el.setAttribute('burnable', {
          visual: 'boxy-dynamite',
          length: DYNAMITE_FUSE_LENGTH,
          ashRate: DYNAMITE_FUSE_RATE,
          minLength: DYNAMITE_FUSE_MIN,
          ashColor: '#2e2a24',
        });
        el.setAttribute('lightable', { tipSelector: '.ember' });
        el.setAttribute('ignition-source', { tipSelector: '.ember' });
        el.setAttribute('explosive', '');
        // Shootable, so somebody with better aim than sense can set it
        // off in your hand from across the room.
        el.classList.add('shootable');
      });

      // Taking something out of the world is deferred to the end of the
      // frame for exactly the reason particle removal is (see
      // killParticle): A-Frame runs every component's tick from one
      // list, and removing an entity mid-tick mutates the list it's
      // walking. Mark it, sweep it once, same as everything else here.
      var DOOMED = [];

      function despawnItem(el) {
        if (DOOMED.indexOf(el) === -1) DOOMED.push(el);
      }

      function sweepDoomed() {
        if (!DOOMED.length) return;

        for (var i = 0; i < DOOMED.length; i++) {
          var el = DOOMED[i];

          // Out of everyone's hands and out of whatever socket it was
          // claiming, first — an occupant that stops existing without
          // saying so leaves a slot that looks full forever, and a
          // rack that looks full never restocks.
          var hands = document.querySelectorAll('.hand');
          for (var h = 0; h < hands.length; h++) {
            var handRig = hands[h].components['hand-rig'];
            if (handRig) handRig.discard(el);
          }

          var holsterable = el.components && el.components.holsterable;
          if (holsterable) {
            holsterable.hand = null;
            holsterable.vacateSlot();
          }

          if (el.parentNode) el.parentNode.removeChild(el);
          if (el.object3D && el.object3D.parent) el.object3D.parent.remove(el.object3D);
        }

        DOOMED.length = 0;
      }

      // ==============================================================
      // detonate
      // See the EXPLOSIONS note. Deliberately a plain function rather
      // than a component: a stick of dynamite, a rocket and (later)
      // anything else that goes bang all want the same event to happen
      // at a point in space, and none of them want to own it.
      // ==============================================================
      var _blastScratch = new THREE.Vector3();
      var _blastPush = new THREE.Vector3();

      function detonate(worldPos, options) {
        options = options || {};
        var radius = options.radius || BLAST_RADIUS;

        playBoom();
        spawnDebris(worldPos, { count: BLAST_SHARDS, color: '#4a3f39', size: SHARD_SIZE * 1.4, speed: SHARD_SPEED * 2.2 });
        spawnSparks(worldPos, 14);
        for (var s = 0; s < 6; s++) spawnSmoke(worldPos, randomUnitVector().multiplyScalar(2.2), 1.6);

        // Burning fuel on whatever it went off over. Everything that
        // makes fire interesting — spreading, being doused, lighting
        // cigars — follows from this one line rather than from
        // anything here.
        var pool = spillPuddle(worldPos, 'fire', options.fuel || BLAST_FUEL);
        if (pool) ignitePool(pool);

        var manager = document.querySelector('#range-manager');

        var hinges = document.querySelectorAll('[pop-target]');
        for (var i = 0; i < hinges.length; i++) {
          var popTarget = hinges[i].components['pop-target'];
          if (!popTarget || popTarget.fallen) continue;
          hinges[i].object3D.getWorldPosition(_blastScratch);
          if (_blastScratch.distanceTo(worldPos) > radius) continue;
          if (manager) manager.emit('ring-hit', { score: BLAST_SCORE, label: 'BLASTED' }, false);
          popTarget.fall();
        }

        var breakables = document.querySelectorAll('[breakable]');
        for (var b = 0; b < breakables.length; b++) {
          var breakable = breakables[b].components.breakable;
          if (!breakable || breakable.broken || !breakable.data.autoShatter) continue;
          breakables[b].object3D.getWorldPosition(_blastScratch);
          if (_blastScratch.distanceTo(worldPos) > radius) continue;
          breakable.shatter(true);
        }

        // And everything loose gets thrown. Note it goes through the
        // ordinary throw path, so a blasted bottle is catchable in
        // mid-air and can be shot out of it like any other.
        var loose = document.querySelectorAll('.grabbable');
        for (var g = 0; g < loose.length; g++) {
          var holsterable = loose[g].components.holsterable;
          if (!holsterable) continue;
          if (holsterable.state !== 'resting' && holsterable.state !== 'falling') continue;

          loose[g].object3D.getWorldPosition(_blastScratch);
          var distance = _blastScratch.distanceTo(worldPos);
          if (distance > radius) continue;

          _blastPush.copy(_blastScratch).sub(worldPos);
          if (_blastPush.lengthSq() < 0.0001) _blastPush.set(0, 1, 0);
          _blastPush.normalize().multiplyScalar(BLAST_SHOVE * (1 - distance / radius));
          _blastPush.y = Math.abs(_blastPush.y) + BLAST_SHOVE * 0.35;
          holsterable.throwWithVelocity(_blastPush.clone());
        }
      }

      // ==============================================================
      // COMPONENT: explosive
      // The thing that goes bang, and it doesn't know what set it off.
      // It listens for the three ways anything in this scene ends —
      // a fuse running out (`burnt-out`, straight out of burnable),
      // being hit hard (`impact`), and being shot (`shot`) — so a
      // stick of dynamite can be lit and thrown, shot out of the air
      // by someone with better aim than sense, or simply dropped from
      // a height.
      //
      // Everything else about a stick of dynamite is components that
      // already existed: `lightable` and `burnable` give it a fuse
      // that any cigar, match, Zippo or hot barrel will light, and
      // `holsterable` gives it the aimed overhand throw. This
      // component is the last two lines of its life.
      // ==============================================================
      registerComponent('explosive', {
        schema: {
          radius: { type: 'number', default: BLAST_RADIUS },
          fuel: { type: 'number', default: BLAST_FUEL },
          armed: { type: 'boolean', default: false }, // true = a hard knock alone is enough, no fuse required
        },

        init: function () {
          this.spent = false;
          this._world = new THREE.Vector3();

          this.onBurntOut = this.blow.bind(this);
          this.onImpact = this.onImpact.bind(this);
          this.onShot = this.onShot.bind(this);

          this.el.addEventListener('burnt-out', this.onBurntOut);
          this.el.addEventListener('impact', this.onImpact);
          this.el.addEventListener('landed', this.onImpact);
          this.el.addEventListener('shot', this.onShot);
        },

        remove: function () {
          this.el.removeEventListener('burnt-out', this.onBurntOut);
          this.el.removeEventListener('impact', this.onImpact);
          this.el.removeEventListener('landed', this.onImpact);
          this.el.removeEventListener('shot', this.onShot);
        },

        // A knock only sets it off if it's already lit or armed —
        // otherwise a stick of dynamite would be unable to survive
        // being dropped, which makes carrying a bundle of it much less
        // funny than it should be.
        onImpact: function (evt) {
          var lightable = this.el.components.lightable;
          if (!this.data.armed && !(lightable && lightable.lit)) return;
          if (evt.detail && evt.detail.speed < IMPACT_MIN_SPEED) return;
          this.blow();
        },

        onShot: function () {
          this.blow();
        },

        blow: function () {
          if (this.spent) return;
          this.spent = true;

          this.el.object3D.getWorldPosition(this._world);
          detonate(this._world, { radius: this.data.radius, fuel: this.data.fuel });
          despawnItem(this.el);
        },
      });

      // ==============================================================
      // COMPONENT: stocked
      // A socket that knows what belongs in it. It puts one there at
      // scene load, and that's all it does unless you give it a
      // refillMs, in which case it keeps doing it however many times
      // the socket goes bare.
      //
      // That one number is the whole difference between a holster and
      // a shop. A holster is stocked: there's a pistol in it when you
      // start and after that it holds whatever you put in it. An
      // armoury peg refills, because an armoury is where guns come
      // from. Neither knows what became of the last one, which is also
      // what separates both from breakable's respawn — that one is an
      // object coming back from the dead, this is a shelf being
      // restocked.
      //
      // It goes on the slot rather than on the item for the obvious
      // reason: the item might not be there. Put it on any anchor-slot
      // in the scene and that spot starts with whatever you name — a
      // rack of rifles, a hip holster, or, if you wanted, a bar that
      // never runs out of matches.
      // ==============================================================
      registerComponent('stocked', {
        schema: {
          item: { type: 'string' }, // a key into ITEM_MAKERS
          refillMs: { type: 'number', default: 0 }, // 0 = the opening stock was the whole offer
        },

        init: function () {
          // Zero, so the opening stock arrives on the first tick rather
          // than a delay into the game. Deferring it that far is also
          // what guarantees the sibling anchor-slot component has
          // initialized — the same reason holsterable claims its slot
          // from tick() instead of init().
          this.timer = 0;
          this.filled = false;
        },

        tick: function (time, dt) {
          var slot = this.el.components['anchor-slot'];
          if (!slot) return;

          if (slot.isFull()) {
            this.timer = this.data.refillMs;
            return;
          }
          if (this.filled && !this.data.refillMs) return;

          this.timer -= dt || 16;
          if (this.timer > 0) return;
          this.timer = this.data.refillMs;

          // The opening stock fills the socket outright — a crate with
          // room for three sticks starts with three. After that they
          // come back one at a time, so working through a crate is
          // worth something. (The count is read from the slot rather
          // than counted afterwards because a freshly built item takes
          // a frame to claim its place.)
          var wanted = this.filled ? 1 : slot.data.capacity - slot.occupants.length;
          this.filled = true;
          for (var i = 0; i < wanted; i++) makeItem(this.data.item, this.el);
        },
      });

      // ==============================================================
      // COMPONENT: perishable
      // The other half of that bargain. The clock only runs while this
      // object is loose — lying on the floor or still in the air.
      // Anything holding it counts, and every kind of holding counts
      // equally: a fist, a fingertip it's twirling on, or any socket
      // anywhere in the scene. Pick a dropped pistol back up with one
      // second left and it's as good as new.
      //
      // It shrinks away over the last of its life instead of blinking
      // out, so a gun you were about to go back for tells you it's
      // going.
      // ==============================================================
      registerComponent('perishable', {
        schema: {
          lifetimeMs: { type: 'number', default: LOOSE_ITEM_LIFETIME_MS },
          fadeMs: { type: 'number', default: LOOSE_ITEM_FADE_MS },
        },

        init: function () {
          this.remaining = this.data.lifetimeMs;
          this.expired = false;
          this._world = new THREE.Vector3();
        },

        tick: function (time, dt) {
          if (this.expired) return;

          var holsterable = this.el.components.holsterable;
          if (!holsterable) return;

          if (holsterable.state !== 'resting' && holsterable.state !== 'falling') {
            if (this.remaining !== this.data.lifetimeMs) {
              this.remaining = this.data.lifetimeMs;
              this.el.object3D.scale.setScalar(1);
            }
            return;
          }

          this.remaining -= dt || 16;
          if (this.remaining <= 0) {
            this.expire();
            return;
          }
          if (this.remaining < this.data.fadeMs) {
            this.el.object3D.scale.setScalar(Math.max(this.remaining / this.data.fadeMs, 0.04));
          }
        },

        expire: function () {
          this.expired = true;
          this.el.object3D.getWorldPosition(this._world);
          spawnSmoke(this._world, null, 0.7);
          spawnSmoke(this._world, null, 0.45);
          despawnItem(this.el);
        },
      });

      // ==============================================================
      // COMPONENT: firearm
      // Everything that can be fired, in one component. This used to
      // be two nearly identical components ("pistol" and "shotgun")
      // that differed only in a handful of numbers, so it's now one
      // with those numbers in its schema — a single-ball pistol is
      // just pellets:1, coneDeg:0. Any new gun is a markup line.
      //
      // A thin companion to holsterable, attached alongside it only on
      // the guns — the hat, bottles, and cigars have no such
      // component, so hand-rig's trigger-pull handler (which looks for
      // this component before calling fire()) is naturally a no-op
      // while holding them. It reads holsterable's state and writes
      // its recoil kick into holsterable.extraPitchDeg rather than
      // touching the object's rotation itself, so recoil, the hand's
      // fan offset, and drunken sway all compose in one place instead
      // of three components fighting over one object3D.
      //
      // `heat` is the other bit of state, and it's what makes rapid
      // fire visibly different from careful shooting: every shot adds
      // some, it bleeds off at GUN_HEAT_DECAY_PER_S, and it drives
      // both how much smoke a shot produces and whether the barrel is
      // hot enough to light a cigar off (see world-systems).
      // ==============================================================
      registerComponent('firearm', {
        schema: {
          pellets: { type: 'number', default: 1 }, // rays per shot
          coneDeg: { type: 'number', default: 0 }, // half-angle of the spread cone
          kickDeg: { type: 'number', default: RECOIL_KICK_DEG },
          recoverMs: { type: 'number', default: RECOIL_RECOVER_MS },
          heatPerShot: { type: 'number', default: 0.22 },
        },

        init: function () {
          this.recoilTimer = 0; // ms remaining on the current fire-recoil kick
          this.heat = 0; // 0..1 barrel temperature — how hard this barrel has been worked lately
          this.sinceLastShot = Infinity;
          this.curlRemaining = 0; // puffs still to come in the post-shooting curl
          this.curlTimer = 0;

          this._origin = new THREE.Vector3();
          this._quat = new THREE.Quaternion();
          this._forward = new THREE.Vector3();
          this._right = new THREE.Vector3();
          this._up = new THREE.Vector3();
        },

        tick: function (time, dt) {
          var dtSeconds = Math.min((dt || 16) / 1000, 0.05);
          this.sinceLastShot += dtSeconds * 1000;
          this.heat = Math.max(this.heat - GUN_HEAT_DECAY_PER_S * dtSeconds, 0);
          this.updateRecoil(dtSeconds);
          this.updateBarrelSmoke(dtSeconds);

          // A barrel that's just been fired is hot enough to light a
          // cigar off. firearm doesn't know what a cigar is — it only
          // publishes "this tip is hot right now" (see
          // ignition-source) and lets world-systems do the matching.
          var source = this.el.components['ignition-source'];
          if (source) source.hot = this.heat > MUZZLE_HOT_THRESHOLD;
        },

        // Eases the kick back down to zero. The kick itself is handed
        // to holsterable, which composes it into the held pose — a
        // gun that's been dropped or holstered mid-recovery just stops
        // having its pose written at all, which is exactly right.
        updateRecoil: function (dtSeconds) {
          if (this.recoilTimer <= 0) return;

          this.recoilTimer = Math.max(this.recoilTimer - dtSeconds * 1000, 0);
          var holsterable = this.el.components.holsterable;
          if (holsterable) {
            holsterable.extraPitchDeg = this.data.kickDeg * (this.recoilTimer / this.data.recoverMs);
          }
        },

        // Smoke happens after the shooting, not during it. Once the
        // barrel has been quiet for BARREL_SMOKE_DELAY_MS, however hot
        // it got is converted into a curl of puffs released one at a
        // time so they rise out of the muzzle in a column. Fire again
        // mid-curl and it's cancelled and re-armed — you only get the
        // smoke when you're actually done.
        updateBarrelSmoke: function (dtSeconds) {
          if (this.curlRemaining > 0) {
            this.curlTimer -= dtSeconds * 1000;
            if (this.curlTimer <= 0) {
              this.curlTimer = BARREL_SMOKE_INTERVAL_MS;
              this.curlRemaining--;
              this.emitBarrelPuff();
            }
            return;
          }

          if (this.sinceLastShot < BARREL_SMOKE_DELAY_MS) return;
          if (this.heat < BARREL_SMOKE_MIN_HEAT) return;

          this.curlRemaining = Math.max(Math.round(this.heat * BARREL_SMOKE_MAX_PUFFS), 1);
          this.curlTimer = 0;
          this.heat = 0; // spent — the curl IS the heat leaving the barrel
        },

        emitBarrelPuff: function () {
          var muzzleEl = this.el.querySelector('.muzzle');
          if (!muzzleEl || !muzzleEl.object3D) return;

          muzzleEl.object3D.getWorldPosition(this._origin);
          this._forward.set(0, 0.55, 0); // up and out of the barrel, not down the firing line
          spawnSmoke(this._origin, this._forward, 0.75);
        },

        // hand-rig's generic press dispatch (see useHeldObject) — a
        // trigger pull on a held gun means fire.
        onTriggerUse: function () {
          this.fire();
        },

        // Raycasts from the muzzle at everything wearing the
        // "shootable" class (see castShot) — targets, bottles, cigars,
        // whatever gets added next. Only fires while properly held —
        // not while dangling or mid-air, so a twirl in progress can't
        // accidentally go off.
        fire: function () {
          var holsterable = this.el.components.holsterable;
          if (!holsterable || holsterable.state !== 'held') return;

          var muzzleEl = this.el.querySelector('.muzzle');
          if (!muzzleEl || !muzzleEl.object3D) return;

          muzzleEl.object3D.getWorldPosition(this._origin);
          muzzleEl.object3D.getWorldQuaternion(this._quat);
          this._forward.set(0, 0, -1).applyQuaternion(this._quat).normalize();
          this._right.set(1, 0, 0).applyQuaternion(this._quat).normalize();
          this._up.set(0, 1, 0).applyQuaternion(this._quat).normalize();

          this.playMuzzleEffects();

          var coneRad = (this.data.coneDeg * Math.PI) / 180;
          var hitCount = 0;
          var roots = gatherShootableRoots();

          for (var i = 0; i < this.data.pellets; i++) {
            var direction = this._forward.clone();
            if (coneRad > 0) {
              direction
                .applyAxisAngle(this._right, (Math.random() - 0.5) * 2 * coneRad)
                .applyAxisAngle(this._up, (Math.random() - 0.5) * 2 * coneRad)
                .normalize();
            }

            var hit = castShot(this._origin, direction, roots);
            var endPoint;
            if (hit) {
              endPoint = hit.point;
              // Non-bubbling and aimed straight at the thing that was
              // hit: what a hit MEANS is entirely up to the target
              // (score and tip over, shatter, catch light).
              hit.el.emit('shot', { point: hit.point.clone(), direction: direction.clone() }, false);
              hitCount++;
            } else {
              endPoint = this._origin.clone().addScaledVector(direction, MAX_SHOT_RANGE);
            }

            spawnTracer(this._origin, endPoint);
          }

          if (hitCount === 0) {
            var manager = document.querySelector('#range-manager');
            if (manager) manager.emit('gun-miss', null, false);
          }
        },

        playMuzzleEffects: function () {
          this.recoilTimer = this.data.recoverMs;
          this.heat = Math.min(this.heat + this.data.heatPerShot, 1);
          this.sinceLastShot = 0;
          this.curlRemaining = 0; // still shooting — the curl waits

          flashMuzzle(this.el);
          spawnSparks(this._origin, 3);
        },
      });

      // ==============================================================
      // COMPONENT: hand-rig
      // Listens to one hand's grip/trigger buttons. Owns the "what am
      // I currently holding" bookkeeping and delegates all the actual
      // state/physics work to the holsterable component on whatever
      // object is involved — completely object-agnostic, it never
      // checks whether that object is a gun, a hat, or anything else.
      // Firing is the one exception: onTriggerDown looks specifically
      // for co-located "firearm" components and calls fire() on each,
      // which is naturally a no-op while holding anything that isn't
      // a gun.
      //
      // A hand holds up to HAND_CAPACITY things at once rather than
      // one, which is where a lot of the ridiculousness comes from:
      // grip again with a full-ish hand and you pick up another
      // thing. Two pistols in one fist both fire on one trigger pull.
      // An armful of bottles all launch together on one throw. None of
      // that is special-cased anywhere — items just get fanned out
      // (see holsterable.applyHandPose) and every operation loops.
      //
      // It also owns where your hand actually IS, which is not the
      // same thing as where the controller is once you've been
      // drinking. Everything held hangs off a child "grip" entity
      // rather than off this one, and updateGrip below moves that grip
      // around with the drink sway, the cigar tremor, and the drunk
      // aim drift. That's why those effects had to live here rather
      // than in holsterable: a wobble applied per-object made the gun
      // swim inside a perfectly steady fist. Applied to the grip, the
      // hand and everything in it move together, which is what being
      // unsteady actually looks like. The offset goes on a CHILD
      // because tracked-controls rewrites this entity's own pose from
      // the headset every frame and would erase anything written here.
      //
      // Also tracks this hand's own world-space velocity and current
      // button state (gripHeld, fingerOnTrigger) as plain public
      // fields — generic hand-side data that computeThrowVelocity,
      // findCatchingHand, and the smoke wind simulation (all reusable,
      // object-agnostic) read directly rather than going through
      // holsterable-specific accessors.
      // ==============================================================
      registerComponent('hand-rig', {
        schema: {
          visual: { type: 'selector' }, // this hand's cosmetic twin, so the rendered hand shakes too
        },

        init: function () {
          this.heldObjects = []; // objects currently rigidly held by this hand
          this.supportObjects = []; // objects this hand is steadying by their second grip — held, but not by the trigger hand
          this.danglingObjects = []; // objects currently dangling from this hand's trigger finger
          this.stash = []; // what the last release let go of, briefly reclaimable — see reclaimStash
          this.stashTime = 0;
          this.fingerOnTrigger = false; // capacitive touch, not a pull — see triggertouchstart/end below
          this.gripHeld = false; // true for the whole time the grip is squeezed, not just the initial press
          this.triggerHeld = false; // and the same for the trigger, which a bowstring and a hose nozzle both need

          this.velocity = new THREE.Vector3();
          this._prevPos = new THREE.Vector3();
          this.el.object3D.getWorldPosition(this._prevPos); // avoid a garbage first-frame velocity spike

          // The grip: a child entity that everything held attaches to,
          // carrying however unsteady this hand currently is.
          this.gripEl = document.createElement('a-entity');
          this.el.appendChild(this.gripEl);

          this._wobbleSeed = Math.random() * 100;
          this._wobble = { x: 0, y: 0, z: 0 };
          this._ghostHand = new THREE.Vector3();
          this._ghostVel = new THREE.Vector3();
          this._handWorld = new THREE.Vector3();
          this._drift = new THREE.Vector3();
          this._handQuat = new THREE.Quaternion();
          this._ghostSeeded = false;
          this._visualBase = null; // the cosmetic hand mesh's own resting transform, captured once

          this.onGripDown = this.onGripDown.bind(this);
          this.onGripUp = this.onGripUp.bind(this);
          this.onTriggerDown = this.onTriggerDown.bind(this);
          this.onTriggerUp = this.onTriggerUp.bind(this);
          this.onTriggerTouchStart = this.onTriggerTouchStart.bind(this);
          this.onTriggerTouchEnd = this.onTriggerTouchEnd.bind(this);
          this.onFaceButton = this.onFaceButton.bind(this);

          this.el.addEventListener('gripdown', this.onGripDown);
          this.el.addEventListener('gripup', this.onGripUp);
          this.el.addEventListener('triggerdown', this.onTriggerDown);
          this.el.addEventListener('triggerup', this.onTriggerUp);
          this.el.addEventListener('triggertouchstart', this.onTriggerTouchStart);
          this.el.addEventListener('triggertouchend', this.onTriggerTouchEnd);
          // Both face buttons on both controllers do the same thing,
          // so there's nothing to remember about which is which.
          FACE_BUTTON_EVENTS.forEach(function (name) {
            this.el.addEventListener(name, this.onFaceButton);
          }, this);
        },

        remove: function () {
          this.el.removeEventListener('gripdown', this.onGripDown);
          this.el.removeEventListener('gripup', this.onGripUp);
          this.el.removeEventListener('triggerdown', this.onTriggerDown);
          this.el.removeEventListener('triggerup', this.onTriggerUp);
          this.el.removeEventListener('triggertouchstart', this.onTriggerTouchStart);
          this.el.removeEventListener('triggertouchend', this.onTriggerTouchEnd);
          FACE_BUTTON_EVENTS.forEach(function (name) {
            this.el.removeEventListener(name, this.onFaceButton);
          }, this);
        },

        // Smoothed (50%-blended) world-space velocity, so a single
        // noisy tracking frame right at release doesn't get read as a
        // huge spurious throw speed.
        tick: function (time, dt) {
          var dtSeconds = Math.min((dt || 16) / 1000, 0.05);
          if (dtSeconds <= 0) return;

          this.el.object3D.getWorldPosition(this._handWorld);
          this._drift.copy(this._handWorld).sub(this._prevPos).divideScalar(dtSeconds);
          this.velocity.lerp(this._drift, 0.5);
          this._prevPos.copy(this._handWorld);

          this.updateGrip(time, dtSeconds);
        },

        // Where your hand really is this frame. Two contributions,
        // both from VICES and both applied to the grip child:
        //
        //   - the tremor/sway, straight out of viceWobble, as a small
        //     rotation (nicotine is fast and tight, alcohol slow and
        //     wide);
        //   - drunk aim drift, a spring-damped "ghost hand" chasing
        //     your real one. It's deliberately under-damped, so at
        //     speed your hand trails behind you and then swings past
        //     where you stopped. Driven entirely by your own motion —
        //     hold still and it settles; whip the gun around and it
        //     punishes you.
        updateGrip: function (time, dtSeconds) {
          var w = viceWobble(this._wobbleSeed, time, this._wobble);
          this.updateGhostHand(dtSeconds);

          var grip = this.gripEl.object3D;
          grip.position.set(
            this._drift.x * DRIFT_POSITION_GAIN,
            this._drift.y * DRIFT_POSITION_GAIN,
            this._drift.z * DRIFT_POSITION_GAIN
          );
          grip.rotation.set(
            ((w.x - this._drift.y * DRIFT_ROTATION_GAIN) * Math.PI) / 180,
            ((w.y + this._drift.x * DRIFT_ROTATION_GAIN) * Math.PI) / 180,
            (w.z * Math.PI) / 180
          );

          this.applyToVisual(grip);
        },

        updateGhostHand: function (dtSeconds) {
          this._drift.set(0, 0, 0);

          if (!this._ghostSeeded) {
            this._ghostHand.copy(this._handWorld);
            this._ghostVel.set(0, 0, 0);
            this._ghostSeeded = true;
            return;
          }

          this._drift.copy(this._handWorld).sub(this._ghostHand);
          this._ghostVel.addScaledVector(this._drift, DRIFT_STIFFNESS * dtSeconds);
          this._ghostVel.multiplyScalar(Math.max(1 - DRIFT_DAMPING * dtSeconds, 0));
          this._ghostHand.addScaledVector(this._ghostVel, dtSeconds);

          if (VICES.alcohol <= 0.001) return this._drift.set(0, 0, 0);

          // How far the ghost is lagging, in the hand's own frame so
          // "left" means left of the barrel however you're facing.
          this._drift.copy(this._ghostHand).sub(this._handWorld);
          if (this._drift.lengthSq() > DRIFT_MAX_LAG * DRIFT_MAX_LAG) {
            this._drift.setLength(DRIFT_MAX_LAG);
          }
          this.el.object3D.getWorldQuaternion(this._handQuat);
          this._drift.applyQuaternion(this._handQuat.invert());
          this._drift.multiplyScalar(VICES.alcohol);
        },

        // The rendered hand is a separate entity (see the markup
        // comment), so it needs the same offset or the gun would
        // visibly float out of an unnervingly steady fist. Applied to
        // the loaded model rather than the entity, since
        // tracked-controls owns the entity's pose — and composed on
        // top of whatever resting transform hand-controls set up,
        // captured the first time the model exists.
        applyToVisual: function (grip) {
          if (!this.data.visual) return;
          var mesh = this.data.visual.getObject3D('mesh');
          if (!mesh) return;

          if (!this._visualBase) {
            this._visualBase = {
              position: mesh.position.clone(),
              quaternion: mesh.quaternion.clone(),
            };
          }

          mesh.position.copy(this._visualBase.position).add(grip.position);
          mesh.quaternion.copy(this._visualBase.quaternion);
          mesh.rotateX(grip.rotation.x);
          mesh.rotateY(grip.rotation.y);
          mesh.rotateZ(grip.rotation.z);
        },

        // Everything held attaches here rather than to the hand
        // itself. Falls back to the hand if called before init, which
        // can happen on the very first frame.
        gripObject3D: function () {
          return this.gripEl ? this.gripEl.object3D : this.el.object3D;
        },

        isFull: function () {
          return this.heldObjects.length >= HAND_CAPACITY;
        },

        // Public "this hand now holds that" used both by this
        // component's own grip handler and by holsterable.catchThrown,
        // which catches things this hand never deliberately grabbed.
        take: function (objEl) {
          if (this.heldObjects.indexOf(objEl) === -1) this.heldObjects.push(objEl);
          var d = this.danglingObjects.indexOf(objEl);
          if (d !== -1) this.danglingObjects.splice(d, 1);
          this.reflowHeld();
        },

        takeDangling: function (objEl) {
          if (this.danglingObjects.indexOf(objEl) === -1) this.danglingObjects.push(objEl);
          this.reflowStack(this.danglingObjects);
        },

        // Something left this hand without going through a normal
        // release — a bottle shattering in your fist, mostly.
        forget: function (objEl) {
          var h = this.heldObjects.indexOf(objEl);
          if (h !== -1) {
            this.heldObjects.splice(h, 1);
            this.reflowHeld();
          }
          var d = this.danglingObjects.indexOf(objEl);
          if (d !== -1) {
            this.danglingObjects.splice(d, 1);
            this.reflowStack(this.danglingObjects);
          }
        },

        // Everything this hand might still be remembering about an
        // object that has stopped existing. forget() covers the two
        // lists it's actively holding by; the stash in particular has
        // to go too, or a quick re-grip reaches for a gun that isn't
        // in the scene any more.
        discard: function (objEl) {
          this.forget(objEl);
          var s = this.supportObjects.indexOf(objEl);
          if (s !== -1) this.supportObjects.splice(s, 1);
          var t = this.stash.indexOf(objEl);
          if (t !== -1) this.stash.splice(t, 1);
        },

        // Re-tells every item where it sits in the fistful. Same idea
        // (and same reason) as anchor-slot.reflow: the fan has to
        // re-shape itself whenever it gains or loses a member.
        reflowStack: function (list) {
          list.forEach(function (objEl, i) {
            var holsterable = objEl.components.holsterable;
            if (holsterable) holsterable.setHandStack(i, list.length);
          });
        },

        reflowHeld: function () {
          var self = this;
          this.reflowStack(this.heldObjects);
          this.heldObjects.forEach(function (objEl) {
            var holsterable = objEl.components.holsterable;
            if (holsterable) holsterable.applyHandPose(self.el);
          });
        },

        // Grip is a hold, not a toggle, which means there's no such
        // thing as "press it again while still holding" — you'd have
        // to let go first, and letting go drops everything. So the way
        // to build up a fistful is a quick re-grip: release and
        // squeeze again within REGRIP_WINDOW_MS and whatever you just
        // put down comes back with you, plus whatever's nearest now.
        // Sweep down the bar tapping the grip and you collect bottles.
        //
        // The release itself still happens immediately and normally —
        // deferring it would put latency on every throw — so this is
        // purely a matter of remembering what left and being willing
        // to take it back.
        onGripDown: function () {
          this.gripHeld = true;
          this.reclaimStash();
          if (this.isFull()) return;

          var obj = this.findGrabbableObject();
          if (obj) {
            obj.components.holsterable.grab(this.el);
            this.take(obj);
            return;
          }

          // Nothing to pick up, but maybe something in your OTHER hand
          // offers a second place to hold it — a shotgun forend.
          this.takeSupport('grip');
        },

        // Shared by both buttons; which one an object answers to is the
        // object's business (see holsterable's supportGrab).
        takeSupport: function (mode) {
          var support = this.findSupportGrip(mode);
          if (!support) return false;
          support.components.holsterable.grabSupport(this.el);
          this.supportObjects.push(support);
          return true;
        },

        dropSupport: function (mode) {
          this.supportObjects = this.supportObjects.filter(function (objEl) {
            var holsterable = objEl.components.holsterable;
            if (!holsterable || holsterable.data.supportGrab !== mode) return true;
            holsterable.releaseSupport();
            return false;
          });
        },

        // Lets go of everything at once. Each item runs its own
        // release() and therefore makes its own decision — dangle,
        // throw, holster, or fall — which is how a fistful of bottles
        // released over the bar can have some of them land back in
        // their slots while the rest hit the floor.
        onGripUp: function () {
          this.gripHeld = false;

          this.dropSupport('grip');

          if (!this.heldObjects.length) return;

          var objs = this.heldObjects;
          var self = this;
          this.heldObjects = [];
          this.stash = [];
          this.stashTime = performance.now();

          objs.forEach(function (obj) {
            var holsterable = obj.components.holsterable;
            holsterable.release(self.fingerOnTrigger);

            if (holsterable.state === 'dangling') {
              self.danglingObjects.push(obj);
              return;
            }
            // Two things are excluded from the stash. A real throw,
            // because flinging a bottle up and immediately gripping to
            // draw a pistol shouldn't snatch it back out of the air.
            // And anything that landed in a SOCKET, because putting a
            // thing somewhere is a decision — nocking an arrow and then
            // squeezing the grip to steady yourself was pulling the
            // arrow straight back out of the bow.
            if (holsterable.wasThrown || holsterable.state === 'holstered') return;
            self.stash.push(obj);
          });
          this.reflowStack(this.danglingObjects);
        },

        // Take back everything from the last release, if it was recent
        // enough and nothing else has claimed it in the meantime.
        reclaimStash: function () {
          if (!this.stash || !this.stash.length) return;

          if (performance.now() - this.stashTime > REGRIP_WINDOW_MS) {
            this.stash = [];
            return;
          }

          var self = this;
          this.stash.forEach(function (obj) {
            if (self.isFull()) return;
            var holsterable = obj.components.holsterable;
            if (!holsterable) return;
            // Somebody else picked it up, or it broke, in the
            // meantime — it isn't yours to take back any more.
            if (holsterable.hand && holsterable.hand !== self.el) return;
            if (holsterable.state === 'broken') return;
            // It found a home in the meantime. Leave it there.
            if (holsterable.state === 'holstered') return;

            holsterable.grab(self.el);
            self.take(obj);
          });
          this.stash = [];
        },

        // An actual pull (past the digital press threshold), not just
        // a touch. Dispatched generically: anything in this hand with
        // an onTriggerUse method gets it, so a gun fires and a lighter
        // flips its lid without hand-rig knowing either exists. Only
        // heldObjects, never supportObjects — the hand on a shotgun's
        // forend is on a forend, not a trigger.
        onTriggerDown: function () {
          this.triggerHeld = true;

          // A bowstring is drawn with the finger that would shoot,
          // which is both how a bow works and what keeps GRIP free to
          // mean "take the arrow off it". Checked before the press is
          // dispatched, and only when this hand is empty, so a trigger
          // pull on something you're holding still means what it always
          // meant.
          if (!this.heldObjects.length && this.takeSupport('trigger')) return;

          this.heldObjects.forEach(function (objEl) {
            useHeldObject(objEl, 'onTriggerUse');
          });
        },

        // A/X or B/Y, either controller. Same generic dispatch.
        onFaceButton: function () {
          this.heldObjects.forEach(function (objEl) {
            useHeldObject(objEl, 'onFaceButtonUse');
          });
        },

        onTriggerTouchStart: function () {
          this.fingerOnTrigger = true;
        },

        // Finger fully lifts off the trigger surface. Anything
        // dangling from this hand has just lost the only thing holding
        // it up — this is the moment that decides holster vs. fall,
        // per item.
        onTriggerTouchEnd: function () {
          this.fingerOnTrigger = false;
          if (!this.danglingObjects.length) return;

          var objs = this.danglingObjects;
          this.danglingObjects = [];
          objs.forEach(function (obj) {
            obj.components.holsterable.endDangle();
          });
        },

        // The nearest object being held by the OTHER hand that offers
        // a second grip within reach of this one. Deliberately checked
        // only after a normal grab fails, so a forend never steals a
        // pickup from something lying right there.
        onTriggerUp: function () {
          this.triggerHeld = false;
          this.dropSupport('trigger');
        },

        findSupportGrip: function (mode) {
          var handPos = new THREE.Vector3();
          var gripPos = new THREE.Vector3();
          this.el.object3D.getWorldPosition(handPos);

          var objects = document.querySelectorAll('.grabbable');
          var nearest = null;
          var nearestDist = Infinity;

          for (var i = 0; i < objects.length; i++) {
            var holsterable = objects[i].components.holsterable;
            if (!holsterable || !holsterable.canSupport(this.el)) continue;
            if (holsterable.data.supportGrab !== mode) continue;

            holsterable.supportGripWorldPosition(gripPos);
            var d = gripPos.distanceTo(handPos);
            if (d < holsterable.data.supportRadius && d < nearestDist) {
              nearest = objects[i];
              nearestDist = d;
            }
          }

          return nearest;
        },

        // Nearest object this hand is currently allowed to grab:
        // anything holstered or resting on the ground, or the object
        // already dangling from this specific hand's finger (a
        // "catch"). Any ".grabbable" entity qualifies, regardless of
        // what it is — guns, hat, or anything added later. Each
        // object's own grabRadius gates its eligibility (a bulky
        // object like the hat can declare a bigger grab box than a
        // gun without changing anything here), so nearestDist starts
        // wide open and lets the per-object check do the filtering.
        findGrabbableObject: function () {
          var handPos = new THREE.Vector3();
          this.el.object3D.getWorldPosition(handPos);

          var objects = Array.prototype.slice.call(document.querySelectorAll('.grabbable'));
          var self = this;
          var nearest = null;
          var nearestDist = Infinity;
          var objPos = new THREE.Vector3();

          objects.forEach(function (objEl) {
            var holsterable = objEl.components.holsterable;
            if (!holsterable) return;

            var eligible =
              holsterable.state === 'holstered' ||
              holsterable.state === 'resting' ||
              (holsterable.state === 'dangling' && holsterable.hand === self.el);
            if (!eligible) return;

            var d = holsterable.grabDistanceTo(handPos);
            if (d < holsterable.data.grabRadius && d < nearestDist) {
              nearest = objEl;
              nearestDist = d;
            }
          });

          return nearest;
        },
      });

      // ==============================================================
      // COMPONENT: proximity-haptics
      // Generic and reusable — has no idea what a pistol is. Buzzes
      // this hand's controller whenever the nearest ".grabbable"
      // entity in the scene is within PROXIMITY_HAPTIC_RADIUS. Future
      // interactive props just need class="grabbable" to opt into the
      // same behavior; nothing here needs to change for them.
      //
      // Two things it skips, so it doesn't buzz misleadingly:
      //   - whatever this hand is already holding (its object3D is
      //     currently parented under this hand's grip — true for
      //     anything that follows the same "attach to the grip when
      //     held" convention holsterable.grab() uses)
      //   - everything, if hand-rig (when present) reports this hand
      //     as already full, since you can't grab a second thing
      //     right now anyway
      // ==============================================================
      registerComponent('proximity-haptics', {
        init: function () {
          this.handPos = new THREE.Vector3();
          this.targetPos = new THREE.Vector3();
        },

        tick: function () {
          var handRig = this.el.components['hand-rig'];
          if (handRig && handRig.isFull()) return;

          var trackedControls = this.el.components['tracked-controls'];
          var gamepad = trackedControls && trackedControls.controller;
          var actuator = gamepad && gamepad.hapticActuators && gamepad.hapticActuators[0];
          if (!actuator) return;

          this.el.object3D.getWorldPosition(this.handPos);

          var targets = document.querySelectorAll('.grabbable');
          var inRange = false;

          var grip = gripObjectOf(this.el);
          for (var i = 0; i < targets.length; i++) {
            var targetEl = targets[i];
            if (targetEl.object3D.parent === grip) continue; // already holding this one

            targetEl.object3D.getWorldPosition(this.targetPos);
            if (this.handPos.distanceTo(this.targetPos) < PROXIMITY_HAPTIC_RADIUS) {
              inRange = true;
              break;
            }
          }

          if (inRange) {
            actuator.pulse(PROXIMITY_HAPTIC_INTENSITY, PROXIMITY_HAPTIC_PULSE_MS);
          }
        },
      });

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

      registerComponent('boxy-bottle', {
        schema: {
          glass: { type: 'color', default: '#3f6b3a' },
          label: { type: 'color', default: '#d9c27a' },
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

          addCylinder(0.042, 0.135, -0.155, glass, 0.85); // body
          addCylinder(0.0425, 0.05, -0.16, this.data.label, 1); // paper label
          addCylinder(0.018, 0.075, 0.005, glass, 0.85); // neck

          var shoulder = document.createElement('a-entity');
          shoulder.setAttribute('geometry', {
            primitive: 'cone',
            radiusBottom: 0.042,
            radiusTop: 0.018,
            height: 0.055,
          });
          shoulder.setAttribute('material', 'color: ' + glass + '; opacity: 0.85; transparent: true');
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
      // COMPONENT: pourable
      // Anything with liquid in it, which is now a beer bottle and a
      // water jug. Same relationship to holsterable that firearm has:
      // it reads state, owns a little of its own (capped or not), and
      // knows nothing about hands, slots, or throwing.
      //
      // What the liquid DOES isn't here either — the droplets it emits
      // carry their kind, and the world decides what beer and water
      // mean when they land on you, on the floor, or on a fire. That's
      // why a jug of water needed no new pouring code, only a
      // different word in its markup.
      //
      // Two physical moves, no buttons:
      //   - Knock the CAP against something solid — the edge of the
      //     bar, the floor — and it pops off and spins away. The check
      //     is a crossing of the cap's own collider through a surface
      //     (see findHardSurfaceStrike), not proximity, and it's
      //     suppressed for a moment after a grab; the first version
      //     tested the whole bottle and opened every beer the instant
      //     you picked it up, because the snap-into-hand blend counts
      //     as a fast downward move while the base is still at counter
      //     height.
      //   - Tip an open one past horizontal and it pours, forever, at
      //     a rate set by how far over it is. Drinking isn't a
      //     separate mechanic: the droplets are real particles, and
      //     world-systems swallows any that reach your mouth.
      // ==============================================================
      registerComponent('pourable', {
        schema: {
          liquid: { type: 'string', default: 'beer' }, // 'beer' burns and gets you drunk; 'water' puts fires out
          capped: { type: 'boolean', default: true }, // a jug has no cap to knock off
        },

        init: function () {
          this.capped = this.data.capped;
          this.pourAccumulator = 0; // fractional droplets carried between frames

          this.capEl = this.el.querySelector('.bottle-cap');
          this.spoutEl = this.el.querySelector('.spout');

          this._capWorld = new THREE.Vector3();
          this._prevCapWorld = new THREE.Vector3();
          this._spoutWorld = new THREE.Vector3();
          this._prevSpoutWorld = new THREE.Vector3();
          this._neck = new THREE.Vector3();
          this._quat = new THREE.Quaternion();
          this._vel = new THREE.Vector3();
          this._dropVel = new THREE.Vector3();
          this._jitter = new THREE.Vector3();
          this._hasPrev = false;

          this.onShattered = this.onShattered.bind(this);
          this.el.addEventListener('shattered', this.onShattered);
        },

        remove: function () {
          this.el.removeEventListener('shattered', this.onShattered);
        },

        tick: function (time, dt) {
          var holsterable = this.el.components.holsterable;
          if (!holsterable) return;

          var dtSeconds = Math.min((dt || 16) / 1000, 0.05);
          if (dtSeconds <= 0) return;

          if (this.capped) {
            this.updateCap(holsterable, dtSeconds);
            return;
          }

          // Only pours while it's in play. A bottle you set down or
          // dropped stops, which is a small lie — a tipped-over open
          // bottle really ought to keep spilling — but an unattended
          // one pouring forever would quietly evict every other
          // particle in the shared pool.
          if (holsterable.state === 'held' || holsterable.state === 'dangling' || holsterable.state === 'falling') {
            this.updatePour(holsterable, dtSeconds);
          } else {
            this.pourAccumulator = 0;
            this._hasPrev = false;
          }
        },

        // The trigger is the lid button. A Zippo already worked this
        // way, so a bottle cap and (see hatch) a tank hatch now do too:
        // whatever you're holding, the trigger opens it.
        onTriggerUse: function () {
          if (this.capped) this.popCap();
        },

        updateCap: function (holsterable, dtSeconds) {
          if (!this.capEl) return;

          this.capEl.object3D.getWorldPosition(this._capWorld);
          var hadPrev = this._hasPrev;
          var fallSpeed = hadPrev ? (this._prevCapWorld.y - this._capWorld.y) / dtSeconds : 0;
          var prev = this._prevCapWorld.clone();
          this._prevCapWorld.copy(this._capWorld);
          this._hasPrev = true;

          if (holsterable.state !== 'held') return;
          if (!hadPrev) return;
          // A snap blend is the game moving the bottle, not you
          // swinging it, and it's fast enough to read as a strike.
          if (holsterable._heldElapsed < BOTTLE_STRIKE_GRACE_MS) return;

          if (findHardSurfaceStrike(prev, this._capWorld, fallSpeed, CAP_HITBOX_RADIUS)) this.popCap();
        },

        popCap: function () {
          if (!this.capped) return;
          this.capped = false;
          this._hasPrev = false; // the pour tracks the spout, not the cap — start it clean

          this.capEl.object3D.getWorldPosition(this._capWorld);
          this.capEl.setAttribute('visible', false);

          spawnDebris(this._capWorld, { count: 1, color: '#c9a227', size: 0.03, speed: 3.2, life: 2200 });
          spawnSparks(this._capWorld, 4);
          playClink();
        },

        // Pouring. The neck's world direction is the whole input: at
        // horizontal nothing comes out, and the further past that it
        // tips the faster it runs, up to a full stream when it's
        // straight upside down. Droplets inherit the bottle's own
        // motion, so swinging an open bottle around throws an arc of
        // beer across the room, which is the correct behavior.
        updatePour: function (holsterable, dtSeconds) {
          if (!this.spoutEl) return;

          this.spoutEl.object3D.getWorldPosition(this._spoutWorld);
          if (this._hasPrev) {
            this._vel.copy(this._spoutWorld).sub(this._prevSpoutWorld).divideScalar(dtSeconds);
          } else {
            this._vel.set(0, 0, 0);
          }
          this._prevSpoutWorld.copy(this._spoutWorld);
          this._hasPrev = true;

          // Local +Y runs up the neck; -y of that in world space is
          // how far past horizontal it's tipped.
          this.el.object3D.getWorldQuaternion(this._quat);
          this._neck.set(0, 1, 0).applyQuaternion(this._quat);

          var tilt = -this._neck.y;
          if (tilt <= POUR_TILT_START) {
            this.pourAccumulator = 0;
            return;
          }

          var rate = POUR_RATE_MAX * Math.min((tilt - POUR_TILT_START) / (1 - POUR_TILT_START), 1);
          this.pourAccumulator += rate * dtSeconds;

          var count = Math.floor(this.pourAccumulator);
          this.pourAccumulator -= count;

          for (var k = 0; k < count; k++) {
            this._dropVel
              .copy(this._vel)
              .addScaledVector(this._neck, POUR_SPEED)
              .add(this._jitter.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.05));

            // Several droplets in one frame were all emitted at
            // different moments during it, so they're advanced along
            // their own paths by however long ago that was. Without
            // this they stack up at the spout and a long frame turns
            // the stream into a string of blobs.
            var age = count > 1 ? (dtSeconds * k) / count : 0;
            this._jitter.copy(this._spoutWorld).addScaledVector(this._dropVel, age);
            this._jitter.y -= 0.5 * GRAVITY * age * age;
            spawnDroplet(this._jitter, this._dropVel, this.data.liquid);
          }
        },

        // A smashed bottle doesn't just make glass: it puts its
        // contents on the floor. That's the missing half of the
        // Molotov — throw a beer into a lit puddle and the spill it
        // leaves is already touching flame.
        onShattered: function (evt) {
          var point = (evt.detail && evt.detail.point) || this._spoutWorld;
          spillPuddle(point, this.data.liquid, POOL_SPILL_RADIUS);
        },

        // Called by breakable when a shattered bottle comes back as a
        // fresh one — a respawned beer is a capped beer.
        recap: function () {
          this.capped = this.data.capped;
          if (this.capEl) this.capEl.setAttribute('visible', true);
          this._hasPrev = false;
        },
      });

      // ==============================================================
      // COMPONENT: breakable
      // Generic "this comes apart when something hits it hard enough."
      // It listens for the same "shot" event a scoring ring does, plus
      // the "landed" event holsterable emits when something it was
      // simulating hits the ground — so a bottle you shoot out of the
      // air and a bottle you simply throw at the floor both shatter,
      // through two completely different code paths that neither know
      // about bottles.
      //
      // Nothing is destroyed permanently: the entity hides, stops
      // being grabbable/shootable, and comes back on its home slot
      // after respawnMs, the same way a knocked-down target stands
      // back up. That's what keeps the bar stocked while you work
      // through it.
      //
      // autoShatter:false turns off both event triggers and leaves
      // only the explicit shatter() call, which is how a cigar reuses
      // the whole hide/respawn/pop-back-in cycle for burning down to a
      // stub without also exploding every time you shoot it or drop
      // it — it has its own opinions about both of those.
      // ==============================================================
      registerComponent('breakable', {
        schema: {
          color: { type: 'color', default: '#3f6b3a' },
          shards: { type: 'number', default: SHARD_COUNT },
          respawnMs: { type: 'number', default: BOTTLE_RESPAWN_MS },
          score: { type: 'number', default: 25 },
          label: { type: 'string', default: 'BOTTLE' },
          impactSpeed: { type: 'number', default: 3.5 }, // m/s of landing that counts as "dropped hard enough"
          autoShatter: { type: 'boolean', default: true },
          sound: { type: 'boolean', default: true },
        },

        init: function () {
          this.broken = false;
          this.respawnTimer = 0;
          this.popTimer = 0;
          this._world = new THREE.Vector3();

          this.onShot = this.onShot.bind(this);
          this.onLanded = this.onLanded.bind(this);
          this.el.addEventListener('shot', this.onShot);
          this.el.addEventListener('click', this.onShot);
          this.el.addEventListener('landed', this.onLanded);
          // Hitting something on the way down is the same event as
          // hitting the floor, as far as glass is concerned — which is
          // what makes a bottle hurled at a target smash against it
          // instead of sailing through and breaking on the ground
          // behind.
          this.el.addEventListener('impact', this.onLanded);
        },

        remove: function () {
          this.el.removeEventListener('shot', this.onShot);
          this.el.removeEventListener('click', this.onShot);
          this.el.removeEventListener('landed', this.onLanded);
          this.el.removeEventListener('impact', this.onLanded);
        },

        onShot: function () {
          if (this.data.autoShatter) this.shatter(true);
        },

        onLanded: function (evt) {
          if (!this.data.autoShatter) return;
          if (evt.detail && evt.detail.speed >= this.data.impactSpeed) this.shatter(false);
        },

        tick: function (time, dt) {
          if (this.popTimer > 0) {
            this.popTimer = Math.max(this.popTimer - (dt || 16), 0);
            var t = 1 - this.popTimer / 260;
            this.el.object3D.scale.setScalar(0.35 + 0.65 * t * (2 - t)); // ease-out toward full size
            return;
          }

          if (!this.broken) return;
          this.respawnTimer -= dt || 16;
          if (this.respawnTimer <= 0) this.respawn();
        },

        shatter: function (scored) {
          if (this.broken) return;
          this.broken = true;
          this.respawnTimer = this.data.respawnMs;

          this.el.object3D.getWorldPosition(this._world);
          spawnDebris(this._world, { count: this.data.shards, color: this.data.color, size: SHARD_SIZE });
          spawnDebris(this._world, { count: 4, color: '#e8e4d8', size: SHARD_SIZE * 0.7, speed: SHARD_SPEED * 1.3 });
          if (this.data.sound) playSmash();

          var holsterable = this.el.components.holsterable;
          if (holsterable) {
            // Prised out of whatever was holding it, without going
            // through a normal release — a bottle that explodes in
            // your fist doesn't get holstered or thrown.
            if (holsterable.hand) {
              var handRig = holsterable.hand.components['hand-rig'];
              if (handRig) handRig.forget(this.el);
            }
            holsterable.vacateSlot();
            holsterable.hand = null;
            holsterable.state = 'broken';
            holsterable.angularVelocity.set(0, 0, 0);
            holsterable.fallVelocity.set(0, 0, 0);
            this.el.sceneEl.object3D.attach(this.el.object3D);
          }

          this.el.object3D.visible = false;
          this.el.classList.remove('shootable');
          this.el.classList.remove('grabbable');

          // Announced rather than acted on, the same way holsterable
          // emits "landed": breakable has no idea some things are full
          // of liquid.
          this.el.emit('shattered', { point: this._world.clone() }, false);

          if (scored) {
            var manager = document.querySelector('#range-manager');
            if (manager) {
              manager.emit('ring-hit', { score: this.data.score, label: this.data.label }, false);
            }
          }
        },

        respawn: function () {
          var holsterable = this.el.components.holsterable;
          var homeSlot = holsterable && holsterable.data.holsterSelector;
          var slotComp = homeSlot && homeSlot.components['anchor-slot'];

          // Somebody parked something else in its spot; wait it out
          // rather than double-stacking or popping in mid-air.
          if (slotComp && slotComp.isFull()) {
            this.respawnTimer = this.data.respawnMs;
            return;
          }

          this.broken = false;
          this.el.classList.add('shootable');
          this.el.classList.add('grabbable');
          this.el.object3D.visible = true;

          var pourable = this.el.components.pourable;
          if (pourable) pourable.recap();
          var burnable = this.el.components.burnable;
          if (burnable) burnable.restore();

          if (holsterable && homeSlot) {
            holsterable.state = 'holstered';
            // Placed instantly first, so the blend inside occupySlot
            // starts from the shelf instead of from wherever this
            // bottle happened to be standing when it was shot.
            holsterable.attachTo(homeSlot.object3D, holsterable.data.holsterPosition, holsterable.data.holsterRotation);
            holsterable.occupySlot(homeSlot);
          } else if (holsterable) {
            // Nothing declared a home for it — leave it where it broke,
            // as an ordinary pick-up-off-the-ground object.
            holsterable.state = 'resting';
          }

          this.popTimer = 260;
          this.el.object3D.scale.setScalar(0.35);
        },
      });

      // ==============================================================
      // COMPONENT: ignition-source / lightable
      // The smallest possible "one thing can set another thing on
      // fire" contract, deliberately split from anything that knows
      // what a cigar is. A source publishes a tip position and a
      // public `hot` flag that its owning component sets (a firearm
      // from barrel heat, a cigar from being lit); a lightable
      // publishes a tip position and fires an "ignite" event when a
      // hot tip touches it. world-systems does the matching.
      //
      // The payoff is that the ways to light a cigar were never
      // enumerated anywhere: off another lit cigar, off the barrel of
      // a gun you just emptied, or by shooting it (cigar's own "shot"
      // handler just calls ignite). Adding a lantern or a stick of
      // dynamite is two attributes.
      // ==============================================================
      registerComponent('ignition-source', {
        schema: {
          tipSelector: { type: 'string', default: '' }, // empty = the entity's own origin
        },

        init: function () {
          this.hot = false;
        },

        tipObject: function () {
          if (!this.data.tipSelector) return this.el.object3D;
          var tip = this.el.querySelector(this.data.tipSelector);
          return tip ? tip.object3D : this.el.object3D;
        },
      });

      registerComponent('lightable', {
        schema: {
          tipSelector: { type: 'string', default: '' },
        },

        init: function () {
          this.lit = false;
          // A public veto another component can raise: a Zippo with
          // the lid shut shouldn't catch light off a passing cigar.
          this.blocked = false;
        },

        tipObject: function () {
          if (!this.data.tipSelector) return this.el.object3D;
          var tip = this.el.querySelector(this.data.tipSelector);
          return tip ? tip.object3D : this.el.object3D;
        },

        ignite: function () {
          if (this.lit || this.blocked) return;
          this.lit = true;
          this.el.emit('ignite', null, false);
        },

        extinguish: function () {
          if (!this.lit) return;
          this.lit = false;
          this.el.emit('extinguish', null, false);
        },
      });

      // ==============================================================
      // COMPONENT: boxy-cigar / boxy-match
      // Both are a stick that burns from the far end, so both are the
      // same shape of thing: long axis along local -Z (the same
      // convention as a gun barrel), origin at the end you hold, and a
      // layout(length, ashLength) the burnable component drives as
      // they're consumed. Putting the origin at the held end is what
      // makes "cigar in the mouth slot" and "pistol in the mouth slot"
      // the same operation.
      //
      // These are the only visual builders that don't just build and
      // forget, because these are the only objects that change shape.
      // The split still holds: burnable decides how long and how ashy,
      // these decide what that looks like.
      // ==============================================================
      var CIGAR_LENGTH = 0.13;
      var MATCH_LENGTH = 0.075;

      // Shared by both, since "a coloured stick with a burnt tip and a
      // glowing end" is the whole of it.
      function buildBurnStick(el, options) {
        var parts = {};

        function stick(radius, color) {
          var c = document.createElement('a-cylinder');
          c.setAttribute('radius', radius);
          c.setAttribute('height', options.length);
          c.setAttribute('color', color);
          c.setAttribute('rotation', '90 0 0'); // stand the cylinder's axis up along Z
          el.appendChild(c);
          return c;
        }

        parts.body = stick(options.radius, options.bodyColor);
        parts.ash = stick(options.radius * 1.02, options.ashColor);

        parts.ember = document.createElement('a-sphere');
        parts.ember.setAttribute('radius', options.radius * 1.05);
        parts.ember.setAttribute('material', 'color: ' + options.headColor + '; shader: flat');
        parts.ember.classList.add('ember');
        el.appendChild(parts.ember);

        parts.hitbox = createHitbox(0.045, options.length + 0.04, { x: 0, y: 0, z: 0 }, '90 0 0');
        el.appendChild(parts.hitbox);

        parts.fullLength = options.length;
        parts.headColor = options.headColor;
        parts.litColor = options.litColor;
        return parts;
      }

      // `length` is how much is left, `ashLength` how much of that tip
      // has burnt. The ash sits at the far end, the ember rides the
      // very tip, and the unburnt body fills the rest.
      function layoutBurnStick(parts, length, ashLength) {
        ashLength = Math.min(ashLength, length);
        var solid = length - ashLength;

        parts.body.object3D.scale.y = Math.max(solid / parts.fullLength, 0.0001);
        parts.body.object3D.position.set(0, 0, -solid / 2);
        parts.body.setAttribute('visible', solid > 0.001);

        parts.ash.object3D.scale.y = Math.max(ashLength / parts.fullLength, 0.0001);
        parts.ash.object3D.position.set(0, 0, -(solid + ashLength / 2));
        parts.ash.setAttribute('visible', ashLength > 0.001);

        parts.ember.object3D.position.set(0, 0, -length);
        parts.hitbox.object3D.scale.y = (length + 0.04) / (parts.fullLength + 0.04);
        parts.hitbox.object3D.position.set(0, 0, -length / 2);
      }

      registerComponent('boxy-cigar', {
        init: function () {
          this.parts = buildBurnStick(this.el, {
            length: CIGAR_LENGTH,
            radius: 0.011,
            bodyColor: '#5a3a1e',
            ashColor: '#9c968c',
            headColor: '#2a1a10',
            litColor: '#ff7a1a',
          });

          var band = document.createElement('a-cylinder');
          band.setAttribute('radius', 0.0118);
          band.setAttribute('height', 0.018);
          band.setAttribute('color', '#b8892f');
          band.setAttribute('rotation', '90 0 0');
          band.setAttribute('position', { x: 0, y: 0, z: -0.03 });
          this.el.appendChild(band);

          this.layout(CIGAR_LENGTH, 0);
        },

        layout: function (length, ashLength) {
          layoutBurnStick(this.parts, length, ashLength);
        },

        setEmber: function (lit) {
          this.parts.ember.setAttribute(
            'material',
            'color: ' + (lit ? this.parts.litColor : this.parts.headColor) + '; shader: flat'
          );
        },
      });

      // A match: shorter, thinner, and with a red head that's visible
      // before it's lit — which matters, because the head is the bit
      // you have to strike against something.
      registerComponent('boxy-match', {
        init: function () {
          this.parts = buildBurnStick(this.el, {
            length: MATCH_LENGTH,
            radius: 0.004,
            bodyColor: '#d8c9a4',
            ashColor: '#3a3229',
            headColor: '#b8321f',
            litColor: '#ffb02a',
          });

          // The head's own collider, the same trick a bottle cap uses:
          // striking THIS against something is what lights it, rather
          // than waving the match near a surface.
          var head = document.createElement('a-sphere');
          head.setAttribute('radius', MATCH_HEAD_RADIUS);
          head.setAttribute('material', 'opacity: 0; transparent: true; depthWrite: false');
          head.classList.add('match-head');
          head.setAttribute('position', { x: 0, y: 0, z: -MATCH_LENGTH });
          this.el.appendChild(head);

          this.layout(MATCH_LENGTH, 0);
        },

        layout: function (length, ashLength) {
          layoutBurnStick(this.parts, length, ashLength);
        },

        setEmber: function (lit) {
          this.parts.ember.setAttribute(
            'material',
            'color: ' + (lit ? this.parts.litColor : this.parts.headColor) + '; shader: flat'
          );
        },
      });

      // ==============================================================
      // COMPONENT: burnable
      // Anything that's consumed by being on fire. Owns how much is
      // left and how much of the tip has turned to ash; drives a
      // co-located visual component's layout(); and hands the object
      // over to breakable's hide-and-come-back-later cycle when
      // there's nothing left, rather than reimplementing that.
      //
      // Ash comes off two ways, both of them "you shook it":
      //   - a sharp flick of the wrist (see createFlickDetector), or
      //   - twirling it off your trigger finger, where the tip is
      //     whipping round fast enough that ash has no business
      //     staying on.
      // The second one exists because twirling a cigar is the single
      // most obvious thing to try and it did nothing — a spin has no
      // velocity reversal for a flick detector to notice, so it needs
      // asking about directly.
      //
      // burnMultiplier is a public field other components set: the
      // cigar cranks it while you're drawing on one.
      // ==============================================================
      registerComponent('burnable', {
        schema: {
          visual: { type: 'string', default: '' }, // co-located component exposing layout()/setEmber()
          length: { type: 'number', default: CIGAR_LENGTH },
          ashRate: { type: 'number', default: CIGAR_ASH_RATE }, // meters of tip per second
          minLength: { type: 'number', default: CIGAR_MIN_LENGTH },
          ashColor: { type: 'color', default: '#9c968c' },
          shakeSpeed: { type: 'number', default: CIGAR_SHAKE_SPEED },
          twirlRate: { type: 'number', default: CIGAR_TWIRL_ASH_RATE }, // rad/s of dangle spin that flings ash off
        },

        init: function () {
          this.length = this.data.length;
          this.ash = 0;
          this.burnMultiplier = 1;

          this.emberEl = this.el.querySelector('.ember');
          this._tip = new THREE.Vector3();
          this.flick = createFlickDetector(this.data.shakeSpeed, CIGAR_SHAKE_REVERSAL);

          this.onIgnite = this.onIgnite.bind(this);
          this.onExtinguish = this.onExtinguish.bind(this);
          this.el.addEventListener('ignite', this.onIgnite);
          this.el.addEventListener('extinguish', this.onExtinguish);
        },

        remove: function () {
          this.el.removeEventListener('ignite', this.onIgnite);
          this.el.removeEventListener('extinguish', this.onExtinguish);
        },

        isLit: function () {
          var lightable = this.el.components.lightable;
          return !!(lightable && lightable.lit);
        },

        onIgnite: function () {
          this.setEmber(true);
          this.tipWorldPosition(this._tip);
          spawnSparks(this._tip, 6);
        },

        onExtinguish: function () {
          this.setEmber(false);
        },

        tick: function (time, dt) {
          var dtSeconds = Math.min((dt || 16) / 1000, 0.05);
          var lit = this.isLit();

          var source = this.el.components['ignition-source'];
          if (source) source.hot = lit;

          this.checkShake(dtSeconds);
          if (!lit) return;

          // Sitting in a flame burns it down far faster than smoking
          // it does. Asked of the fire list directly rather than
          // routed through ignition, since this is about being IN a
          // fire rather than being lit by one.
          this.tipWorldPosition(this._tip);
          var inFire = nearestFire(this._tip, FIRE_ASH_RADIUS) ? FIRE_ASH_MULTIPLIER : 1;

          var rate = this.data.ashRate * this.burnMultiplier * inFire;
          this.ash = Math.min(this.ash + rate * dtSeconds, this.length);
          this.applyLayout();

          // Never tapped, so it burnt all the way down. Note this is
          // the slow way to lose one — knocking the ash off is what
          // actually shortens it.
          if (this.length - this.ash <= 0.003) this.burnOut();
        },

        checkShake: function (dtSeconds) {
          if (this.ash <= 0.0005) {
            this.tipWorldPosition(this._tip);
            this.flick.update(this._tip, dtSeconds);
            return;
          }

          var holsterable = this.el.components.holsterable;
          if (
            holsterable &&
            holsterable.state === 'dangling' &&
            holsterable.angularVelocity.length() > this.data.twirlRate
          ) {
            this.dropAsh();
            return;
          }

          this.tipWorldPosition(this._tip);
          if (this.flick.update(this._tip, dtSeconds)) this.dropAsh();
        },

        // The ash breaks off and it's that much shorter for good.
        dropAsh: function () {
          var lost = this.ash;
          this.ash = 0;
          this.length = Math.max(this.length - lost, 0);

          this.tipWorldPosition(this._tip);
          spawnDebris(this._tip, {
            count: 5,
            color: this.data.ashColor,
            size: 0.012,
            speed: 0.9,
            life: 1400,
          });

          if (this.length <= this.data.minLength) this.burnOut();
          else this.applyLayout();
        },

        // Nothing left. Goes through breakable's hide/respawn cycle
        // rather than reimplementing it — see that component's
        // autoShatter note.
        burnOut: function () {
          var lightable = this.el.components.lightable;
          if (lightable) lightable.extinguish();
          this.setEmber(false);
          this.el.emit('burnt-out', null, false);

          var holsterable = this.el.components.holsterable;
          if (holsterable) {
            if (holsterable.hand) {
              var handRig = holsterable.hand.components['hand-rig'];
              if (handRig) handRig.forget(this.el);
            }
            holsterable.vacateSlot();
          }

          var breakable = this.el.components.breakable;
          if (breakable) breakable.shatter(false);
        },

        // Called by breakable when a burnt-out one comes back: fresh,
        // full length, unlit.
        restore: function () {
          this.length = this.data.length;
          this.ash = 0;
          this.burnMultiplier = 1;
          this.flick.reset();
          this.setEmber(false);
          this.applyLayout();
        },

        applyLayout: function () {
          var visual = this.data.visual && this.el.components[this.data.visual];
          if (visual) visual.layout(this.length, this.ash);
        },

        setEmber: function (lit) {
          var visual = this.data.visual && this.el.components[this.data.visual];
          if (visual) visual.setEmber(lit);
        },

        tipWorldPosition: function (out) {
          if (this.emberEl) this.emberEl.object3D.getWorldPosition(out);
          else this.el.object3D.getWorldPosition(out);
          return out;
        },
      });

      // ==============================================================
      // COMPONENT: cigar
      // Everything about a cigar that isn't just "it burns," which is
      // burnable's job now. What's left is your mouth:
      //
      //   - one lit in your mouth trickles nicotine in;
      //   - holding the tip AT your mouth is a proper draw, which
      //     climbs several times faster, cranks burnable's rate, and
      //     stops any smoke coming off it, because you're taking it
      //     in. Pull it away and you exhale the whole banked cloud.
      //
      // Shooting a cigar is handled here rather than by breakable — an
      // unlit one catches light (that is the intended way to do it,
      // and yes, it means pointing a loaded pistol at your own face),
      // and a lit one gets knocked clean out of your teeth.
      // ==============================================================
      registerComponent('cigar', {
        init: function () {
          this.puffTimer = 0;
          this.bankedSmoke = 0; // puffs suppressed while inhaling, released on the exhale
          this.inhaling = false;

          this.mouthEl = document.querySelector('#mouth-anchor');
          this._tip = new THREE.Vector3();
          this._mouthPos = new THREE.Vector3();
          this._forward = new THREE.Vector3();
          this._quat = new THREE.Quaternion();

          this.onShot = this.onShot.bind(this);
          this.el.addEventListener('shot', this.onShot);
          this.el.addEventListener('click', this.onShot);
        },

        remove: function () {
          this.el.removeEventListener('shot', this.onShot);
          this.el.removeEventListener('click', this.onShot);
        },

        burnable: function () {
          return this.el.components.burnable;
        },

        isLit: function () {
          var burnable = this.burnable();
          return !!(burnable && burnable.isLit());
        },

        // A lit cigar shot out of your mouth: it goes out, leaves your
        // teeth, and tumbles away — which, since it's an ordinary
        // holsterable, means it's catchable on the way down.
        onShot: function () {
          var lightable = this.el.components.lightable;
          if (!lightable) return;

          if (!lightable.lit) {
            lightable.ignite();
            return;
          }

          lightable.extinguish();
          this.releaseBankedSmoke();
          this.inhaling = false;

          var holsterable = this.el.components.holsterable;
          if (holsterable && holsterable.state !== 'falling') {
            if (holsterable.hand) {
              var handRig = holsterable.hand.components['hand-rig'];
              if (handRig) handRig.forget(this.el);
            }
            holsterable.vacateSlot();
            holsterable.startFalling();
            holsterable.fallVelocity.set((Math.random() - 0.5) * 1.5, 1.2, (Math.random() - 0.5) * 1.5);
            holsterable.angularVelocity.set(Math.random() * 8, Math.random() * 8, 0);
          }

          var burnable = this.burnable();
          if (burnable) {
            burnable.tipWorldPosition(this._tip);
            spawnSparks(this._tip, 10);
          }
        },

        tick: function (time, dt) {
          var dtSeconds = Math.min((dt || 16) / 1000, 0.05);
          var burnable = this.burnable();
          if (!burnable) return;

          if (!burnable.isLit()) {
            this.releaseBankedSmoke();
            this.inhaling = false;
            burnable.burnMultiplier = 1;
            return;
          }

          this.updateDraw(burnable, dtSeconds);
          this.updateSmoke(burnable, dtSeconds);
        },

        // Is the tip at your mouth? That's a draw: nicotine much
        // faster, ash much faster, and the smoke goes into you instead
        // of into the room.
        updateDraw: function (burnable, dtSeconds) {
          var holsterable = this.el.components.holsterable;
          var inMouth = holsterable && holsterable.currentSlotEl === this.mouthEl;
          var wasInhaling = this.inhaling;
          this.inhaling = false;

          if (holsterable && holsterable.state === 'held' && this.mouthEl) {
            this.mouthEl.object3D.getWorldPosition(this._mouthPos);
            burnable.tipWorldPosition(this._tip);
            this.inhaling = this._tip.distanceTo(this._mouthPos) < CIGAR_INHALE_RADIUS;
          }

          burnable.burnMultiplier = this.inhaling ? CIGAR_ASH_INHALE_MULTIPLIER : 1;

          if (this.inhaling) addNicotine(NICOTINE_PER_INHALE * dtSeconds);
          else if (inMouth) addNicotine(NICOTINE_PER_CIGAR_PASSIVE * dtSeconds);

          if (wasInhaling && !this.inhaling) this.releaseBankedSmoke();
        },

        updateSmoke: function (burnable, dtSeconds) {
          this.puffTimer -= dtSeconds * 1000;
          if (this.puffTimer > 0) return;
          this.puffTimer = CIGAR_PUFF_INTERVAL_MS * (0.7 + Math.random() * 0.6);

          // Drawing on it means the smoke goes in, not out — banked
          // for the exhale when you take it away from your mouth.
          if (this.inhaling) {
            this.bankedSmoke = Math.min(this.bankedSmoke + 2, CIGAR_EXHALE_MAX_PUFFS);
            return;
          }

          burnable.tipWorldPosition(this._tip);
          spawnSmoke(this._tip, null, 0.5);
        },

        // Everything you drew in, back out at once, from your mouth
        // rather than from the cigar.
        releaseBankedSmoke: function () {
          if (!this.bankedSmoke || !this.mouthEl) {
            this.bankedSmoke = 0;
            return;
          }

          this.mouthEl.object3D.getWorldPosition(this._mouthPos);
          this.mouthEl.object3D.getWorldQuaternion(this._quat);
          this._forward.set(0, 0, -1).applyQuaternion(this._quat);

          for (var i = 0; i < this.bankedSmoke; i++) {
            spawnSmoke(this._mouthPos, this._forward.clone().multiplyScalar(0.9 + Math.random() * 0.5), 0.85);
          }
          this.bankedSmoke = 0;
        },
      });

      // ==============================================================
      // COMPONENT: match
      // A match is a burnable you light by striking, using exactly the
      // machinery a bottle cap uses to come off: its head carries a
      // small collider, and driving THAT down through a hard surface
      // is what does it (see findHardSurfaceStrike). Everything after
      // the strike — burning down, ash, going out, coming back in the
      // box — is burnable's, and being a fire source at all is
      // ignition-source's. There is nothing else to a match.
      // ==============================================================
      registerComponent('match', {
        init: function () {
          this.headEl = this.el.querySelector('.match-head');
          this._head = new THREE.Vector3();
          this._prevHead = new THREE.Vector3();
          this._lastHead = new THREE.Vector3(); // where the head was last frame, kept while _prevHead advances
          this._hasPrev = false;

          this.onShot = this.onShot.bind(this);
          this.el.addEventListener('shot', this.onShot);
          this.el.addEventListener('click', this.onShot);
        },

        remove: function () {
          this.el.removeEventListener('shot', this.onShot);
          this.el.removeEventListener('click', this.onShot);
        },

        onShot: function () {
          var lightable = this.el.components.lightable;
          if (lightable) lightable.ignite();
        },

        tick: function (time, dt) {
          if (!this.headEl) return;

          var lightable = this.el.components.lightable;
          var holsterable = this.el.components.holsterable;
          if (!lightable || !holsterable) return;

          var dtSeconds = Math.min((dt || 16) / 1000, 0.05);
          if (dtSeconds <= 0) return;

          this.headEl.object3D.getWorldPosition(this._head);
          var hadPrev = this._hasPrev;
          var speed = hadPrev ? (this._prevHead.y - this._head.y) / dtSeconds : 0;
          this._lastHead.copy(this._prevHead);
          this._prevHead.copy(this._head);
          this._hasPrev = true;

          if (lightable.lit) return;
          if (!hadPrev || holsterable.state !== 'held') return;
          // A snap blend is the game moving the match, not you
          // striking it, and it's fast enough to read as a strike.
          if (holsterable._heldElapsed < BOTTLE_STRIKE_GRACE_MS) return;

          if (findHardSurfaceStrike(this._lastHead, this._head, speed, MATCH_HEAD_RADIUS)) {
            lightable.ignite();
            spawnSparks(this._head, 10);
            playClink();
          }
        },
      });


      // ==============================================================
      // COMPONENT: boxy-bow
      // Two limbs, a grip, a string, and a nock. Same axis convention
      // as the guns — the entity origin is where your fist closes and
      // -Z is where the thing you loosed goes — so the bow holsters,
      // dangles, twirls and is caught by exactly the code that does
      // that for a pistol.
      //
      // The string and the nock are children, and the nock is an
      // ordinary anchor-slot, which is the entire reason a bow can
      // fire a beer bottle.
      // ==============================================================
      registerComponent('boxy-bow', {
        init: function () {
          var el = this.el;
          var wood = '#6b4a24';

          function limb(sign) {
            // Two segments per limb, the outer one angled forward, so
            // the silhouette curves instead of being a plank.
            var inner = document.createElement('a-box');
            inner.setAttribute('width', 0.028);
            inner.setAttribute('height', BOW_LIMB_LENGTH * 0.55);
            inner.setAttribute('depth', 0.022);
            inner.setAttribute('position', { x: 0, y: sign * BOW_LIMB_LENGTH * 0.28, z: 0 });
            inner.setAttribute('color', wood);
            el.appendChild(inner);

            var outer = document.createElement('a-box');
            outer.setAttribute('width', 0.022);
            outer.setAttribute('height', BOW_LIMB_LENGTH * 0.5);
            outer.setAttribute('depth', 0.018);
            outer.setAttribute('position', { x: 0, y: sign * BOW_LIMB_LENGTH * 0.76, z: -0.055 });
            outer.setAttribute('rotation', { x: sign * 24, y: 0, z: 0 });
            outer.setAttribute('color', wood);
            el.appendChild(outer);
          }

          limb(1);
          limb(-1);

          var grip = document.createElement('a-box');
          grip.setAttribute('width', 0.038);
          grip.setAttribute('height', 0.13);
          grip.setAttribute('depth', 0.04);
          grip.setAttribute('color', '#4a3218');
          el.appendChild(grip);

          // One string, drawn as two segments meeting at the nock, so
          // pulling it back makes the V a real bow makes.
          this.upper = this.addString(1);
          this.lower = this.addString(-1);

          this.nockEl = document.createElement('a-entity');
          this.nockEl.classList.add('anchor-slot');
          // Three arrows stack UP THE STRING (the slot's own y) rather
          // than across, because that's the only place a bowstring has
          // room for them, and they splay in yaw so a volley leaves as
          // a fan instead of as one arrow drawn three times.
          this.nockEl.setAttribute('anchor-slot', {
            size: 'small',
            capacity: ARROW_STACK,
            fanAxis: 'y',
            fanSpread: 0.075,
            fanYaw: ARROW_FAN_DEG,
          });
          this.nockEl.setAttribute('position', { x: 0, y: 0, z: BOW_STRING_REST_Z });
          el.appendChild(this.nockEl);

          this.setDraw(0);
        },

        addString: function (sign) {
          var seg = document.createElement('a-box');
          seg.setAttribute('width', 0.006);
          seg.setAttribute('height', 1);
          seg.setAttribute('depth', 0.006);
          seg.setAttribute('color', '#d8cfae');
          this.el.appendChild(seg);
          seg.sign = sign;
          return seg;
        },

        // Lays the string out for a given draw, and takes the nock
        // (and therefore anything sitting in it) with it.
        setDraw: function (draw) {
          var tipY = BOW_LIMB_LENGTH * 0.95;
          var tipZ = -0.04;
          var nockZ = BOW_STRING_REST_Z + draw;

          this.nockEl.object3D.position.z = nockZ;

          [this.upper, this.lower].forEach(function (seg) {
            var dy = seg.sign * tipY;
            var dz = tipZ - nockZ;
            var length = Math.sqrt(dy * dy + dz * dz);
            seg.object3D.scale.y = length;
            seg.object3D.position.set(0, dy / 2, nockZ + dz / 2);
            seg.object3D.rotation.set(Math.atan2(dz, dy) * seg.sign, 0, 0);
          });
        },
      });

      // ==============================================================
      // COMPONENT: bow
      // The behaviour half, and it's smaller than the geometry. Every
      // hard part already existed: the second hand is holsterable's
      // support grip, the draw is how far that hand has gone, and the
      // shot is the ordinary throw with a velocity worked out by
      // solveArcAtSpeed.
      //
      // It looses whatever is in the nock without looking at it. Three
      // arrows leave as three arrows; a bottle leaves as a bottle and
      // smashes into whatever it reaches, because a thrown thing is
      // already a slow bullet (see PROJECTILES). A lit stick of
      // dynamite leaves as a problem you have made for someone else.
      // ==============================================================
      registerComponent('bow', {
        init: function () {
          this.draw = 0;
          this._from = new THREE.Vector3();
          this._velocity = new THREE.Vector3();
          this._solved = new THREE.Vector3();
          this._aim = new THREE.Vector3();
          this._quat = new THREE.Quaternion();

          this.onSupportReleased = this.onSupportReleased.bind(this);
          this.el.addEventListener('support-released', this.onSupportReleased);
        },

        remove: function () {
          this.el.removeEventListener('support-released', this.onSupportReleased);
        },

        visual: function () {
          return this.el.components['boxy-bow'];
        },

        nock: function () {
          var visual = this.visual();
          return visual && visual.nockEl;
        },

        tick: function () {
          var holsterable = this.el.components.holsterable;
          var visual = this.visual();
          if (!holsterable || !visual) return;

          var draw = holsterable.supportHand
            ? Math.min(Math.max(holsterable.supportDraw() - BOW_REST_DRAW, 0), BOW_MAX_DRAW - BOW_REST_DRAW)
            : 0;

          if (Math.abs(draw - this.draw) > 0.001) {
            this.draw = draw;
            visual.setDraw(draw);
          }
        },

        onSupportReleased: function (evt) {
          var pulled = (evt.detail && evt.detail.draw) || 0;
          var visual = this.visual();
          if (visual) visual.setDraw(0);
          this.draw = 0;

          if (pulled < BOW_MIN_LOOSE) return; // slipped off your fingers
          this.loose(Math.min((pulled - BOW_REST_DRAW) / (BOW_MAX_DRAW - BOW_REST_DRAW), 1));
        },

        loose: function (power) {
          var nock = this.nock();
          var slot = nock && nock.components['anchor-slot'];
          if (!slot || !slot.occupants.length) {
            playBowstring(power, false);
            return;
          }

          var speed = ARROW_MIN_SPEED + (ARROW_MAX_SPEED - ARROW_MIN_SPEED) * power;
          playBowstring(power, true);

          // Copied, because each one vacating the slot mutates the
          // list this is walking — the same rule the particle loop
          // follows.
          var leaving = slot.occupants.slice();
          for (var i = 0; i < leaving.length; i++) {
            this.launch(leaving[i], speed, i, leaving.length);
          }
        },

        launch: function (holsterable, speed, index, count) {
          // Freshly nocked things can still be carrying last frame's
          // world matrix, and both the arc solve below and the
          // reparent inside throwWithVelocity read it. Loosing an
          // arrow the same frame you nocked it would otherwise fire it
          // from wherever it used to be, which is exactly the sort of
          // bug that only shows up when someone is quick.
          holsterable.el.object3D.updateWorldMatrix(true, false);
          holsterable.el.object3D.getWorldPosition(this._from);

          // Straight out of the bow, before any help.
          this.el.object3D.getWorldQuaternion(this._quat);
          this._aim.set(0, 0, -1).applyQuaternion(this._quat).normalize();
          this._velocity.copy(this._aim).multiplyScalar(speed);

          // And then the help: solve for what you're looking at and
          // lean most of the way toward that answer. See the note on
          // THE BOW for why this cheats on purpose.
          var cameraEl = document.querySelector('#head-camera');
          if (cameraEl) {
            var headPos = new THREE.Vector3();
            cameraEl.object3D.getWorldPosition(headPos);
            var target = findLookTarget(cameraEl, headPos);
            var gravity = GRAVITY * holsterable.data.gravityScale;
            if (target && solveArcAtSpeed(this._from, target, speed, gravity, this._solved)) {
              // Blend the DIRECTIONS and then put the speed back.
              // Lerping two vectors of equal length gives a shorter
              // one, which would quietly rob a full draw of a third of
              // its power the moment the assist had any work to do.
              this._velocity.lerp(this._solved, ARROW_AIM_ASSIST).setLength(speed);
            }
          }

          // A volley leaves fanned by the same angle it was sitting at
          // on the string, so what you saw loaded is what flies. Yawing
          // the velocity rather than nudging it sideways keeps every
          // arrow at the same speed — a sideways nudge made the outer
          // ones fractionally faster and longer-ranged.
          if (count > 1) {
            this._velocity.applyAxisAngle(_worldUp, (fanOffset(index, count, ARROW_FAN_DEG) * Math.PI) / 180);
          }

          // Flagged as a hurl, which is the existing "this is
          // emphatically leaving, stop trying to catch it" signal.
          // Without it the nock catches its own arrow back on the
          // first frame — the bow is a held object with a slot on it,
          // and that is precisely what a held object with a slot on it
          // is supposed to do (see findCatchingSlot).
          var launched = this._velocity.clone();
          launched.isHurl = true;
          holsterable.vacateSlot();
          holsterable.throwWithVelocity(launched);
          // A loosed arrow flies, it doesn't tumble; throwWithVelocity
          // seeds a toss's spin, which is right for a bottle out of
          // your hand and wrong for anything off a string.
          holsterable.angularVelocity.set(0, 0, 0);
        },
      });

      // ==============================================================
      // COMPONENT: boxy-arrow / arrow
      // A shaft, a head and three fletches. The only behaviour it
      // needs beyond holsterable is: point where you're going, publish
      // heat when you're alight, and stop dead when you hit something.
      //
      // Nothing here knows about the bow. An arrow is a small
      // holsterable, so it sits in a quiver, a hip holster, your
      // mouth, or the crown of your hat, and you can throw one by
      // hand — badly, which is the joke.
      // ==============================================================
      registerComponent('boxy-arrow', {
        init: function () {
          var el = this.el;

          var shaft = document.createElement('a-cylinder');
          shaft.setAttribute('radius', 0.006);
          shaft.setAttribute('height', ARROW_LENGTH);
          shaft.setAttribute('color', '#8a6a3a');
          shaft.setAttribute('rotation', '90 0 0');
          shaft.setAttribute('position', { x: 0, y: 0, z: -ARROW_LENGTH / 2 + 0.08 });
          el.appendChild(shaft);

          var head = document.createElement('a-cone');
          head.setAttribute('radius-bottom', 0.016);
          head.setAttribute('radius-top', 0);
          head.setAttribute('height', 0.055);
          head.setAttribute('color', '#3a3f43');
          head.setAttribute('rotation', '-90 0 0');
          head.setAttribute('position', { x: 0, y: 0, z: -ARROW_LENGTH + 0.055 });
          el.appendChild(head);

          for (var i = 0; i < 3; i++) {
            var fletch = document.createElement('a-box');
            fletch.setAttribute('width', 0.002);
            fletch.setAttribute('height', 0.026);
            fletch.setAttribute('depth', 0.07);
            fletch.setAttribute('position', { x: 0, y: 0, z: 0.04 });
            fletch.setAttribute('rotation', { x: 0, y: 0, z: i * 120 });
            fletch.setAttribute('color', i ? '#c4c0b4' : '#a83b2c');
            var pivot = document.createElement('a-entity');
            pivot.setAttribute('rotation', { x: 0, y: 0, z: i * 120 });
            pivot.appendChild(fletch);
            el.appendChild(pivot);
          }

          // The head doubles as the hot tip, so a lit arrow lights
          // whatever it touches through the ordinary contract.
          var ember = document.createElement('a-sphere');
          ember.setAttribute('radius', 0.02);
          ember.setAttribute('material', 'color: #ffb02a; shader: flat; opacity: 0.9');
          ember.setAttribute('position', { x: 0, y: 0, z: -ARROW_LENGTH + 0.02 });
          ember.setAttribute('visible', false);
          ember.classList.add('ember');
          el.appendChild(ember);
          this.ember = ember;
        },
      });

      registerComponent('arrow', {
        init: function () {
          this._dir = new THREE.Vector3();
          this._quat = new THREE.Quaternion();
          this._forward = new THREE.Vector3(0, 0, -1);
          this._world = new THREE.Vector3();

          this.onImpact = this.onImpact.bind(this);
          this.el.addEventListener('impact', this.onImpact);
        },

        remove: function () {
          this.el.removeEventListener('impact', this.onImpact);
        },

        tick: function (time, dt) {
          var lightable = this.el.components.lightable;
          var lit = !!(lightable && lightable.lit);

          var visual = this.el.components['boxy-arrow'];
          if (visual && visual.ember) visual.ember.setAttribute('visible', lit);

          var source = this.el.components['ignition-source'];
          if (source) source.hot = lit;

          if (lit) {
            this.trailTimer = (this.trailTimer || 0) - (dt || 16);
            if (this.trailTimer <= 0) {
              this.trailTimer = 90;
              spawnSmoke(this.el.object3D.getWorldPosition(this._world), null, 0.4);
            }
          }

          // Nose over into the arc. Only while genuinely flying — a
          // dropped arrow tumbles like anything else.
          var holsterable = this.el.components.holsterable;
          if (!holsterable || holsterable.state !== 'falling') return;
          if (holsterable.fallVelocity.lengthSq() < 1) return;

          this._dir.copy(holsterable.fallVelocity).normalize();
          this._quat.setFromUnitVectors(this._forward, this._dir);
          this.el.object3D.quaternion.copy(this._quat);
          holsterable.angularVelocity.set(0, 0, 0);
        },

        // Sticks where it lands. Freezing in place reads as buried in
        // the thing it hit, and a stuck arrow is an ordinary resting
        // object again — pick it back up, or leave it and it'll be
        // gone in half a minute like anything else loose.
        onImpact: function () {
          var holsterable = this.el.components.holsterable;
          if (!holsterable) return;
          holsterable.fallVelocity.set(0, 0, 0);
          holsterable.angularVelocity.set(0, 0, 0);
          holsterable.state = 'resting';
          playThunk();
        },
      });

      // ==============================================================
      // COMPONENT: boxy-tank / boxy-nozzle
      // A pack with a hinged lid, a little window showing what's in it,
      // and a clip on the chest strap for the nozzle. The clip is an
      // ordinary anchor-slot, and where it SITS is the whole reason
      // this rig is usable — see THE TANK AND THE HOSE.
      // ==============================================================
      var _tankSerial = 0;

      registerComponent('boxy-tank', {
        init: function () {
          var el = this.el;
          var steel = '#5a6068';
          var strap = '#3a2f24';

          function box(w, h, d, pos, color, rot, cls) {
            var b = document.createElement('a-box');
            b.setAttribute('width', w);
            b.setAttribute('height', h);
            b.setAttribute('depth', d);
            b.setAttribute('position', pos);
            b.setAttribute('color', color);
            if (rot) b.setAttribute('rotation', rot);
            if (cls) b.classList.add(cls);
            el.appendChild(b);
            return b;
          }

          // The tank is GLASS, and what's in it is a solid block of
          // colour inside it. An indicator stripe on one face was
          // useless in practice: worn, the whole pack is behind you, so
          // whatever tells you what you loaded has to be visible from
          // every angle and from across the room. A see-through tank
          // full of orange is legible at a glance; a gauge is not.
          var glass = document.createElement('a-box');
          glass.setAttribute('width', TANK_WIDTH);
          glass.setAttribute('height', TANK_HEIGHT);
          glass.setAttribute('depth', TANK_DEPTH);
          glass.setAttribute('material', 'color: #b9c6cc; opacity: 0.35; transparent: true; side: double');
          el.appendChild(glass);

          // The contents. Hidden while empty, and coloured by whatever
          // was last poured in.
          var fill = document.createElement('a-box');
          fill.setAttribute('width', TANK_WIDTH - 0.03);
          fill.setAttribute('height', TANK_HEIGHT - 0.05);
          fill.setAttribute('depth', TANK_DEPTH - 0.03);
          fill.setAttribute('material', 'color: #2b2b2f; shader: flat; opacity: 0.85; transparent: true');
          fill.setAttribute('visible', false);
          fill.classList.add('tank-gauge');
          el.appendChild(fill);

          // Bands top and bottom, so it reads as a vessel rather than
          // a floating cube.
          box(TANK_WIDTH + 0.02, 0.03, TANK_DEPTH + 0.02, { x: 0, y: TANK_HEIGHT * 0.42, z: 0 }, '#3f454b');
          box(TANK_WIDTH + 0.02, 0.03, TANK_DEPTH + 0.02, { x: 0, y: -TANK_HEIGHT * 0.42, z: 0 }, '#3f454b');

          // Straps, and the clip on the front one.
          box(0.05, 0.02, 0.5, { x: -0.11, y: TANK_HEIGHT * 0.34, z: -0.25 }, strap, '14 0 0');
          box(0.05, 0.02, 0.5, { x: 0.11, y: TANK_HEIGHT * 0.34, z: -0.25 }, strap, '14 0 0');

          // The filler neck and its lid. The lid hinges at the back of
          // the neck, so it falls shut under the hatch component's own
          // easing rather than snapping.
          var neck = document.createElement('a-cylinder');
          neck.setAttribute('radius', 0.055);
          neck.setAttribute('height', 0.05);
          neck.setAttribute('color', '#3f454b');
          neck.setAttribute('position', { x: 0, y: TANK_HEIGHT / 2 + 0.025, z: 0 });
          el.appendChild(neck);

          var hinge = document.createElement('a-entity');
          hinge.setAttribute('position', { x: 0, y: TANK_HEIGHT / 2 + 0.05, z: 0.055 });
          hinge.classList.add('hatch-lid');
          el.appendChild(hinge);

          var lid = document.createElement('a-cylinder');
          lid.setAttribute('radius', 0.062);
          lid.setAttribute('height', 0.018);
          lid.setAttribute('color', '#6b7078');
          lid.setAttribute('position', { x: 0, y: 0, z: -0.055 });
          hinge.appendChild(lid);

          var mouth = document.createElement('a-entity');
          mouth.setAttribute('position', { x: 0, y: TANK_HEIGHT / 2 + 0.05, z: 0 });
          mouth.classList.add('tank-mouth');
          el.appendChild(mouth);

          var outlet = document.createElement('a-entity');
          outlet.setAttribute('position', { x: 0.1, y: -TANK_HEIGHT / 2 - 0.01, z: -0.04 });
          outlet.classList.add('hose-outlet');
          el.appendChild(outlet);

          // The nozzle's home: down the front strap, at chest height
          // once the pack is on. Reaching here is a different gesture
          // from reaching over your shoulder for the pack itself, which
          // is the entire trick.
          var clip = document.createElement('a-entity');
          clip.setAttribute('id', 'tank-clip-' + _tankSerial++);
          clip.classList.add('anchor-slot');
          clip.setAttribute('anchor-slot', { size: 'small', indicatorScale: 0.8 });
          clip.setAttribute('position', { x: 0.13, y: -0.02, z: -0.42 });
          el.appendChild(clip);
          // The clip brings its own nozzle, and brings another if you
          // manage to lose one. That's a refill rather than a one-off
          // stock because a hose without a nozzle is scrap, not a
          // consequence.
          clip.setAttribute('stocked', { item: 'nozzle' });
        },
      });

      registerComponent('boxy-nozzle', {
        init: function () {
          var el = this.el;

          var body = document.createElement('a-box');
          body.setAttribute('width', 0.04);
          body.setAttribute('height', 0.1);
          body.setAttribute('depth', 0.05);
          body.setAttribute('position', { x: 0, y: -0.04, z: 0.02 });
          body.setAttribute('color', '#3f454b');
          el.appendChild(body);

          var barrel = document.createElement('a-cylinder');
          barrel.setAttribute('radius', 0.017);
          barrel.setAttribute('height', 0.26);
          barrel.setAttribute('color', '#5a6068');
          barrel.setAttribute('rotation', '90 0 0');
          barrel.setAttribute('position', { x: 0, y: 0.01, z: -0.11 });
          el.appendChild(barrel);

          var cone = document.createElement('a-cone');
          cone.setAttribute('radius-bottom', 0.026);
          cone.setAttribute('radius-top', 0.012);
          cone.setAttribute('height', 0.05);
          cone.setAttribute('color', '#8a7a45');
          cone.setAttribute('rotation', '-90 0 0');
          cone.setAttribute('position', { x: 0, y: 0.01, z: -0.25 });
          el.appendChild(cone);

          // The band that says what's loaded, on the thing you're
          // holding when it matters.
          var band = document.createElement('a-cylinder');
          band.setAttribute('radius', 0.024);
          band.setAttribute('height', 0.03);
          band.setAttribute('rotation', '90 0 0');
          band.setAttribute('position', { x: 0, y: 0.01, z: -0.05 });
          band.setAttribute('material', 'color: #2b2b2f; shader: flat');
          band.classList.add('liquid-band');
          el.appendChild(band);

          var tip = document.createElement('a-entity');
          tip.setAttribute('position', { x: 0, y: 0.01, z: -0.275 });
          tip.classList.add('spray-tip');
          el.appendChild(tip);
        },
      });

      // ==============================================================
      // COMPONENT: hatch
      // A lid on a hinge that the trigger opens and that shuts itself
      // again if you wander off. Same idea as the Zippo's lid, made
      // general because a second thing wanted one — and the shared
      // idiom that came out of it is worth stating: THE TRIGGER OPENS
      // WHATEVER YOU ARE HOLDING. A Zippo, a bottle cap, this.
      //
      // It publishes `open` and nothing else. What being open MEANS is
      // entirely the owner's business: for a tank it means liquid can
      // get in.
      // ==============================================================
      registerComponent('hatch', {
        schema: {
          openDeg: { type: 'number', default: HATCH_OPEN_DEG },
          speedDeg: { type: 'number', default: HATCH_SPEED_DEG },
          autoCloseMs: { type: 'number', default: HATCH_AUTOCLOSE_MS },
          lidSelector: { type: 'string', default: '.hatch-lid' },
        },

        init: function () {
          this.open = false;
          this.angle = 0; // degrees, 0 = shut
          this.remaining = 0;
          this.lidEl = this.el.querySelector(this.data.lidSelector);
        },

        onTriggerUse: function () {
          this.toggle();
        },

        toggle: function () {
          this.open = !this.open;
          this.remaining = this.open ? this.data.autoCloseMs : 0;
          playTone({ type: 'square', freq: this.open ? 520 : 300, duration: 0.06, volume: 0.06 });
        },

        tick: function (time, dt) {
          if (this.open && this.data.autoCloseMs > 0) {
            this.remaining -= dt || 16;
            if (this.remaining <= 0) this.toggle();
          }

          var wanted = this.open ? this.data.openDeg : 0;
          if (this.angle === wanted) return;

          var step = (this.data.speedDeg * Math.min((dt || 16) / 1000, 0.05)) * (wanted > this.angle ? 1 : -1);
          this.angle = Math.abs(wanted - this.angle) <= Math.abs(step) ? wanted : this.angle + step;
          if (this.lidEl) this.lidEl.object3D.rotation.x = (this.angle * Math.PI) / 180;
        },
      });

      // ==============================================================
      // COMPONENT: liquid-tank
      // Holds one liquid type, and holds an unlimited amount of it —
      // how much you poured in is not tracked, because the funny part
      // is which liquid, never how much.
      //
      // It fills by having liquid land in it, which means the pour that
      // fills it is the same pour that fills your mouth, and the same
      // droplets. It catches light the same way a puddle does: a
      // flammable liquid with an open lid and something hot nearby
      // becomes fire. Neither of those is tank code so much as a tank
      // standing where the liquid system can see it.
      // ==============================================================
      var OPEN_CONTAINERS = []; // refreshed each frame by world-systems, read by the droplet loop

      registerComponent('liquid-tank', {
        schema: {
          liquid: { type: 'string', default: '' }, // starts empty
          mouthSelector: { type: 'string', default: '.tank-mouth' },
        },

        init: function () {
          this.liquid = this.data.liquid || null;
          this.mouthEl = this.el.querySelector(this.data.mouthSelector);
          this.gaugeEl = this.el.querySelector('.tank-gauge');
          this._mouth = new THREE.Vector3();
          this.applyGauge();
        },

        isOpen: function () {
          var hatch = this.el.components.hatch;
          return !!(hatch && hatch.open);
        },

        mouthWorldPosition: function (out) {
          (this.mouthEl ? this.mouthEl.object3D : this.el.object3D).getWorldPosition(out);
          return out;
        },

        fill: function (type) {
          if (!LIQUIDS[type] || this.liquid === type) return;
          this.liquid = type;
          this.applyGauge();
          playGlug();
        },

        // What's in the tank, shown as what's in the tank. Also
        // repeated on the nozzle you're actually holding, because when
        // the pack is on your back you can't see it and the thing you
        // need to know before pulling the trigger is what's about to
        // come out.
        applyGauge: function () {
          var liquid = this.liquid && LIQUIDS[this.liquid];
          var color = liquid ? liquid.dropColor || liquid.poolColor : '#2b2b2f';

          if (this.gaugeEl) {
            this.gaugeEl.setAttribute('visible', !!liquid);
            this.gaugeEl.setAttribute(
              'material',
              'color: ' + color + '; shader: flat; opacity: 0.85; transparent: true'
            );
          }

          var bands = this.el.querySelectorAll('.liquid-band');
          for (var i = 0; i < bands.length; i++) {
            bands[i].setAttribute('material', 'color: ' + color + '; shader: flat');
          }
        },

        // An open tank of something flammable is a puddle in a box, and
        // it catches from the same hot points a puddle does.
        tick: function () {
          if (!this.isOpen() || !this.liquid) return;
          var liquid = LIQUIDS[this.liquid];
          if (!liquid || !liquid.flammable) return;

          this.mouthWorldPosition(this._mouth);
          for (var i = 0; i < HOT_POINTS.length; i++) {
            if (this._mouth.distanceTo(HOT_POINTS[i].pos) > TANK_MOUTH_RADIUS + IGNITE_RADIUS) continue;
            this.fill('fire');
            spawnSparks(this._mouth, 6);
            return;
          }
        },
      });

      // ==============================================================
      // COMPONENT: nozzle
      // Squeeze the trigger and it sprays whatever the tank has. It
      // does not know what that is and never asks — it hands the type
      // straight to spawnDroplet, and every consequence downstream
      // (pooling, burning, dousing, going down somebody's throat)
      // belongs to the liquid, not to the gun.
      //
      // It also draws the hose, because the hose is a line between two
      // objects and neither of them is a better owner than this one.
      // ==============================================================
      registerComponent('nozzle', {
        init: function () {
          this.tankEl = null;
          this._tip = new THREE.Vector3();
          this._dir = new THREE.Vector3();
          this._quat = new THREE.Quaternion();
          this._vel = new THREE.Vector3();
          this._outlet = new THREE.Vector3();
          this._a = new THREE.Vector3();
          this._b = new THREE.Vector3();
          this.accumulator = 0;

          this.tipEl = this.el.querySelector('.spray-tip');
          this.buildHose();
        },

        remove: function () {
          if (this.hoseEl && this.hoseEl.parentNode) this.hoseEl.parentNode.removeChild(this.hoseEl);
        },

        // The hose lives in the scene rather than on either end, since
        // it belongs to neither once they're apart.
        buildHose: function () {
          this.hoseEl = document.createElement('a-entity');
          this.segments = [];
          for (var i = 0; i < HOSE_SEGMENTS; i++) {
            var seg = document.createElement('a-cylinder');
            seg.setAttribute('radius', 0.014);
            seg.setAttribute('height', 1);
            seg.setAttribute('color', '#2f2a26');
            this.hoseEl.appendChild(seg);
            this.segments.push(seg);
          }
          this.el.sceneEl.appendChild(this.hoseEl);
        },

        // Found once, by walking up from the socket this thing calls
        // home — which is mounted on the tank, so the pack a nozzle
        // belongs to is simply the pack its clip is bolted to.
        tank: function () {
          if (this.tankEl) return this.tankEl.components['liquid-tank'];
          var holsterable = this.el.components.holsterable;
          var home = holsterable && holsterable.data.holsterSelector;
          this.tankEl = home && home.closest && home.closest('[liquid-tank]');
          return this.tankEl ? this.tankEl.components['liquid-tank'] : null;
        },

        tick: function (time, dt) {
          var tank = this.tank();
          if (!tank) return;

          if (this.shownLiquid !== tank.liquid) {
            this.shownLiquid = tank.liquid;
            var liquid = tank.liquid && LIQUIDS[tank.liquid];
            var band = this.el.querySelector('.liquid-band');
            if (band) {
              band.setAttribute(
                'material',
                'color: ' + (liquid ? liquid.dropColor || liquid.poolColor : '#2b2b2f') + '; shader: flat'
              );
            }
          }

          this.drawHose(tank);
          this.reelIn(tank);

          var holsterable = this.el.components.holsterable;
          if (!holsterable || holsterable.state !== 'held' || !holsterable.hand) return;
          var handRig = holsterable.hand.components['hand-rig'];
          if (!handRig || !handRig.triggerHeld) {
            this.accumulator = 0;
            return;
          }
          if (!tank.liquid) return;

          this.spray(tank.liquid, Math.min((dt || 16) / 1000, 0.05));
        },

        spray: function (type, dtSeconds) {
          var tip = this.tipEl ? this.tipEl.object3D : this.el.object3D;
          tip.getWorldPosition(this._tip);
          tip.getWorldQuaternion(this._quat);
          this._dir.set(0, 0, -1).applyQuaternion(this._quat).normalize();

          this.accumulator += SPRAY_RATE * dtSeconds;
          var count = Math.floor(this.accumulator);
          this.accumulator -= count;

          for (var i = 0; i < count; i++) {
            this._vel
              .copy(this._dir)
              .multiplyScalar(SPRAY_SPEED)
              .add(
                _sprayJitter.set(
                  (Math.random() - 0.5) * SPRAY_SPREAD,
                  (Math.random() - 0.5) * SPRAY_SPREAD,
                  (Math.random() - 0.5) * SPRAY_SPREAD
                )
              );
            spawnDroplet(this._tip, this._vel, type);
          }
        },

        // A quadratic bezier sagging under the midpoint, drawn as a
        // handful of stretched cylinders. Not simulated: a hose that
        // fought your hand would be a worse toy than one that follows
        // it.
        drawHose: function (tank) {
          var outletEl = tank.el.querySelector('.hose-outlet');
          (outletEl ? outletEl.object3D : tank.el.object3D).getWorldPosition(this._outlet);
          this.el.object3D.getWorldPosition(this._tip);

          var sag = this._outlet.distanceTo(this._tip) / HOSE_LENGTH;
          _hoseControl
            .copy(this._outlet)
            .add(this._tip)
            .multiplyScalar(0.5).y -= HOSE_SAG * Math.max(1 - sag, 0.15);

          for (var i = 0; i < HOSE_SEGMENTS; i++) {
            bezierPoint(this._outlet, _hoseControl, this._tip, i / HOSE_SEGMENTS, this._a);
            bezierPoint(this._outlet, _hoseControl, this._tip, (i + 1) / HOSE_SEGMENTS, this._b);

            var seg = this.segments[i].object3D;
            var length = this._a.distanceTo(this._b);
            seg.position.copy(this._a).add(this._b).multiplyScalar(0.5);
            seg.scale.y = Math.max(length, 0.0001);
            _hoseDir.copy(this._b).sub(this._a).normalize();
            seg.quaternion.setFromUnitVectors(_hoseUp, _hoseDir);
          }
        },

        // You can put the nozzle down, but you can't leave it across
        // the room: past the length of the hose it goes home, which
        // reads as the hose pulling it back.
        reelIn: function (tank) {
          var holsterable = this.el.components.holsterable;
          if (!holsterable) return;
          if (holsterable.state !== 'resting' && holsterable.state !== 'falling') return;
          if (this._outlet.distanceTo(this._tip) < HOSE_LENGTH) return;

          var home = holsterable.data.holsterSelector;
          if (!home) return;
          holsterable.state = 'holstered';
          holsterable.attachTo(home.object3D, holsterable.data.holsterPosition, holsterable.data.holsterRotation);
          holsterable.occupySlot(home);
        },
      });

      var _worldUp = new THREE.Vector3(0, 1, 0);
      var _sprayJitter = new THREE.Vector3();
      var _hoseControl = new THREE.Vector3();
      var _hoseDir = new THREE.Vector3();
      var _hoseUp = new THREE.Vector3(0, 1, 0);

      function bezierPoint(a, control, b, t, out) {
        var u = 1 - t;
        return out
          .set(0, 0, 0)
          .addScaledVector(a, u * u)
          .addScaledVector(control, 2 * u * t)
          .addScaledVector(b, t * t);
      }

      // ==============================================================
      // COMPONENT: scope
      // See THE SCOPE. Generic on purpose — it is "a disc on this
      // object that shows what a narrow-angle camera pointed down this
      // object's -Z can see", so it would work just as well on a
      // spyglass, a periscope, or a mirror behind the bar.
      //
      // Three things it has to be careful about, all of them the same
      // hazard: it renders in the middle of somebody else's frame.
      // The renderer's current target has to be put back, WebXR has to
      // be switched off for the duration (or three.js renders the
      // off-screen pass in stereo into the headset's own framebuffer),
      // and the lens itself has to be hidden or it films its own last
      // frame — an infinite corridor, which is a lovely bug and quite
      // useless as a sight.
      // ==============================================================
      registerComponent('scope', {
        schema: {
          fov: { type: 'number', default: SCOPE_FOV },
          offset: { type: 'vec3', default: { x: 0, y: 0, z: 0 } }, // where the eyepiece sits on the object
          objective: { type: 'number', default: 0.32 }, // how far ahead of the eyepiece the far end of the tube is
          radius: { type: 'number', default: SCOPE_LENS_RADIUS },
          wake: { type: 'number', default: SCOPE_WAKE_DISTANCE },
        },

        init: function () {
          this.awake = false;
          this._eye = new THREE.Vector3();
          this._lens = new THREE.Vector3();

          this.target = new THREE.WebGLRenderTarget(SCOPE_TEXTURE, SCOPE_TEXTURE);

          // The near plane sits past the end of the tube on purpose. A
          // scope camera parked at the eyepiece films the inside of its
          // own tube, and at eleven degrees the tube walls are most of
          // the picture; clipping everything closer than the objective
          // throws away the tube, the barrel and your own hands, which
          // is exactly what a scope does.
          this.camera = new THREE.PerspectiveCamera(this.data.fov, 1, 0.25, 400);
          this.el.object3D.add(this.camera);
          this.camera.position.set(
            this.data.offset.x,
            this.data.offset.y,
            this.data.offset.z - this.data.objective
          );

          // Facing +Z, i.e. straight back at your eye, which is the
          // default for a CircleGeometry and was the bug: it had been
          // turned to face down the barrel, so the only thing ever
          // visible through the scope was the back of the lens.
          //
          // No mirroring is needed. The scope camera and the eye behind
          // it both look along -Z, so their idea of "right" is the same
          // one.
          //
          // side: double, not the material default of front-only —
          // a held scope is always approached from the +Z side (the
          // shooter's eye behind the eyepiece), but a mirror sitting in
          // the world is approached from whichever side the player
          // happens to be standing on. Without this the glass renders
          // correctly to the render target (proven by reading its
          // pixels back) while being completely invisible on screen —
          // simple back-face culling, not a rendering failure, but easy
          // to chase as one.
          this.lensMesh = new THREE.Mesh(
            new THREE.CircleGeometry(this.data.radius, 20),
            new THREE.MeshBasicMaterial({ map: this.target.texture, side: THREE.DoubleSide })
          );
          this.lensMesh.position.set(this.data.offset.x, this.data.offset.y, this.data.offset.z + 0.005);
          this.lensMesh.visible = false; // asleep, you see straight through the hollow tube at life size
          this.el.object3D.add(this.lensMesh);

          this.liveMaterial = this.lensMesh.material;

          // The crosshair rides on the glass, so it magnifies with it.
          var reticle = new THREE.Mesh(
            new THREE.RingGeometry(this.data.radius * 0.06, this.data.radius * 0.08, 16),
            new THREE.MeshBasicMaterial({ color: '#1a1a1a' })
          );
          reticle.position.z = 0.001;
          this.lensMesh.add(reticle);
          this.reticle = reticle;
          reticle.visible = false;

          this.cameraEl = document.querySelector('#head-camera');
        },

        remove: function () {
          this.el.object3D.remove(this.camera);
          this.el.object3D.remove(this.lensMesh);
          this.target.dispose();
          this.lensMesh.geometry.dispose();
          this.liveMaterial.dispose();
        },

        tick: function () {
          if (!this.cameraEl) return;

          this.lensMesh.getWorldPosition(this._lens);
          this.cameraEl.object3D.getWorldPosition(this._eye);
          var awake = this._lens.distanceTo(this._eye) < this.data.wake;

          if (awake !== this.awake) {
            this.awake = awake;
            this.lensMesh.visible = awake;
            this.reticle.visible = awake;
          }
          if (!awake) return;

          this.renderThrough();
        },

        renderThrough: function () {
          var sceneEl = this.el.sceneEl;
          var renderer = sceneEl && sceneEl.renderer;
          if (!renderer) return;

          var wasXR = renderer.xr.enabled;
          var wasTarget = renderer.getRenderTarget();

          this.lensMesh.visible = false;
          renderer.xr.enabled = false;
          renderer.setRenderTarget(this.target);
          renderer.render(sceneEl.object3D, this.camera);
          renderer.setRenderTarget(wasTarget);
          renderer.xr.enabled = wasXR;
          this.lensMesh.visible = true;
        },
      });

      // ==============================================================
      // COMPONENT: boxy-sniper
      // A long rifle with a tube on top. Same conventions as every
      // other gun here — origin at the trigger guard, -Z down the
      // barrel — so `firearm`, `holsterable` and `scope` all point the
      // same way without being told to.
      // ==============================================================
      registerComponent('boxy-sniper', {
        init: function () {
          var el = this.el;
          var metal = '#2b2b2f';
          var wood = '#5b3a1c';

          function box(w, h, d, pos, color, rot) {
            var b = document.createElement('a-box');
            b.setAttribute('width', w);
            b.setAttribute('height', h);
            b.setAttribute('depth', d);
            b.setAttribute('position', pos);
            b.setAttribute('color', color);
            if (rot) b.setAttribute('rotation', rot);
            el.appendChild(b);
            return b;
          }

          box(0.045, 0.13, 0.05, '0 -0.05 0.02', wood, '12 0 0'); // grip
          box(0.048, 0.055, 0.2, '0 0.02 -0.07', metal); // receiver
          box(0.026, 0.026, SNIPER_LENGTH * 0.62, '0 0.045 -0.52', metal); // long barrel
          box(0.05, 0.04, 0.3, '0 0.005 -0.28', wood); // forestock
          box(0.055, 0.1, 0.3, '0 -0.025 0.26', wood, '-7 0 0'); // stock
          box(0.045, 0.006, 0.06, '0 -0.028 -0.02', metal); // trigger guard
          box(0.008, 0.03, 0.008, '0 -0.01 -0.035', '#c9962c'); // trigger
          box(0.02, 0.05, 0.02, '0 0.05 0.03', metal, '30 0 0'); // bolt handle

          // The scope tube. The eyepiece end is where `scope` puts its
          // glass, so the two sets of numbers have to agree — the same
          // hand-kept arrangement boxy-gun and the pistol's comOffset
          // already live with.
          // Open-ended and double-sided, so with the scope asleep you
          // are looking through a tube at the world rather than at a
          // solid cylinder. That also makes the moment it wakes read as
          // the view zooming rather than a wall turning into a window.
          var tube = document.createElement('a-cylinder');
          tube.setAttribute('radius', 0.028);
          tube.setAttribute('height', 0.34);
          tube.setAttribute('color', metal);
          tube.setAttribute('open-ended', true);
          tube.setAttribute('material', 'color: ' + metal + '; side: double');
          tube.setAttribute('rotation', '90 0 0');
          tube.setAttribute('position', { x: 0, y: 0.115, z: -0.14 });
          el.appendChild(tube);

          box(0.02, 0.05, 0.03, '0 0.085 -0.26', metal); // front mount
          box(0.02, 0.05, 0.03, '0 0.085 -0.02', metal); // rear mount

          var flash = document.createElement('a-circle');
          flash.setAttribute('radius', 0.03);
          flash.setAttribute('material', 'color: #ffe066; shader: flat; opacity: 0.9');
          flash.setAttribute('position', { x: 0, y: 0.045, z: -SNIPER_LENGTH + 0.06 });
          flash.setAttribute('visible', false);
          flash.classList.add('muzzle-flash');
          el.appendChild(flash);

          var muzzle = document.createElement('a-entity');
          muzzle.setAttribute('position', { x: 0, y: 0.045, z: -SNIPER_LENGTH + 0.05 });
          muzzle.classList.add('muzzle');
          el.appendChild(muzzle);
        },
      });

      // ==============================================================
      // COMPONENT: boxy-launcher / launcher
      // A tube you put something in and a trigger that sends it. It is
      // the bow's idea again with a different silhouette: a socket at
      // the loading end, and a release that hands whatever is in there
      // a velocity. That the socket doesn't ask what it's holding is
      // now a habit rather than a surprise — a rocket goes down the
      // tube, and so does a beer, and so does a lit stick of dynamite,
      // and the launcher can tell the difference between none of them.
      //
      // Firing empty is a click and a puff, because a man should be
      // allowed to find that out the hard way.
      // ==============================================================
      registerComponent('boxy-launcher', {
        init: function () {
          var el = this.el;
          var metal = '#3f4429';
          var wood = '#4a2f1c';

          function box(w, h, d, pos, color, rot) {
            var b = document.createElement('a-box');
            b.setAttribute('width', w);
            b.setAttribute('height', h);
            b.setAttribute('depth', d);
            b.setAttribute('position', pos);
            b.setAttribute('color', color);
            if (rot) b.setAttribute('rotation', rot);
            el.appendChild(b);
            return b;
          }

          var tube = document.createElement('a-cylinder');
          tube.setAttribute('radius', 0.055);
          tube.setAttribute('height', LAUNCHER_LENGTH);
          tube.setAttribute('color', metal);
          tube.setAttribute('rotation', '90 0 0');
          tube.setAttribute('position', { x: 0, y: 0.06, z: LAUNCHER_LENGTH / 2 - LAUNCHER_MUZZLE_Z });
          el.appendChild(tube);

          box(0.05, 0.14, 0.055, '0 -0.05 0.02', wood, '10 0 0'); // grip
          box(0.045, 0.006, 0.06, '0 -0.028 -0.02', metal); // trigger guard
          box(0.008, 0.03, 0.008, '0 -0.01 -0.035', '#c9962c'); // trigger
          box(0.09, 0.03, 0.1, '0 0.12 -0.16', metal); // crude sight block
          box(0.05, 0.05, 0.12, '0 0.05 0.3', wood); // shoulder pad

          var flash = document.createElement('a-circle');
          flash.setAttribute('radius', 0.08);
          flash.setAttribute('material', 'color: #ffe066; shader: flat; opacity: 0.9');
          flash.setAttribute('position', { x: 0, y: 0.06, z: -LAUNCHER_MUZZLE_Z });
          flash.setAttribute('visible', false);
          flash.classList.add('muzzle-flash');
          el.appendChild(flash);

          var muzzle = document.createElement('a-entity');
          muzzle.setAttribute('position', { x: 0, y: 0.06, z: -LAUNCHER_MUZZLE_Z });
          muzzle.classList.add('muzzle');
          el.appendChild(muzzle);

          // The breech: an ordinary socket at the back of the tube.
          this.breechEl = document.createElement('a-entity');
          this.breechEl.classList.add('anchor-slot');
          // A big obvious indicator, because a socket you can't find is
          // a weapon that doesn't work — the first version had a
          // discreet one down the tube and the honest playtest note was
          // "I couldn't tell if anything loaded".
          this.breechEl.setAttribute('anchor-slot', { size: 'small', indicatorScale: 2.1 });
          this.breechEl.setAttribute('position', { x: 0, y: 0.06, z: LAUNCHER_LENGTH - LAUNCHER_MUZZLE_Z - 0.16 });
          el.appendChild(this.breechEl);
        },
      });

      registerComponent('launcher', {
        init: function () {
          this._muzzle = new THREE.Vector3();
          this._dir = new THREE.Vector3();
          this._quat = new THREE.Quaternion();
        },

        breech: function () {
          var visual = this.el.components['boxy-launcher'];
          return visual && visual.breechEl;
        },

        // hand-rig's generic press dispatch, same hook a gun's trigger
        // uses — which is why holding the launcher and a pistol in one
        // fist fires both.
        onTriggerUse: function () {
          var holsterable = this.el.components.holsterable;
          if (!holsterable || holsterable.state !== 'held') return;

          var breech = this.breech();
          var slot = breech && breech.components['anchor-slot'];

          var muzzleEl = this.el.querySelector('.muzzle');
          if (muzzleEl) {
            muzzleEl.object3D.updateWorldMatrix(true, false);
            muzzleEl.object3D.getWorldPosition(this._muzzle);
            muzzleEl.object3D.getWorldQuaternion(this._quat);
            this._dir.set(0, 0, -1).applyQuaternion(this._quat).normalize();
          }

          if (!slot || !slot.occupants.length) {
            // Unmistakably nothing happening, rather than quietly
            // nothing happening.
            playTone({ type: 'square', freq: 150, duration: 0.09, volume: 0.16 });
            playNoise({ duration: 0.05, freq: 1800, q: 2, volume: 0.08 });
            return;
          }

          var payload = slot.occupants[0];
          payload.el.object3D.updateWorldMatrix(true, false);
          payload.vacateSlot();

          var velocity = this._dir.clone().multiplyScalar(LAUNCH_SPEED);
          velocity.isHurl = true; // don't let the tube catch its own rocket back
          payload.throwWithVelocity(velocity);
          payload.angularVelocity.set(0, 0, 0);
          payload.el.object3D.quaternion.setFromUnitVectors(_launchForward, this._dir);

          this.report();
        },

        // Muzzle flash, backblast and a shove. The kick goes through
        // holsterable.extraPitchDeg, the same channel a pistol's recoil
        // uses, so it composes with drunken sway instead of fighting it.
        report: function () {
          playBoom();
          flashMuzzle(this.el);

          var holsterable = this.el.components.holsterable;
          if (holsterable) holsterable.extraPitchDeg = LAUNCHER_KICK_DEG;
          this.recoil = LAUNCHER_RECOVER_MS;

          // Backblast, out the far end and straight at whatever is
          // standing behind you.
          this.el.object3D.getWorldPosition(this._muzzle);
          for (var i = 0; i < 5; i++) {
            spawnSmoke(this._muzzle, this._dir.clone().multiplyScalar(-3.4), 1.4);
          }
          spawnSparks(this._muzzle, 8);
        },

        tick: function (time, dt) {
          if (!this.recoil) return;
          this.recoil = Math.max(this.recoil - (dt || 16), 0);
          var holsterable = this.el.components.holsterable;
          if (holsterable) holsterable.extraPitchDeg = LAUNCHER_KICK_DEG * (this.recoil / LAUNCHER_RECOVER_MS);
        },
      });

      var _launchForward = new THREE.Vector3(0, 0, -1);

      // ==============================================================
      // COMPONENT: rocket
      // The thing that goes in the tube, and it is barely a thing. It's
      // an `explosive` that's armed — so anything it touches sets it
      // off, no fuse required — plus a motor: while it's in the air it
      // pushes itself along, fights most of gravity, and leaves a
      // trail. Everything about how it flies, what it hits and what it
      // does to what it hit is machinery that was already here for
      // thrown bottles and dynamite.
      // ==============================================================
      registerComponent('rocket', {
        init: function () {
          this._world = new THREE.Vector3();
          this._dir = new THREE.Vector3();
          this._quat = new THREE.Quaternion();
          this.burn = ROCKET_BURN_MS;
        },

        tick: function (time, dt) {
          var holsterable = this.el.components.holsterable;
          if (!holsterable || holsterable.state !== 'falling') return;

          var dtSeconds = Math.min((dt || 16) / 1000, 0.05);
          var speed = holsterable.fallVelocity.length();
          if (speed < 0.5) return;

          this._dir.copy(holsterable.fallVelocity).divideScalar(speed);

          if (this.burn > 0) {
            this.burn -= dt || 16;
            holsterable.fallVelocity.addScaledVector(this._dir, ROCKET_THRUST * dtSeconds);
            // The motor holds it up while it's lit, so a rocket flies
            // flat and then drops, rather than arcing like a thrown
            // bottle from the moment it leaves.
            holsterable.fallVelocity.y += GRAVITY * ROCKET_LIFT * dtSeconds;
          }

          holsterable.angularVelocity.set(0, 0, 0);
          this._quat.setFromUnitVectors(_launchForward, this._dir);
          this.el.object3D.quaternion.copy(this._quat);

          this.trail = (this.trail || 0) - (dt || 16);
          if (this.trail > 0) return;
          this.trail = 26;
          this.el.object3D.getWorldPosition(this._world);
          spawnSmoke(this._world, this._dir.clone().multiplyScalar(-1.5), 0.8);
          spawnSparks(this._world, 1);
        },
      });

      registerComponent('boxy-rocket', {
        init: function () {
          var el = this.el;

          var body = document.createElement('a-cylinder');
          body.setAttribute('radius', 0.042);
          body.setAttribute('height', 0.2);
          body.setAttribute('color', '#5b6b3a');
          body.setAttribute('rotation', '90 0 0');
          body.setAttribute('position', { x: 0, y: 0, z: 0.02 });
          el.appendChild(body);

          var nose = document.createElement('a-cone');
          nose.setAttribute('radius-bottom', 0.042);
          nose.setAttribute('radius-top', 0);
          nose.setAttribute('height', 0.1);
          nose.setAttribute('color', '#a8342a');
          nose.setAttribute('rotation', '-90 0 0');
          nose.setAttribute('position', { x: 0, y: 0, z: -0.13 });
          el.appendChild(nose);

          for (var i = 0; i < 4; i++) {
            var fin = document.createElement('a-box');
            fin.setAttribute('width', 0.004);
            fin.setAttribute('height', 0.055);
            fin.setAttribute('depth', 0.06);
            fin.setAttribute('position', { x: 0, y: 0.05, z: 0.1 });
            fin.setAttribute('color', '#3f4429');
            var pivot = document.createElement('a-entity');
            pivot.setAttribute('rotation', { x: 0, y: 0, z: i * 90 });
            pivot.appendChild(fin);
            el.appendChild(pivot);
          }
        },
      });

      // ==============================================================
      // COMPONENT: boxy-dynamite
      // Three red sticks in a bundle with a fuse out the end, and the
      // fuse is a `buildBurnStick` — the same object a match and a
      // cigar are made of, because "a thing that burns down from the
      // tip" was already a shape this file knew how to draw. Which
      // means the fuse ashes as it goes, can have its light knocked
      // off it by a hard enough flick, and lights off anything hot,
      // none of which is dynamite code.
      //
      // Same axis convention as the cigar: the entity origin is where
      // your fist closes, and the fuse burns back toward you along -Z.
      // ==============================================================
      registerComponent('boxy-dynamite', {
        init: function () {
          var el = this.el;

          for (var i = 0; i < 3; i++) {
            var stick = document.createElement('a-cylinder');
            stick.setAttribute('radius', 0.019);
            stick.setAttribute('height', DYNAMITE_STICK_LENGTH);
            stick.setAttribute('color', i === 1 ? '#a8342a' : '#8f2b22');
            stick.setAttribute('rotation', '90 0 0');
            stick.setAttribute('position', {
              x: (i - 1) * 0.034,
              y: i === 1 ? 0.016 : 0,
              z: DYNAMITE_STICK_LENGTH / 2 - 0.02,
            });
            el.appendChild(stick);
          }

          var band = document.createElement('a-cylinder');
          band.setAttribute('radius', 0.056);
          band.setAttribute('height', 0.02);
          band.setAttribute('color', '#4a3f2c');
          band.setAttribute('rotation', '90 0 0');
          band.setAttribute('position', { x: 0, y: 0.006, z: DYNAMITE_STICK_LENGTH / 2 - 0.02 });
          el.appendChild(band);

          this.parts = buildBurnStick(el, {
            length: DYNAMITE_FUSE_LENGTH,
            radius: 0.005,
            bodyColor: '#6b5a3a',
            ashColor: '#2e2a24',
            headColor: '#6b5a3a',
            litColor: '#ffd257',
          });

          this.layout(DYNAMITE_FUSE_LENGTH, 0);
        },

        layout: function (length, ashLength) {
          layoutBurnStick(this.parts, length, ashLength);
        },

        setEmber: function (lit) {
          this.parts.ember.setAttribute(
            'material',
            'color: ' + (lit ? this.parts.litColor : this.parts.headColor) + '; shader: flat'
          );
          // A lit fuse throws sparks, which is most of what sells it.
          this.sparking = lit;
        },

        tick: function (time, dt) {
          if (!this.sparking) return;
          this.sparkTimer = (this.sparkTimer || 0) - (dt || 16);
          if (this.sparkTimer > 0) return;
          this.sparkTimer = 70;
          spawnSparks(this.parts.ember.object3D.getWorldPosition(_dynamiteTip), 2);
        },
      });

      var _dynamiteTip = new THREE.Vector3();

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

      // ==============================================================
      // COMPONENT: boxy-zippo
      // A lighter, built the same "pile of primitives" way as
      // everything else. The lid is a separate entity hinged along the
      // top back edge so it can swing open, the wick sits just inside
      // the chimney, and the flame is a cone that only exists while
      // it's lit. Origin at the middle of the body, where your fingers
      // would close around it.
      // ==============================================================
      registerComponent('boxy-zippo', {
        init: function () {
          var el = this.el;
          var brass = '#b9962e';
          var steel = '#8d8f94';

          function box(w, h, d, pos, color, parent) {
            var b = document.createElement('a-box');
            b.setAttribute('width', w);
            b.setAttribute('height', h);
            b.setAttribute('depth', d);
            b.setAttribute('position', pos);
            b.setAttribute('color', color);
            (parent || el).appendChild(b);
            return b;
          }

          box(0.032, 0.042, 0.016, '0 -0.008 0', brass); // body
          box(0.026, 0.006, 0.013, '0 0.015 0', steel); // chimney deck

          // The lid, hinged at the top BACK edge: the hinge entity
          // sits on that edge and the lid panel hangs forward from it,
          // so rotating the hinge on X swings the lid up and back the
          // way a real one does.
          this.hinge = document.createElement('a-entity');
          this.hinge.setAttribute('position', { x: 0, y: 0.018, z: 0.008 });
          el.appendChild(this.hinge);

          box(0.032, 0.026, 0.016, '0 0.013 -0.008', brass, this.hinge);

          var wick = document.createElement('a-cylinder');
          wick.setAttribute('radius', 0.0018);
          wick.setAttribute('height', 0.008);
          wick.setAttribute('color', '#2a2420');
          wick.setAttribute('position', { x: 0, y: 0.021, z: 0 });
          el.appendChild(wick);

          this.flameEl = document.createElement('a-entity');
          this.flameEl.setAttribute('geometry', {
            primitive: 'cone',
            radiusBottom: 0.007,
            radiusTop: 0.0004,
            height: 0.03,
          });
          this.flameEl.setAttribute('material', 'color: #ffb02a; shader: flat; transparent: true; opacity: 0.9');
          this.flameEl.setAttribute('position', { x: 0, y: 0.038, z: 0 });
          this.flameEl.setAttribute('visible', false);
          this.flameEl.classList.add('flame');
          el.appendChild(this.flameEl);

          el.appendChild(createHitbox(0.04, 0.08, { x: 0, y: 0, z: 0 }));
        },

        setLid: function (openFraction) {
          this.hinge.object3D.rotation.x = (ZIPPO_LID_OPEN_DEG * openFraction * Math.PI) / 180;
        },

        setFlame: function (lit, scale) {
          this.flameEl.setAttribute('visible', lit);
          if (lit) this.flameEl.object3D.scale.set(1, scale, 1);
        },
      });

      // ==============================================================
      // COMPONENT: zippo
      // The behavior: a lid that opens and closes, and a flame that
      // can only exist while it's open.
      //
      // Two ways to work the lid, because both are things people will
      // try: pull the trigger (through hand-rig's generic press
      // dispatch — see useHeldObject), or flick your wrist, which
      // reuses the same flick detector that knocks ash off a cigar. A
      // face button strikes it. Closing the lid snuffs it, which is
      // the one rule a Zippo really has.
      //
      // While lit and open it's an ordinary ignition-source, so it
      // lights cigars and matches through exactly the same proximity
      // check a hot barrel does, and needed no code of its own to do
      // that.
      // ==============================================================
      registerComponent('zippo', {
        init: function () {
          this.open = false;
          this.lidFraction = 0; // 0 shut, 1 fully back
          this.flickerPhase = Math.random() * 10;

          this._lidTip = new THREE.Vector3();
          this.flick = createFlickDetector(ZIPPO_FLICK_SPEED, ZIPPO_FLICK_REVERSAL);

          this.onShot = this.onShot.bind(this);
          this.el.addEventListener('shot', this.onShot);
          this.el.addEventListener('click', this.onShot);
        },

        remove: function () {
          this.el.removeEventListener('shot', this.onShot);
          this.el.removeEventListener('click', this.onShot);
        },

        visual: function () {
          return this.el.components['boxy-zippo'];
        },

        isLit: function () {
          var lightable = this.el.components.lightable;
          return !!(lightable && lightable.lit);
        },

        // Trigger: work the lid.
        onTriggerUse: function () {
          this.toggleLid();
        },

        // Face button: strike it. Only catches with the lid open,
        // which is the entire ritual.
        onFaceButtonUse: function () {
          if (!this.open) return;
          var lightable = this.el.components.lightable;
          if (lightable && !lightable.lit) {
            lightable.ignite();
            playClink();
          }
        },

        // Shooting a lighter is not something anyone should do, so it
        // simply snaps the lid shut and puts it out.
        onShot: function () {
          if (this.open) this.toggleLid();
        },

        toggleLid: function () {
          this.open = !this.open;
          playClink();

          // Updated here as well as in tick so the invariant holds
          // immediately: open the lid and strike it in the same frame
          // and it lights, rather than silently refusing because the
          // veto hadn't been cleared yet.
          var lightable = this.el.components.lightable;
          if (lightable) lightable.blocked = !this.open;

          if (!this.open) this.snuff();
        },

        snuff: function () {
          var lightable = this.el.components.lightable;
          if (lightable) lightable.extinguish();
        },

        tick: function (time, dt) {
          var dtSeconds = Math.min((dt || 16) / 1000, 0.05);
          var visual = this.visual();
          if (!visual) return;

          // Lid animation, driven straight rather than through
          // A-Frame's animation component, for the same reason
          // everything else here writes object3D directly.
          var target = this.open ? 1 : 0;
          var step = (ZIPPO_LID_SPEED_DEG / Math.abs(ZIPPO_LID_OPEN_DEG)) * dtSeconds;
          if (this.lidFraction < target) this.lidFraction = Math.min(this.lidFraction + step, target);
          else if (this.lidFraction > target) this.lidFraction = Math.max(this.lidFraction - step, target);
          visual.setLid(this.lidFraction);

          this.checkFlick(dtSeconds, visual);

          var lit = this.isLit();
          var flicker = 0.75 + 0.25 * Math.sin((time / 1000) * ZIPPO_FLAME_FLICKER_HZ + this.flickerPhase);
          visual.setFlame(lit, flicker);

          // Only a lit, open lighter is a fire source. Closing it mid-
          // burn snuffs it via toggleLid, so this is belt and braces.
          var source = this.el.components['ignition-source'];
          if (source) source.hot = lit && this.lidFraction > 0.5;

          // Shut, it isn't lightable by anything either — no catching
          // fire in your pocket off a stray hot barrel.
          var lightable = this.el.components.lightable;
          if (lightable) lightable.blocked = !this.open;

          // A lit flame gives off the occasional thread of smoke.
          this.smokeTimer = (this.smokeTimer || 0) - dtSeconds * 1000;
          if (lit && this.smokeTimer <= 0) {
            this.smokeTimer = 900 + Math.random() * 600;
            visual.flameEl.object3D.getWorldPosition(this._lidTip);
            spawnSmoke(this._lidTip, null, 0.3);
          }
        },

        // A sharp flick of the wrist works the lid too. Measured at
        // the lid rather than the body so a rotation counts as motion
        // — the same detector the cigar uses to shed ash.
        checkFlick: function (dtSeconds, visual) {
          var holsterable = this.el.components.holsterable;
          if (!holsterable || holsterable.state !== 'held') {
            this.flick.reset();
            return;
          }

          visual.hinge.object3D.getWorldPosition(this._lidTip);
          if (this.flick.update(this._lidTip, dtSeconds)) this.toggleLid();
        },
      });

      // ==============================================================
      // COMPONENT: vice-meter
      // Owns the two numbers in VICES and the readout that tells you
      // where you stand.
      //
      // They're kept separate because they do different jobs. Nicotine
      // is the shakes and nothing else — a fast tremor on everything
      // you hold, which is why five cigars at once is funny. Alcohol
      // is the interesting one: aim drift, a head-locked vignette and
      // warm pulse, and butterfingers, all of which live in other
      // components that just read VICES.alcohol. Neither meter is
      // allowed anywhere near the camera transform.
      //
      // Both decay on their own, slowly enough that a session has
      // consequences and fast enough that you can sober up if you stop.
      // ==============================================================
      var SOBER_SKY = '#7d6b8f';
      var DRUNK_SKY = '#9c5f79';

      function addAlcohol(amount) {
        VICES.alcohol = Math.min(VICES.alcohol + amount, 1);
      }

      function addNicotine(amount) {
        VICES.nicotine = Math.min(VICES.nicotine + amount, 1);
      }

      registerComponent('vice-meter', {
        init: function () {
          VICES.alcohol = 0;
          VICES.nicotine = 0;

          this.hud = document.querySelector('#vice-text');
          this.sky = document.querySelector('a-sky');
          this.refreshTimer = 0;

          this._soberColor = new THREE.Color(SOBER_SKY);
          this._drunkColor = new THREE.Color(DRUNK_SKY);
          this._skyColor = new THREE.Color();
        },

        tick: function (time, dt) {
          var dtSeconds = Math.min((dt || 16) / 1000, 0.05);
          VICES.alcohol = Math.max(VICES.alcohol - ALCOHOL_DECAY_PER_S * dtSeconds, 0);
          VICES.nicotine = Math.max(VICES.nicotine - NICOTINE_DECAY_PER_S * dtSeconds, 0);

          this.refreshTimer -= dt || 16;
          if (this.refreshTimer > 0) return;
          this.refreshTimer = 150;

          this.updateHud();
          this.updateSky();
        },

        updateHud: function () {
          if (!this.hud) return;
          this.hud.setAttribute(
            'text',
            'value',
            'Alcohol: ' + Math.round(VICES.alcohol * 100) + '%   |   Nicotine: ' + Math.round(VICES.nicotine * 100) + '%'
          );
        },

        updateSky: function () {
          if (!this.sky) return;
          this._skyColor.copy(this._soberColor).lerp(this._drunkColor, VICES.alcohol);
          this.sky.setAttribute('material', 'color', '#' + this._skyColor.getHexString());
        },
      });

      // ==============================================================
      // COMPONENT: booze-overlay
      // The visual half of being drunk: a tunnel vignette closing in
      // from the edges plus a warm tint over the whole view, both
      // pulsing slowly.
      //
      // It is drawn as a single quad in CLIP SPACE — the vertex shader
      // writes gl_Position directly from the vertex positions and
      // never looks at the camera at all. That's deliberate and it's
      // the third attempt at this. A quad placed in the world in front
      // of the camera only works if it exactly matches the frustum at
      // that distance: too small and you see a rectangle floating in
      // front of you, too big and the entire gradient falls outside
      // your field of view, so every pixel you can actually see
      // samples the clear middle and the effect is invisible. Matching
      // the frustum means knowing the FOV, and in WebXR there is no
      // single FOV to know — the runtime substitutes two per-eye
      // projection matrices, and any hardcoded guess is a guess. In
      // clip space there is nothing to get wrong: the quad covers
      // exactly the viewport, per eye, at any FOV, on any device.
      //
      // The safety argument is unchanged and is the whole reason the
      // drunk effects are allowed to be visual at all: this is rigidly
      // locked to your view, so there is no relative motion for your
      // inner ear to disagree with. Nothing here — and nothing
      // anywhere else in the alcohol code — moves the camera.
      // ==============================================================
      var VIGNETTE_MAX = 0.92; // peak darkness of the closed-in tunnel
      var TINT_MAX = 0.3; // peak warm wash over everything
      var TINT_PULSE_HZ = 0.35;
      var VIGNETTE_CURVE = 0.65; // <1 pushes the effect earlier, so being a bit drunk still reads

      registerComponent('booze-overlay', {
        init: function () {
          var vertexShader = [
            'varying vec2 vUv;',
            'void main() {',
            // position.xy spans -0.5..0.5 on a unit plane; doubling it
            // spans the full -1..1 of clip space. z is pinned just
            // inside the far plane and depth testing is off anyway.
            '  vUv = uv;',
            '  gl_Position = vec4(position.xy * 2.0, 0.0, 1.0);',
            '}',
          ].join('\n');

          var fragmentShader = [
            'varying vec2 vUv;',
            'uniform float amount;',
            'uniform vec3 tintColor;',
            'uniform vec3 edgeColor;',
            'void main() {',
            '  float r = length(vUv - vec2(0.5)) * 2.0;', // 0 at center, ~1.41 at the corners
            '  float tunnel = smoothstep(0.55, 1.3, r);',
            '  float alpha = clamp(tunnel * amount * ' + VIGNETTE_MAX.toFixed(2) + ' + amount * ' + TINT_MAX.toFixed(2) + ', 0.0, 1.0);',
            '  vec3 color = mix(tintColor, edgeColor, tunnel);',
            '  gl_FragColor = vec4(color, alpha);',
            '}',
          ].join('\n');

          this.material = new THREE.ShaderMaterial({
            uniforms: {
              amount: { value: 0 },
              tintColor: { value: new THREE.Color('#c25a3a') },
              edgeColor: { value: new THREE.Color('#0a060c') },
            },
            vertexShader: vertexShader,
            fragmentShader: fragmentShader,
            transparent: true,
            depthTest: false,
            depthWrite: false,
          });

          this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.material);
          this.mesh.frustumCulled = false; // its vertices are in clip space; culling them against a frustum is meaningless
          this.mesh.renderOrder = 10000; // last, over everything, including anything held up to your face
          this.mesh.visible = false;
          this.el.setObject3D('overlay', this.mesh);
        },

        remove: function () {
          this.el.removeObject3D('overlay');
        },

        tick: function (time) {
          var alcohol = VICES.alcohol;
          if (alcohol <= 0.01) {
            this.mesh.visible = false;
            return;
          }

          this.mesh.visible = true;
          // The pulse is the "woozy" part: a slow swell that reads as
          // the room breathing, without anything actually moving.
          var pulse = 0.78 + 0.22 * Math.sin((time / 1000) * TINT_PULSE_HZ * Math.PI * 2);
          this.material.uniforms.amount.value = Math.pow(alcohol, VIGNETTE_CURVE) * pulse;
        },
      });

      // ==============================================================
      // COMPONENT: world-systems
      // One scene-level tick that owns everything shared between props:
      // the particle pool, the wind that pushes smoke around, and the
      // "hot thing touched a flammable thing" matching. It's a single
      // component rather than one per particle both for the obvious
      // reason (a hundred component ticks a frame is a lot of
      // overhead) and a less obvious one: wind and ignition are
      // inherently pairwise, and doing them in one place means each
      // hand's position is read once per frame instead of once per
      // particle.
      // ==============================================================
      registerComponent('world-systems', {
        init: function () {
          this.mouthEl = document.querySelector('#mouth-anchor');
          this.cameraEl = document.querySelector('#head-camera');

          this._handPos = new THREE.Vector3();
          this._mouthPos = new THREE.Vector3();
          this._tipA = new THREE.Vector3();
          this._tipB = new THREE.Vector3();
          this._muzzlePos = new THREE.Vector3();
          this._muzzleDir = new THREE.Vector3();
          this._headDir = new THREE.Vector3();
          this._quat = new THREE.Quaternion();
          this._delta = new THREE.Vector3();
          this._heldPool = []; // reused entries behind HELD_ITEMS
          this._hotPool = []; // reused entries behind HOT_POINTS
          this._containerPool = []; // and behind OPEN_CONTAINERS
          this._scratch = new THREE.Vector3();
          this._blowing = {}; // per-hand latch, so one raise of the barrel is one gust
        },

        tick: function (time, dt) {
          var dtSeconds = Math.min((dt || 16) / 1000, 0.05);
          FRAME_STAMP++; // see gatherShootableRoots
          // Anything that asked to stop existing during the last frame
          // actually goes here, where nothing is mid-iteration.
          sweepDoomed();
          this.updateHeldItems();
          this.updateWind();
          if (this.mouthEl) this.mouthEl.object3D.getWorldPosition(this._mouthPos);
          // Hot points first: fires, lit tips, hot barrels. Droplets,
          // puddles and lightables all ask the same question this
          // frame, so it gets answered once.
          this.updateHotPoints();
          this.updateContainers();
          this.updatePools(time, dtSeconds);
          this.updateParticles(dtSeconds);
          this.updateIgnition();
          this.updateBlow();
        },

        // One scan of the scene per frame, shared by every anchor-slot
        // indicator. Vectors are pooled rather than reallocated, since
        // this runs every frame forever.
        updateHeldItems: function () {
          var items = document.querySelectorAll('.grabbable');
          var count = 0;
          HELD_ITEMS.length = 0;

          for (var i = 0; i < items.length; i++) {
            var holsterable = items[i].components.holsterable;
            if (!holsterable || holsterable.state !== 'held') continue;

            if (!this._heldPool[count]) this._heldPool[count] = { rank: 0, pos: new THREE.Vector3() };
            var entry = this._heldPool[count];
            items[i].object3D.getWorldPosition(entry.pos);
            entry.rank = SLOT_SIZE_RANK[holsterable.data.itemSize];
            HELD_ITEMS.push(entry);
            count++;
          }
        },

        // A snapshot of where the hands are and how fast they're
        // moving, taken once and reused by every puff of smoke.
        updateWind: function () {
          var hands = document.querySelectorAll('.hand');
          WIND_HANDS.length = 0;

          for (var i = 0; i < hands.length; i++) {
            var handRig = hands[i].components['hand-rig'];
            if (!handRig) continue;
            if (handRig.velocity.length() < WIND_HAND_MIN_SPEED) continue;

            hands[i].object3D.getWorldPosition(this._handPos);
            WIND_HANDS.push({ pos: this._handPos.clone(), vel: handRig.velocity.clone() });
          }
        },

        // Every source of ignition in the world, in one flat list of
        // positions: lit cigars, hot barrels, burning ground, and
        // every flame currently in the air. Droplets, pools and
        // lightables all ask the same question each frame, so it gets
        // answered once — and fire being IN this list is the whole
        // reason fire lights things without fire knowing what a cigar
        // is.
        updateHotPoints: function () {
          HOT_POINTS.length = 0;
          var self = this;

          function add(pos, el) {
            if (!self._hotPool[HOT_POINTS.length]) {
              self._hotPool[HOT_POINTS.length] = { pos: new THREE.Vector3(), el: null };
            }
            var entry = self._hotPool[HOT_POINTS.length];
            entry.pos.copy(pos);
            entry.el = el || null;
            HOT_POINTS.push(entry);
          }

          var sources = document.querySelectorAll('[ignition-source]');
          for (var i = 0; i < sources.length; i++) {
            var source = sources[i].components['ignition-source'];
            if (!source || !source.hot) continue;
            source.tipObject().getWorldPosition(this._scratch);
            add(this._scratch, sources[i]);
          }

          for (var j = 0; j < POOLS.length; j++) {
            if (!LIQUIDS[POOLS[j].type].isFire) continue;
            // Measured at the middle of the flame rather than at the
            // ground it stands on, or liquid poured through a fire
            // passes straight over the top of it without catching.
            poolPosition(POOLS[j], this._scratch);
            this._scratch.y += FIRE_MIN_RADIUS + (FIRE_MAX_RADIUS - FIRE_MIN_RADIUS) *
              Math.sqrt(Math.min(POOLS[j].radius / POOL_REFERENCE_RADIUS, 1));
            add(this._scratch);
          }

          for (var k = 0; k < PARTICLES.length; k++) {
            var p = PARTICLES[k];
            if (p.dead || p.kind !== 'liquid' || p.liquid !== 'fire') continue;
            add(p.el.object3D.position);
          }
        },

        // Pools: evaporate, burn down, throw flames, and scorch
        // whatever is standing in them.
        updatePools: function (time, dtSeconds) {
          var brightest = null;

          this.minglePools(dtSeconds);

          for (var i = POOLS.length - 1; i >= 0; i--) {
            var pool = POOLS[i];
            var liquid = LIQUIDS[pool.type];
            pool.age += dtSeconds * 1000;
            if (pool.dousedUntil > 0) pool.dousedUntil -= dtSeconds * 1000;

            if (liquid.isFire) {
              this.updateFirePool(pool, time, dtSeconds);
              if (!brightest || pool.radius > brightest.radius) brightest = pool;
            } else {
              if (pool.flame) pool.flame.setAttribute('visible', false);
              // Drying out is a size, not a timer: a puddle shrinks at
              // its liquid's own rate, so a big spill lasts longer than
              // a splash for the obvious reason rather than because
              // something is counting. (Different rates per SURFACE —
              // a bar top versus dirt — are in todo.md.)
              if (liquid.dryRate) pool.radius -= liquid.dryRate * dtSeconds;
              if (liquid.flammable && pool.dousedUntil <= 0) this.checkPoolIgnition(pool);
            }

            if (pool.radius <= POOL_MIN_RADIUS) {
              releasePool(i);
              continue;
            }

            // The last of it thins out rather than blinking away.
            this.drawPool(pool, liquid, Math.min(pool.radius / (POOL_MIN_RADIUS * 5), 1));
          }

          var light = ensureFireLight(this.el.sceneEl);
          if (brightest) {
            light.position.set(brightest.x, brightest.y + 0.25, brightest.z);
            light.intensity =
              Math.min((brightest.radius / POOL_REFERENCE_RADIUS) * FIRE_LIGHT_MAX, FIRE_LIGHT_MAX) *
              (0.82 + 0.18 * Math.sin((time / 1000) * FIRE_WIGGLE_HZ * 1.7));
          } else {
            light.intensity = 0;
          }
        },

        // ==========================================================
        // POOLS RUNNING TOGETHER
        // Every pair of same-liquid puddles that overlap, once a frame.
        // Two things pass between them and both are proportional to how
        // much they overlap, so touching at the edges barely does
        // anything and sitting on top of each other resolves fast:
        //
        //   - AREA flows from the smaller into the larger. Area, not
        //     radius, because area is how much liquid there is — a
        //     puddle that doubles in radius holds four times the beer,
        //     and fire's fuel is measured the same way. Big puddles
        //     therefore eat small ones, which is what keeps the count
        //     down now that nothing is capped or culled.
        //   - The two SLIDE, toward each other or apart depending on
        //     the liquid's cohesion. Water pulls together hardest and
        //     drops become one drop. Fire's is negative, so patches
        //     shove each other outward and a fire crawls instead of
        //     balling up and going out.
        //
        // The smaller one does most of the moving, since the bigger one
        // is more liquid to shift. O(n²) over sixty discs is nothing —
        // a circle overlap test is two multiplies.
        // ==========================================================
        minglePools: function (dtSeconds) {
          for (var i = 0; i < POOLS.length; i++) {
            var a = POOLS[i];
            var liquid = LIQUIDS[a.type];

            for (var j = i + 1; j < POOLS.length; j++) {
              var b = POOLS[j];
              if (b.type !== a.type) continue;
              if (Math.abs(a.y - b.y) > 0.06) continue; // the bar and the floor are different places

              var dx = b.x - a.x;
              var dz = b.z - a.z;
              var d = Math.sqrt(dx * dx + dz * dz);
              var reach = a.radius + b.radius;
              if (d >= reach) continue;

              var small = a.radius <= b.radius ? a : b;
              var large = small === a ? b : a;
              var overlap = Math.min((reach - d) / Math.max(small.radius * 2, 0.001), 1);

              var moved =
                Math.PI * small.radius * small.radius * POOL_FLOW_RATE * (liquid.flow || 1) * overlap * dtSeconds;
              small.radius = Math.sqrt(Math.max(Math.PI * small.radius * small.radius - moved, 0) / Math.PI);
              large.radius = Math.sqrt((Math.PI * large.radius * large.radius + moved) / Math.PI);

              var cohesion = liquid.cohesion || 0;
              if (!cohesion || d < 0.0001) continue;

              var pull = POOL_DRIFT_RATE * cohesion * overlap * dtSeconds;
              var total = a.radius + b.radius;
              var aShare = total > 0.0001 ? b.radius / total : 0.5;
              a.x += (dx / d) * pull * aShare;
              a.z += (dz / d) * pull * aShare;
              b.x -= (dx / d) * pull * (1 - aShare);
              b.z -= (dz / d) * pull * (1 - aShare);
            }
          }
        },

        // A burning patch consumes itself, keeps a steady flame, and
        // spits droplets. The droplets are what make it spread: they
        // land a little way off and start burning ground there.
        updateFirePool: function (pool, time, dtSeconds) {
          pool.radius -= POOL_BURN_RATE * dtSeconds;
          if (pool.radius <= 0.008) {
            pool.type = 'scorch';
            pool.needsColor = true;
            pool.radius = POOL_START_RADIUS * 2;
            pool.age = 0;
            if (pool.flame) pool.flame.setAttribute('visible', false);
            spawnSmoke(poolPosition(pool, this._scratch), null, 0.7);
            return;
          }

          var strength = Math.min(pool.radius / POOL_REFERENCE_RADIUS, 1);

          if (pool.flame) {
            pool.flame.setAttribute('visible', true);
            var phase = (time / 1000) * FIRE_WIGGLE_HZ + pool.phase;
            var height = FIRE_MIN_RADIUS + (FIRE_MAX_RADIUS - FIRE_MIN_RADIUS) * Math.sqrt(strength);
            var stretch = 1.7 + 0.35 * Math.sin(phase);
            pool.flame.object3D.scale.set(height * (1 + 0.12 * Math.sin(phase * 1.3)), height * stretch, height);
            pool.flame.object3D.position.set(0, height * stretch * 0.75, 0);
            pool.flame.object3D.rotation.set(0.12 * Math.sin(phase * 0.7), phase * 0.2, 0);
          }

          pool.jumpTimer -= dtSeconds * 1000;
          if (pool.jumpTimer <= 0) {
            pool.jumpTimer = FIRE_JUMP_INTERVAL_MS / Math.max(FIRE_JUMP_RATE * strength, 0.001);
            if (FIRE_JUMP_RATE > 0) jumpFlame(pool);
          }

          if (Math.random() < dtSeconds * 2.5 * strength) {
            spawnSmoke(poolPosition(pool, this._scratch), null, 0.6);
          }

          this.burnTargets(pool, dtSeconds);
        },

        // Alcohol catches from anything in HOT_POINTS — a dropped
        // match, a lit cigar, a hot barrel, a flame in the air, or
        // burning ground nearby.
        checkPoolIgnition: function (pool) {
          var reach = FIRE_SPREAD_RADIUS + pool.radius;
          for (var i = 0; i < HOT_POINTS.length; i++) {
            var pos = HOT_POINTS[i].pos;
            var dx = pos.x - pool.x;
            var dz = pos.z - pool.z;
            if (dx * dx + dz * dz > reach * reach) continue;
            if (pos.y - pool.y > FIRE_SPREAD_RADIUS || pos.y < pool.y - 0.3) continue;

            ignitePool(pool);
            return;
          }
        },

        // Anything that can be knocked down can be burnt down. A target
        // standing in a flame goes over exactly as if it had been shot,
        // through pop-target's own fall() — fire has no idea what a
        // target is beyond that.
        burnTargets: function (pool, dtSeconds) {
          pool.damageTimer = (pool.damageTimer || 0) - dtSeconds * 1000;
          if (pool.damageTimer > 0) return;
          pool.damageTimer = FIRE_DAMAGE_DELAY_MS;

          var hinges = document.querySelectorAll('[pop-target]');
          var reach = FIRE_DAMAGE_RADIUS + pool.radius;

          for (var i = 0; i < hinges.length; i++) {
            var popTarget = hinges[i].components['pop-target'];
            if (!popTarget || popTarget.fallen) continue;

            hinges[i].object3D.getWorldPosition(this._scratch);
            var dx = this._scratch.x - pool.x;
            var dz = this._scratch.z - pool.z;
            if (dx * dx + dz * dz > reach * reach) continue;

            var manager = document.querySelector('#range-manager');
            if (manager) manager.emit('ring-hit', { score: FIRE_DAMAGE_SCORE, label: 'BURNED' }, false);
            popTarget.fall();
          }
        },

        drawPool: function (pool, liquid, fade) {
          pool.el.object3D.position.set(pool.x, pool.y + 0.004, pool.z);
          if (pool.disc) pool.disc.object3D.scale.setScalar(pool.radius);

          var mesh = pool.disc && pool.disc.getObject3D('mesh');
          if (!mesh || !mesh.material) return;

          if (pool.needsColor) {
            mesh.material.color.set(liquid.poolColor);
            pool.needsColor = false;
          }
          mesh.material.opacity = liquid.poolOpacity * fade;
        },


        updateParticles: function (dtSeconds) {
          // Length is captured up front and nothing is removed inside
          // the loop: several of the branches below spawn particles of
          // their own (a droplet landing makes a splash, catching light
          // makes sparks), and anything appended is simply picked up
          // next frame. See addParticle/killParticle for the other half
          // of this rule.
          var count = PARTICLES.length;

          for (var i = 0; i < count; i++) {
            var p = PARTICLES[i];
            if (p.dead) continue;

            p.age += dtSeconds * 1000;

            if (p.age >= p.life) {
              killParticle(p);
              continue;
            }

            var t = p.age / p.life;
            var obj = p.el.object3D;

            if (p.kind === 'debris') {
              p.vel.y -= GRAVITY * dtSeconds;
              obj.position.addScaledVector(p.vel, dtSeconds);
              if (obj.position.y <= p.restY) {
                obj.position.y = p.restY;
                p.vel.y *= -0.35; // a shard bounces once or twice, then gives up
                p.vel.x *= 0.6;
                p.vel.z *= 0.6;
              }
              if (p.angVel) {
                obj.rotation.x += p.angVel.x * dtSeconds;
                obj.rotation.y += p.angVel.y * dtSeconds;
                obj.rotation.z += p.angVel.z * dtSeconds;
              }
            } else if (p.kind === 'liquid') {
              var liquid = LIQUIDS[p.liquid] || LIQUIDS.beer;

              p.vel.y -= GRAVITY * liquid.gravity * dtSeconds;
              // A touch of ongoing wander on top of the heading it was
              // born with, so a flame in particular meanders rather
              // than travelling like a thrown bead.
              if (liquid.drift) {
                p.vel.x += (Math.random() - 0.5) * liquid.drift * dtSeconds;
                p.vel.z += (Math.random() - 0.5) * liquid.drift * dtSeconds;
              }
              obj.position.addScaledVector(p.vel, dtSeconds);

              // A flame in the air writhes rather than sitting there
              // as a bead — same trick the steady flame on a burning
              // pool uses, at droplet scale.
              if (liquid.isFire) {
                var flamePhase = (p.age / 1000) * FIRE_WIGGLE_HZ + p.phase;
                obj.scale.set(
                  p.baseScale * (0.85 + 0.2 * Math.sin(flamePhase * 1.3)),
                  p.baseScale * (1.6 + 0.4 * Math.sin(flamePhase)),
                  p.baseScale
                );
              }

              // THIS is drinking. A poured droplet that reaches your
              // mouth goes down your throat — there is no separate
              // "am I drinking" check anywhere, just beer and a head
              // in the way of it.
              if (this.mouthEl && obj.position.distanceTo(this._mouthPos) < DROPLET_SWALLOW_RADIUS) {
                this.swallow(liquid);
                killParticle(p);
                continue;
              }

              if (this.updateLiquidContact(p, obj, liquid)) {
                killParticle(p);
                continue;
              }

              // Poured into something that's open. Filling a tank is
              // just liquid landing somewhere that happens to be a
              // container, which is why the pour that fills it is the
              // same pour that fills your mouth.
              if (this.fillContainer(p, obj)) {
                killParticle(p);
                continue;
              }

              if (this.landLiquid(p, obj)) {
                killParticle(p);
                continue;
              }
            } else {
              p.vel.y += SMOKE_RISE * dtSeconds;
              this.applyWind(p, dtSeconds);
              p.vel.multiplyScalar(Math.max(1 - SMOKE_DRAG * dtSeconds, 0));
              obj.position.addScaledVector(p.vel, dtSeconds);
              obj.scale.setScalar(p.baseScale * (1 + SMOKE_GROWTH * t));
            }

            var mesh = p.el.getObject3D('mesh');
            if (mesh && mesh.material) {
              // Pooled entities keep whatever colour the last particle
              // left behind, so it's re-applied once on the first
              // frame this one is alive.
              if (p.needsColor) {
                mesh.material.color.set(p.color);
                p.needsColor = false;
              }
              // Smoke holds its opacity most of its life and then goes;
              // debris fades only at the very end so shards read as
              // solid glass while they're bouncing.
              mesh.material.opacity = p.kind === 'smoke' ? p.opacity * (1 - t * t) : p.opacity * Math.min((1 - t) * 4, 1);
            }
          }

          sweepParticles();
        },

        // Drinking, and the one joke the unified system produced for
        // free: if fire is a liquid and liquid that reaches your mouth
        // gets swallowed, then yes, you can drink fire. It costs you
        // nothing but dignity — a lungful of smoke, a jolt of nicotine,
        // and it burns off some of what you'd already drunk.
        swallow: function (liquid) {
          if (liquid.drink === 'sober') {
            VICES.alcohol = Math.max(VICES.alcohol - WATER_SOBER_PER_DROPLET, 0);
            this.glug();
          } else if (liquid.drink === 'burn') {
            addNicotine(FIRE_DRINK_NICOTINE);
            VICES.alcohol = Math.max(VICES.alcohol - FIRE_DRINK_BURN_OFF, 0);
            if (this.mouthEl) {
              this.mouthEl.object3D.getWorldPosition(this._scratch);
              for (var i = 0; i < 3; i++) spawnSmoke(this._scratch, null, 0.9);
              spawnSparks(this._scratch, 4);
            }
          } else {
            addAlcohol(ALCOHOL_PER_DROPLET);
            this.glug();
          }
        },

        // What a droplet does when it meets something hot or something
        // burning, in mid-air. Alcohol CATCHES — it doesn't spawn a
        // fire beside itself, it becomes a fire droplet and carries on
        // falling, which is why pouring onto a flame sets the stream
        // alight and drops burning liquid on the floor. Water does the
        // reverse.
        updateLiquidContact: function (p, obj, liquid) {
          if (liquid.douses) {
            return douseFires(obj.position, WATER_DOUSE_RADIUS, WATER_DOUSE_FUEL);
          }
          if (!liquid.flammable) return false;

          for (var i = 0; i < HOT_POINTS.length; i++) {
            if (obj.position.distanceTo(HOT_POINTS[i].pos) > DROPLET_IGNITE_RADIUS) continue;

            p.liquid = 'fire';
            p.baseScale = LIQUIDS.fire.dropRadius;
            p.needsColor = true;
            p.color = LIQUIDS.fire.dropColor;
            p.life = FIRE_DROPLET_LIFETIME_MS;
            p.age = 0;
            return false; // it keeps falling, as fire
          }
          return false;
        },

        // Every open container, refreshed once a frame the same way
        // hot points are, since every droplet in the air asks.
        updateContainers: function () {
          OPEN_CONTAINERS.length = 0;
          var tanks = document.querySelectorAll('[liquid-tank]');
          for (var i = 0; i < tanks.length; i++) {
            var tank = tanks[i].components['liquid-tank'];
            if (!tank || !tank.isOpen()) continue;
            if (!this._containerPool[OPEN_CONTAINERS.length]) {
              this._containerPool[OPEN_CONTAINERS.length] = { pos: new THREE.Vector3(), tank: null };
            }
            var entry = this._containerPool[OPEN_CONTAINERS.length];
            tank.mouthWorldPosition(entry.pos);
            entry.tank = tank;
            OPEN_CONTAINERS.push(entry);
          }
        },

        fillContainer: function (p, obj) {
          for (var i = 0; i < OPEN_CONTAINERS.length; i++) {
            if (obj.position.distanceTo(OPEN_CONTAINERS[i].pos) > TANK_MOUTH_RADIUS) continue;
            OPEN_CONTAINERS[i].tank.fill(p.liquid || 'beer');
            return true;
          }
          return false;
        },

        // Where liquid ends up: a droplet meets a surface and stops
        // being a droplet. Any registered hard surface counts, not just
        // the floor, so you can pour along the bar — and set the bar
        // alight. This is also the step that makes fire spread, since a
        // jumped flame landing here is what starts the next patch of
        // burning ground.
        landLiquid: function (p, obj) {
          var surfaceY = null;

          if (obj.position.y <= p.restY) {
            surfaceY = 0;
          } else {
            for (var i = 0; i < HARD_SURFACES.length; i++) {
              var s = HARD_SURFACES[i];
              if (s.y <= 0) continue; // the ground is handled above, by restY
              if (obj.position.y > s.y + 0.02 || obj.position.y < s.y - 0.12) continue;
              if (!overSurface(s, obj.position)) continue;
              surfaceY = s.y;
              break;
            }
          }

          if (surfaceY === null) return false;

          var type = p.liquid || 'beer';
          var amount = LIQUIDS[type].isFire ? FIRE_LANDING_SPILL : POOL_GROWTH_PER_DROPLET;
          addToPool(obj.position, surfaceY, type, amount);

          if (!LIQUIDS[type].isFire) {
            spawnDebris(obj.position, {
              count: 1,
              color: LIQUIDS[type].dropColor,
              size: 0.008,
              speed: 0.4,
              life: 400,
            });
          }
          return true;
        },

        retireParticle: function (index) {
          if (PARTICLES[index]) killParticle(PARTICLES[index]);
        },

        // Rate-limited so a full stream of beer doesn't fire the
        // sound sixty times a second.
        glug: function () {
          var now = performance.now();
          if (this._lastGlug && now - this._lastGlug < GLUG_MIN_INTERVAL_MS) return;
          this._lastGlug = now;
          playGlug();
        },

        // Sweeping a hand through a cloud drags it along. This is the
        // reliable way to clear your own gun smoke; the blow gust
        // below is the showy one.
        applyWind: function (p, dtSeconds) {
          for (var i = 0; i < WIND_HANDS.length; i++) {
            this._delta.copy(p.el.object3D.position).sub(WIND_HANDS[i].pos);
            var d = this._delta.length();
            if (d > WIND_HAND_RADIUS) continue;

            var falloff = 1 - d / WIND_HAND_RADIUS;
            p.vel.addScaledVector(WIND_HANDS[i].vel, WIND_HAND_FACTOR * falloff * dtSeconds);
          }
        },

        // Every unlit lightable checked against every hot ignition
        // source. Both lists are tiny (a handful of cigars, two guns),
        // and neither side knows what the other is.
        updateIgnition: function () {
          var lightables = document.querySelectorAll('[lightable]');
          if (!lightables.length || !HOT_POINTS.length) return;

          for (var i = 0; i < lightables.length; i++) {
            var lightable = lightables[i].components.lightable;
            if (!lightable || lightable.lit || lightable.blocked) continue;
            lightable.tipObject().getWorldPosition(this._tipA);

            for (var j = 0; j < HOT_POINTS.length; j++) {
              if (HOT_POINTS[j].el === lightables[i]) continue;
              if (this._tipA.distanceTo(HOT_POINTS[j].pos) < IGNITE_RADIUS) {
                lightable.ignite();
                break;
              }
            }
          }
        },

        // Raising a gun barrel up in front of your face blows the
        // smoke off it. There's no breath sensor on a headset, so the
        // gesture is the input — bring the muzzle to your mouth,
        // pointed up, and the cloud in front of you scatters.
        updateBlow: function () {
          if (!this.mouthEl || !this.cameraEl) return; // _mouthPos is refreshed once per frame in tick

          var hands = document.querySelectorAll('.hand');
          for (var i = 0; i < hands.length; i++) {
            var handRig = hands[i].components['hand-rig'];
            if (!handRig) continue;

            var armed = false;
            for (var j = 0; j < handRig.heldObjects.length; j++) {
              var muzzleEl = handRig.heldObjects[j].querySelector('.muzzle');
              if (!muzzleEl || !handRig.heldObjects[j].components.firearm) continue;

              muzzleEl.object3D.getWorldPosition(this._muzzlePos);
              if (this._muzzlePos.distanceTo(this._mouthPos) > BLOW_RADIUS) continue;

              muzzleEl.object3D.getWorldQuaternion(this._quat);
              this._muzzleDir.set(0, 0, -1).applyQuaternion(this._quat);
              if (this._muzzleDir.y < BLOW_UP_DOT) continue;

              armed = true;
              break;
            }

            var key = 'hand' + i;
            if (armed && !this._blowing[key]) this.blow();
            this._blowing[key] = armed;
          }
        },

        blow: function () {
          this.cameraEl.object3D.getWorldQuaternion(this._quat);
          this._headDir.set(0, 0, -1).applyQuaternion(this._quat).normalize();

          for (var i = 0; i < PARTICLES.length; i++) {
            var p = PARTICLES[i];
            if (p.kind !== 'smoke') continue;
            if (p.el.object3D.position.distanceTo(this._mouthPos) > BLOW_GUST_RADIUS) continue;

            p.vel.addScaledVector(this._headDir, BLOW_GUST_SPEED);
            p.vel.y += 0.6;
            p.age += p.life * 0.25; // blown smoke also thins out faster than it would on its own
          }

          // A visible breath, so the gesture reads even when there's
          // nothing to clear.
          this._delta.copy(this._mouthPos).addScaledVector(this._headDir, 0.12);
          for (var k = 0; k < 2; k++) {
            spawnSmoke(this._delta, this._headDir.clone().multiplyScalar(2.2), 0.5);
          }
        },
      });
