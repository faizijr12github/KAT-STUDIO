---
name: kat-studio
description: Open, initialize, check, save, update, or sync a portable KAT Studio workspace in Codex. Use for KAT Studio project work, draft review, and maintenance of the official Studio checkout.
---

Use the launcher path in the installed skill's `workspace.json`. Invoke it as `node <launcher> <command>`. If working directly from a source checkout, use its `kat.mjs`.

| User request | Command |
| --- | --- |
| Open KAT Studio | `open` |
| Initialize KAT Studio | `init` |
| Check KAT Studio Status | `status` |
| Save KAT Studio | `save` for a local verified workspace backup. For code, inspect the staged diff then use `save --message "…"`. |
| Update KAT Studio | `update` to check, then `update --approve` after approval of the selected release. |
| Sync KAT Studio with GitHub | `sync` to review commits and tags. Use `sync --approve` only after approval of those exact commits and the destination. |

After opening, use the local browser URL from the launcher. Treat its access token as private. Start the same workspace on future requests. Consult the project's saved briefs, style, notes, and draft history with `node <launcher> context <project-id>` before editing. Read `docs/editing.md` for the assisted editing workflow, reusable lessons and verified draft registration. Preserve approved drafts and produce new versions for revisions.

Read the checkout's `docs/setup.md` before restoring a backup, rolling back, or publishing. Use GitHub for source and release history. Transfer private projects between machines using verified Studio snapshots over a private channel.
