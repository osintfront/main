# Deep analysis — nested terms menu (short design, approved 2026-11-13)

## Why
A long linked phrase can hold another term, e.g. "כוחות היבשה של **משמרות המהפכה**". Today the
longest name wins and the inner term disappears inside the link, so the reader cannot open the
entry for "משמרות המהפכה" from there.

## What
1. **Window:** a term link that holds other event terms opens a small menu on click: the full
   phrase first, then the inner terms in reading order. Choosing one opens its entry window as
   today. A link with no inner term opens directly, as today.
2. **AI editor:** when a marked name contains another name worth marking (a unit / branch of an
   organisation, a title with a person's name), mark both — new events only.
3. **Old events:** no backfill. An inner term appears if an entry for it already exists (the
   server already adds existing entries whose name is in the text) or staff mark it with "Analyze".

## Approaches
- **Chosen — menu over existing terms:** only offers terms the event already has, so every option
  can be written within the reader's quota; the server's rules stay unchanged.
- Rejected — split phrases by words like "של": options that are not terms cannot be written by
  subscribers without opening free-text writing (budget abuse).
- Rejected — client only: the editor rarely marks the inner name, so the menu would rarely appear.

## Calls made by the builder
- Readers without the feature (guests / Free) see no menu: the click opens the gate, as today.
- Inner terms are not counted as "used": the same term can still link on its own later in the window.
- The menu closes on outside click, Escape (without closing the event window) and scroll.
