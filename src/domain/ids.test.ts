import { describe, expect, expectTypeOf, it } from 'vitest';

import {
  groupIdSchema,
  tableIdSchema,
  type GroupId,
  type MatchId,
  type TableId,
} from '@/domain/ids';

describe('branded IDs', () => {
  it('carries the plain string through at runtime', () => {
    expect(groupIdSchema.parse('grp_1')).toBe('grp_1');
  });

  it('rejects an empty ID', () => {
    expect(() => groupIdSchema.parse('')).toThrow();
  });

  /*
   * Issue #7 acceptance criterion: passing a GroupId where a TableId is
   * expected is a compile error. `expectTypeOf` asserts it at typecheck time,
   * so `pnpm typecheck` fails if the brands are ever collapsed to `string` —
   * a runtime test could not see this at all.
   */
  it('does not let one ID stand in for another', () => {
    expectTypeOf<GroupId>().not.toEqualTypeOf<TableId>();
    expectTypeOf<GroupId>().not.toEqualTypeOf<MatchId>();
    expectTypeOf<GroupId>().not.toEqualTypeOf<string>();

    const groupId = groupIdSchema.parse('grp_1');
    expectTypeOf(groupId).not.toMatchTypeOf<TableId>();

    // @ts-expect-error — a GroupId is not a TableId, which is the point.
    const wrong: TableId = groupId;
    // The runtime value is fine; only the type is wrong, so it is still usable
    // here and the expectation documents exactly that split.
    expect(wrong).toBe('grp_1');
  });

  it('accepts a correctly branded ID', () => {
    const tableId: TableId = tableIdSchema.parse('tbl_1');
    expect(tableId).toBe('tbl_1');
  });
});
