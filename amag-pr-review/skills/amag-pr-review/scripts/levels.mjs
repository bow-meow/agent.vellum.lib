// What each review level changes. Scripts read the level from repos.json, where prepare.mjs records it.
export const LEVELS = {
  // A quick look for showstoppers: fewer reviewers, no recheck. It never approves and never counts as
  // the review of a commit, so the next review reads the whole change again.
  low: { context: 15, mergeMax: Infinity, lean: true, recheck: false, approve: false, secondPass: false },
  medium: { context: 15, mergeMax: 400, lean: false, recheck: true, approve: true, secondPass: false },
  // A second, independent correctness pass catches what only one reviewer reaches on a given run.
  high: { context: 40, mergeMax: 0, lean: false, recheck: true, approve: true, secondPass: true },
};

export const DEFAULT_LEVEL = 'medium';

export function levelName(name) {
  const n = name ?? DEFAULT_LEVEL;
  if (!Object.hasOwn(LEVELS, n)) throw new Error(`unknown level "${n}": use ${Object.keys(LEVELS).join(', ')}`);
  return n;
}

export const levelOf = name => LEVELS[levelName(name)];
