# Contributing Guide

## Branch Naming
Use one of these prefixes:

- `feature/*` - new feature
- `fix/*` - bug fix
- `hotfix/*` - urgent production fix
- `docs/*` - documentation only
- `chore/*` - maintenance, config, dependencies
- `refactor/*` - refactor without behavior change
- `release/*` - release preparation
- `dev/*` - shared development branch

Examples:
- `feature/add-login`
- `fix/null-pointer-error`
- `docs/update-readme`

## Commit Messages
Use clear, imperative commit messages:

```text
feat: add user login
fix: handle null response
docs: update contributing guide
chore: bump dependencies
```

## Pull Requests
- Open PRs against `master`.
- `master` cannot be pushed directly.
- Use the PR template.
- Keep PRs small and focused.
- Update branch with `master` before merge.
- One approval is required.

## Testing
Before opening a PR, run:

```sh
npm test
npm run lint
```

Update tests when behavior changes.

## Merge Strategy
- Squash merge only.
- Each PR becomes one commit on `master`.
- Delete branch after merge.

## Risk & Rollback
For risky changes, include:
- Risk level: Low / Medium / High
- Rollback plan
