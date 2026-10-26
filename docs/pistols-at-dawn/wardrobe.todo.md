# Wardrobe: your costume is your health bar

You're a ghost. You can't be hurt, but you *can* have your cowboy
costume shot off. Each worn item is a hit, and a ghost wearing nothing
has lost. This is the game's damage system, and it should feel like a
slapstick scramble: your hat goes flying, you want it back, and you
end up in weird combinations of other people's outfits.

## What exists today (as of this plan)

- The **head** (`#head-anchor`, under the camera), **waist**
  (`#waist-anchor`) and **chest** (`#chest-anchor`) are `anchor-slot`s
  with `swap: true`, defined in `games/pistols-at-dawn/index.html`.
  The back (`#back-anchor`) holds the shotgun and isn't wardrobe.
- The waist starts with `belt-classic`, and **the belt carries the two
  hip holsters**: `belt` in `js/core-equip.js` builds its own small
  `belt-hip-N` slots. The chest starts with `vest-classic` and its
  blade packs. Hats are `boxy-hat` / `hat-tan` in
  `js/world-player-body.js`.
- The ghost body is `boxy-ghost`. There's a `#mirror` so you can see
  yourself.
- **The problem:** worn items are ordinary grabbable things. Reaching
  for a gun at your hip often grabs the whole belt (holsters, guns and
  all). It needs fixing in its own right, apart from everything else
  in this plan.

## Decisions

- **Wardrobe slots are fixed and change only on purpose.** During play
  you can't grab a worn item off your own body. Outfits change only at
  the clothier (Boots & Suits, mirror) or from a watch-menu Wardrobe
  page. This should be a general `anchor-slot` option (a locked slot),
  not a special case for belts: "If you find yourself writing
  `if (thing === 'bottle')`, stop."
- **Things *in* worn items stay usable.** Drawing a pistol from a belt
  holster or a knife from a vest pack still works. The belt itself is
  what's locked.
- **Hat tipping is allowed.** Grabbing the brim of a worn hat lifts it
  with your hand, and letting go always puts it back on your head. It
  never drops, so it can't happen by accident in a fight. Announce it
  (e.g. a `hat-tipped` event) so the style system can reward tipping
  your hat to an opponent mid-duel.
- **Every wardrobe slot has the same size hit zone**, and it belongs to
  the slot, not the item. A giant sombrero is no easier to hit than a
  beanie. Cosmetics never affect gameplay.
- **The ghost body itself isn't shootable.** A shot through a bare
  chest passes straight through. The less you wear, the less of you
  there is to hit.
- **A hit knocks the item loose.** It becomes an ordinary physical
  object carrying the shot's velocity (the same throw path explosions
  use, DESIGN.md "Explosions"), and the slot empties. A loose costume
  item is shootable like anything else, so you can keep shooting
  someone's hat further down the street.
- **A loose costume item must not perish** (`perishable`) while a
  match is on. It's somebody's health bar.
- **Rental costume.** Everyone always starts a match with every slot
  filled. Players who haven't bought anything wear the free
  rental, and buying only changes looks.

## Which slots

To decide in phase 01-A by trying it out. Suggested start: **hat,
vest, belt, boots**, then add **gloves** and **bandana** once the hit
zones feel right.

- Hands are tracked, so a glove hit zone moves a lot. Is that fun or
  just hard?
- Feet aren't tracked. Boots would sit at an estimated position the
  way `body-anchor` already estimates hips (from the headset's
  position and turn).
- Gloves come in pairs. Probably one item that pops both off together.

## The belt question

If the belt is shot off, what happens to the holstered guns?
**Default for playtesting:** the belt flies off (or goes to the
shooter under conservation of clothes) and its holstered items fall
loose at the victim's feet, so you can grab your guns back. Sending
your guns to the shooter would snowball, which goes against the
party-game balance. The other option is moving the holsters onto the
body so the belt is purely cosmetic. Decide after playtesting.

## Rule options (per match, host's choice)

| Rule | What happens to a knocked-off item |
|---|---|
| **Conservation of clothes** (default) | Flies to the shooter's matching slot if it's empty. Otherwise it drops loose. The total amount of gear stays the same. |
| Retrieve own | Drops loose. Only its owner can put it back on. |
| Anyone's | Drops loose. Anybody can pick it up and wear it in a matching empty slot. |
| Hardcore | Drops loose. Nobody can put clothes back on. |
| Anything's a hat | Any object that fits a slot counts as clothing. Hat stabbed off in a bar fight? Put a beer bottle or a stool on your head. (Slots already don't ask what you put in them, DESIGN.md.) |

Conservation of clothes balances itself: whoever's losing wears less
and gets harder to hit, and whoever's winning wears more and gets
easier to hit. That's the opposite of a killstreak, and it's what we
want for a party game.

Putting an item back on mid-match is the one exception to "only on
purpose": you can return an item to an **empty** slot of the right
type while the rules allow it. That's how you get your hat back.

## Fire and explosions

- **Explosions only strip you through shrapnel.** A blast throws out
  shrapnel projectiles, and each one is an ordinary hit. No blast
  radius. Otherwise explosives would beat everything.
- **Fire from an explosion is fire projectiles.** This mostly happens
  already (explosions spill burning fuel). A burning drop that lands on
  a worn item **sets it alight**.
- **A burning item pops off after a couple of seconds** unless you put
  it out. Pat it with your hand (the "hand hits a small object fast"
  check already exists for bottle caps and matches) or douse it with
  water (fire is a liquid, and water already puts it out). So fire
  isn't too strong, and patting your own flaming hat is great
  slapstick.

## Open questions

- Exact slot list and how many lives that gives (4–6?).
- Should an outfit shown in the menu use the slot's name or the item's?
- Spectators in Boot Hill (see `dueling.todo.md`) have no clothes. Do
  they get a sad bedsheet?
