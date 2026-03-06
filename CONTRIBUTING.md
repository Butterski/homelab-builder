# Contributing to HLBuilder

First, thanks for taking the time to contribute!

## Development Setup

1. Fork the repository (or clone it if you have write access)
2. Set up the environment variables (`cp .env.example .env`)
3. Spin up the development environment using Docker:
   ```bash
   docker compose up -d
   ```

## Branching Strategy

We use a two-branch model:

| Branch | Purpose |
|--------|---------|
| `master` | Stable, release-ready code. **Never push directly to master.** |
| `dev` | Integration branch. All feature/fix branches are merged here first. |

### Workflow

```
master (stable releases)
  ↑ merge (maintainer only)
dev (integration / staging)
  ↑ pull request
feature/your-feature-name  ← you work here
```

1. **Start from `dev`** — always branch off the latest `dev`:
   ```bash
   git checkout dev
   git pull origin dev
   git checkout -b feature/short-description
   ```

2. **Work on your branch** — make commits with clear messages. Keep the scope small (one feature or fix per branch).

3. **Push and open a Pull Request into `dev`**:
   ```bash
   git push -u origin feature/short-description
   ```
   Then open a PR on GitHub targeting the **`dev`** branch (not `master`).

4. **PR review & merge** — once CI passes and the PR is approved, it gets merged into `dev`.

5. **Releases** — the maintainer periodically merges `dev` into `master` to cut a release.

### Branch Naming Convention

Use a descriptive prefix:

| Prefix | Use for |
|--------|---------|
| `feature/` | New functionality (e.g., `feature/add-vlan-support`) |
| `fix/` | Bug fixes (e.g., `fix/ip-collision-on-dual-router`) |
| `docs/` | Documentation-only changes (e.g., `docs/update-readme`) |
| `refactor/` | Code restructuring with no behavior change |
| `test/` | Adding or updating tests |

## Pull Request Process

We strictly follow a "One PR = One Feature/Fix" philosophy to keep reviews fast and code stable.

1. **Target branch: `dev`** — all PRs must target `dev`, not `master`.
2. Ensure any install or build dependencies are removed before the end of the layer when doing a build.
3. Update the README.md with details of changes to the interface, if applicable.
4. Your PR must pass all GitHub Action CI tests before it can be merged.
5. If you have modified backend service logic, you MUST write an accompanying test in `*_test.go`.
6. Keep PRs focused — avoid mixing unrelated changes in a single PR.

### CI Checks (Required)

Every PR automatically runs the following GitHub Actions checks — **all must pass** before the PR can be merged:

| Check | What it runs |
|-------|-------------|
| **Frontend Tests** | `npm test` (Vitest) in `frontend/` |
| **hlbIPAM Tests** | `go test ./...` in `hlbipam/` |
| **Backend Tests** | Docker Compose integration tests against PostgreSQL |
| **Security Analysis** | Gosec (Go) + npm audit (frontend) |

A summary gate job (**"All Tests Pass"**) aggregates the results — branch protection is configured to require this check. If any test suite fails, the PR is blocked from merging.

## Code of Conduct

Help us keep HLBuilder open and inclusive. Please read and follow our [Code of Conduct](CODE_OF_CONDUCT.md).

### Additional Terms (pursuant to section 7)

You must retain the following attribution notice in all copies or substantial portions of the Software:

"Original creator: Butterski. Author homepage: https://mkuch.pl"

If you modify the Software, you must ensure that the attribution notice remains intact and visible.

By contributing code to this project, you agree that your contributions will be licensed under the same license as the project (AGPL-3.0 with additional attribution terms). You also grant the project maintainer the right to use your contributions in the official hosted version of the project, as well as any future versions under the same or a compatible license.
