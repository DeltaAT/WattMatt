import { describe, expect, it } from 'vitest';

import { resolveWindowRoute } from '@/windows/route';

const at = (search: string, pathname = '/') => ({ pathname, search });

describe('window routing', () => {
  it('routes the two real windows by query parameter', () => {
    expect(resolveWindowRoute(at('?window=host'), false)).toBe('host');
    expect(resolveWindowRoute(at('?window=beamer'), false)).toBe('beamer');
  });

  it('survives extra query parameters', () => {
    expect(resolveWindowRoute(at('?window=beamer&debug=1'), false)).toBe('beamer');
  });

  /*
   * The beamer must never resolve from anything but an explicit request: a
   * typo in the query string putting a beamer scene on the laptop screen is
   * the exact failure CLAUDE.md rule 3 exists to prevent.
   */
  it('falls back to the host, never to the beamer', () => {
    expect(resolveWindowRoute(at(''), false)).toBe('host');
    expect(resolveWindowRoute(at('?window='), false)).toBe('host');
    expect(resolveWindowRoute(at('?window=Beamer'), false)).toBe('host');
    expect(resolveWindowRoute(at('?window=projector'), false)).toBe('host');
  });

  it('reaches the token review page in dev, by path or by query', () => {
    expect(resolveWindowRoute(at('?window=tokens'), true)).toBe('tokens');
    expect(resolveWindowRoute(at('', '/tokens'), true)).toBe('tokens');
  });

  it('hides the token review page in a release build', () => {
    expect(resolveWindowRoute(at('?window=tokens'), false)).toBe('host');
    expect(resolveWindowRoute(at('', '/tokens'), false)).toBe('host');
  });
});
