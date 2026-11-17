# KAT Studio upgrades

When the owner asks for a KAT Studio upgrade, finish it by publishing the verified source changes to the existing GitHub repository at https://github.com/faizijr12github/KAT-STUDIO. The owner has authorized this as part of completed upgrades.

- Use the existing checkout and inspect its status and remote first. Sync upgrade-related source, portable presets, reusable lessons and documentation. Keep unrelated changes, project databases, client media, local drafts, private prompts and credentials out of the commit.
- Test the affected workflow and run `node --test` plus `git diff --check`. Fix regressions before publishing. Bump the package version and add a matching annotated tag for an installable release.
- Commit the reviewed changes. Push to `main` without force, atomically with the new tag when releasing. Verify the remote commit and tag against the local refs. Report the confirmed result, version and commit link.
- If authentication or a remote conflict prevents publishing, preserve the local work and report the specific blocker. Never publish an untested upgrade or overwrite remote work to make the push succeed.

Apply this workflow when completing app upgrades. Routine project work and draft edits stay in the local Studio workspace.
