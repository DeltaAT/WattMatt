# Tournament Rules (normative)

This document is the **single source of truth** for the tournament algorithm.
Code must match it. If reality disagrees with this document, open an issue — do not
improvise in code.

## 0. Vocabulary

- **Group** (`Gruppe`) — a participating unit: one player or a team. Identified by a **number**
  from the moment it is created. It gets a **name** only in the naming phase.
- **Table** (`Tisch`) — a physical playing surface. A table is `FREE`, `OCCUPIED` or `DISABLED`.
  A `DISABLED` table is one the host has taken out of service — a wobbly leg, a spilled drink —
  and is never offered to a queued match. Tables may be created, renamed, reordered, taken out
  of service and deleted **at any point of the tournament**, not only during `SETUP`: a table
  breaks during a round, not before it (issue #13). Table numbers follow the same rule as group
  numbers (§2): stable for the whole tournament and **never reused**, even after a table is
  deleted, so a match that records where it was played cannot come to mean another table. A
  table's *name* is the host's to change and must stay unique across tables.
- **Match** (`Partie`) — exactly two groups, or one group plus a bye.
- **Bye** (`Freilos`) — a group that advances without playing, because the count was odd.

## 1. Phases

```text
SETUP → QUALIFYING → REPECHAGE? → ELIMINATION* → NAMING → BRACKET → CEREMONY
```

`REPECHAGE` is skipped when it is not needed. `ELIMINATION` repeats.

The line above is a **track**, not a tournament. From the close of the `REPECHAGE` onwards a
second, parallel tournament may be running beside the main field — the `Trostrunde` of §10 —
and it runs **this same line** on its own field, on the same tables, in the same room. Every
round, lottery and tree carries a `track` (`MAIN` or `CONSOLATION`), and "the current phase" is
a question asked of one track at a time.

The side event's copy of the line differs in exactly one place: it skips `NAMING`, and
therefore ends at `BRACKET` rather than walking on to `CEREMONY`.

```text
CONSOLATION:  QUALIFYING → REPECHAGE? → ELIMINATION* → BRACKET
```

The two tracks are independent. The main field's phase machine neither waits for the side
event nor knows about it, and the side event is routinely several rounds behind.

## 2. SETUP

- The host creates tables (at least 1) and groups (at least 2) — groups via a `+` control.
- Groups are numbered `1..n` in creation order. Numbers are stable for the whole tournament
  and are never reused, even after a group is removed. "Never reused" is carried by a stored
  counter, `tournament.nextGroupNumber`, exactly as it is for tables: once `grp_3` is deleted
  nothing left in `groups` remembers that 3 is spent (issue #14, docs/OPEN-QUESTIONS.md #22).
- Groups may be added **at any point of the tournament**, not only during `SETUP` — a
  participant who turns up late is a real thing that happens. After the first draw the host is
  warned first: a group added then is not in the rounds already drawn (issue #14).
- A group that has already been drawn — into a match, a repechage draw or a bracket slot —
  cannot be **removed**. Those records name it, and a match against a group that no longer
  exists would show the audience a `Freilos` the draw never granted. Such a participant leaves
  the tournament by losing, by declining (§4), or by the host undoing back past the draw.
- The German word for a participant is the host's choice — `Gruppe`, `Team` or `Spieler`
  (`settings.participantLabel`). It changes UI copy only; the model is `Group` throughout —
  and since issue #75 it does not reach a beamer match card at all, which draws the bare
  number in a group round (docs/STYLEGUIDE.md §4).
- The tournament cannot start unless: `groups >= 2` and at least one table is **usable**, that
  is not `DISABLED` — a room whose only table has a wobbly leg is a room that cannot play. Both
  are checked before the host presses *Turnier starten*, with the reason stated in German
  (issue #15). Fewer tables than matches is **not** a blocker: matches queue (§3), and the host
  is warned with the estimated queue length rather than refused.
- Starting moves the phase `SETUP → QUALIFYING` and does nothing else. The draw of round 1 is a
  separate, explicit host action (issue #16, docs/OPEN-QUESTIONS.md #45).

## 3. QUALIFYING (round 1)

```text
P  := active groups, n := |P|, n >= 2
shuffle(P) using the seeded RNG
byes := the last `b` of the shuffle (see §4 fallback 1; `b` is 0 or 1 in the ordinary case)
pairs := the reading of the rest of that shuffle in which no two groups meet
         who have already played each other in this tournament
```

**No rematches.** In every randomly drawn round — the qualifying round, every elimination
round, and the **first** bracket round — two groups may not be paired if they have already
played each other at any earlier point in this tournament. Two groups meeting twice feels
unfair and reads as a bug from the third row.

The history is *derived* from the rounds and the bracket. It is never stored a second time:
a copy would drift from the matches the moment a host undid a round or corrected a result.

The pairing is searched for out of the shuffled order rather than filtered afterwards, so the
fairness still comes from the shuffle and the room still watches the same pot being emptied.
The search is bounded — a frozen host window mid-event is worse than any pairing.

**Fallback — no rematch-free pairing exists.** With a small field this is genuinely possible:
four groups in which everyone has played everyone admit no such pairing at all. The engine
detects it rather than looping, and then:

1. It takes the pairing with the **fewest** repeated meetings.
2. Those pairings are marked as repeats and named to the host.
3. The host confirms them **before the draw is published to the beamer**. Never silently.

Cancelling costs nothing: the draw is a preview, so the seed, the cursor and the history are
untouched and the same press of the button asks the identical question again.

**Table assignment.** Matches are assigned to `FREE` tables in draw order. If there are more
matches than tables, the remaining matches get status `WAITING_FOR_TABLE` and are queued.
When the host closes a match, its table returns to `FREE` and the next queued match is offered
to it — the host confirms, so nothing moves on the beamer without the host wanting it.

**Which free table comes next is configurable** (`settings.tableAssignmentOrder`, issue #101).
`ASCENDING` takes the first table of the host's list and is the default; `DESCENDING` takes the
last. Which end of a hall is the good end — nearest the beamer, the bar, the stage — is a
property of the room and nothing the app can work out, so it is the host's to set.

Three things it deliberately does not do:

- It orders the host's **list**, never a number parsed out of a label. Tables can be renamed and
  reordered (issue #13), so “the last table” means the last row of the table panel.
- It changes only what happens **next**. Flipping it mid-round moves no running match and
  reorders no queue — a pair's place in the queue is the one they earned in the draw. The same
  rule a table reservation follows (§10).
- A `gesperrt` table is skipped in both directions: out of service is not a table at either end.

It is never locked by the phase, and with a single table it has no observable effect.

A table that is taken out of service or deleted **while a match is on it** does not simply drop
that match: the host is asked whether it goes back into the queue or straight onto another free
table, and a table added mid-round joins the free ones immediately (issue #13,
docs/OPEN-QUESTIONS.md #35).

**Results.** The host marks a winner per match. On the beamer the winner card turns green,
the loser card red (see [MOTION.md](MOTION.md) §4.2). Results can be corrected until the
round is explicitly closed, and even afterwards via undo.

When every match is decided:

```text
W := winners (including bye recipients)
L := losers
```

## 4. REPECHAGE (`Hoffnungsrunde`)

The bracket needs a power-of-two field, so losers get a second chance.

```text
target := 2^ceil(log2(|W|))        // next power of two >= |W|
if |W| == target: skip this phase entirely
need := target - |W|
pool := shuffle(L)

while need > 0 and pool is not empty:
    candidate := pool.pop()         // animated draw on the beamer
    host decides: "Nachrücken?" → Ja | Nein
        Ja   → W.add(candidate); need -= 1
        Nein → candidate is eliminated
```

**Beamer.** Before the draw starts, all losers are shown (`REPECHAGE` scene). Each drawn
candidate is highlighted; the accept/decline outcome is shown immediately.

**Two independent orderings.** This phase is the only one that reveals information
*progressively* while withholding the rest, so the order the room is shown and the order the
draw uses must be unrelated:

| | Source | Property |
| --- | --- | --- |
| **Display order** | group number, ascending | Stable for the whole phase. Identical for every seed. Never reorders |
| **Draw order** | the seeded shuffle (`pool`) | Never rendered as an order, ever |

They were once the same list, and that was a bug (issue #97). `pool := shuffle(L)` is drawn
from the front, so a scene that rendered the pool in its own order cancelled the shuffle out:
the sequence was random against the original loser list and perfectly predictable against the
grid the audience was actually looking at. Anyone watching could call the next name. The
shuffle itself was never broken — it ran correctly and was then thrown away, because the thing
it randomised became the thing on screen.

With the two separated, the highlight lands wherever the drawn group happens to sit in a grid
sorted by number, which is unpredictable precisely because the two orderings have nothing to do
with each other. Sorting the display by number is also better for the room: people can find
their own number instead of scanning a scrambled grid.

Three consequences follow, and all three are part of the rule:

- **A drawn card is marked in place, never removed.** Removing one reflows the grid and shifts
  every position after it, which both leaks structure and makes the screen jump (§0, and the
  same argument the pre-computed draw layout makes).
- **No reveal may be staggered in draw order.** A stagger in pool order hands the whole
  sequence to anyone paying attention on the very first frame. Stagger by display position or
  not at all.
- **Nothing rendered may be derived from pool position** — no index badge, no per-card
  animation delay, no z-order.

This constraint is specific to the `Hoffnungsrunde`. The pairing draw of §3 reveals everything
eventually, so its reveal order carries no secret and needs no such separation.

**Fallback — pool exhausted while `need > 0`.** The host is offered two options in German:

1. *Freilose vergeben* — the `need` missing slots become byes in the next round (default).
   All of them, not one: a field of 13 short of 16 owes **three** `Freilose`, and a draw that
   granted only the single bye an odd count earns would produce 7 winners where the bracket
   needs 8. The count is `target - |W|` and it is the next draw that hands them out (§5).
2. *Ausgeschiedene erneut zulassen* — declined groups return to the pool and are drawn again.
   The pool is shuffled again when they go back in, so being readmitted does not also mean
   being drawn first. The displayed order does not change: they were on the wall all along,
   marked as out, and they go back to `POOL` where they already stand.

This situation is logged prominently. It can only occur when a large share of losers decline.

**Invariant after this phase:** the field is a power of two — `|W| + Freilose = target`. The
`Freilose` term is zero unless fallback 1 was taken, so in the ordinary case this is the
plainer statement that `|W|` is a power of two.

**Declining.** A group that answers *Nein* leaves the main field. It does **not** leave the
evening: unless the host declined the `Trostrunde`, it drops into the side event with everyone
else the lottery did not take (§10, docs/OPEN-QUESTIONS.md #6). This is the one place the two
sections touch, and the direction is one-way — nothing in §10 puts anybody back into `W`.

**Ordering.** This phase runs **before** the `Trostrunde` is started, always. The lottery is
what decides who is left in `L`, so the side event's field is not known until the pot is
closed. The host may be *asked* about the side event as soon as the qualifying round closes,
but the question cannot be *answered into a field* before this phase is over.

## 5. ELIMINATION rounds

```text
while |W| > 16:
    shuffle(W); pair; assign tables (§3); play; W := winners
```

Because `|W|` is a power of two, every round halves cleanly and no further repechage is
needed. Byes cannot occur here unless the §4 fallback introduced them.

The loop ends when `|W| <= 16`. The **final phase size** is then `|W|` — normally 16, but a
small tournament may legitimately enter the final phase at 8, 4 or 2.

## 6. NAMING

- The host enters a name for every remaining group. The group number stays visible as a badge
  next to the name for the rest of the event.
- *When* this phase is reached is `settings.namingAt` — the field size at which names become
  required, 16 by default (docs/OPEN-QUESTIONS.md #8). The host may move it up to ask for names
  from the start, or down; from this phase on it is **locked**, because moving the line after
  names have been asked for would either demand names nobody was asked for or leave a bracket
  half-named (issue #15, docs/OPEN-QUESTIONS.md #46).
- Validation: names must be non-empty, trimmed, max 40 characters; duplicates produce a
  warning but are allowed (two teams may genuinely share a name).
- The bracket cannot be drawn until every remaining group has a name.

## 7. BRACKET (`Turnierbaum`)

- The named groups are drawn **randomly** into the bracket slots — a single shuffle, then
  slots `1..2^k` in order, subject to §3's no-rematch rule for the pairings the first round
  produces.
- **Known limitation.** Only the **first** bracket round can be constrained. Every round above
  it is decided by *who wins*, not by a draw, so two groups who have already played may meet
  again in a `Viertelfinale`, `Halbfinale` or `Finale`. That is a documented rule of the final
  phase rather than a bug: there is nothing to draw. Such a pairing still carries the repeat
  marker on the host's screen, so nobody has to work it out from memory.
- Rounds are named by field size: 16 → `Achtelfinale`, 8 → `Viertelfinale`,
  4 → `Halbfinale`, 2 → `Finale`.
- Each bracket match is assigned a table using the same rules as §3.
- The two losers of the `Halbfinale` play the **`Spiel um Platz 3`**. It is scheduled at the
  same time as the final and appears as a separate node under the tree.
- The bracket is the beamer's main scene during the final phase, with progressive reveal and
  animated advancement (see [MOTION.md](MOTION.md) §4.4).

## 8. CEREMONY (`Siegerehrung`)

An animated podium: 1st, 2nd and 3rd place, revealed bronze → silver → gold. Third place is
the winner of the `Spiel um Platz 3`. The host triggers the reveal manually — it must never
fire automatically the instant the final is decided, because the host may still be talking.

## 9. Edge cases (all must be handled and tested)

| # | Case | Required behaviour |
| --- | --- | --- |
| 1 | Odd group count in any round | Last drawn group gets a `Freilos`, clearly marked on the beamer |
| 2 | `\|W\|` already a power of two | Repechage skipped, no empty scene shown |
| 3 | More matches than tables | Matches queue as `WAITING_FOR_TABLE`, host assigns as tables free up |
| 4 | Fewer than 2 groups | Tournament cannot start |
| 5 | Exactly 2 groups | One match, then straight to naming and a 2-slot final — that match **is** the `Finale`, and no qualifying round is drawn (docs/OPEN-QUESTIONS.md #62) |
| 6 | Repechage pool exhausted | §4 fallback dialog |
| 7 | All losers decline | Same as #6 |
| 8 | Host marks the wrong winner | Correctable in place; undo restores table status too |
| 9 | Group removed during SETUP | Numbers of other groups do not shift |
| 10 | Final phase reached at 8/4/2 | Bracket adapts, third-place match still exists (except at 2) |
| 11 | App crashes mid-round | Autosave restores the round with all decided results |
| 12 | Beamer window closed mid-draw | Reopening shows the current scene in its settled state |
| 13 | Two groups already played each other | They are never drawn against each other again (§3) |
| 14 | No rematch-free pairing exists at all | Fewest repeats, named to the host, confirmed before the beamer sees them (§3) |
| 15 | Rematch in a bracket round after the first | Allowed and marked — it is decided by results, not by a draw (§7) |
| 16 | `Trostrunde` field of 1 or 0 | No side event at all, and no empty round drawn (§10) |
| 17 | Group declines the `Hoffnungsrunde` | Out of the main field, into the `Trostrunde` (§4, §10) |
| 18 | Both tracks live at once | No table carries two matches; each track has its own queue (§10) |
| 19 | Undo during a live `Trostrunde` | Leaves the other track untouched (§10) |
| 20 | `Trostrunde` field not a power of two | Its own `Hoffnungsrunde` tops it up, same maths as §4 (§10) |
| 21 | `Trostrunde` field of exactly 2 | No round and no lottery: the single match **is** its `Finale` (§9 case 5, §10) |
| 22 | Losers inside the `Trostrunde` | No further side event — one level only, and they are out (§10) |
| 23 | `Trostrunde` reaches its bracket | Numbers, never names; the naming phase is skipped entirely (§6, §10) |
| 24 | `Trostrunde` decided | Its winner is **not** on the `Siegerehrung` podium (§8, §10) |

## 10. `Trostrunde` (consolation round)

A **self-contained side event** for the groups knocked out in the qualifying round. Optional:
the host is asked once, and a tournament whose host says no behaves exactly as it did before
this section existed.

**Its winner does not rejoin the main field.** The only route back is the §4 lottery. This is
the sentence the host says out loud, and it is why the panel repeats it in two places.

### Field

```text
L      := the losers of the qualifying round (§3)
field  := L minus everyone the Hoffnungsrunde drew back up (§4)
```

Decliners are in the field, not out of it (§4 "Declining"). A loser the lottery never reached
is in it too. Nobody else ever is: the side event is for the **first-round** losers, and by the
time an elimination round has produced any, this section has long since been answered.

If `|field| < 2` there is **no `Trostrunde`**. One group has nobody to play and none has nobody
at all; neither may produce a round with nothing in it (docs/OPEN-QUESTIONS.md #86).

### Structure

It runs the **same pipeline as the main tournament** on its own field (issue #91). Not a
sequence of rounds: a whole tournament, with its own lottery and its own tree.

```text
Trostrunde R1                                     (§3, on the CONSOLATION track)
  → Hoffnungsrunde among its own R1 losers, up to the next power of two   (§4)
  → elimination rounds until the field is ≤ 16                            (§5)
  → bracket: Achtelfinale → Finale, plus Spiel um Platz 3                 (§7)
  → the Trostrunde winner
```

Every rule already stated applies to it unchanged, with the track set the other way: the
power-of-two maths of §4, the `while |W| > 16` loop of §5, byes, table queueing, the
third-place routing of §7, and undo. The no-rematch rule of §3 applies out of the **same**
history as the main field: two groups who met in the qualifying round are not drawn against
each other again here.

**The one exception is §6.** The `Trostrunde` never enters the naming phase. It is
numbers-only from its first round to its final, its bracket included. §6 names the main field
and nobody else; if the `Trostrunde` winner is to be named at the `Siegerehrung`, the host
types that name there, once.

**Its bracket carries a `Spiel um Platz 3`**, exactly as the main bracket does — same node
structure, same semi-final loser routing (issue #91).

Two field sizes are worth naming, because they are the ends of the range:

- **A field of 2** takes the route the main field takes at two participants (§9 case 5): no
  qualifying round, because the single match there is to play *is* the `Finale`, and therefore
  no lottery and no `Spiel um Platz 3` either. The match is modelled as a one-node tree rather
  than as a round — the price of one pipeline instead of two.
- **A field of 1 or 0** is no side event at all (§9 case 16).

### No nesting

The `Trostrunde`'s own first-round losers do **not** get a side event of their own. One level,
and the structure stops there — otherwise it recurses forever. A group that loses inside the
`Trostrunde` and is not drawn back up by its `Hoffnungsrunde` is out for the evening.

The consequence is the opposite of the main field's and the host must be able to say it out
loud: declining the **`Trostrunde`'s** `Hoffnungsrunde` really does mean going home, where
declining the main field's only means dropping into the `Trostrunde` (§4). The side event's
lottery panel says so on screen before anybody is drawn.

### Two rounds at once

From the moment the side event is started, the main field's rounds and its own run **in
parallel**. Every round carries a `track` — `MAIN` or `CONSOLATION` — and "the open round" is a
question asked of one track at a time.

- **Tables are one pool, and the host may divide it.** Both tracks draw from the `FREE` tables
  of §3 and a table is never handed to a second match while it carries one. Every table also
  carries a **reservation** — `MAIN`, `CONSOLATION`, or none:

  - A draw fills only the tables its track may use. An unreserved table serves either, and that
    is the default and the ordinary arrangement.
  - A reservation says what happens **next**. Reserving a table that a match of the other track
    is already on does not take that match off it, exactly as taking a table out of service
    does not (§0). The pair are playing and the room is watching.
  - Reservations are changed at any moment, like every other table property. A table that has
    become unreachable for its track is not an error state: everything queues, and the round
    board says which of the two reasons it is — every table out of service, or every table the
    other track's.
  - If a track ends up with no table it may use, nothing is drawn onto one and nothing breaks.
    The round exists, its pairings exist, and they wait.

- **Queues are per track.** A freed table is offered the next waiting pair of the track the
  host points it at.
- **Undo does not cross tracks.** An action on one track does not touch the other, so taking it
  back cannot either.
- **The beamer shows one track, or both.** The single board is the default; when both tracks
  have a live round the host may split the wall in two, one board per track. Never a merged
  board — they are two tournaments, and a shared progress count would tell the room a
  `Trostrunde` pair is one result away from the bracket. Which of the two is on is the host's
  decision like every other scene (§0, CLAUDE.md golden rule 3).

### Ceremony

**The `Trostrunde` winner does not appear on the `Siegerehrung`** (issue #91). The podium is
the main tournament's 1/2/3 and nobody else's — putting a fourth participant beside them would
tell the room they came fourth.

The side event ends where its bracket ends. Its result stays visible in its own bracket scene,
which is where the room reads it and where the host points the projector if they want to name
the winner out loud.
