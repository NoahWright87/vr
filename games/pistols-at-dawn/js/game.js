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
      // headset. (Most subsystems now keep their own tuning constants
      // in their own file — see DESIGN.md's "File structure" section —
      // what's left here is genuinely shared across more than one.)
      // ==============================================================
      var GRAVITY = 9.8; // real-world value, used for the drop/tumble simulation
      var GROUND_REST_Y = 0.05; // meters — half the gun's resting thickness off the floor

      // Also read by castShot/findLookTarget (see items-guns.js and
      // core-equip.js's computeThrowVelocity) for the raycaster's far
      // distance and a miss tracer's length alike.
      var MAX_SHOT_RANGE = 20; // meters

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
