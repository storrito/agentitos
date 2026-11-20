#!/usr/bin/env bash
# The ffmpeg the tests run with: ffmpeg and ffprobe of one static build of FFmpeg's 8.1 release
# branch, from github.com/BtbN/FFmpeg-Builds, put into the folder $1. It is the build an rragent
# machine has (rragent's deploy/image/ffmpeg.sh names it, with the same three values: when that
# file moves to another build, this one follows), so a filter, an option or a loudness number is
# the same in a test as where the skills run. Not the newest branch, 9.0: in 9.0.2 the filter
# anlmdn ends with a memory error on every input and arnndn writes invalid samples at its end
# (tried 2026-11-19; 8.1.3 has neither fault). The skills' own commands run on both: ffmpeg 9
# no longer knows -vsync, and none of them uses it. Ubuntu's own ffmpeg (6.1.1 on ubuntu-24.04)
# timed a made-up clip's frames differently.
#
# The build is a month's last one (autobuild-<yyyy>-<mm>-<last day>): BtbN keeps those for about
# two years and deletes a day's build after about two weeks. The download is checked against the
# checksum the release listed for it, which is written here, not fetched.
#
# The same on your machine: bash .github/ffmpeg.sh ~/.local/bin
set -euo pipefail

BUILD=autobuild-2026-10-31-12-59
NAME=ffmpeg-n8.1.3-27-g8dca1586f4-linux64-gpl-8.1
SHA256=41e9c565594c390622cf968d82fa4135d9e9a11d06c1515644288cbc844e3380

dest="${1:?usage: ffmpeg.sh <the folder ffmpeg and ffprobe go into>}"
[ "$(uname -m)" = x86_64 ] || { echo "this build of ffmpeg is for x86_64, the machine is $(uname -m): nothing installed" >&2; exit 1; }

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl -fsSL --retry 3 -o "$tmp/ffmpeg.tar.xz" \
  "https://github.com/BtbN/FFmpeg-Builds/releases/download/$BUILD/$NAME.tar.xz"
echo "$SHA256  $tmp/ffmpeg.tar.xz" | sha256sum --quiet -c -
tar -xJf "$tmp/ffmpeg.tar.xz" -C "$tmp" "$NAME/bin/ffmpeg" "$NAME/bin/ffprobe"
mkdir -p "$dest"
# each program written beside its place and moved there in one step: never a half-written one
for program in ffmpeg ffprobe; do install -m 755 "$tmp/$NAME/bin/$program" "$dest/.$program.new"; done
for program in ffmpeg ffprobe; do mv -f "$dest/.$program.new" "$dest/$program"; done
"$dest/ffmpeg" -hide_banner -version | head -1
