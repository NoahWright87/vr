# Process: making rare headset time count

Headset testing doesn't happen often, so every PR should make the next
headset session as focused as possible, and as much as possible should
be testable without one.

## Decisions

- **A pull request template for the whole repo** (all VR games, not
  just Pistols) with a **headset playtest checklist** section: concrete
  things to try in the headset and what "good" looks like. For example:
  "draw from the left holster ten times. The belt should never come
  off." Not "test the wardrobe." Every phase file already ends with
  what needs a headset, and that list is what goes into the PR's
  checklist.
- The template also keeps the non-headset parts honest: what was
  tested headlessly (Playwright, `node --test`) and what wasn't.
- **A Utilities section on the site** for non-VR helper tools: the
  Voice Lab, the Ghost Lab, and whatever comes next. Either a section
  on the landing page or a gear icon on the Pistols at Dawn card (some
  tools serve only Pistols, so the icon may be the nicer fit). The
  landing page is `src/App.jsx`.

## Ongoing habits

- When something can be tuned on a regular web page instead of in VR,
  consider building the page (`platforms.todo.md` "Non-VR tools").
- Placeholder assets are always marked (`aesthetic.todo.md`).
- Every new system answers "what's its data file?" (`town.todo.md`
  "Extension points").

Setting these up is `phase00.todo.md`.
