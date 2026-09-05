const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { GameManager, DIFFICULTY_MAP } = require('../server/gameManager');

describe('GameManager Tests', () => {

  test('Create room initializes host, room code, and default 12 bottles', () => {
    const gm = new GameManager();
    const room = gm.createRoom('socket-host', 'HostPlayer');

    assert.ok(room.code);
    assert.equal(room.code.length, 5);
    assert.equal(room.hostId, 'socket-host');
    assert.equal(room.settings.difficulty, 'hard'); // default 12 bottles
    assert.equal(room.players.size, 1);
    const host = room.players.get('socket-host');
    assert.equal(host.name, 'HostPlayer');
    assert.equal(host.isHost, true);
    assert.equal(host.total, 12);
  });

  test('Players can join room with valid room code', () => {
    const gm = new GameManager();
    const room = gm.createRoom('socket-host', 'HostPlayer');
    const res = gm.joinRoom(room.code, 'socket-competitor', 'Ahmed');

    assert.ok(res.player);
    assert.equal(res.player.name, 'Ahmed');
    assert.equal(res.player.isHost, false);
    assert.equal(room.players.size, 2);
  });

  test('Cannot join non-existent room or full room', () => {
    const gm = new GameManager();
    const room = gm.createRoom('socket-host', 'HostPlayer', { maxPlayers: 2 });
    gm.joinRoom(room.code, 'socket-p2', 'Player 2');

    // Room is now full (2/2)
    const fullRes = gm.joinRoom(room.code, 'socket-p3', 'Player 3');
    assert.ok(fullRes.error);
    assert.match(fullRes.error, /full/i);

    // Invalid code
    const invalidRes = gm.joinRoom('XXXXX', 'socket-p4', 'Player 4');
    assert.ok(invalidRes.error);
    assert.match(invalidRes.error, /not found/i);
  });

  test('Host can update settings and kick players', () => {
    const gm = new GameManager();
    const room = gm.createRoom('socket-host', 'HostPlayer');
    gm.joinRoom(room.code, 'socket-p2', 'Troublemaker');

    // Non-host attempts kick -> fails
    const fakeKick = gm.kickPlayer(room.code, 'socket-p2', 'socket-host');
    assert.ok(fakeKick.error);

    // Host kicks Troublemaker -> succeeds
    const kickRes = gm.kickPlayer(room.code, 'socket-host', 'socket-p2');
    assert.equal(kickRes.success, true);
    assert.equal(room.players.size, 1);
    assert.equal(room.players.has('socket-p2'), false);

    // Host updates settings (e.g. error penalty ON, 2s penalty)
    const updateRes = gm.updateSettings(room.code, 'socket-host', {
      difficulty: 'medium',
      errorPenaltyEnabled: true,
      penaltyPerError: 2
    });
    assert.equal(updateRes.success, true);
    assert.equal(room.settings.difficulty, 'medium');
    assert.equal(room.settings.errorPenaltyEnabled, true);
    assert.equal(room.settings.penaltyPerError, 2);
    assert.equal(room.players.get('socket-host').total, 8); // medium = 8 bottles
  });

  test('Synchronized puzzle generation: all players receive the same puzzle', () => {
    const gm = new GameManager();
    const room = gm.createRoom('socket-host', 'HostPlayer', { difficulty: 'hard' });
    gm.joinRoom(room.code, 'socket-ahmed', 'Ahmed');

    const startRes = gm.startCountdown(room.code, 'socket-host');
    assert.equal(startRes.success, true);
    assert.equal(room.state, 'COUNTDOWN');
    assert.ok(room.puzzle);
    assert.equal(room.puzzle.bottleCount, 12);
    assert.equal(room.puzzle.targetSequence.length, 12);

    const summary = gm.getRoomSummary(room.code);
    assert.equal(summary.puzzle.targetSequence.length, 12);
    assert.deepEqual(summary.puzzle.targetSequence, room.puzzle.targetSequence);
  });

  test('Live progress and finish recording', () => {
    const gm = new GameManager();
    const room = gm.createRoom('socket-host', 'HostPlayer', { difficulty: 'hard' });
    gm.joinRoom(room.code, 'socket-ahmed', 'Ahmed');
    gm.startCountdown(room.code, 'socket-host');
    room.state = 'RACING';

    // Ahmed makes moves
    gm.updatePlayerProgress(room.code, 'socket-ahmed', { matched: 7, errors: 2 });
    const ahmed = room.players.get('socket-ahmed');
    assert.equal(ahmed.matched, 7);
    assert.equal(ahmed.errors, 2);

    // Ahmed finishes automatically upon matching 12/12
    const finishRes = gm.recordPlayerFinish(room.code, 'socket-ahmed', { finishTime: 30.50, errors: 2 });
    assert.equal(finishRes.player.completed, true);
    assert.equal(finishRes.player.finishTime, 30.50);
    assert.equal(finishRes.player.errors, 2);
    assert.equal(finishRes.player.rank, 1);
  });

  test('Host leaves -> host role migrated to next player', () => {
    const gm = new GameManager();
    const room = gm.createRoom('socket-host', 'HostPlayer');
    gm.joinRoom(room.code, 'socket-competitor', 'Competitor');

    const leaveRes = gm.leaveRoom('socket-host');
    assert.equal(leaveRes.roomDeleted, false);
    assert.equal(room.hostId, 'socket-competitor');
    assert.equal(room.players.get('socket-competitor').isHost, true);
  });

  test('Disconnect grace period keeps player in room and reconnectPlayer restores session', () => {
    const gm = new GameManager();
    const room = gm.createRoom('socket-host', 'HostPlayer', {}, 'token-host-123');
    const joinRes = gm.joinRoom(room.code, 'socket-player2', 'Player2', 'token-p2-456');

    // Player 2 switches apps / temporary disconnect
    const dcRes = gm.handleDisconnect('socket-player2');
    assert.ok(dcRes);
    assert.equal(dcRes.player.connected, false);
    assert.equal(room.players.size, 2, 'Player should NOT be removed on disconnect');

    // Player 2 returns with a new socket ID
    const recRes = gm.reconnectPlayer(room.code, 'socket-player2-new', 'token-p2-456');
    assert.ok(recRes.success);
    assert.equal(recRes.player.id, 'socket-player2-new');
    assert.equal(recRes.player.connected, true);
    assert.equal(room.players.get('socket-player2-new').name, 'Player2');
    assert.equal(room.players.has('socket-player2'), false);
    assert.equal(room.players.size, 2);

    // Clean up timer
    gm.clearDisconnectTimer('token-p2-456');
    gm.clearDisconnectTimer('token-host-123');
  });

  test('Mid-race joiner waits in lobby and automatically becomes active when race finishes', () => {
    const gm = new GameManager();
    const room = gm.createRoom('socket-host', 'Host');
    gm.joinRoom(room.code, 'socket-p1', 'Player1');

    // Host starts race
    gm.startCountdown(room.code, 'socket-host');
    room.state = 'RACING';

    // Player 2 joins while race is in progress
    const joinMidRace = gm.joinRoom(room.code, 'socket-p2', 'Player2');
    assert.ok(joinMidRace.player, 'Player 2 should be allowed to join');
    assert.equal(joinMidRace.isWaiting, true, 'Player 2 must be marked as waiting');
    assert.equal(joinMidRace.player.isWaiting, true);

    // Player 1 finishes the race
    const hostFinish = gm.recordPlayerFinish(room.code, 'socket-host', { finishTime: 20.00 });
    assert.equal(hostFinish.allCompleted, false, 'Player 1 is still racing');

    const p1Finish = gm.recordPlayerFinish(room.code, 'socket-p1', { finishTime: 25.00 });
    assert.equal(p1Finish.allCompleted, true, 'All active racers finished, ignoring waiting player');
    assert.equal(room.state, 'FINISHED');

    // Check that Player 2 is now one of them directly!
    const p2 = room.players.get('socket-p2');
    assert.equal(p2.isWaiting, false, 'Waiting player must directly become a full room participant');

    // Host restarts race for rematch
    const restartRes = gm.restartRace(room.code, 'socket-host');
    assert.equal(restartRes.success, true);
    assert.equal(room.state, 'LOBBY');
    assert.equal(room.players.get('socket-p2').isWaiting, false);
  });

});
