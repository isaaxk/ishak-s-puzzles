/**
 * server.js
 * Express & Socket.io server for Color Bottle Matching Race Game
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');
const QRCode = require('qrcode');
const { GameManager } = require('./gameManager');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  pingTimeout: 45000,
  pingInterval: 20000,
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = process.env.PORT || 3050;
const gameManager = new GameManager({ persist: true });

// Serve static assets
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(express.json());

// Health and keep-alive endpoints
app.get('/api/ping', (req, res) => {
  res.json({
    status: 'ok',
    rooms: gameManager.rooms.size,
    timestamp: Date.now()
  });
});

app.get('/health', (req, res) => {
  res.send('OK');
});

// Helper to get local network IP address
function getLocalNetworkIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      // Find non-internal IPv4
      if (net.family === 'IPv4' && !net.internal) {
        // Skip virtual/Hyper-V/loopback if possible
        if (!name.toLowerCase().includes('vethernet') && !name.toLowerCase().includes('virtual')) {
          return net.address;
        }
      }
    }
  }
  // Fallback
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

// API endpoint to get server network info and QR code for mobile joining
app.get('/api/info', async (req, res) => {
  const localIP = getLocalNetworkIP();
  const roomCode = req.query.room ? req.query.room.toUpperCase() : '';
  const portStr = PORT === 80 ? '' : `:${PORT}`;
  const baseUrl = `http://${localIP}${portStr}`;
  const targetUrl = roomCode ? `${baseUrl}?join=${roomCode}` : baseUrl;

  try {
    const qrDataUrl = await QRCode.toDataURL(targetUrl, {
      margin: 2,
      width: 260,
      color: {
        dark: '#1e293b',
        light: '#ffffff'
      }
    });

    res.json({
      localIP,
      port: PORT,
      joinUrl: targetUrl,
      qrDataUrl
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

// Broadcast room state to all sockets in that room
function broadcastRoomUpdate(roomCode) {
  const summary = gameManager.getRoomSummary(roomCode);
  if (summary) {
    io.to(`room_${roomCode}`).emit('room_update', summary);
  }
}

// Socket.io Connection Logic
io.on('connection', (socket) => {
  // 1. Create Room
  socket.on('create_room', ({ name, settings, token }, callback) => {
    try {
      const room = gameManager.createRoom(socket.id, name, settings, token);
      socket.join(`room_${room.code}`);
      const summary = gameManager.getRoomSummary(room.code);
      const hostPlayer = room.players.get(socket.id);
      if (typeof callback === 'function') {
        callback({ success: true, room: summary, playerId: socket.id, playerToken: hostPlayer.token });
      }
      broadcastRoomUpdate(room.code);
    } catch (err) {
      if (typeof callback === 'function') callback({ error: err.message });
    }
  });

  // 2. Join Room
  socket.on('join_room', ({ code, name, token }, callback) => {
    try {
      const result = gameManager.joinRoom(code, socket.id, name, token);
      if (result.error) {
        if (typeof callback === 'function') callback({ error: result.error });
        return;
      }
      socket.join(`room_${result.room.code}`);
      const summary = gameManager.getRoomSummary(result.room.code);
      if (typeof callback === 'function') {
        callback({
          success: true,
          room: summary,
          playerId: socket.id,
          playerToken: result.player.token,
          isWaiting: Boolean(result.player.isWaiting)
        });
      }
      broadcastRoomUpdate(result.room.code);
      const joinMsg = result.reconnected
        ? `${result.player.name} reconnected`
        : (result.player.isWaiting
            ? `${result.player.name} joined the room (waiting in lobby)`
            : `${result.player.name} joined the room`);
      io.to(`room_${result.room.code}`).emit(result.reconnected ? 'player_reconnected' : 'player_joined', {
        player: result.player,
        message: joinMsg
      });
    } catch (err) {
      if (typeof callback === 'function') callback({ error: err.message });
    }
  });

  // 2b. Reconnect Session (after background app switch or network resume)
  socket.on('reconnect_session', ({ code, roomCode, token }, callback) => {
    try {
      const targetCode = code || roomCode;
      const result = gameManager.reconnectPlayer(targetCode, socket.id, token);
      if (result.error) {
        if (typeof callback === 'function') callback({ error: result.error });
        return;
      }
      socket.join(`room_${result.room.code}`);
      const summary = gameManager.getRoomSummary(result.room.code);
      if (typeof callback === 'function') {
        callback({
          success: true,
          room: summary,
          playerId: socket.id,
          player: result.player,
          isWaiting: Boolean(result.player.isWaiting)
        });
      }
      broadcastRoomUpdate(result.room.code);
      io.to(`room_${result.room.code}`).emit('player_reconnected', {
        player: result.player,
        message: `${result.player.name} is back!`
      });
    } catch (err) {
      if (typeof callback === 'function') callback({ error: err.message });
    }
  });

  // 3. Leave Room
  socket.on('leave_room', (callback) => {
    const leaveResult = gameManager.leaveRoom(socket.id);
    if (leaveResult && !leaveResult.roomDeleted) {
      socket.leave(`room_${leaveResult.room.code}`);
      broadcastRoomUpdate(leaveResult.room.code);
      io.to(`room_${leaveResult.room.code}`).emit('player_left', {
        player: leaveResult.player,
        newHostId: leaveResult.newHostId,
        message: `${leaveResult.player?.name || 'A player'} left the room`
      });
    }
    if (typeof callback === 'function') callback({ success: true });
  });

  // 4. Kick Player (Host only)
  socket.on('kick_player', ({ targetId }, callback) => {
    const room = gameManager.getRoomBySocket(socket.id);
    if (!room) {
      if (typeof callback === 'function') callback({ error: 'Room not found' });
      return;
    }
    const result = gameManager.kickPlayer(room.code, socket.id, targetId);
    if (result.error) {
      if (typeof callback === 'function') callback({ error: result.error });
      return;
    }

    // Inform the kicked player
    io.to(targetId).emit('kicked', { message: 'You have been removed from the room by the host.' });
    const targetSocket = io.sockets.sockets.get(targetId);
    if (targetSocket) {
      targetSocket.leave(`room_${room.code}`);
    }

    broadcastRoomUpdate(room.code);
    io.to(`room_${room.code}`).emit('player_kicked', {
      player: result.kickedPlayer,
      message: `${result.kickedPlayer.name} was kicked from the room`
    });

    if (typeof callback === 'function') callback({ success: true });
  });

  // 5. Update Settings (Host only)
  socket.on('update_settings', (newSettings, callback) => {
    const room = gameManager.getRoomBySocket(socket.id);
    if (!room) {
      if (typeof callback === 'function') callback({ error: 'Room not found' });
      return;
    }
    const result = gameManager.updateSettings(room.code, socket.id, newSettings);
    if (result.error) {
      if (typeof callback === 'function') callback({ error: result.error });
      return;
    }
    broadcastRoomUpdate(room.code);
    if (typeof callback === 'function') callback({ success: true, room: gameManager.getRoomSummary(room.code) });
  });

  // 6. Start Race (Host only)
  socket.on('start_race', (callback) => {
    const room = gameManager.getRoomBySocket(socket.id);
    if (!room) {
      if (typeof callback === 'function') callback({ error: 'Room not found' });
      return;
    }
    const result = gameManager.startCountdown(room.code, socket.id);
    if (result.error) {
      if (typeof callback === 'function') callback({ error: result.error });
      return;
    }

    const summary = gameManager.getRoomSummary(room.code);

    // Broadcast countdown start (3 seconds)
    io.to(`room_${room.code}`).emit('countdown_start', {
      countdownDuration: 3000,
      startTime: room.startTime,
      puzzle: summary.puzzle,
      settings: summary.settings
    });
    broadcastRoomUpdate(room.code);

    // Schedule race active state transition after countdown
    setTimeout(() => {
      const activeRoom = gameManager.getRoom(room.code);
      if (activeRoom && activeRoom.state === 'COUNTDOWN') {
        activeRoom.state = 'RACING';
        io.to(`room_${room.code}`).emit('race_start', {
          startTime: activeRoom.startTime
        });
        broadcastRoomUpdate(room.code);
      }
    }, 3000);

    if (typeof callback === 'function') callback({ success: true });
  });

  // 7. Player Action / Progress Update
  socket.on('player_progress', (data) => {
    const room = gameManager.getRoomBySocket(socket.id);
    if (!room) return;

    const result = gameManager.updatePlayerProgress(room.code, socket.id, data);
    if (result) {
      // Broadcast fast live progress to all competitors
      io.to(`room_${room.code}`).emit('competitor_progress', {
        playerId: socket.id,
        playerName: result.player.name,
        matched: result.player.matched,
        total: result.player.total,
        errors: result.player.errors
      });
    }
  });

  // 8. Player Automatic Finish
  socket.on('player_finish', (data, callback) => {
    const room = gameManager.getRoomBySocket(socket.id);
    if (!room) {
      if (typeof callback === 'function') callback({ error: 'Room not found' });
      return;
    }

    const result = gameManager.recordPlayerFinish(room.code, socket.id, data);
    if (!result) {
      if (typeof callback === 'function') callback({ error: 'Failed to record finish' });
      return;
    }

    // Broadcast immediate finish notification
    io.to(`room_${room.code}`).emit('player_finished', {
      playerId: socket.id,
      player: result.player,
      allCompleted: result.allCompleted,
      rankings: result.rankings
    });

    broadcastRoomUpdate(room.code);
    if (typeof callback === 'function') callback({ success: true, player: result.player, rankings: result.rankings });
  });

  // 8b. Player Surrender
  socket.on('surrender_race', (callback) => {
    const room = gameManager.getRoomBySocket(socket.id);
    if (!room) {
      if (typeof callback === 'function') callback({ error: 'Room not found' });
      return;
    }

    const result = gameManager.surrenderPlayer(room.code, socket.id);
    if (!result) {
      if (typeof callback === 'function') callback({ error: 'Cannot surrender' });
      return;
    }

    io.to(`room_${room.code}`).emit('player_surrendered', {
      playerId: socket.id,
      player: result.player,
      allCompleted: result.allCompleted,
      rankings: result.rankings,
      message: `${result.player.name} surrendered 🏳️`
    });

    broadcastRoomUpdate(room.code);
    if (typeof callback === 'function') callback({ success: true, allCompleted: result.allCompleted });
  });

  // 8c. Host End Race
  socket.on('host_end_race', (callback) => {
    const room = gameManager.getRoomBySocket(socket.id);
    if (!room) {
      if (typeof callback === 'function') callback({ error: 'Room not found' });
      return;
    }

    const result = gameManager.hostEndRace(room.code, socket.id);
    if (result.error) {
      if (typeof callback === 'function') callback({ error: result.error });
      return;
    }

    io.to(`room_${room.code}`).emit('race_ended_by_host', {
      message: 'Host ended the race! 🛑',
      rankings: result.rankings
    });

    broadcastRoomUpdate(room.code);
    if (typeof callback === 'function') callback({ success: true });
  });

  // 9. Restart Race / Rematch
  socket.on('restart_race', (callback) => {
    const room = gameManager.getRoomBySocket(socket.id);
    if (!room) {
      if (typeof callback === 'function') callback({ error: 'Room not found' });
      return;
    }
    const result = gameManager.restartRace(room.code, socket.id);
    if (result.error) {
      if (typeof callback === 'function') callback({ error: result.error });
      return;
    }

    io.to(`room_${room.code}`).emit('race_reset', {
      message: 'Host has reset the race for a rematch!'
    });
    broadcastRoomUpdate(room.code);
    if (typeof callback === 'function') callback({ success: true });
  });

  // 10. Disconnect (grace period for app switching / brief network drop)
  socket.on('disconnect', () => {
    const dcResult = gameManager.handleDisconnect(socket.id, (leaveResult) => {
      // 60-second grace period expired, player actually evicted
      if (leaveResult && !leaveResult.roomDeleted) {
        broadcastRoomUpdate(leaveResult.room.code);
        io.to(`room_${leaveResult.room.code}`).emit('player_left', {
          player: leaveResult.player,
          newHostId: leaveResult.newHostId,
          message: `${leaveResult.player?.name || 'A player'} timed out`
        });
      }
    });

    if (dcResult) {
      // Broadcast that player is temporarily away / disconnected
      broadcastRoomUpdate(dcResult.room.code);
      io.to(`room_${dcResult.room.code}`).emit('player_away', {
        player: dcResult.player,
        message: `${dcResult.player.name} switched apps (away)`
      });
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const localIP = getLocalNetworkIP();
  console.log(`\n======================================================`);
  console.log(`  ISHAK's BOTTLE RACE - MULTIPLAYER SERVER`);
  console.log(`======================================================`);
  console.log(`  Local URL:   http://localhost:${PORT}`);
  console.log(`  Network URL: http://${localIP}:${PORT}`);
  console.log(`======================================================\n`);

  // Render keep-alive mechanism to prevent free tier sleeping
  const renderExternalUrl = process.env.RENDER_EXTERNAL_URL;
  if (renderExternalUrl) {
    console.log(`[KeepAlive] Scheduled for ${renderExternalUrl}`);
    setInterval(() => {
      try {
        const pingUrl = `${renderExternalUrl}/api/ping`;
        const client = pingUrl.startsWith('https') ? require('https') : require('http');
        client.get(pingUrl, (res) => {
          res.on('data', () => {});
        }).on('error', () => {});
      } catch (e) {}
    }, 10 * 60 * 1000); // Every 10 minutes
  }
});

process.on('SIGTERM', () => {
  gameManager.saveToDisk();
  process.exit(0);
});

process.on('SIGINT', () => {
  gameManager.saveToDisk();
  process.exit(0);
});
