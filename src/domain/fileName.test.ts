import { describe, expect, it } from 'vitest';

import {
  TOURNAMENT_FILE_EXTENSION,
  toTournamentFileName,
  tournamentNameFromFileName,
  uniqueFileName,
} from '@/domain/fileName';

const FALLBACK = 'Neues Turnier';

describe('toTournamentFileName', () => {
  it('keeps a normal tournament name as it is', () => {
    expect(toTournamentFileName('Vereinsturnier 2026', FALLBACK)).toBe(
      'Vereinsturnier 2026.wattmatt',
    );
  });

  it('keeps umlauts and ß — the file name is German UI too', () => {
    expect(toTournamentFileName('Schützenfest Grünau', FALLBACK)).toBe(
      'Schützenfest Grünau.wattmatt',
    );
  });

  it('replaces every character Windows refuses', () => {
    expect(toTournamentFileName('A/B: "C" <D> |E| ?F* \\G', FALLBACK)).toBe(
      'A B C D E F G.wattmatt',
    );
  });

  it('drops control characters rather than writing them into a path', () => {
    expect(toTournamentFileName('Turnier\u0000\u001F 1', FALLBACK)).toBe('Turnier 1.wattmatt');
  });

  it('never ends the name in a dot or a space, which Windows silently strips', () => {
    expect(toTournamentFileName('Turnier ...  ', FALLBACK)).toBe('Turnier.wattmatt');
  });

  it('falls back when the name sanitises away to nothing', () => {
    expect(toTournamentFileName('///', FALLBACK)).toBe('Neues Turnier.wattmatt');
  });

  it('falls back when the name is a reserved device name', () => {
    // `CON.wattmatt` is the console, not a file: the save would fail at the
    // event with an error Windows words unhelpfully.
    expect(toTournamentFileName('CON', FALLBACK)).toBe('Neues Turnier.wattmatt');
    expect(toTournamentFileName('lpt1', FALLBACK)).toBe('Neues Turnier.wattmatt');
    expect(toTournamentFileName('Control', FALLBACK)).toBe('Control.wattmatt');
  });

  it('still produces a file name when the fallback is unusable as well', () => {
    expect(toTournamentFileName('', '')).toBe(`tournament.${TOURNAMENT_FILE_EXTENSION}`);
  });

  it('truncates a name long enough to break a path budget', () => {
    const name = 'A'.repeat(400);

    const fileName = toTournamentFileName(name, FALLBACK);

    expect(fileName.length).toBeLessThanOrEqual(80 + `.${TOURNAMENT_FILE_EXTENSION}`.length);
    expect(fileName.endsWith(`.${TOURNAMENT_FILE_EXTENSION}`)).toBe(true);
  });
});

describe('tournamentNameFromFileName', () => {
  it('strips the extension', () => {
    expect(tournamentNameFromFileName('Vereinsturnier.wattmatt')).toBe('Vereinsturnier');
  });

  it('strips a Windows directory as well', () => {
    expect(tournamentNameFromFileName('C:\\Turniere\\Sommer.wattmatt')).toBe('Sommer');
  });

  it('leaves a name that has no extension alone', () => {
    expect(tournamentNameFromFileName('Sommer')).toBe('Sommer');
  });

  it('matches the extension case-insensitively, as the file system does', () => {
    expect(tournamentNameFromFileName('Sommer.WATTMATT')).toBe('Sommer');
  });
});

describe('uniqueFileName', () => {
  it('leaves a free name alone', () => {
    expect(uniqueFileName('Sommer.wattmatt', ['Winter.wattmatt'])).toBe('Sommer.wattmatt');
  });

  it('numbers a name the library already holds', () => {
    expect(uniqueFileName('Sommer.wattmatt', ['Sommer.wattmatt'])).toBe('Sommer (2).wattmatt');
  });

  it('keeps counting past the ones already numbered', () => {
    const taken = ['Sommer.wattmatt', 'Sommer (2).wattmatt', 'Sommer (3).wattmatt'];

    expect(uniqueFileName('Sommer.wattmatt', taken)).toBe('Sommer (4).wattmatt');
  });

  /**
   * Windows file names are case-insensitive. Treating `sommer.wattmatt` as a
   * free name would not create a second file, it would overwrite the first —
   * a tournament replaced by another one, mid-event, without a word.
   */
  it('collides case-insensitively, because the file system does', () => {
    expect(uniqueFileName('Sommer.wattmatt', ['sommer.WATTMATT'])).toBe('Sommer (2).wattmatt');
  });
});
