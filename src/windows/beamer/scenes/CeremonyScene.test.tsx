import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { toTournamentSnapshot } from '@/domain/snapshot';
import { group, tournament, bracketNodeId, groupId } from '@/domain/testFixtures';
import { de } from '@/i18n';
import { CeremonyScene } from '@/windows/beamer/scenes/CeremonyScene';

function scene(t: ReturnType<typeof tournament>, settled = true): string {
  return renderToStaticMarkup(
    <CeremonyScene tournament={toTournamentSnapshot(t)} settled={settled} />,
  );
}

describe('the ceremony scene', () => {
  it('renders the podium in 2 · 1 · 3 order', () => {
    const doc = tournament({
      phase: 'CEREMONY',
      groups: [
        group(1, { name: 'Erster' }),
        group(2, { name: 'Zweiter' }),
        group(3, { name: 'Dritter' }),
      ],
      bracket: {
        size: 4,
        nodes: [
          {
            id: bracketNodeId(1),
            round: 'SEMI_FINAL',
            slotA: groupId(1),
            slotB: groupId(2),
            winnerId: null,
            nextNodeId: bracketNodeId(3),
            tableId: null,
          },
          {
            id: bracketNodeId(2),
            round: 'THIRD_PLACE',
            slotA: groupId(3),
            slotB: null,
            winnerId: groupId(3),
            nextNodeId: null,
            tableId: null,
          },
          {
            id: bracketNodeId(3),
            round: 'FINAL',
            slotA: groupId(1),
            slotB: groupId(2),
            winnerId: groupId(1),
            nextNodeId: null,
            tableId: null,
          },
        ],
        thirdPlaceNodeId: bracketNodeId(2),
      },
    });

    const markup = scene(doc);

    const idx2 = markup.indexOf('data-podium-place="2"');
    const idx1 = markup.indexOf('data-podium-place="1"');
    const idx3 = markup.indexOf('data-podium-place="3"');

    expect(idx2).toBeGreaterThan(-1);
    expect(idx1).toBeGreaterThan(-1);
    expect(idx3).toBeGreaterThan(-1);
    expect(idx2).toBeLessThan(idx1);
    expect(idx1).toBeLessThan(idx3);

    // Titles and labels
    expect(markup).toContain(de.beamer.ceremony.title);
    expect(markup).toContain('Erster');
    expect(markup).toContain('Zweiter');
    expect(markup).toContain('Dritter');
  });

  it('suppresses confetti in performance mode', () => {
    const doc = tournament({
      phase: 'CEREMONY',
      settings: { performanceMode: true, participantLabel: 'GROUP', namingAt: 16 },
      groups: [group(1, { name: 'A' }), group(2, { name: 'B' }), group(3, { name: 'C' })],
      bracket: {
        size: 2,
        nodes: [],
        thirdPlaceNodeId: null as unknown as ReturnType<typeof bracketNodeId>,
      },
    });

    const markup = scene(doc);

    expect(markup).not.toContain('data-confetti=""');
  });
});
