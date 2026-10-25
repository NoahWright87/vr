# Economy: money in, money out, all the time

This is a fun game, not a serious economy. Earning money is only fun
if it's useful, and spending is only fun when you have plenty. The
model is Animal Crossing: you can soon afford almost anything, and
you're mostly waiting for it to show up in the shop.

## Decisions

- **Currency is `$`.** No name needed.
- **Money is easy to come by.** Duel payouts, wanted-poster bounties,
  style bonuses (so losing in style still pays), medals, small daily
  things.
- **Items are cheap and there are loads of them, but only a handful
  are on display at once.** The clothier (Boots & Suits) rotates its
  stock.
- **Big-ticket silly items** (golden toilet tier) give you something to
  save toward once you've got everything else.
- **Town upgrades as a money sink.** Fix up the town. Several
  buildings are empty shells today (Bank, Pharmacy, Post Office,
  General Store in `world-hub-interiors.js`), and paying to fix them
  up is progress you can see.
- **No real money.** Cosmetics are bought with in-game `$` only.

## The catalog

Cosmetics fill wardrobe slots (`wardrobe.todo.md`). They never change
hit zones, so they're purely for looks:

- big belt buckles
- ridiculous hats
- sparkly boots
- bedazzled gloves
- bandanas, vests
- gun finishes (gold plating, see below)

Everything is data: id, slot, price, how rare it is in the rotation,
and its look.

## Collecting, not time-gating progress

- **Several shops can rotate their stock by date**: the clothier for
  sure, probably the General Store for gun customizations, and maybe
  more later. Each is a catalog plus a display, and adding one is data
  (`town.todo.md` "Extension points").
- **What you buy is yours for good.** It goes into your wardrobe (or
  your gun customizations) as a collection, and you change into it any
  time at the clothier or from the watch menu.
- The date only gates *shopping*. The fight ladder and activity
  progression aren't on a timer (`dueling.todo.md`,
  `activities.todo.md`).

## Your gear (gun customization)

You customize the guns you carry around normally: finishes (gold
plating, bedazzling), grips, engraving. Those are cosmetics you
collect like clothes.

Open design problem: today a gun is a world object. Wall racks restock
and dropped guns eventually disappear (DESIGN.md "Stock and
perishing"). The simplest fit is that a customization is a cosmetic
setting applied to **your carried guns** (the ones in your own
holsters), not a separate object you own. Then a lost gun doesn't lose
you anything, and a new one from a rack becomes "yours" once
holstered. Other players need to see it. Decide when customizations
are first built. Duels can take over with their own weapons
(`deck.todo.md` "Weapons in a fight").

## Open questions

- **When does the stock rotate?** Animal Crossing ties it to the real
  calendar date. **Suggestion:** pick the stock from today's date, so
  every friend's shop has the same stock that day ("dude, the sparkly
  boots are in!").
- Price bands and payout amounts: tune by feel once phase 02 can be
  played.
- What do town upgrades actually add (new hangout spaces, new duel
  places, new shops)? Rewrite this in phase 05.
