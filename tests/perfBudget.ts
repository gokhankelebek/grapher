// Timing budgets in the tests are tuned for a developer machine. Shared CI
// runners (the GitHub Pages deploy) are noisier and slower, so there every
// budget is multiplied by PERF: still catches a real regression (an
// order-of-magnitude slowdown), no longer fails a deploy on a 2.7 ms run
// of a 2 ms budget.
export const PERF = typeof process !== 'undefined' && process.env.CI ? 4 : 1
