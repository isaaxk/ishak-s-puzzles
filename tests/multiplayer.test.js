process.env.NODE_ENV = 'test';
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const ioClient = require('socket.io-client');
const { GameManager } = require('../server/gameManager');

describe('Full Multiplayer Socket Integration Tests', () => {
  let server, ioServer, port, serverUrl;
  let gameManager;

  before(async () => {
    const app = express();
    server = http.createServer(app);
    ioServer = new Server(server);
    gameManager = new GameManager();

    // Attach same handlers as server.js
    ioServer.on('connection', (socket) => {
      socket.on('create_room', ({ name, settings }, cb) => {
        const room = gameManager.createRoom(socket.id, name, settings);
        socket.join(`room_${room.code}`);
        cb({ success: true, room: gameManager.getRoomSummary(room.code), playerId: socket.id });
      });

      socket.on('join_room', ({ code, name, token }, cb) => {
        const res = gameManager.joinRoom(code, socket.id, name, token);
        if (res.error) return cb({ error: res.error });
        socket.join(`room_${res.room.code}`);
        cb({
          success: true,
          room: gameManager.getRoomSummary(res.room.code),
          playerId: socket.id,
          isWaiting: Boolean(res.isWaiting)
        });
      });

      socket.on('update_settings', (newSettings, cb) => {
        const room = gameManager.getRoomBySocket(socket.id);
        const res = gameManager.updateSettings(room.code, socket.id, newSettings);
        if (res.error) return cb({ error: res.error });
        cb({ success: true, room: gameManager.getRoomSummary(room.code) });
      });

      socket.on('start_race', (cb) => {
        const room = gameManager.getRoomBySocket(socket.id);
        const res = gameManager.startCountdown(room.code, socket.id);
        if (res.error) return cb({ error: res.error });
        const summary = gameManager.getRoomSummary(room.code);
        ioServer.to(`room_${room.code}`).emit('countdown_start', {
          countdownDuration: 100,
          startTime: room.startTime,
          puzzle: summary.puzzle,
          settings: summary.settings
        });
        room.state = 'RACING';
        cb({ success: true });
      });

      socket.on('player_progress', (data) => {
        const room = gameManager.getRoomBySocket(socket.id);
        const res = gameManager.updatePlayerProgress(room.code, socket.id, data);
        if (res) {
          ioServer.to(`room_${room.code}`).emit('competitor_progress', {
            playerId: socket.id,
            matched: res.player.matched,
            total: res.player.total,
            errors: res.player.errors
          });
        }
      });

      socket.on('player_finish', (data, cb) => {
        const room = gameManager.getRoomBySocket(socket.id);
        const res = gameManager.recordPlayerFinish(room.code, socket.id, data);
        ioServer.to(`room_${room.code}`).emit('player_finished', {
          player: res.player,
          rankings: res.rankings,
          allCompleted: res.allCompleted
        });
        cb({ success: true, player: res.player, rankings: res.rankings });
      });

      socket.on('surrender_race', (cb) => {
        const room = gameManager.getRoomBySocket(socket.id);
        const res = gameManager.surrenderPlayer(room.code, socket.id);
        if (!res) return cb({ error: 'Cannot surrender' });
        ioServer.to(`room_${room.code}`).emit('player_surrendered', {
          playerId: socket.id,
          player: res.player,
          allCompleted: res.allCompleted,
          rankings: res.rankings
        });
        cb({ success: true, allCompleted: res.allCompleted });
      });

      socket.on('host_end_race', (cb) => {
        const room = gameManager.getRoomBySocket(socket.id);
        const res = gameManager.hostEndRace(room.code, socket.id);
        if (res.error) return cb({ error: res.error });
        ioServer.to(`room_${room.code}`).emit('race_ended_by_host', {
          message: 'Host ended the race! 🛑',
          rankings: res.rankings
        });
        cb({ success: true });
      });
    });

    await new Promise((resolve) => {
      server.listen(0, () => {
        port = server.address().port;
        serverUrl = `http://localhost:${port}`;
        resolve();
      });
    });
  });

  after(() => {
    ioServer.close();
    server.close();
  });

  function createClient() {
    return ioClient(serverUrl, {
      transports: ['websocket'],
      forceNew: true
    });
  }

  test('Host creates room and Competitor joins via room code', async () => {
    const host = createClient();
    const guest = createClient();

    let roomCode;

    await new Promise((resolve) => {
      host.emit('create_room', { name: 'Host Ishak', settings: { difficulty: 'hard' } }, (res) => {
        assert.equal(res.success, true);
        assert.equal(res.room.settings.difficulty, 'hard');
        assert.equal(res.room.players.length, 1);
        roomCode = res.room.code;
        resolve();
      });
    });

    await new Promise((resolve) => {
      guest.emit('join_room', { code: roomCode, name: 'Ahmed' }, (res) => {
        assert.equal(res.success, true);
        assert.equal(res.room.players.length, 2);
        resolve();
      });
    });

    host.disconnect();
    guest.disconnect();
  });

  test('Race start sends identical puzzle to all players', async () => {
    const host = createClient();
    const guest = createClient();
    let roomCode;

    await new Promise((resolve) => {
      host.emit('create_room', { name: 'Ishak' }, (res) => {
        roomCode = res.room.code;
        resolve();
      });
    });

    await new Promise((resolve) => {
      guest.emit('join_room', { code: roomCode, name: 'Ahmed' }, () => resolve());
    });

    let hostPuzzle = null;
    let guestPuzzle = null;

    const pHost = new Promise((resolve) => {
      host.on('countdown_start', (data) => {
        hostPuzzle = data.puzzle;
        resolve();
      });
    });

    const pGuest = new Promise((resolve) => {
      guest.on('countdown_start', (data) => {
        guestPuzzle = data.puzzle;
        resolve();
      });
    });

    await new Promise((resolve) => {
      host.emit('start_race', () => resolve());
    });

    await Promise.all([pHost, pGuest]);

    assert.ok(hostPuzzle);
    assert.ok(guestPuzzle);
    assert.equal(hostPuzzle.bottleCount, 12);
    assert.equal(guestPuzzle.bottleCount, 12);
    // Identical puzzle layout!
    assert.deepEqual(hostPuzzle.targetSequence, guestPuzzle.targetSequence);

    host.disconnect();
    guest.disconnect();
  });

  test('Tiebreaker Rule: Ahmed 30.50s 2 errors ranks above Ishak 30.50s 4 errors', async () => {
    const host = createClient();
    const guest = createClient();
    let roomCode;

    await new Promise((resolve) => {
      host.emit('create_room', { name: 'Ishak' }, (res) => {
        roomCode = res.room.code;
        resolve();
      });
    });

    await new Promise((resolve) => {
      guest.emit('join_room', { code: roomCode, name: 'Ahmed' }, () => resolve());
    });

    await new Promise((resolve) => host.emit('start_race', () => resolve()));

    // Ahmed finishes first with 30.50s and 2 errors
    let finalRankings = null;
    await new Promise((resolve) => {
      guest.emit('player_finish', { finishTime: 30.50, errors: 2 }, (res) => resolve());
    });

    // Ishak finishes with 30.50s and 4 errors
    await new Promise((resolve) => {
      host.emit('player_finish', { finishTime: 30.50, errors: 4 }, (res) => {
        finalRankings = res.rankings;
        resolve();
      });
    });

    assert.ok(finalRankings);
    assert.equal(finalRankings[0].name, 'Ahmed');
    assert.equal(finalRankings[0].rank, 1);
    assert.equal(finalRankings[0].finishTime, 30.50);
    assert.equal(finalRankings[0].errors, 2);

    assert.equal(finalRankings[1].name, 'Ishak');
    assert.equal(finalRankings[1].rank, 2);
    assert.equal(finalRankings[1].finishTime, 30.50);
    assert.equal(finalRankings[1].errors, 4);

    host.disconnect();
    guest.disconnect();
  });

  test('Mid-race joiner receives isWaiting true and waits in lobby', async () => {
    const host = createClient();
    const racer = createClient();
    const lateJoiner = createClient();
    let roomCode;

    await new Promise((resolve) => {
      host.emit('create_room', { name: 'Host' }, (res) => {
        roomCode = res.room.code;
        resolve();
      });
    });

    await new Promise((resolve) => {
      racer.emit('join_room', { code: roomCode, name: 'Racer' }, () => resolve());
    });

    // Start race
    await new Promise((resolve) => {
      host.emit('start_race', () => resolve());
    });

    // Late joiner joins mid-race
    let lateJoinRes;
    await new Promise((resolve) => {
      lateJoiner.emit('join_room', { code: roomCode, name: 'LateJoiner' }, (res) => {
        lateJoinRes = res;
        resolve();
      });
    });

    assert.equal(lateJoinRes.success, true);
    assert.equal(lateJoinRes.isWaiting, true, 'Late joiner must have isWaiting: true');

    // Host finishes
    await new Promise((resolve) => {
      host.emit('player_finish', { finishTime: 20.00, errors: 0 }, () => resolve());
    });

    // Racer finishes -> race finishes -> late joiner becomes active!
    await new Promise((resolve) => {
      racer.emit('player_finish', { finishTime: 22.00, errors: 1 }, () => resolve());
    });

    const summary = gameManager.getRoomSummary(roomCode);
    const lateP = summary.players.find(p => p.name === 'LateJoiner');
    assert.ok(lateP);
    assert.equal(lateP.isWaiting, false, 'Late joiner is now one of them directly!');

    host.disconnect();
    racer.disconnect();
    lateJoiner.disconnect();
  });

  test('Player surrender emits player_surrendered and finishes race when remaining racers surrender', async () => {
    const host = createClient();
    const guest = createClient();
    let roomCode;

    await new Promise((resolve) => {
      host.emit('create_room', { name: 'Host', settings: { raceMode: 'all' } }, (res) => {
        roomCode = res.room.code;
        resolve();
      });
    });

    await new Promise((resolve) => {
      guest.emit('join_room', { code: roomCode, name: 'Guest' }, () => resolve());
    });

    await new Promise((resolve) => {
      host.emit('start_race', () => resolve());
    });

    // Host finishes
    await new Promise((resolve) => {
      host.emit('player_finish', { finishTime: 19.5, errors: 0 }, () => resolve());
    });

    // Guest surrenders
    const pSurrender = new Promise((resolve) => {
      host.on('player_surrendered', (data) => {
        assert.equal(data.allCompleted, true);
        assert.equal(data.player.name, 'Guest');
        assert.equal(data.player.surrendered, true);
        resolve();
      });
    });

    await new Promise((resolve) => {
      guest.emit('surrender_race', (res) => {
        assert.equal(res.success, true);
        assert.equal(res.allCompleted, true);
        resolve();
      });
    });

    await pSurrender;

    host.disconnect();
    guest.disconnect();
  });

  test('Host ending race emits race_ended_by_host with final rankings', async () => {
    const host = createClient();
    const guest = createClient();
    let roomCode;

    await new Promise((resolve) => {
      host.emit('create_room', { name: 'Host', settings: { raceMode: 'all' } }, (res) => {
        roomCode = res.room.code;
        resolve();
      });
    });

    await new Promise((resolve) => {
      guest.emit('join_room', { code: roomCode, name: 'Guest' }, () => resolve());
    });

    await new Promise((resolve) => {
      host.emit('start_race', () => resolve());
    });

    const pHostEnd = new Promise((resolve) => {
      guest.on('race_ended_by_host', (data) => {
        assert.ok(data.rankings);
        assert.equal(data.rankings.length, 2);
        resolve();
      });
    });

    await new Promise((resolve) => {
      host.emit('host_end_race', (res) => {
        assert.equal(res.success, true);
        resolve();
      });
    });

    await pHostEnd;

    host.disconnect();
    guest.disconnect();
  });

});
