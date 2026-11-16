#!/bin/sh
set -eu
root=${KAT_HOME:-"$HOME/.local/share/kat-studio"}
repo=${KAT_REPO:-https://github.com/faizijr12github/KAT-Studio.git}
target=$root/app
for tool in node git ffmpeg ffprobe; do
  command -v "$tool" >/dev/null || { echo "Required command missing: $tool" >&2; exit 1; }
done
node --input-type=module -e 'import {backup} from "node:sqlite"; if(typeof backup !== "function") process.exit(1)'
if [ -e "$target" ] || [ -L "$target" ]; then
  [ -f "$target/kat.mjs" ] || { echo "Install destination is occupied: $target" >&2; exit 1; }
  git -C "$target" diff --quiet HEAD && [ -z "$(git -C "$target" status --porcelain)" ] || {
    echo "The installed checkout has local edits. Review them before reinstalling." >&2; exit 1;
  }
  node "$target/kat.mjs" init
  node "$target/kat.mjs" update || echo "Release check unavailable. Opening the existing install." >&2
  exec node "$target/kat.mjs" open
fi
mkdir -p "$root"
# Keep checkout and validation separate from the installed location.
mkdir "$root/.install-lock" || { echo "Another install is running, or the install lock needs inspection." >&2; exit 1; }
scratch=$(mktemp -d "$root/.install.XXXXXXXX") || { rmdir "$root/.install-lock"; exit 1; }
trap 'rm -rf "$scratch"; rmdir "$root/.install-lock"' EXIT
trap 'exit 1' HUP INT TERM
git clone --origin origin --no-checkout -- "$repo" "$scratch/app"
git -C "$scratch/app" fsck --strict
tag=$(git -C "$scratch/app" tag --sort=-version:refname | awk '/^v[0-9]+\.[0-9]+\.[0-9]+$/ && !found { print; found=1 }')
[ -n "$tag" ] || { echo "No stable release tag was found in $repo." >&2; exit 1; }
commit=$(git -C "$scratch/app" rev-parse "refs/tags/$tag^{commit}")
if [ -n "${KAT_EXPECTED_COMMIT:-}" ] && [ "$commit" != "$KAT_EXPECTED_COMMIT" ]; then
  echo "Release commit does not match KAT_EXPECTED_COMMIT." >&2; exit 1
fi
git -C "$scratch/app" checkout -b installed "$commit"
git -C "$scratch/app" config kat.remote "$repo"
git -C "$scratch/app" config kat.installed-tag "$tag"
git -C "$scratch/app" config kat.installed-commit "$commit"
node "$scratch/app/kat.mjs" verify "$tag"
[ ! -e "$target" ] && [ ! -L "$target" ] || { echo 'Install destination changed during setup.' >&2; exit 1; }
mv "$scratch/app" "$target"
echo "Installed $tag at $target ($commit)."
node "$target/kat.mjs" init
node "$target/kat.mjs" open
