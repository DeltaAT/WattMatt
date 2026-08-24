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
  (`settings.participantLabel`). It changes UI copy only; the model is `Group` throughout.
- The tournament cannot start unless: `groups >= 2` and `tables >= 1`.

## 3. QUALIFYING (round 1)

```text
P  := active groups, n := |P|, n >= 2
shuffle(P) using the seeded RNG
pairs := [(P[0],P[1]), (P[2],P[3]), …]
if n is odd: the last remaining group receives a BYE and advances automatically
```

**Table assignment.** Matches are assigned to `FREE` tables in draw order. If there are more
matches than tables, the remaining matches get status `WAITING_FOR_TABLE` and are queued.
When the host closes a match, its table returns to `FREE` and the next queued match is offered
to it — the host confirms, so nothing moves on the beamer without the host wanting it.

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

**Fallback — pool exhausted while `need > 0`.** The host is offered two options in German:

1. *Freilose vergeben* — the missing slots become byes in the next round (default).
2. *Ausgeschiedene erneut zulassen* — declined groups return to the pool and are drawn again.

This situation is logged prominently. It can only occur when a large share of losers decline.

**Invariant after this phase:** `|W|` is a power of two.

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
- Validation: names must be non-empty, trimmed, max 40 characters; duplicates produce a
  warning but are allowed (two teams may genuinely share a name).
- The bracket cannot be drawn until every remaining group has a name.

## 7. BRACKET (`Turnierbaum`)

- The named groups are drawn **randomly** into the bracket slots — a single shuffle, then
  slots `1..2^k` in order.
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
| 5 | Exactly 2 groups | One match, then straight to naming and a 2-slot final |
| 6 | Repechage pool exhausted | §4 fallback dialog |
| 7 | All losers decline | Same as #6 |
| 8 | Host marks the wrong winner | Correctable in place; undo restores table status too |
| 9 | Group removed during SETUP | Numbers of other groups do not shift |
| 10 | Final phase reached at 8/4/2 | Bracket adapts, third-place match still exists (except at 2) |
| 11 | App crashes mid-round | Autosave restores the round with all decided results |
| 12 | Beamer window closed mid-draw | Reopening shows the current scene in its settled state |
