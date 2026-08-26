import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

import { describe, expect, it } from 'vitest';

import { SCENE_ORDER } from '@/domain/sceneCatalog';
import { deAT } from '@/i18n/de-AT';

/**
 * What the host manual must never quietly stop being true about (issue #32).
 *
 * The manual is read by somebody standing in front of a room, and it is the
 * one document in the repository whose readers cannot check it against the
 * code. A shortcut table listing a key the app no longer binds is worse than
 * no table at all — so the two lists most likely to drift, the shortcuts and
 * the nine beamer scenes, are checked against `de-AT.ts` and `SCENE_ORDER`
 * rather than against a reviewer's memory. The same goes for the sentences the
 * manual quotes off a button: they are quoted so the host can match what they
 * read against what the screen says, which only works while they are the same
 * sentence.
 *
 * Deliberately *not* a spellchecker and not a German-versus-English test. "No
 * English terms in the manual" is an acceptance criterion a human reads for,
 * and a regular expression pretending to enforce it would only teach people to
 * work around it.
 */

const root = new URL('../', import.meta.url);

function read(path) {
  return readFileSync(fileURLToPath(new URL(path, root)), 'utf-8');
}

/**
 * The manual wraps at 100 characters, so a sentence quoted off a button is
 * usually split across two lines. Comparing on collapsed whitespace is what
 * lets the quote be checked at all without freezing the line breaks.
 */
function flat(source) {
  return source.replace(/\s+/g, ' ');
}

const GERMAN_DOCS = ['docs/HANDBUCH.de.md', 'docs/CHECKLISTE.de.md', 'docs/PROBLEME.de.md'];
const LINKING_DOCS = [...GERMAN_DOCS, 'docs/SCREENSHOTS.md', 'README.md'];

const manual = read('docs/HANDBUCH.de.md');

/** One `##`/`###` section, up to the next heading of either level. */
function section(source, heading) {
  const start = source.indexOf(heading);
  expect(start, `the manual has no section "${heading}"`).toBeGreaterThan(-1);
  const rest = source.slice(start + heading.length);
  const end = rest.search(/^#{2,3} /m);
  return end === -1 ? rest : rest.slice(0, end);
}

describe('the German host manual', () => {
  /**
   * The three German documents cross-link, and a host who follows a dead link
   * during an event has been sent looking for a page that is not there.
   */
  it.each(LINKING_DOCS)('links only to files that exist: %s', (path) => {
    const base = dirname(fileURLToPath(new URL(path, root)));

    for (const [, target] of read(path).matchAll(/\]\(([^)#][^)]*)\)/g)) {
      if (/^[a-z]+:\/\//.test(target)) {
        continue;
      }
      const file = resolve(base, target.split('#')[0]);
      expect(existsSync(file), `${path} links to ${target}, which does not exist`).toBe(true);
    }
  });

  /**
   * §15 against the `?` dialog (`ShortcutsDialog`). The host reads one of the
   * two and presses the key named on the other, so the key names have to be
   * spelt identically — `Strg+Z`, not `Strg + Z`.
   */
  it('lists exactly the shortcuts the app binds', () => {
    const { key, action } = deAT.beamerControl.shortcuts;
    const rows = [
      ...section(manual, '## 15. Tastenkürzel').matchAll(/^\| \*\*(.+?)\*\* \| (.+?)\s*\|\s*$/gm),
    ];

    expect(rows.map(([, cell]) => cell).sort()).toEqual(Object.values(key).sort());

    // And each row says what the dialog says the key does, word for word.
    for (const name of Object.keys(key)) {
      const row = rows.find(([, cell]) => cell === key[name]);
      expect(row?.[2], `the manual has no row for ${name}`).toContain(action[name]);
    }
  });

  /**
   * §6.2 against the switcher. The position in `SCENE_ORDER` *is* the keyboard
   * shortcut, so a manual that renumbers the scenes teaches the host's hand a
   * layout that moves under it.
   */
  it('numbers the beamer scenes the way the switcher does', () => {
    const table = section(manual, '### 6.2 Die Ansicht wählen');

    SCENE_ORDER.forEach((id, index) => {
      const name = deAT.beamerControl.sceneName[id];
      expect(table, `scene ${id} is not row ${index + 1} of the switcher table`).toContain(
        `| ${index + 1} | ${name} |`,
      );
    });
  });

  /** §16 draws every scene, in the same order and under the same names. */
  it('describes every beamer scene in section 16', () => {
    const headings = [...manual.matchAll(/^### (\d) — (.+?)\s*$/gm)].map((match) => [
      Number(match[1]),
      match[2],
    ]);

    expect(headings).toEqual(
      SCENE_ORDER.map((id, index) => [index + 1, deAT.beamerControl.sceneName[id]]),
    );
  });

  /**
   * The sentences the manual reproduces off a screen. Each one is a place a
   * host is told "the app will say this" — and each is a string somebody could
   * reword in `de-AT.ts` without ever opening this file.
   */
  it.each([
    deAT.start.noUsableTable,
    deAT.participant.GROUP.tooFew,
    deAT.round.none,
    deAT.round.closeUndecided({ n: 3 }),
    deAT.bracket.finishBlocked,
    deAT.repechage.complete,
    deAT.naming.duplicate,
    deAT.beamerControl.sceneUnavailable,
    deAT.beamerControl.status.projected,
    deAT.beamerControl.status.previewNoSecondMonitor,
  ])('quotes the app word for word: %s', (sentence) => {
    expect(flat(manual) + flat(read('docs/PROBLEME.de.md'))).toContain(flat(sentence));
  });
});
