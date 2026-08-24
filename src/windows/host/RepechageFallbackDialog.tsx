import type { RepechageFallback } from '@/domain/types';
import { de } from '@/i18n';

/**
 * "The pool emptied with places still open" — docs/TOURNAMENT-RULES.md §4's
 * fallback, as a decision the host takes rather than a state they are stuck in
 * (issue #21).
 *
 * There is deliberately no way out that changes nothing. The field has to reach
 * the target or the bracket cannot be built, so the two answers are the two §4
 * gives and both of them finish the phase — *Freilose vergeben* outright, and
 * *Ausgeschiedene erneut zulassen* by putting somebody back in the pot to be
 * drawn again. `Freilose vergeben` is available every single time this dialog
 * appears, which is what guarantees the host is never stranded (issue #20).
 *
 * Both options are explained in full sentences rather than named on a button.
 * The host is choosing between them in front of a waiting room, neither is
 * obviously right, and what each does to the next round is the part they have
 * to be able to say out loud.
 */
export function RepechageFallbackDialog({
  need,
  declined,
  onAnswer,
}: {
  /** Places still open. Never zero — the dialog would not be shown. */
  need: number;
  /** How many groups could be readmitted. Zero is a normal case. */
  declined: number;
  onAnswer: (choice: RepechageFallback) => void;
}) {
  const canReopen = declined > 0;

  return (
    <div
      className="absolute inset-0 z-10 flex items-center justify-center bg-wm-bg/80 p-6"
      role="dialog"
      aria-modal="true"
      aria-label={de.repechage.fallback.title}
      data-dialog="repechage-fallback"
    >
      <div className="flex w-full max-w-xl flex-col gap-4 rounded-wm-lg border border-wm-border-strong bg-wm-bg-elevated p-6">
        <h2 className="wm-display text-host-lg font-bold">{de.repechage.fallback.title}</h2>

        <p className="text-host-sm text-wm-text-muted">{de.repechage.fallback.body({ n: need })}</p>

        <div className="flex flex-col gap-3">
          {/*
            First and primary: it is §4's default, it always works, and it is
            the answer that ends the phase here and now. A host who is out of
            their depth should land on this one.
          */}
          <Choice
            action="byes"
            title={de.repechage.fallback.byes}
            body={de.repechage.fallback.byesBody({ n: need })}
            primary
            onChoose={() => onAnswer('BYES')}
          />

          <Choice
            action="reopen"
            title={de.repechage.fallback.reopen}
            // Why it is greyed out, where the click was aimed: with nobody
            // having declined there is nothing to put back, and a host who
            // pressed it would be looking at this same dialog again.
            body={
              canReopen
                ? de.repechage.fallback.reopenBody({ n: declined })
                : de.repechage.fallback.reopenNobody
            }
            disabled={!canReopen}
            onChoose={() => onAnswer('REOPEN_DECLINED')}
          />
        </div>
      </div>
    </div>
  );
}

function Choice({
  action,
  title,
  body,
  primary = false,
  disabled = false,
  onChoose,
}: {
  action: string;
  title: string;
  body: string;
  primary?: boolean;
  disabled?: boolean;
  onChoose: () => void;
}) {
  return (
    <button
      type="button"
      className={`flex flex-col items-start gap-1 rounded-wm-md border p-3 text-left transition-colors duration-[--dur-fast] ease-out disabled:opacity-60 ${
        primary
          ? 'border-wm-accent bg-wm-accent-soft hover:bg-wm-accent-strong'
          : 'border-wm-border-strong bg-wm-surface hover:bg-wm-surface-hover'
      }`}
      disabled={disabled}
      onClick={onChoose}
      data-dialog-action={action}
    >
      <span className="text-host-base font-semibold text-wm-text">{title}</span>
      <span className="text-host-sm text-wm-text-muted">{body}</span>
    </button>
  );
}
