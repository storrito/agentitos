#!/usr/bin/env bash
# Ubuntu's packages the tests need ($DEBS: ffmpeg, and Noto Sans for the layout skill's pages),
# from ~/debs when GitHub's cache brought them, else from Ubuntu's mirrors, which then fill
# ~/debs for the cache to keep. The cache holds for the Ubuntu release, not for the runner
# image's build: every build of ubuntu-24.04 installs the same release's packages. A set that no
# longer fits (a build that lacks a library the set did not bring, a package Ubuntu replaced)
# fails to install; then the mirrors are asked and the set is made anew. A mirror that fails is
# asked again, three times in all, a pause between. Writes fresh=true|false to $GITHUB_OUTPUT.
set -euo pipefail
dir="$HOME/debs" out="${GITHUB_OUTPUT:-/dev/null}"
sudo rm -f /var/lib/man-db/auto-update   # man-db's index of new manuals would take minutes
# (DEBS_BREAK, from a manual run: a cached package made unreadable, to show the way back)
if [ -n "${DEBS_BREAK:-}" ] && ls "$dir"/*.deb >/dev/null 2>&1; then f=$(ls "$dir"/*.deb | head -n 1); echo "::warning::DEBS_BREAK: $(basename "$f") made unreadable"; : > "$f"; fi
if ls "$dir"/*.deb >/dev/null 2>&1 && sudo DEBIAN_FRONTEND=noninteractive dpkg -i --refuse-downgrade "$dir"/*.deb > /dev/null; then
  echo "$(ls "$dir"/*.deb | wc -l) packages installed from the cache"
  echo "fresh=false" >> "$out"
else
  if ls "$dir"/*.deb >/dev/null 2>&1; then echo "::warning::The cached packages did not install on this runner: from Ubuntu's mirrors, and the cache made anew."; fi
  ok=""
  for try in 1 2 3; do
    if sudo apt-get update -o Acquire::Retries=5 \
      && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -f --no-install-recommends -o Acquire::Retries=5 -o APT::Keep-Downloaded-Packages=true $DEBS < /dev/null; then ok=1; break; fi
    [ "$try" -lt 3 ] && { echo "::warning::Ubuntu's mirrors failed (try $try of 3): again in 30 s."; sleep 30; }
  done
  [ -n "$ok" ] || { echo "::error::$DEBS could not be installed: Ubuntu's mirrors failed three times."; exit 1; }
  rm -rf "$dir" && mkdir -p "$dir" && cp /var/cache/apt/archives/*.deb "$dir"/
  echo "$(ls "$dir"/*.deb | wc -l) packages from Ubuntu's mirrors, kept for the cache"
  echo "fresh=true" >> "$out"
fi
ffmpeg -hide_banner -version | sed -n 1p
fc-match "Noto Sans"
