/**
 * gameManager.js
 * In-memory room and race state manager
 */

const { rankPlayers, calculateFinalTime } = require('./ranking');

// Curated high-contrast bottle color palette
const COLOR_PALETTE = [
  { id: 'c1', name: 'Ruby Red', hex: '#E63946', secondary: '#FF6B6B' },
  { id: 'c2', name: 'Ocean Blue', hex: '#1D3557', secondary: '#457B9D' },
  { id: 'c3', name: 'Emerald', hex: '#2A9D8F', secondary: '#52B788' },
  { id: 'c4', name: 'Sun Yellow', hex: '#E9C46A', secondary: '#F4A261' },
  { id: 'c5', name: 'Tangerine', hex: '#F77F00', secondary: '#FCBF49' },
  { id: 'c6', name: 'Amethyst', hex: '#7209B7', secondary: '#B5179E' },
  { id: 'c7', name: 'Bubblegum', hex: '#F72585', secondary: '#FF70A6' },
  { id: 'c8', name: 'Electric Cyan', hex: '#00B4D8', secondary: '#90E0EF' },
  { id: 'c9', name: 'Lime Mint', hex: '#70E000', secondary: '#9EF01A' },
  { id: 'c10', name: 'Deep Indigo', hex: '#3A0CA3', secondary: '#4361EE' },
  { id: 'c11', name: 'Coral Bronze', hex: '#D00000', secondary: '#DC2F02' },
  { id: 'c12', name: 'Teal Shadow', hex: '#0077B6', secondary: '#023E8A' },
  { id: 'c13', name: 'Berry Grape', hex: '#480CA8', secondary: '#560BAD' },
  { id: 'c14', name: 'Amber Gold', hex: '#FFB703', secondary: '#FB8500' },
  { id: 'c15', name: 'Mint Leaf', hex: '#55A630', secondary: '#80B918' },
  { id: 'c16', name: 'Midnight', hex: '#10002B', secondary: '#240046' }
];

const DIFFICULTY_MAP = {
  easy: 5,
  medium: 8,
  10: 10,
  bottles10: 10,
  hard: 12,
  14: 14,
  bottles14: 14,
  expert: 16
};

class GameManager {
  constructor() {
    this.rooms = new Map(); // roomCode -> roomData
    this.socketToRoom = new Map(); // socketId -> roomCode
  }

  generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Avoid ambiguous 0/O, 1/I
    let code;
    do {
      code = '';
      for (let i = 0; i < 5; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }
    } while (this.rooms.has(code));
    return code;
  }

  createRoom(hostSocketId, hostName, initialSettings = {}) {
    const code = this.generateRoomCode();
    const settings = {
      difficulty: initialSettings.difficulty || 'hard', // Default 12 bottles as requested
      maxPlayers: Math.min(Math.max(Number(initialSettings.maxPlayers) || 8, 2), 32),
      errorPenaltyEnabled: Boolean(initialSettings.errorPenaltyEnabled),
      penaltyPerError: Number(initialSettings.penaltyPerError) || 2, // e.g. +2s per error
      gameplayMode: initialSettings.gameplayMode || 'speed_match' // 'speed_match' or 'mystery_box'
    };

    const hostPlayer = {
      id: hostSocketId,
      name: (hostName || 'Host').trim().slice(0, 16) || 'Host',
      isHost: true,
      ready: true,
      completed: false,
      finishTime: null,
      finalTime: null,
      errors: 0,
      matched: 0,
      total: DIFFICULTY_MAP[settings.difficulty] || 12,
      rank: null
    };

    const room = {
      code,
      hostId: hostSocketId,
      state: 'LOBBY', // 'LOBBY', 'COUNTDOWN', 'RACING', 'FINISHED'
      settings,
      players: new Map([[hostSocketId, hostPlayer]]),
      puzzle: null,
      startTime: null,
      countdownStartTime: null,
      createdAt: Date.now()
    };

    this.rooms.set(code, room);
    this.socketToRoom.set(hostSocketId, code);

    return room;
  }

  getRoom(roomCode) {
    if (!roomCode) return null;
    return this.rooms.get(roomCode.toUpperCase()) || null;
  }

  getRoomBySocket(socketId) {
    const code = this.socketToRoom.get(socketId);
    return this.getRoom(code);
  }

  joinRoom(roomCode, socketId, playerName) {
    const code = (roomCode || '').toUpperCase();
    const room = this.rooms.get(code);

    if (!room) {
      return { error: 'Room not found. Please check the room code.' };
    }

    if (room.state !== 'LOBBY') {
      return { error: 'Race is currently in progress. Please wait for the next race.' };
    }

    if (room.players.size >= room.settings.maxPlayers) {
      return { error: `Room is full (Maximum ${room.settings.maxPlayers} players).` };
    }

    const cleanName = (playerName || 'Player').trim().slice(0, 16) || 'Player';

    // Disconnect old room if socket was already mapped
    const oldCode = this.socketToRoom.get(socketId);
    if (oldCode && oldCode !== code) {
      this.leaveRoom(socketId);
    }

    const player = {
      id: socketId,
      name: cleanName,
      isHost: false,
      ready: true,
      completed: false,
      finishTime: null,
      finalTime: null,
      errors: 0,
      matched: 0,
      total: DIFFICULTY_MAP[room.settings.difficulty] || 12,
      rank: null
    };

    room.players.set(socketId, player);
    this.socketToRoom.set(socketId, code);

    return { room, player };
  }

  leaveRoom(socketId) {
    const code = this.socketToRoom.get(socketId);
    if (!code) return null;

    const room = this.rooms.get(code);
    this.socketToRoom.delete(socketId);

    if (!room) return null;

    const player = room.players.get(socketId);
    room.players.delete(socketId);

    // If room is empty, delete room
    if (room.players.size === 0) {
      this.rooms.delete(code);
      return { roomDeleted: true, code, player };
    }

    // If host left, promote next player
    let newHostId = null;
    if (room.hostId === socketId) {
      const nextPlayer = room.players.values().next().value;
      if (nextPlayer) {
        nextPlayer.isHost = true;
        room.hostId = nextPlayer.id;
        newHostId = nextPlayer.id;
      }
    }

    return { room, player, newHostId, roomDeleted: false };
  }

  kickPlayer(roomCode, hostSocketId, targetPlayerId) {
    const room = this.getRoom(roomCode);
    if (!room) return { error: 'Room not found' };
    if (room.hostId !== hostSocketId) return { error: 'Only the host can kick players' };
    if (targetPlayerId === hostSocketId) return { error: 'Host cannot kick themselves' };

    const target = room.players.get(targetPlayerId);
    if (!target) return { error: 'Player not found in room' };

    room.players.delete(targetPlayerId);
    this.socketToRoom.delete(targetPlayerId);

    return { success: true, kickedPlayer: target };
  }

  updateSettings(roomCode, hostSocketId, newSettings = {}) {
    const room = this.getRoom(roomCode);
    if (!room) return { error: 'Room not found' };
    if (room.hostId !== hostSocketId) return { error: 'Only the host can update settings' };
    if (room.state !== 'LOBBY') return { error: 'Settings cannot be changed during a race' };

    if (newSettings.difficulty && DIFFICULTY_MAP[newSettings.difficulty]) {
      room.settings.difficulty = newSettings.difficulty;
      const totalBottles = DIFFICULTY_MAP[newSettings.difficulty];
      for (const p of room.players.values()) {
        p.total = totalBottles;
      }
    }

    if (newSettings.maxPlayers !== undefined) {
      room.settings.maxPlayers = Math.min(Math.max(Number(newSettings.maxPlayers) || 2, 2), 32);
    }

    if (newSettings.errorPenaltyEnabled !== undefined) {
      room.settings.errorPenaltyEnabled = Boolean(newSettings.errorPenaltyEnabled);
    }

    if (newSettings.penaltyPerError !== undefined) {
      room.settings.penaltyPerError = Math.max(Number(newSettings.penaltyPerError) || 0, 0.5);
    }

    if (newSettings.gameplayMode !== undefined) {
      room.settings.gameplayMode = newSettings.gameplayMode === 'mystery_box' ? 'mystery_box' : 'speed_match';
    }

    return { success: true, room };
  }

  /**
   * Generates identical puzzle for all players in the room.
   */
  generatePuzzle(bottleCount) {
    const count = Math.min(Math.max(bottleCount, 4), COLOR_PALETTE.length);
    const selectedColors = COLOR_PALETTE.slice(0, count);

    // Create target sequence of bottles
    const targetSequence = selectedColors.map((color, index) => ({
      slotIndex: index,
      colorId: color.id,
      colorName: color.name,
      hex: color.hex,
      secondary: color.secondary
    }));

    // Deterministically shuffle initial bottle positions
    const initialBottles = [...targetSequence];
    const maxAllowedInitialMatches = Math.max(1, Math.floor(count / 4));
    let matches = 0;
    let attempts = 0;
    do {
      for (let i = initialBottles.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [initialBottles[i], initialBottles[j]] = [initialBottles[j], initialBottles[i]];
      }
      matches = 0;
      for (let i = 0; i < initialBottles.length; i++) {
        if (initialBottles[i].colorId === targetSequence[i].colorId) {
          matches++;
        }
      }
      attempts++;
    } while (matches > maxAllowedInitialMatches && attempts < 50);

    // If still completely matched, force-swap first two
    if (matches === count && count > 1) {
      [initialBottles[0], initialBottles[1]] = [initialBottles[1], initialBottles[0]];
    }

    return {
      bottleCount: count,
      targetSequence,
      initialBottles
    };
  }

  startCountdown(roomCode, hostSocketId) {
    const room = this.getRoom(roomCode);
    if (!room) return { error: 'Room not found' };
    if (room.hostId !== hostSocketId) return { error: 'Only the host can start the race' };
    if (room.players.size < 1) return { error: 'Not enough players' };
    if (room.state !== 'LOBBY' && room.state !== 'FINISHED') {
      return { error: 'Race is already in progress' };
    }

    const bottleCount = DIFFICULTY_MAP[room.settings.difficulty] || 12;
    room.puzzle = this.generatePuzzle(bottleCount);

    // Reset player race stats
    for (const p of room.players.values()) {
      p.completed = false;
      p.finishTime = null;
      p.finalTime = null;
      p.errors = 0;
      p.matched = 0;
      p.total = bottleCount;
      p.rank = null;
    }

    room.state = 'COUNTDOWN';
    room.countdownStartTime = Date.now();
    // 3 seconds countdown
    room.startTime = room.countdownStartTime + 3000;

    return { success: true, room };
  }

  updatePlayerProgress(roomCode, socketId, data = {}) {
    const room = this.getRoom(roomCode);
    if (!room || room.state !== 'RACING') return null;

    const player = room.players.get(socketId);
    if (!player || player.completed) return null;

    if (data.matched !== undefined) {
      player.matched = Math.min(Math.max(Number(data.matched) || 0, 0), player.total);
    }
    if (data.errors !== undefined) {
      player.errors = Math.max(Number(data.errors) || 0, 0);
    }

    return { player, room };
  }

  recordPlayerFinish(roomCode, socketId, data = {}) {
    const room = this.getRoom(roomCode);
    if (!room) return null;

    const player = room.players.get(socketId);
    if (!player) return null;

    if (player.completed) {
      return { player, room, alreadyFinished: true };
    }

    player.completed = true;
    player.matched = player.total;
    player.finishTime = Number((Number(data.finishTime) || 0).toFixed(2));
    player.errors = Math.max(Number(data.errors) || player.errors || 0, 0);
    player.finalTime = calculateFinalTime(
      player.finishTime,
      player.errors,
      room.settings.errorPenaltyEnabled,
      room.settings.penaltyPerError
    );

    // Compute updated rankings
    const playerArray = Array.from(room.players.values());
    const ranked = rankPlayers(playerArray, room.settings);
    for (const r of ranked) {
      const p = room.players.get(r.id);
      if (p) {
        p.rank = r.rank;
      }
    }

    // Check if all players completed
    const allCompleted = Array.from(room.players.values()).every(p => p.completed);
    if (allCompleted) {
      room.state = 'FINISHED';
    }

    return {
      player,
      room,
      allCompleted,
      rankings: ranked
    };
  }

  restartRace(roomCode, hostSocketId) {
    const room = this.getRoom(roomCode);
    if (!room) return { error: 'Room not found' };
    if (room.hostId !== hostSocketId) return { error: 'Only the host can reset the room' };

    room.state = 'LOBBY';
    room.puzzle = null;
    room.startTime = null;
    room.countdownStartTime = null;

    for (const p of room.players.values()) {
      p.completed = false;
      p.finishTime = null;
      p.finalTime = null;
      p.errors = 0;
      p.matched = 0;
      p.rank = null;
    }

    return { success: true, room };
  }

  getRoomSummary(roomCode) {
    const room = this.getRoom(roomCode);
    if (!room) return null;

    const playerArray = Array.from(room.players.values());
    const ranked = rankPlayers(playerArray, room.settings);

    return {
      code: room.code,
      hostId: room.hostId,
      state: room.state,
      settings: room.settings,
      players: ranked,
      puzzle: room.puzzle ? {
        bottleCount: room.puzzle.bottleCount,
        targetSequence: room.puzzle.targetSequence,
        initialBottles: room.puzzle.initialBottles
      } : null,
      startTime: room.startTime
    };
  }
}

module.exports = {
  GameManager,
  COLOR_PALETTE,
  DIFFICULTY_MAP
};
