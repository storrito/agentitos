#!/usr/bin/env bash
# The ffmpeg the tests run with: ffmpeg and ffprobe of one static build of FFmpeg's newest release
# branch (9.0), from github.com/BtbN/FFmpeg-Builds, put into the folder $1. It is the build an
# rragent machine has (rragent's deploy/image/ffmpeg.sh names it, with the same three values: when
# that file moves to a newer build, this one follows), so a filter, an option or a loudness number
# is the same in a test as where the skills run. Ubuntu's own ffmpeg (6.1.1 on ubuntu-24.04) still
# took options ffmpeg 9 no longer knows (-vsync) and timed a made-up clip's frames differently.
#
# The build is a month's last one (autobuild-<yyyy>-<mm>-<last day>): BtbN keeps those for about
# two years and deletes a day's build after about two weeks. The download is checked against the
# checksum the release listed for it, which is written here, not fetched.
#
# The same on your machine: bash .github/ffmpeg.sh ~/.local/bin
set -euo pipefail

BUILD=autobuild-2026-10-31-12-59
NAME=ffmpeg-n9.0.2-39-g7adfbe40dc-linux64-gpl-9.0
SHA256=73e29a56974ae5a651133a04584c7483b21afe941e17dc91d79814a758b608d3

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
