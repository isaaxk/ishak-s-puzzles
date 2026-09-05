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

  test('Mode 1: Race finishes as soon as first player solves puzzle', () => {
    const gm = new GameManager();
    const room = gm.createRoom('socket-host', 'Host', { raceMode: 'first' });
    gm.joinRoom(room.code, 'socket-p1', 'Player1');
    gm.joinRoom(room.code, 'socket-p2', 'Player2');

    gm.startCountdown(room.code, 'socket-host');
    room.state = 'RACING';

    // Player 1 updates progress
    gm.updatePlayerProgress(room.code, 'socket-p1', { matched: 8, errors: 1 });

    // Host finishes first
    const finishRes = gm.recordPlayerFinish(room.code, 'socket-host', { finishTime: 18.25, errors: 0 });
    assert.equal(finishRes.allCompleted, true, 'Mode 1 finishes immediately on 1st completion');
    assert.equal(room.state, 'FINISHED');
    assert.equal(finishRes.rankings[0].id, 'socket-host');
    assert.equal(finishRes.rankings[0].rank, 1);
  });

  test('Mode 2: Race finishes when top 3 players solve puzzle', () => {
    const gm = new GameManager();
    const room = gm.createRoom('socket-host', 'Host', { raceMode: 'top3' });
    gm.joinRoom(room.code, 'socket-p1', 'Player1');
    gm.joinRoom(room.code, 'socket-p2', 'Player2');
    gm.joinRoom(room.code, 'socket-p3', 'Player3');
    gm.joinRoom(room.code, 'socket-p4', 'Player4');

    gm.startCountdown(room.code, 'socket-host');
    room.state = 'RACING';

    // 1st finisher
    const f1 = gm.recordPlayerFinish(room.code, 'socket-p1', { finishTime: 15.0 });
    assert.equal(f1.allCompleted, false, '1st finish does not end Mode 2');
    assert.equal(room.state, 'RACING');

    // 2nd finisher
    const f2 = gm.recordPlayerFinish(room.code, 'socket-p2', { finishTime: 18.0 });
    assert.equal(f2.allCompleted, false, '2nd finish does not end Mode 2');
    assert.equal(room.state, 'RACING');

    // 3rd finisher
    const f3 = gm.recordPlayerFinish(room.code, 'socket-p3', { finishTime: 22.0 });
    assert.equal(f3.allCompleted, true, '3rd finish ends Mode 2');
    assert.equal(room.state, 'FINISHED');
    assert.equal(f3.rankings.length, 5);
  });

  test('Mode 3: Race finishes when all players solve or surrender', () => {
    const gm = new GameManager();
    const room = gm.createRoom('socket-host', 'Host', { raceMode: 'all' });
    gm.joinRoom(room.code, 'socket-p1', 'Player1');
    gm.joinRoom(room.code, 'socket-p2', 'Player2');

    gm.startCountdown(room.code, 'socket-host');
    room.state = 'RACING';

    // Player 1 finishes
    const f1 = gm.recordPlayerFinish(room.code, 'socket-p1', { finishTime: 14.5 });
    assert.equal(f1.allCompleted, false);

    // Host surrenders
    const sHost = gm.surrenderPlayer(room.code, 'socket-host');
    assert.equal(sHost.allCompleted, false);
    assert.equal(sHost.player.surrendered, true);

    // Player 2 surrenders -> last unfinished player surrenders -> race finishes!
    const sP2 = gm.surrenderPlayer(room.code, 'socket-p2');
    assert.equal(sP2.allCompleted, true);
    assert.equal(room.state, 'FINISHED');

    // Rankings: Player 1 (finished) is rank 1; surrendered players follow
    assert.equal(sP2.rankings[0].id, 'socket-p1');
    assert.equal(sP2.rankings[0].rank, 1);
    assert.equal(sP2.rankings[1].surrendered, true);
    assert.equal(sP2.rankings[2].surrendered, true);
  });

  test('Host can unilaterally end the race at any moment', () => {
    const gm = new GameManager();
    const room = gm.createRoom('socket-host', 'Host', { raceMode: 'all' });
    gm.joinRoom(room.code, 'socket-p1', 'Player1');
    gm.joinRoom(room.code, 'socket-p2', 'Player2');

    gm.startCountdown(room.code, 'socket-host');
    room.state = 'RACING';

    // Non-host attempts to end race -> error
    const nonHostEnd = gm.hostEndRace(room.code, 'socket-p1');
    assert.ok(nonHostEnd.error);
    assert.match(nonHostEnd.error, /host/i);
    assert.equal(room.state, 'RACING');

    // Host ends race -> succeeds
    const hostEnd = gm.hostEndRace(room.code, 'socket-host');
    assert.equal(hostEnd.success, true);
    assert.equal(room.state, 'FINISHED');
    assert.ok(hostEnd.rankings);
    assert.equal(hostEnd.rankings.length, 3);
  });

});

