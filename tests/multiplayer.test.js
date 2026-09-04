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

      socket.on('join_room', ({ code, name }, cb) => {
        const res = gameManager.joinRoom(code, socket.id, name);
        if (res.error) return cb({ error: res.error });
        socket.join(`room_${res.room.code}`);
        cb({ success: true, room: gameManager.getRoomSummary(res.room.code), playerId: socket.id });
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
          rankings: res.rankings
        });
        cb({ success: true, player: res.player, rankings: res.rankings });
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

});
