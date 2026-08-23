import { useState, type FormEvent } from 'react';

import { tournamentNameFromFileName } from '@/domain/fileName';
import { de, formatDateTime } from '@/i18n';
import type { TournamentEntry } from '@/platform/tournamentFile';

/**
 * What the host sees before a tournament is open (issue #9).
 *
 * Three things and nothing else: name a new tournament, open a saved one, or
 * pick one of the recent ones. The recent list is the default library read
 * fresh from disk rather than a remembered list — a tournament copied onto the
 * laptop from a USB stick appears without anything having to record it, and one
 * deleted in Explorer stops being offered.
 */
export function StartScreen({
  recents,
  library,
  busy,
  onCreate,
  onOpen,
  onOpenAt,
}: {
  recents: TournamentEntry[];
  library: string | null;
  busy: boolean;
  onCreate: (name: string) => void;
  onOpen: () => void;
  onOpenAt: (path: string) => void;
}) {
  const [name, setName] = useState('');
  const trimmed = name.trim();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (trimmed === '' || busy) {
      return;
    }
    onCreate(trimmed);
    setName('');
  };

  return (
    <main className="flex flex-1 justify-center overflow-y-auto p-12">
      <div className="flex w-full max-w-2xl flex-col gap-8">
        <header className="flex flex-col gap-2">
          <h1 className="wm-display text-host-2xl font-bold">{de.startScreen.title}</h1>
          <p className="text-host-sm text-wm-text-muted">{de.startScreen.subtitle}</p>
        </header>

        <form className="flex flex-col gap-3" onSubmit={submit}>
          <label className="wm-label" htmlFor="tournament-name">
            {de.startScreen.nameLabel}
          </label>
          <div className="flex gap-2">
            <input
              id="tournament-name"
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={de.startScreen.namePlaceholder}
              className="h-10 flex-1 rounded-wm-md border border-wm-border-strong bg-wm-surface px-3 text-host-sm text-wm-text placeholder:text-wm-text-faint"
            />
            <button type="submit" className={PRIMARY_CLASS} disabled={busy || trimmed === ''}>
              {de.startScreen.create}
            </button>
            <button type="button" className={SECONDARY_CLASS} onClick={onOpen} disabled={busy}>
              {de.startScreen.open}
            </button>
          </div>
        </form>

        <section className="flex flex-col gap-3">
          <h2 className="wm-label">{de.startScreen.recentTitle}</h2>
          {recents.length === 0 ? (
            <p className="text-host-sm text-wm-text-faint">{de.startScreen.recentEmpty}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {recents.map((entry) => (
                <li key={entry.path}>
                  <RecentButton entry={entry} busy={busy} onSelect={() => onOpenAt(entry.path)} />
                </li>
              ))}
            </ul>
          )}
          {library === null ? null : (
            <p className="text-host-xs text-wm-text-faint">
              {de.startScreen.libraryHint({ path: library })}
            </p>
          )}
        </section>
      </div>
    </main>
  );
}

function RecentButton({
  entry,
  busy,
  onSelect,
}: {
  entry: TournamentEntry;
  busy: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={busy}
      className="flex w-full flex-col items-start gap-1 rounded-wm-md border border-wm-border bg-wm-surface px-3 py-2 text-left transition-colors duration-[--dur-fast] ease-out hover:bg-wm-surface-hover"
    >
      <span className="text-host-sm font-medium text-wm-text">
        {tournamentNameFromFileName(entry.fileName)}
      </span>
      <span className="wm-tnum text-host-xs text-wm-text-faint">
        {entry.modifiedAt === null ? entry.path : formatDateTime(new Date(entry.modifiedAt))}
      </span>
    </button>
  );
}

/** 40 px tall: a high-frequency control (docs/STYLEGUIDE.md §3). */
const PRIMARY_CLASS =
  'h-10 rounded-wm-md border border-wm-accent bg-wm-accent-soft px-4 text-host-sm font-medium text-wm-text transition-colors duration-[--dur-fast] ease-out hover:bg-wm-accent-strong disabled:opacity-60';

const SECONDARY_CLASS =
  'h-10 rounded-wm-md border border-wm-border-strong bg-wm-surface px-4 text-host-sm text-wm-text-muted transition-colors duration-[--dur-fast] ease-out hover:bg-wm-surface-hover disabled:opacity-60';
