import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { roundIdSchema } from '@/domain/ids';
import { de } from '@/i18n';
import { BeamerScenePlaceholder } from '@/windows/beamer/BeamerScenePlaceholder';

const round = (value: string) => roundIdSchema.parse(value);

describe('the beamer scene surface', () => {
  it('renders the scene the host staged, not a fixed screen', () => {
    const markup = renderToStaticMarkup(
      <BeamerScenePlaceholder scene={{ id: 'DRAW', roundId: round('r2') }} settled />,
    );
    expect(markup).toContain('data-scene="DRAW"');
    expect(markup).toContain(de.beamer.scenePending);
  });

  it('shows nothing at all during a blackout', () => {
    const markup = renderToStaticMarkup(
      <BeamerScenePlaceholder scene={{ id: 'BLACKOUT' }} settled />,
    );
    expect(markup).toContain('data-scene="BLACKOUT"');
    // Any text here would be a lit rectangle in a dark room.
    expect(markup).not.toContain(de.beamer.idleTitle);
    expect(markup).not.toContain(de.beamer.scenePending);
  });

  it('marks a caught-up scene as settled so it is not animated in', () => {
    const settled = renderToStaticMarkup(
      <BeamerScenePlaceholder scene={{ id: 'BRACKET' }} settled />,
    );
    const animating = renderToStaticMarkup(
      <BeamerScenePlaceholder scene={{ id: 'BRACKET' }} settled={false} />,
    );

    expect(settled).toContain('data-settled="true"');
    expect(animating).toContain('data-settled="false"');
  });
});
