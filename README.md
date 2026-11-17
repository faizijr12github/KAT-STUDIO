# KAT Studio

KAT Studio is a local video editing and review workspace for Codex. It provides project setup, folder imports, Codex-assisted first drafts, timestamped revision notes, a 31-preset gallery with side-by-side comparison, draft playback, client-scoped learning, FFmpeg QA and verified backups. The official Git checkout holds the app, CLI, and Codex skill. Your workspace stays in a separate SQLite database with local media files.

## Install

Install Git, Node.js 22.16 or newer, FFmpeg and FFprobe using your preferred package manager. From an authenticated clone of this repository, run:

```sh
sh bootstrap.sh
```

The installer loads the highest stable `vMAJOR.MINOR.PATCH` Git tag from the official repository, checks Git integrity and the package version, installs the Codex skill, and opens Studio. For a private repository, configure GitHub access before running it. Set `KAT_EXPECTED_COMMIT` to an independently confirmed release SHA if you need a pinned install. Keep this file as the handoff to another Codex environment.

Start a new Codex chat if needed and type **Open KAT Studio**. The CLI is also available at `~/.local/share/kat-studio/app/kat.mjs`. Run it with Node.

| Command | Action |
| --- | --- |
| `init` | Validate dependencies and register the skill and local workspace preference |
| `open`, `stop`, `status` | Manage the local app |
| `context <project-id>`, `register <project-id> <submission.json>` | Read editing context or register a verified assisted edit |
| `save`, `restore <new-directory>` | Make or recover a verified workspace snapshot |
| `save --message "…"` | Run tests and commit already staged code |
| `update` | Check the latest stable tag and print the commit available for approval |
| `update --approve <release-commit>` | Apply the reviewed fast-forward update |
| `sync [vX.Y.Z]` | Review the destination and local commit or release |
| `sync [vX.Y.Z] --approve <commit>` | Validate and push the approved commit and optional tag atomically |

[Setup, authenticated publishing, backups and recovery](docs/setup.md) · [Editing and learning](docs/editing.md) · [Changelog](CHANGELOG.md)

The bootstrap supports macOS and other POSIX environments. Linux needs a desktop opener for browser auto-launch. Windows support is preliminary. The Node CLI is portable, and the bootstrap can run in WSL. The installer uses the CLI and a Codex skill because the workflows are local and authenticated Studio already exposes its application interface. There is no MCP server to configure.
