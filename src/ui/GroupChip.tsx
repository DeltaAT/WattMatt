import type { Group, ParticipantLabel } from '@/domain/types';
import { de } from '@/i18n';
import { fitNameType, type NameType } from '@/ui/nameFit';

import type { ReactNode } from 'react';

/**
 * The most repeated element in the app (docs/STYLEGUIDE.md §4).
 *
 * One component for the host grid and for the beamer scene, with the size
 * driven by a `scale` prop, exactly as the style guide asks. The reason is
 * golden rule 4: the projector and the laptop must never disagree about who is
 * playing, and two chip components would drift the first time one of them
 * learned about a status the other did not.
 *
 * The number is the identity of a participant until the naming phase
 * (docs/TOURNAMENT-RULES.md §0), so it is set in the display font and the name
 * — once there is one — sits beside it. `ELIMINATED` carries a red left border
 * **and** the word, because colour is never the only signal and a projector in
 * a lit room destroys hue differences (§1, §5).
 */

/**
 * How big the chip is drawn.
 *
 * `host` is the 50 cm control panel; the three beamer steps let a scene get
 * denser instead of taller as the field grows — a beamer scene that needs a
 * scrollbar is the wrong scene (§3).
 */
export type ChipScale = 'host' | 'beamerRoomy' | 'beamerNormal' | 'beamerDense';

export function GroupChip({
  group,
  participant,
  scale,
  action,
}: {
  group: Group;
  /** The wording this tournament uses (`settings.participantLabel`). */
  participant: ParticipantLabel;
  scale: ChipScale;
  /** The host's delete button. The beamer passes nothing — nobody clicks it. */
  action?: ReactNode;
}) {
  const isEliminated = group.status === 'ELIMINATED';

  return (
    <li
      className={`flex items-baseline gap-2 border-l-4 bg-wm-surface ${SIZE[scale]} ${
        isEliminated ? 'border-l-wm-lose opacity-60' : 'border-l-wm-accent'
      }`}
      data-group-id={group.id}
      data-group-status={group.status}
    >
      <span className={`wm-display wm-tnum shrink-0 font-bold ${NUMBER_TYPE[scale]}`}>
        {group.number}
      </span>

      {group.name === null ? null : (
        <span className={`min-w-0 flex-1 truncate ${nameType(group.name, scale)}`}>
          {group.name}
        </span>
      )}

      {isEliminated ? (
        <span className={`shrink-0 ${NAME_TYPE[scale]} text-wm-lose`}>{de.outcome.eliminated}</span>
      ) : null}

      {action === undefined ? null : <span className="ml-auto shrink-0">{action}</span>}

      {/*
        The word the number belongs to, for a screen reader and for nobody else:
        "3" on its own is not a participant, and the grid would otherwise read as
        a list of bare numbers.
      */}
      <span className="sr-only">{de.participant[participant].numbered({ n: group.number })}</span>
    </li>
  );
}

/** Padding and rounding per step. 32 px is the floor for a host control (§3). */
const SIZE: Record<ChipScale, string> = {
  host: 'h-9 rounded-wm-md px-2',
  beamerRoomy: 'rounded-wm-xl px-6 py-4',
  beamerNormal: 'rounded-wm-xl px-5 py-3',
  beamerDense: 'rounded-wm-lg px-4 py-2',
};

const NUMBER_TYPE: Record<ChipScale, string> = {
  host: 'text-host-base',
  beamerRoomy: 'text-beamer-h2',
  beamerNormal: 'text-beamer-h3',
  beamerDense: 'text-beamer-body',
};

/**
 * Never below `text-beamer-body` on the projector: 32 px is the absolute floor
 * for beamer text (docs/STYLEGUIDE.md §2), and a name that has been entered is
 * exactly as readable as the number beside it.
 */
const NAME_TYPE: Record<ChipScale, string> = {
  host: 'text-host-xs text-wm-text-muted',
  beamerRoomy: 'text-beamer-h3',
  beamerNormal: 'text-beamer-body',
  beamerDense: 'text-beamer-body',
};

/**
 * The step a name on a *beamer* chip is drawn at, before the ellipsis
 * (`@/ui/nameFit`).
 *
 * Separate from `NAME_TYPE` above, which is also the eliminated word's step and
 * is a plain class either way. The host chip is left out of the strategy: its
 * scale is not a beamer step, it is 12 px whatever the name says, and the host
 * grid scrolls where a scene cannot.
 */
const BEAMER_NAME_TYPE: Record<Exclude<ChipScale, 'host'>, NameType> = {
  beamerRoomy: 'text-beamer-h3',
  beamerNormal: 'text-beamer-body',
  beamerDense: 'text-beamer-body',
};

/** The class the name itself gets: stepped down on the projector, plain on the host. */
function nameType(name: string, scale: ChipScale): string {
  return scale === 'host' ? NAME_TYPE.host : fitNameType(name, BEAMER_NAME_TYPE[scale]);
}
