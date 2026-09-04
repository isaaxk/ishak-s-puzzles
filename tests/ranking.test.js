const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { calculateFinalTime, comparePlayers, rankPlayers } = require('../server/ranking');

describe('Ranking Engine Tests', () => {

  test('Completion rule: Uncompleted player cannot rank above completed player', () => {
    const players = [
      { id: '1', name: 'Ishak', completed: false, matched: 11, total: 12, errors: 0, finishTime: null },
      { id: '2', name: 'Ahmed', completed: true, matched: 12, total: 12, errors: 5, finishTime: 45.20 }
    ];

    const ranked = rankPlayers(players);
    assert.equal(ranked[0].name, 'Ahmed');
    assert.equal(ranked[0].rank, 1);
    assert.equal(ranked[1].name, 'Ishak');
    assert.equal(ranked[1].rank, 2);
  });

  test('Finish Time rule: Among completed players, lower time ranks higher (Penalty OFF)', () => {
    const players = [
      { id: '1', name: 'Bob', completed: true, matched: 12, total: 12, errors: 2, finishTime: 35.10 },
      { id: '2', name: 'Alice', completed: true, matched: 12, total: 12, errors: 2, finishTime: 25.80 }
    ];

    const ranked = rankPlayers(players, { errorPenaltyEnabled: false });
    assert.equal(ranked[0].name, 'Alice');
    assert.equal(ranked[0].rank, 1);
    assert.equal(ranked[1].name, 'Bob');
    assert.equal(ranked[1].rank, 2);
  });

  test('Errors as Tiebreaker: Ahmed 30.50s 2 errors ranks above Ishak 30.50s 4 errors', () => {
    const players = [
      { id: '1', name: 'Ishak', completed: true, matched: 12, total: 12, errors: 4, finishTime: 30.50 },
      { id: '2', name: 'Ahmed', completed: true, matched: 12, total: 12, errors: 2, finishTime: 30.50 }
    ];

    const ranked = rankPlayers(players, { errorPenaltyEnabled: false });
    assert.equal(ranked[0].name, 'Ahmed');
    assert.equal(ranked[0].rank, 1);
    assert.equal(ranked[1].name, 'Ishak');
    assert.equal(ranked[1].rank, 2);
  });

  test('True Tie: Identical time and errors share the same rank (Server timestamp NOT used)', () => {
    // Both finished at 30.50s with 2 errors, but Ishak was registered earlier or later
    const players = [
      { id: '1', name: 'Ahmed', completed: true, matched: 12, total: 12, errors: 2, finishTime: 30.50, timestamp: 1000 },
      { id: '2', name: 'Ishak', completed: true, matched: 12, total: 12, errors: 2, finishTime: 30.50, timestamp: 2000 },
      { id: '3', name: 'Charlie', completed: true, matched: 12, total: 12, errors: 1, finishTime: 35.00, timestamp: 3000 }
    ];

    const ranked = rankPlayers(players, { errorPenaltyEnabled: false });
    assert.equal(ranked[0].rank, 1);
    assert.equal(ranked[1].rank, 1);
    // Standard Olympic ranking: next player after two rank-1 players is rank 3
    assert.equal(ranked[2].rank, 3);
    assert.equal(ranked[2].name, 'Charlie');
  });

  test('Error Penalty ON: Final Time = Actual Time + (Errors * Penalty)', () => {
    // Example from prompt:
    // Actual Time: 28.42s, Errors: 3, Penalty: +2s/error -> Final Time = 34.42s
    const actualTime = 28.42;
    const errors = 3;
    const penalty = 2;
    const finalTime = calculateFinalTime(actualTime, errors, true, penalty);
    assert.equal(finalTime, 34.42);

    const players = [
      // Player A: 28.42s actual, 3 errors -> final 34.42s
      { id: '1', name: 'Player A', completed: true, matched: 12, total: 12, errors: 3, finishTime: 28.42 },
      // Player B: 32.00s actual, 0 errors -> final 32.00s
      { id: '2', name: 'Player B', completed: true, matched: 12, total: 12, errors: 0, finishTime: 32.00 }
    ];

    const ranked = rankPlayers(players, { errorPenaltyEnabled: true, penaltyPerError: 2 });
    assert.equal(ranked[0].name, 'Player B');
    assert.equal(ranked[0].finalTime, 32.00);
    assert.equal(ranked[0].rank, 1);

    assert.equal(ranked[1].name, 'Player A');
    assert.equal(ranked[1].finalTime, 34.42);
    assert.equal(ranked[1].rank, 2);
  });

  test('Incomplete players: Ranked by matched count, then lowest errors', () => {
    const players = [
      { id: '1', name: 'P1', completed: false, matched: 5, total: 12, errors: 3, finishTime: null },
      { id: '2', name: 'P2', completed: false, matched: 9, total: 12, errors: 4, finishTime: null },
      { id: '3', name: 'P3', completed: false, matched: 9, total: 12, errors: 1, finishTime: null }
    ];

    const ranked = rankPlayers(players);
    assert.equal(ranked[0].name, 'P3'); // 9 matched, 1 error
    assert.equal(ranked[1].name, 'P2'); // 9 matched, 4 errors
    assert.equal(ranked[2].name, 'P1'); // 5 matched, 3 errors
  });

});
