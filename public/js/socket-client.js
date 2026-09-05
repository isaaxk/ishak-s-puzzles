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

  // Session storage token for app-switch persistence
  let myPlayerToken = sessionStorage.getItem('bottle_race_token');
  if (!myPlayerToken) {
    myPlayerToken = 'tok_' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
    sessionStorage.setItem('bottle_race_token', myPlayerToken);
  }

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
  const selectRaceMode = document.getElementById('select-race-mode');
  const togglePenalty = document.getElementById('toggle-penalty');
  const penaltySecRow = document.getElementById('penalty-seconds-row');
  const inputPenaltySec = document.getElementById('penalty-seconds');
  const playerListEl = document.getElementById('lobby-player-list');
  const playerCountEl = document.getElementById('lobby-player-count');
  const btnStartRace = document.getElementById('btn-start-race');
  const hostSettingsContainer = document.getElementById('host-settings-container');
  const waitingBannerEl = document.getElementById('lobby-waiting-banner');

  // Race Elements
  const raceModeBadge = document.getElementById('race-mode-badge');
  const rivalListEl = document.getElementById('rival-list');
  const btnSurrender = document.getElementById('btn-surrender');
  const btnHostEndRace = document.getElementById('btn-host-end-race');

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

  const savedName = sessionStorage.getItem('bottle_race_name');
  if (savedName) {
    if (inputPlayerName) inputPlayerName.value = savedName;
    if (inputHostName) inputHostName.value = savedName;
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
    sessionStorage.setItem('bottle_race_name', name);
    socket.emit('create_room', { name, settings: {}, token: myPlayerToken }, (res) => {
      if (res.error) {
        showToast(res.error);
        return;
      }
      myPlayerId = res.playerId;
      if (res.playerToken) {
        myPlayerToken = res.playerToken;
        sessionStorage.setItem('bottle_race_token', myPlayerToken);
      }
      sessionStorage.setItem('bottle_race_room', res.room.code);
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

    sessionStorage.setItem('bottle_race_name', name);
    socket.emit('join_room', { code, name, token: myPlayerToken }, (res) => {
      if (res.error) {
        showToast(res.error);
        return;
      }
      myPlayerId = res.playerId;
      if (res.playerToken) {
        myPlayerToken = res.playerToken;
        sessionStorage.setItem('bottle_race_token', myPlayerToken);
      }
      sessionStorage.setItem('bottle_race_room', res.room.code);
      currentRoom = res.room;
      isHost = res.room.hostId === myPlayerId;
      setupLobby();
      showScreen(screenLobby);
      if (res.isWaiting) {
        showToast(`Joined Room ${res.room.code}! Race in progress - waiting in lobby ⏳`, 4000);
      } else {
        showToast(`Joined Room ${res.room.code}!`);
      }
    });
  });

  // 3. Leave Room
  btnLeaveRoom?.addEventListener('click', () => {
    sessionStorage.removeItem('bottle_race_room');
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

  // Helper to format race mode label
  function getRaceModeLabel(mode) {
    switch (mode) {
      case 'first': return '🥇 Mode: First to Solve';
      case 'top3': return '🥉 Mode: Top 3 Finish';
      case 'all': default: return '🏁 Mode: All Players / Surrender';
    }
  }

  // 6. Host Settings Modification
  function emitSettingsUpdate() {
    if (!isHost || !currentRoom) return;
    const settings = {
      difficulty: selectDifficulty.value,
      maxPlayers: Number(selectMaxPlayers.value),
      raceMode: selectRaceMode ? selectRaceMode.value : 'all',
      errorPenaltyEnabled: togglePenalty.checked,
      penaltyPerError: Number(inputPenaltySec.value) || 2
    };
    socket.emit('update_settings', settings, (res) => {
      if (res.error) showToast(res.error);
    });
  }

  selectDifficulty?.addEventListener('change', emitSettingsUpdate);
  selectMaxPlayers?.addEventListener('change', emitSettingsUpdate);
  selectRaceMode?.addEventListener('change', emitSettingsUpdate);
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

    // Check if the current user is waiting for the active race to finish
    const myP = currentRoom.players?.find(p => p.id === myPlayerId || p.token === myPlayerToken);
    const amWaiting = Boolean(myP?.isWaiting);
    if (waitingBannerEl) {
      waitingBannerEl.style.display = amWaiting ? 'flex' : 'none';
    }

    // Adjust settings inputs based on host privileges
    const formControls = [selectDifficulty, selectMaxPlayers, selectRaceMode, togglePenalty, inputPenaltySec];
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
      if (selectRaceMode) selectRaceMode.value = currentRoom.settings.raceMode || 'all';
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
      const isAway = p.connected === false;
      const isWaiting = p.isWaiting === true;

      const item = document.createElement('div');
      item.className = `player-item ${isAway ? 'player-away' : ''} ${isWaiting ? 'player-waiting' : ''}`;
      item.innerHTML = `
        <div class="player-info">
          <div class="player-avatar">${isAway ? '💤' : (isWaiting ? '⏳' : '🍾')}</div>
          <span class="player-name-text">${escapeHtml(p.name)}</span>
          ${isRoomHost ? '<span class="badge-host">HOST</span>' : ''}
          ${isMe ? '<span class="badge-you">YOU</span>' : ''}
          ${isWaiting ? '<span class="badge-waiting">⏳ WAITING</span>' : ''}
          ${isAway ? '<span class="badge-away">📱 AWAY</span>' : ''}
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

  let wasIWaiting = false;
  socket.on('room_update', (roomSummary) => {
    const prevWaiting = wasIWaiting;
    currentRoom = roomSummary;
    isHost = roomSummary.hostId === myPlayerId;

    const myP = currentRoom.players?.find(p => p.id === myPlayerId || p.token === myPlayerToken);
    wasIWaiting = Boolean(myP?.isWaiting);

    // If I was waiting and the race finished, notify that I am now directly part of the room!
    if (prevWaiting && !wasIWaiting) {
      showToast('🏁 The race has finished! You are now directly part of the room for the next race! 🚀', 4500);
    }

    if (screenLobby.classList.contains('active')) {
      setupLobby();
    }
    updateRivalTracks();
  });

  socket.on('player_joined', (data) => {
    showToast(`👋 ${data.player.name} joined!`);
  });

  socket.on('player_away', (data) => {
    showToast(`📱 ${data.player?.name || 'A player'} is away (in another app)`);
    if (currentRoom && currentRoom.players) {
      const p = currentRoom.players.find(x => x.id === data.player?.id || x.token === data.player?.token);
      if (p) p.connected = false;
      renderPlayerList();
      updateRivalTracks();
    }
  });

  socket.on('player_reconnected', (data) => {
    showToast(`⚡ ${data.player?.name || 'A player'} is back!`);
    if (currentRoom && currentRoom.players) {
      const p = currentRoom.players.find(x => x.id === data.player?.id || x.token === data.player?.token);
      if (p) p.connected = true;
      renderPlayerList();
      updateRivalTracks();
    }
  });

  socket.on('player_left', (data) => {
    showToast(`🚪 ${data.player?.name || 'A player'} left`);
  });

  socket.on('kicked', (data) => {
    sessionStorage.removeItem('bottle_race_room');
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

    // Update race mode badge
    if (raceModeBadge) {
      raceModeBadge.textContent = getRaceModeLabel(data.settings?.raceMode || currentRoom?.settings?.raceMode);
    }

    // Reset race action buttons
    if (btnSurrender) {
      btnSurrender.disabled = false;
      btnSurrender.innerHTML = '<span>🏳️ Surrender</span>';
      btnSurrender.style.display = 'inline-flex';
    }
    if (btnHostEndRace) {
      btnHostEndRace.style.display = isHost ? 'inline-flex' : 'none';
      btnHostEndRace.disabled = false;
    }

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
    const formattedFinish = window.formatTimeDisplay ? window.formatTimeDisplay(data.player.finishTime) : `${data.player.finishTime.toFixed(2)}s`;
    showToast(`🏁 ${data.player.name} finished in ${formattedFinish}!`);
    updateRivalTracks();

    if (data.allCompleted) {
      if (gameEngine) gameEngine.stopTimer();
      if (btnSurrender) btnSurrender.disabled = true;
      if (btnHostEndRace) btnHostEndRace.disabled = true;
      if (data.rankings && screenRace.classList.contains('active')) {
        displayPodium(data.rankings, currentRoom?.settings);
      }
    } else if (data.rankings && screenRace.classList.contains('active') && data.player?.id === myPlayerId) {
      displayPodium(data.rankings, currentRoom?.settings);
    }
  });

  // Player surrendered notification
  socket.on('player_surrendered', (data) => {
    showToast(`🏳️ ${data.player?.name || 'A player'} surrendered`);
    if (currentRoom && currentRoom.players) {
      const p = currentRoom.players.find(x => x.id === data.playerId);
      if (p) p.surrendered = true;
    }
    updateSingleRival({
      playerId: data.playerId,
      surrendered: true
    });

    if (data.allCompleted) {
      if (gameEngine) gameEngine.stopTimer();
      if (btnSurrender) btnSurrender.disabled = true;
      if (btnHostEndRace) btnHostEndRace.disabled = true;
      if (data.rankings && screenRace.classList.contains('active')) {
        displayPodium(data.rankings, currentRoom?.settings);
      }
    }
  });

  // Host ended race notification
  socket.on('race_ended_by_host', (data) => {
    showToast(`🛑 ${data.message || 'Host ended the race!'}`);
    if (gameEngine) gameEngine.stopTimer();
    if (btnSurrender) btnSurrender.disabled = true;
    if (btnHostEndRace) btnHostEndRace.disabled = true;
    if (data.rankings && screenRace.classList.contains('active')) {
      displayPodium(data.rankings, currentRoom?.settings);
    }
  });

  // Surrender button click
  btnSurrender?.addEventListener('click', () => {
    if (!gameEngine || !gameEngine.isRacing || gameEngine.isCompleted) return;
    if (!confirm('Are you sure you want to surrender this race?')) return;
    btnSurrender.disabled = true;
    btnSurrender.innerHTML = '<span>🏳️ Surrendered</span>';
    gameEngine.stopTimer();
    socket.emit('surrender_race', (res) => {
      if (res && res.error) {
        showToast(res.error);
        btnSurrender.disabled = false;
        btnSurrender.innerHTML = '<span>🏳️ Surrender</span>';
      } else {
        showToast('You surrendered 🏳️');
      }
    });
  });

  // Host end race button click
  btnHostEndRace?.addEventListener('click', () => {
    if (!isHost) return;
    if (!confirm('End the race immediately for all players?')) return;
    btnHostEndRace.disabled = true;
    socket.emit('host_end_race', (res) => {
      if (res && res.error) {
        showToast(res.error);
        btnHostEndRace.disabled = false;
      }
    });
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

    const activePlayers = (currentRoom.players || []).filter(p => !p.isWaiting);
    activePlayers.forEach(p => {
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

    if (data.surrendered) {
      row.classList.add('rival-surrendered');
      const score = row.querySelector('.rival-score');
      if (score) score.innerHTML = '<span class="badge-surrendered">🏳️ Surrendered</span>';
      return;
    }

    const percent = Math.min(Math.round((data.matched / data.total) * 100), 100);
    const fill = row.querySelector('.rival-fill');
    const score = row.querySelector('.rival-score');

    if (fill) fill.style.width = `${percent}%`;
    if (score) score.textContent = `${data.matched}/${data.total}`;
    if (data.connected === false) {
      row.classList.add('rival-away');
    } else {
      row.classList.remove('rival-away');
    }
  }

  function updateRivalTracks() {
    if (!currentRoom || !currentRoom.players || !rivalListEl) return;
    const total = currentRoom.puzzle ? currentRoom.puzzle.bottleCount : 12;
    currentRoom.players.forEach(p => {
      updateSingleRival({
        playerId: p.id,
        matched: p.matched,
        total: p.total || total,
        errors: p.errors,
        connected: p.connected,
        surrendered: p.surrendered
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

      let timeText = '';
      let finalTimeText = '';
      if (p.surrendered) {
        timeText = '<span class="badge-surrendered">🏳️ Surrendered</span>';
        finalTimeText = '<span style="color: var(--text-secondary)">DNF</span>';
      } else if (p.completed && p.finishTime !== null) {
        timeText = window.formatTimeDisplay ? window.formatTimeDisplay(p.finishTime) : `${p.finishTime.toFixed(2)}s`;
        finalTimeText = p.finalTime !== null
          ? (window.formatTimeDisplay ? window.formatTimeDisplay(p.finalTime) : `${p.finalTime.toFixed(2)}s`)
          : '<span style="color: var(--text-secondary)">DNF</span>';
      } else {
        timeText = `${p.matched}/${p.total}`;
        finalTimeText = '<span style="color: var(--text-secondary)">DNF</span>';
      }

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

  // ==========================================
  // Session Reconnection for Mobile App Switching
  // ==========================================
  let isReconnecting = false;
  function tryReconnect() {
    const savedRoomCode = sessionStorage.getItem('bottle_race_room');
    if (!savedRoomCode || !myPlayerToken || isReconnecting) return;

    isReconnecting = true;
    socket.emit('reconnect_session', { roomCode: savedRoomCode, token: myPlayerToken }, (res) => {
      isReconnecting = false;
      if (res && res.success) {
        myPlayerId = res.playerId;
        currentRoom = res.room;
        isHost = res.room.hostId === myPlayerId;

        const myP = res.room.players?.find(p => p.id === res.playerId || p.token === myPlayerToken);
        const amWaiting = Boolean(myP?.isWaiting || res.isWaiting);

        if (res.room.state === 'LOBBY' || amWaiting) {
          setupLobby();
          showScreen(screenLobby);
        } else if (res.room.state === 'RACING' || res.room.state === 'COUNTDOWN') {
          showScreen(screenRace);
          if (!gameEngine) {
            gameEngine = new window.ColorBottleGame({
              onProgress: (progressData) => {
                socket.emit('player_progress', progressData);
              },
              onFinish: (finishData) => {
                socket.emit('player_finish', finishData, (fres) => {
                  if (fres.rankings) {
                    displayPodium(fres.rankings, currentRoom?.settings);
                  }
                });
              }
            });
          }
          if (raceModeBadge) {
            raceModeBadge.textContent = getRaceModeLabel(res.room.settings?.raceMode);
          }
          if (btnHostEndRace) {
            btnHostEndRace.style.display = isHost ? 'inline-flex' : 'none';
            btnHostEndRace.disabled = false;
          }
          if (btnSurrender) {
            btnSurrender.style.display = 'inline-flex';
            if (myP?.surrendered) {
              btnSurrender.disabled = true;
              btnSurrender.innerHTML = '<span>🏳️ Surrendered</span>';
            } else {
              btnSurrender.disabled = false;
              btnSurrender.innerHTML = '<span>🏳️ Surrender</span>';
            }
          }

          if (res.room.puzzle && (!gameEngine.isRacing && !gameEngine.isCompleted && !myP?.surrendered)) {
            gameEngine.initRace(res.room.puzzle, res.room.settings, res.room.startTime);
            gameEngine.startRace(res.room.startTime);
          }
          setupRivalTracks();
          updateRivalTracks();
        } else if (res.room.state === 'FINISHED') {
          displayPodium(res.room.players, res.room.settings);
        }
        showToast('Connected back to room! 🔄');
      } else if (res && res.error) {
        // Room no longer exists or grace period expired
        sessionStorage.removeItem('bottle_race_room');
      }
    });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      tryReconnect();
    }
  });

  window.addEventListener('focus', () => {
    tryReconnect();
  });

  socket.on('connect', () => {
    const savedRoomCode = sessionStorage.getItem('bottle_race_room');
    if (savedRoomCode) {
      tryReconnect();
    }
  });

})();
