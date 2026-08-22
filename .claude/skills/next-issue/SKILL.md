---
name: next-issue
description: Pick up the next open WattMatt issue and implement it end to end.
---
1. `gh issue list --state open -L 200 --json number,title --jq 'min_by(.number)'`
   Issue numbers ARE the dependency order — never skip ahead.
2. Read the issue, CLAUDE.md, and every doc the issue links.
3. Branch `feat/<n>-<slug>`.
4. Implement. Domain logic gets tests first.
5. `pnpm typecheck && pnpm lint && pnpm test`
6. Commit (Conventional Commits), push, open a DRAFT PR with `Closes #<n>`.
7. Report which Definition of Done boxes you could NOT tick and why.