/**
 * socket-client.js
 * Socket.io networking and UI view coordinator
 */

(function () {
  const socket = io();

  // State
  let currentRoom = null;
  let myPlayerId = null;
  let isHost = false;
  let gameEngine = null;

  // DOM Elements - Screens
  const screenHome = document.getElementById('screen-home');
  const screenLobby = document.getElementById('screen-lobby');
  const screenRace = document.getElementById('screen-race');

  // Modals & Overlays
  const countdownOverlay = document.getElementById('countdown-overlay');
  const countdownNumber = document.getElementById('countdown-number');
  const podiumModal = document.getElementById('podium-modal');
  const qrModal = document.getElementById('qr-modal');

  // Home Screen Elements
  const tabJoin = document.getElementById('tab-join');
  const tabCreate = document.getElementById('tab-create');
  const formJoin = document.getElementById('form-join');
  const formCreate = document.getElementById('form-create');
  const inputPlayerName = document.getElementById('player-name');
  const inputRoomCode = document.getElementById('room-code-input');
  const inputHostName = document.getElementById('host-name');
  const btnJoin = document.getElementById('btn-join-room');
  const btnCreate = document.getElementById('btn-create-room');

  // Lobby Screen Elements
  const lobbyRoomCodeText = document.getElementById('lobby-room-code');
  const btnCopyCode = document.getElementById('btn-copy-code');
  const btnShowQR = document.getElementById('btn-show-qr');
  const btnLeaveRoom = document.getElementById('btn-leave-room');
  const selectDifficulty = document.getElementById('select-difficulty');
  const selectMaxPlayers = document.getElementById('select-max-players');
  const togglePenalty = document.getElementById('toggle-penalty');
  const penaltySecRow = document.getElementById('penalty-seconds-row');
  const inputPenaltySec = document.getElementById('penalty-seconds');
  const playerListEl = document.getElementById('lobby-player-list');
  const playerCountEl = document.getElementById('lobby-player-count');
  const btnStartRace = document.getElementById('btn-start-race');
  const hostSettingsContainer = document.getElementById('host-settings-container');

  // Race Elements
  const rivalListEl = document.getElementById('rival-list');

  // Podium Elements
  const rankingTbody = document.getElementById('ranking-tbody');
  const podiumRuleNote = document.getElementById('podium-rule-note');
  const btnPlayAgain = document.getElementById('btn-play-again');
  const btnLobbyReturn = document.getElementById('btn-lobby-return');

  // QR Modal Elements
  const qrImageEl = document.getElementById('qr-image');
  const qrUrlText = document.getElementById('qr-url-text');
  const btnCloseQR = document.getElementById('btn-close-qr');

  // Toast System
  function showToast(msg, duration = 3000) {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }

  // Switch Active Screen
  function showScreen(screen) {
    [screenHome, screenLobby, screenRace].forEach(s => s.classList.remove('active'));
    screen.classList.add('active');
  }

  // Check URL parameters for auto join room
  const urlParams = new URLSearchParams(window.location.search);
  const autoJoinCode = urlParams.get('join');
  if (autoJoinCode && inputRoomCode) {
    inputRoomCode.value = autoJoinCode.toUpperCase();
  }

  // Home Tabs Switching
  tabJoin?.addEventListener('click', () => {
    tabJoin.classList.add('active');
    tabCreate.classList.remove('active');
    formJoin.style.display = 'block';
    formCreate.style.display = 'none';
  });

  tabCreate?.addEventListener('click', () => {
    tabCreate.classList.add('active');
    tabJoin.classList.remove('active');
    formJoin.style.display = 'none';
    formCreate.style.display = 'block';
  });

  // 1. Create Room
  btnCreate?.addEventListener('click', () => {
    const name = inputHostName.value.trim() || 'Host';
    socket.emit('create_room', { name, settings: {} }, (res) => {
      if (res.error) {
        showToast(res.error);
        return;
      }
      myPlayerId = res.playerId;
      currentRoom = res.room;
      isHost = true;
      setupLobby();
      showScreen(screenLobby);
      showToast(`Room ${res.room.code} created!`);
    });
  });

  // 2. Join Room
  btnJoin?.addEventListener('click', () => {
    const name = inputPlayerName.value.trim() || 'Player';
    const code = inputRoomCode.value.trim().toUpperCase();

    if (!code) {
      showToast('Please enter a room code');
      return;
    }

    socket.emit('join_room', { code, name }, (res) => {
      if (res.error) {
        showToast(res.error);
        return;
      }
      myPlayerId = res.playerId;
      currentRoom = res.room;
      isHost = res.room.hostId === myPlayerId;
      setupLobby();
      showScreen(screenLobby);
      showToast(`Joined Room ${res.room.code}!`);
    });
  });

  // 3. Leave Room
  btnLeaveRoom?.addEventListener('click', () => {
    socket.emit('leave_room', () => {
      currentRoom = null;
      isHost = false;
      showScreen(screenHome);
    });
  });

  // 4. Copy Room Code & Link
  btnCopyCode?.addEventListener('click', () => {
    if (!currentRoom) return;
    const shareUrl = `${window.location.origin}?join=${currentRoom.code}`;
    navigator.clipboard.writeText(shareUrl).then(() => {
      showToast('Invite link copied to clipboard! 📋');
    }).catch(() => {
      navigator.clipboard.writeText(currentRoom.code);
      showToast(`Room Code ${currentRoom.code} copied!`);
    });
  });

  // 5. Show QR Code
  btnShowQR?.addEventListener('click', async () => {
    if (!currentRoom) return;
    try {
      const res = await fetch(`/api/info?room=${currentRoom.code}`);
      const data = await res.json();
      qrImageEl.src = data.qrDataUrl;
      qrUrlText.textContent = data.joinUrl;
      qrModal.classList.add('active');
    } catch (err) {
      showToast('Failed to load QR code');
    }
  });

  btnCloseQR?.addEventListener('click', () => {
    qrModal.classList.remove('active');
  });

  // 6. Host Settings Modification
  function emitSettingsUpdate() {
    if (!isHost || !currentRoom) return;
    const settings = {
      difficulty: selectDifficulty.value,
      maxPlayers: Number(selectMaxPlayers.value),
      errorPenaltyEnabled: togglePenalty.checked,
      penaltyPerError: Number(inputPenaltySec.value) || 2
    };
    socket.emit('update_settings', settings, (res) => {
      if (res.error) showToast(res.error);
    });
  }

  selectDifficulty?.addEventListener('change', emitSettingsUpdate);
  selectMaxPlayers?.addEventListener('change', emitSettingsUpdate);
  togglePenalty?.addEventListener('change', () => {
    penaltySecRow.style.display = togglePenalty.checked ? 'flex' : 'none';
    emitSettingsUpdate();
  });
  inputPenaltySec?.addEventListener('change', emitSettingsUpdate);

  // 7. Start Race (Host only)
  btnStartRace?.addEventListener('click', () => {
    if (!isHost) return;
    socket.emit('start_race', (res) => {
      if (res.error) showToast(res.error);
    });
  });

  // Setup Lobby View
  function setupLobby() {
    if (!currentRoom) return;
    lobbyRoomCodeText.textContent = currentRoom.code;
    isHost = currentRoom.hostId === myPlayerId;

    // Adjust settings inputs based on host privileges
    const formControls = [selectDifficulty, selectMaxPlayers, togglePenalty, inputPenaltySec];
    formControls.forEach(ctrl => {
      if (ctrl) ctrl.disabled = !isHost;
    });

    if (btnStartRace) {
      btnStartRace.style.display = isHost ? 'flex' : 'none';
    }

    // Populate settings values from room state
    if (currentRoom.settings) {
      selectDifficulty.value = currentRoom.settings.difficulty || 'hard';
      selectMaxPlayers.value = currentRoom.settings.maxPlayers || 8;
      togglePenalty.checked = Boolean(currentRoom.settings.errorPenaltyEnabled);
      penaltySecRow.style.display = togglePenalty.checked ? 'flex' : 'none';
      inputPenaltySec.value = currentRoom.settings.penaltyPerError || 2;
    }

    renderPlayerList();
  }

  // Render Lobby Player List
  function renderPlayerList() {
    if (!currentRoom || !playerListEl) return;
    playerListEl.innerHTML = '';
    const players = currentRoom.players || [];
    playerCountEl.textContent = `(${players.length}/${currentRoom.settings.maxPlayers})`;

    players.forEach(p => {
      const isMe = p.id === myPlayerId;
      const isRoomHost = p.id === currentRoom.hostId;

      const item = document.createElement('div');
      item.className = 'player-item';
      item.innerHTML = `
        <div class="player-info">
          <div class="player-avatar">🍾</div>
          <span class="player-name-text">${escapeHtml(p.name)}</span>
          ${isRoomHost ? '<span class="badge-host">HOST</span>' : ''}
          ${isMe ? '<span class="badge-you">YOU</span>' : ''}
        </div>
        ${isHost && !isMe ? `<button class="kick-btn" data-id="${p.id}">Kick</button>` : ''}
      `;

      if (isHost && !isMe) {
        item.querySelector('.kick-btn')?.addEventListener('click', () => {
          socket.emit('kick_player', { targetId: p.id }, (res) => {
            if (res.error) showToast(res.error);
          });
        });
      }

      playerListEl.appendChild(item);
    });
  }

  // Escape HTML helper
  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ==========================================
  // Socket Event Listeners
  // ==========================================
  socket.on('room_update', (roomSummary) => {
    currentRoom = roomSummary;
    isHost = roomSummary.hostId === myPlayerId;

    if (screenLobby.classList.contains('active')) {
      setupLobby();
    }
    updateRivalTracks();
  });

  socket.on('player_joined', (data) => {
    showToast(`👋 ${data.player.name} joined!`);
  });

  socket.on('player_left', (data) => {
    showToast(`🚪 ${data.player?.name || 'A player'} left`);
  });

  socket.on('kicked', (data) => {
    currentRoom = null;
    isHost = false;
    showScreen(screenHome);
    showToast(data.message || 'You were kicked from the room.');
  });

  socket.on('player_kicked', (data) => {
    showToast(`👢 ${data.player.name} was kicked`);
  });

  // Countdown (3 - 2 - 1 - GO!)
  socket.on('countdown_start', (data) => {
    podiumModal.classList.remove('active');
    showScreen(screenRace);

    // Initialize game engine with synchronized puzzle
    if (!gameEngine) {
      gameEngine = new window.ColorBottleGame({
        onProgress: (progressData) => {
          socket.emit('player_progress', progressData);
        },
        onFinish: (finishData) => {
          socket.emit('player_finish', finishData, (res) => {
            if (res.rankings) {
              displayPodium(res.rankings, currentRoom?.settings);
            }
          });
        }
      });
    }

    gameEngine.initRace(data.puzzle, data.settings, data.startTime);
    setupRivalTracks();

    // Start 3-2-1 visual countdown
    countdownOverlay.classList.add('active');
    let count = 3;
    countdownNumber.textContent = count;
    window.sounds?.playCountdownBeep(false);

    const interval = setInterval(() => {
      count--;
      if (count > 0) {
        countdownNumber.textContent = count;
        window.sounds?.playCountdownBeep(false);
      } else if (count === 0) {
        countdownNumber.textContent = 'GO!';
        window.sounds?.playCountdownBeep(true);
      } else {
        clearInterval(interval);
        countdownOverlay.classList.remove('active');
        gameEngine.startRace(data.startTime);
      }
    }, 1000);
  });

  socket.on('race_start', (data) => {
    if (gameEngine && !gameEngine.isRacing && !gameEngine.isCompleted) {
      gameEngine.startRace(data.startTime);
    }
  });

  // Competitor progress update
  socket.on('competitor_progress', (data) => {
    updateSingleRival(data);
  });

  // Competitor finish announcement
  socket.on('player_finished', (data) => {
    showToast(`🏁 ${data.player.name} finished in ${data.player.finishTime.toFixed(2)}s!`);
    updateRivalTracks();
    if (data.rankings) {
      displayPodium(data.rankings, currentRoom?.settings);
    }
  });

  // Rematch / Reset Race
  socket.on('race_reset', () => {
    podiumModal.classList.remove('active');
    showScreen(screenLobby);
    setupLobby();
    showToast('Ready for rematch! 🏁');
  });

  // ==========================================
  // Rival Tracker Methods
  // ==========================================
  function setupRivalTracks() {
    if (!rivalListEl || !currentRoom) return;
    rivalListEl.innerHTML = '';
    const total = currentRoom.puzzle ? currentRoom.puzzle.bottleCount : 12;

    currentRoom.players.forEach(p => {
      const row = document.createElement('div');
      row.className = 'rival-row';
      row.dataset.player = p.id;
      row.innerHTML = `
        <span class="rival-name">${escapeHtml(p.name)}</span>
        <div class="rival-track">
          <div class="rival-fill" style="width: 0%"></div>
        </div>
        <span class="rival-score">0/${total}</span>
      `;
      rivalListEl.appendChild(row);
    });
  }

  function updateSingleRival(data) {
    if (!rivalListEl) return;
    const row = rivalListEl.querySelector(`.rival-row[data-player="${data.playerId}"]`);
    if (!row) return;

    const percent = Math.min(Math.round((data.matched / data.total) * 100), 100);
    const fill = row.querySelector('.rival-fill');
    const score = row.querySelector('.rival-score');

    if (fill) fill.style.width = `${percent}%`;
    if (score) score.textContent = `${data.matched}/${data.total}`;
  }

  function updateRivalTracks() {
    if (!currentRoom || !currentRoom.players || !rivalListEl) return;
    const total = currentRoom.puzzle ? currentRoom.puzzle.bottleCount : 12;
    currentRoom.players.forEach(p => {
      updateSingleRival({
        playerId: p.id,
        matched: p.matched,
        total: p.total || total,
        errors: p.errors
      });
    });
  }

  // ==========================================
  // Podium & Leaderboard Display
  // ==========================================
  function displayPodium(rankings, settings = {}) {
    if (!rankingTbody) return;
    rankingTbody.innerHTML = '';

    const penaltyEnabled = Boolean(settings.errorPenaltyEnabled);
    const penaltyPerError = Number(settings.penaltyPerError) || 2;

    if (podiumRuleNote) {
      podiumRuleNote.innerHTML = penaltyEnabled
        ? `⚙️ <strong>Error Penalty: ON (+${penaltyPerError}s/error)</strong><br>Final Time = Actual Time + (Errors × ${penaltyPerError}s)`
        : `⚙️ <strong>Error Penalty: OFF</strong> (Errors used solely as tiebreaker. Tied players share rank).`;
    }

    rankings.forEach(p => {
      const row = document.createElement('tr');
      const isMe = p.id === myPlayerId;
      if (isMe) row.style.background = 'rgba(56, 189, 248, 0.1)';

      let medal = `#${p.rank}`;
      if (p.rank === 1) medal = '🥇 1st';
      else if (p.rank === 2) medal = '🥈 2nd';
      else if (p.rank === 3) medal = '🥉 3rd';

      const timeText = p.completed && p.finishTime !== null ? `${p.finishTime.toFixed(2)}s` : `${p.matched}/${p.total}`;
      const penaltyText = penaltyEnabled ? (p.errors > 0 ? `+${(p.errors * penaltyPerError).toFixed(1)}s` : '0.0s') : '-';
      const finalTimeText = p.completed && p.finalTime !== null ? `${p.finalTime.toFixed(2)}s` : 'DNF';

      row.innerHTML = `
        <td class="rank-cell rank-${p.rank}">${medal}</td>
        <td><strong>${escapeHtml(p.name)}</strong> ${isMe ? '(You)' : ''}</td>
        <td>${timeText}</td>
        <td style="color: var(--accent-red)">${p.errors}</td>
        ${penaltyEnabled ? `<td>${penaltyText}</td>` : ''}
        <td><strong>${finalTimeText}</strong></td>
      `;

      rankingTbody.appendChild(row);
    });

    // Rematch button (Host only)
    if (btnPlayAgain) {
      btnPlayAgain.style.display = isHost ? 'flex' : 'none';
    }

    podiumModal.classList.add('active');
  }

  // Rematch / Play Again
  btnPlayAgain?.addEventListener('click', () => {
    if (!isHost) return;
    socket.emit('restart_race', (res) => {
      if (res.error) showToast(res.error);
    });
  });

  // Return to Lobby
  btnLobbyReturn?.addEventListener('click', () => {
    podiumModal.classList.remove('active');
    showScreen(screenLobby);
    setupLobby();
  });

})();
