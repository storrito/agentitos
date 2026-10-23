// How fast what the picture shows in a pause plays (after best-takes' motion.mjs; where the
// picture moves is activity.mjs).

// A moving span: up to 2.5 s as it is, longer ones in about a third of their time, 2 to 6 s, at
// most ten times as fast (HyperFrames' limit).
export function speed(seconds) {
  if (seconds <= 2.5) return 1;
  return Math.min(10, seconds / Math.min(6, Math.max(2, seconds / 3)));
}

// A wait whose picture moves (the agent working, a progress bar, a phone loading): in 3 to 5 s,
// at most ten times as fast, so that the viewer sees the time pass.
export function waitSpeed(seconds) {
  const span = Math.min(5, Math.max(3, seconds / 6));
  return Math.max(1, Math.min(10, seconds / span));
}

// The picture of a wait moves enough to play as a timelapse from this share of its time on.
export const WAIT_MOVING = 0.15;
// A wait whose picture stands still holds this long before the cut.
export const WAIT_HOLD = 3;
