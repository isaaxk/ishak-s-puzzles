/**
 * ranking.js
 * Ranking engine for Color Bottle Matching Game
 * 
 * Rules:
 * 1. Puzzle Completion: Completed players always rank above non-completed players.
 * 2. Finish Time: Lowest finish time ranks higher.
 * 3. Error Penalty:
 *    - OFF (default): Finish time is primary criterion, errors are tiebreaker only.
 *    - ON: Final Time = finishTime + (errors * penalty). Final time is primary criterion.
 * 4. Ties:
 *    - When primary time is identical: fewer errors ranks higher.
 *    - When both time and errors are identical: players share the exact same ranking position.
 *    - Server timestamp is explicitly NOT used to break ties.
 * 5. Incomplete players:
 *    - More matched bottles ranks higher.
 *    - Fewer errors ranks higher as tiebreaker.
 *    - Shared rank if matched and errors are identical.
 */

/**
 * Calculates final time for a player based on penalty settings.
 * @param {number|null} finishTime - In seconds (e.g. 24.37)
 * @param {number} errors - Number of errors made
 * @param {boolean} errorPenaltyEnabled - Whether error penalty is active
 * @param {number} penaltyPerError - Penalty in seconds per error
 * @returns {number|null}
 */
function calculateFinalTime(finishTime, errors = 0, errorPenaltyEnabled = false, penaltyPerError = 0) {
  if (finishTime === null || finishTime === undefined) return null;
  const time = Number(finishTime);
  const err = Number(errors) || 0;
  if (!errorPenaltyEnabled || !penaltyPerError) {
    return Number(time.toFixed(2));
  }
  const penalty = err * Number(penaltyPerError);
  return Number((time + penalty).toFixed(2));
}

/**
 * Compares two players according to ranking rules.
 * Returns negative if p1 ranks higher (better), positive if p2 ranks higher, 0 if tied.
 */
function comparePlayers(p1, p2, errorPenaltyEnabled = false, penaltyPerError = 0) {
  // Waiting players (joined mid-race) always rank behind active racers
  const p1Waiting = Boolean(p1.isWaiting);
  const p2Waiting = Boolean(p2.isWaiting);
  if (p1Waiting && !p2Waiting) return 1;
  if (!p1Waiting && p2Waiting) return -1;
  if (p1Waiting && p2Waiting) return 0;

  const p1Completed = Boolean(p1.completed);
  const p2Completed = Boolean(p2.completed);

  // 1. Completion check
  if (p1Completed && !p2Completed) return -1;
  if (!p1Completed && p2Completed) return 1;

  // Both completed
  if (p1Completed && p2Completed) {
    const t1 = calculateFinalTime(p1.finishTime, p1.errors, errorPenaltyEnabled, penaltyPerError);
    const t2 = calculateFinalTime(p2.finishTime, p2.errors, errorPenaltyEnabled, penaltyPerError);

    // Primary ranking time comparison
    if (t1 !== t2) {
      return t1 - t2; // lower time is better
    }

    // Tiebreaker: errors (fewer errors is better)
    const e1 = Number(p1.errors) || 0;
    const e2 = Number(p2.errors) || 0;
    if (e1 !== e2) {
      return e1 - e2;
    }

    // Fully tied! Server timestamp is NOT used to break tie.
    return 0;
  }

  // Neither completed: rank by progress (matched bottles descending), then errors ascending
  const m1 = Number(p1.matched) || 0;
  const m2 = Number(p2.matched) || 0;
  if (m1 !== m2) {
    return m2 - m1; // higher matched is better
  }

  const e1 = Number(p1.errors) || 0;
  const e2 = Number(p2.errors) || 0;
  if (e1 !== e2) {
    return e1 - e2; // fewer errors is better
  }

  return 0; // tied in progress
}

/**
 * Computes ranks for a list of player state objects.
 * Assigns `rank`, `finalTime`, `actualTime` to each player.
 * Supports standard competition ranking (1, 1, 3) when tied.
 * 
 * @param {Array} players - Array of player objects:
 *   { id, name, completed, finishTime, matched, total, errors }
 * @param {Object} settings - { errorPenaltyEnabled, penaltyPerError }
 * @returns {Array} Ranked players with rank property added.
 */
function rankPlayers(players, settings = {}) {
  const { errorPenaltyEnabled = false, penaltyPerError = 0 } = settings;

  // Clone players to avoid mutating source unexpectedly
  const list = players.map(p => {
    const finishTime = p.finishTime !== null && p.finishTime !== undefined ? Number(Number(p.finishTime).toFixed(2)) : null;
    const finalTime = calculateFinalTime(finishTime, p.errors, errorPenaltyEnabled, penaltyPerError);
    return {
      ...p,
      finishTime,
      finalTime,
      errors: Number(p.errors) || 0,
      matched: Number(p.matched) || 0,
      total: Number(p.total) || 0,
      completed: Boolean(p.completed),
      isWaiting: Boolean(p.isWaiting)
    };
  });

  // Sort according to comparison rules
  list.sort((a, b) => comparePlayers(a, b, errorPenaltyEnabled, penaltyPerError));

  // Assign ranks with tie handling (waiting players receive null rank)
  for (let i = 0; i < list.length; i++) {
    if (list[i].isWaiting) {
      list[i].rank = null;
      continue;
    }
    if (i === 0) {
      list[i].rank = 1;
    } else {
      const cmp = comparePlayers(list[i - 1], list[i], errorPenaltyEnabled, penaltyPerError);
      if (cmp === 0) {
        // Tied with previous player
        list[i].rank = list[i - 1].rank;
      } else {
        // Olympic ranking (1, 1, 3)
        list[i].rank = i + 1;
      }
    }
  }

  return list;
}

module.exports = {
  calculateFinalTime,
  comparePlayers,
  rankPlayers
};
