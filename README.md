# [project-name]

> One-line description of what this project does and why it exists.

## Overview

[Describe the problem this project solves and who it is for. Keep it to a paragraph.]

## Architecture

[Brief description of the system structure. Link to ADRs in `docs/decisions/` for significant design choices.]

## Getting Started

### Prerequisites

- [List runtime, tooling, and environment requirements]

### Setup

```sh
# Clone the repo
git clone git@github.com:Plimmerton-Labs/[project-name].git
cd [project-name]

# Install dependencies
[add project-specific steps]
```

### Running locally

```sh
[add project-specific steps]
```

### Checking changes

```sh
[add project-specific check command]
```

## Repository Governance

Before accepting feature work, complete the repository setup checklist in [docs/repository-setup.md](docs/repository-setup.md). At minimum, the repository should have:

- a `develop` integration branch;
- protected `develop` and `main` branches;
- issue-driven workflow labels synced from `.github/labels.json`;
- required CI checks;
- CODEOWNERS review routing;
- security reporting guidance;
- a licence appropriate for the project.

## Contributing

All contributions - human and AI - follow the [Plimmerton Labs Engineering Playbook](https://github.com/Plimmerton-Labs/engineering-playbook).

Key points:

- Branch from `develop`: `feature/xyz`, `fix/xyz`, or `agent/<agent>/xyz`
- Open a pull request against `develop`; use the PR template
- Significant design decisions get an ADR in `docs/decisions/`
- `develop` -> `main` requires an authorised reviewer

See [CONTRIBUTING.md](CONTRIBUTING.md) for contributor guidance and [AGENTS.md](AGENTS.md) for AI contributor instructions specific to this repo.

## Security

Report security concerns using the process in [SECURITY.md](SECURITY.md).

## Licence

[Add licence]
