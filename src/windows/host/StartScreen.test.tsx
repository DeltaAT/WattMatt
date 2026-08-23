import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { de } from '@/i18n';
import type { TournamentEntry } from '@/platform/tournamentFile';
import { StartScreen } from '@/windows/host/StartScreen';

function entry(fileName: string, modifiedAt: number | null = 0): TournamentEntry {
  return {
    path: `C:\\Turniere\\${fileName}`,
    fileName,
    modifiedAt,
    bytes: 1024,
  };
}

function render(recents: TournamentEntry[], library: string | null = 'C:\\Turniere'): string {
  return renderToStaticMarkup(
    <StartScreen
      recents={recents}
      library={library}
      busy={false}
      onCreate={() => {}}
      onOpen={() => {}}
      onOpenAt={() => {}}
    />,
  );
}

describe('StartScreen', () => {
  it('offers both ways in', () => {
    const markup = render([]);

    expect(markup).toContain(de.startScreen.create);
    expect(markup).toContain(de.startScreen.open);
  });

  it('says so when nothing has been saved yet', () => {
    expect(render([])).toContain(de.startScreen.recentEmpty);
  });

  it('lists a recent tournament by name rather than by file name', () => {
    const markup = render([entry('Vereinsturnier 2026.wattmatt')]);

    expect(markup).toContain('Vereinsturnier 2026');
    expect(markup).not.toContain('.wattmatt<');
    expect(markup).not.toContain(de.startScreen.recentEmpty);
  });

  /**
   * A tournament whose timestamp the platform could not read still has to be
   * openable — showing the path is more use than showing nothing.
   */
  it('falls back to the path when there is no date', () => {
    const markup = render([entry('Sommer.wattmatt', null)]);

    expect(markup).toContain('C:\\Turniere\\Sommer.wattmatt');
  });

  it('names the folder the list comes from, so it can be found in Explorer', () => {
    expect(render([], 'C:\\Turniere')).toContain('C:\\Turniere');
  });

  it('leaves the folder line out when there is no library to name', () => {
    const markup = render([], null);

    expect(markup).not.toContain('Ordner');
  });

  /**
   * The one control that must not be reachable empty: creating a tournament
   * with a blank name would put an unfindable file in the library.
   */
  it('will not create a tournament until it has a name', () => {
    expect(render([])).toMatch(/<button type="submit"[^>]*disabled/);
  });
});
