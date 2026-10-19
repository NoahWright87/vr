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
- **Town upgrades as a money sink.** Fix up the attraction. Several
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

## Owned guns (open design problem)

Today a gun is a world object: wall racks restock and dropped guns
eventually disappear (DESIGN.md "Stock and perishing"). A gold-plated
gun *you own* is a new kind of thing. It has to come back to you
instead of disappearing, and other players need to see the finish.
Simplest version: a finish is a cosmetic setting on whatever gun you
hold ("your guns look gold"), not an object you own. Decide when gun
finishes are first built. Not before phase 02-C.

## Open questions

- **When does the stock rotate?** Animal Crossing ties it to the real
  calendar date. **Suggestion:** pick the stock from today's date, so
  every friend's shop has the same stock that day ("dude, the sparkly
  boots are in!").
- Price bands and payout amounts: tune by feel once phase 02 can be
  played.
- What do town upgrades actually add (new hangout spaces, new duel
  places, new shops)? Rewrite this in phase 05.
