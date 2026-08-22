/**
 * Conventional Commits, restricted to the types listed in CLAUDE.md §6.
 * Subject stays English — the German rule is for user-visible strings only.
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [2, 'always', ['feat', 'fix', 'docs', 'refactor', 'test', 'chore', 'revert']],
    'header-max-length': [2, 'always', 100],
    'body-max-line-length': [0],
  },
};
