/**
 * game.js
 * Interactive Color Bottle Puzzle Engine
 */

class ColorBottleGame {
  constructor(options = {}) {
    this.onProgress = options.onProgress || (() => {});
    this.onFinish = options.onFinish || (() => {});
    
    this.puzzle = null;
    this.settings = null;
    this.isRacing = false;
    this.isCompleted = false;

    this.matchedCount = 0;
    this.errorsCount = 0;
    this.finishTime = null;

    this.timerStartTime = null;
    this.timerAnimationId = null;

    // Slots & Bottle state
    this.dockBottles = []; // bottles in player hand/dock
    this.placedSlots = []; // bottles matched or placed in slots [ { slotIndex, bottle } ]
    this.selectedDockIndex = null;
    this.selectedSlotIndex = null;

    // DOM Elements
    this.matchedDisplay = document.getElementById('stat-matched');
    this.errorsDisplay = document.getElementById('stat-errors');
    this.timeDisplay = document.getElementById('stat-time');
    this.shelfSlotsEl = document.getElementById('shelf-slots');
    this.dockBottlesEl = document.getElementById('dock-bottles');
    this.shelfTitleEl = document.getElementById('shelf-title');
    this.modeNoteEl = document.getElementById('game-mode-note');
  }

  initRace(puzzle, settings, startTime) {
    this.stopTimer();
    this.puzzle = puzzle;
    this.settings = settings || {};
    this.isRacing = false;
    this.isCompleted = false;
    this.matchedCount = 0;
    this.errorsCount = 0;
    this.finishTime = null;
    this.selectedDockIndex = null;
    this.selectedSlotIndex = null;

    const total = puzzle.bottleCount;
    this.placedSlots = new Array(total).fill(null);

    if (this.settings.gameplayMode === 'mystery_box') {
      // In mystery mode, bottles start placed in slots and player swaps them
      this.dockBottles = [];
      this.placedSlots = puzzle.initialBottles.map((b, idx) => ({ ...b, currentSlot: idx }));
      this.matchedCount = this.calculateMysteryMatches();
    } else {
      // Speed match mode: bottles are in dock, slots are color targets
      this.dockBottles = puzzle.initialBottles.map((b, idx) => ({ ...b, dockIndex: idx }));
      this.matchedCount = 0;
    }

    this.updateHUD();
    this.render();
  }

  startRace(serverStartTime) {
    this.isRacing = true;
    this.isCompleted = false;
    this.timerStartTime = performance.now();
    this.runTimer();
  }

  runTimer() {
    if (!this.isRacing || this.isCompleted) return;

    const now = performance.now();
    const elapsedSeconds = (now - this.timerStartTime) / 1000;
    if (this.timeDisplay) {
      this.timeDisplay.textContent = `${elapsedSeconds.toFixed(2)}s`;
    }

    this.timerAnimationId = requestAnimationFrame(() => this.runTimer());
  }

  stopTimer() {
    if (this.timerAnimationId) {
      cancelAnimationFrame(this.timerAnimationId);
      this.timerAnimationId = null;
    }
  }

  updateHUD() {
    const total = this.puzzle ? this.puzzle.bottleCount : 12;
    if (this.matchedDisplay) {
      this.matchedDisplay.textContent = `${this.matchedCount} / ${total}`;
    }
    if (this.errorsDisplay) {
      this.errorsDisplay.textContent = `${this.errorsCount}`;
    }
  }

  // ==========================================
  // Speed Match Mode Interactions
  // ==========================================
  handleDockBottleClick(index) {
    if (!this.isRacing || this.isCompleted) return;
    if (!this.dockBottles[index]) return;

    if (this.selectedDockIndex === index) {
      // Deselect
      this.selectedDockIndex = null;
    } else {
      this.selectedDockIndex = index;
      window.sounds?.playPop();
    }
    this.render();
  }

  handleSlotClick(slotIndex) {
    if (!this.isRacing || this.isCompleted) return;

    if (this.settings.gameplayMode === 'mystery_box') {
      this.handleMysterySlotClick(slotIndex);
      return;
    }

    // Speed match mode: If already matched, slot is locked
    if (this.placedSlots[slotIndex]) {
      return;
    }

    if (this.selectedDockIndex === null) {
      return;
    }

    const bottle = this.dockBottles[this.selectedDockIndex];
    const targetSlot = this.puzzle.targetSequence[slotIndex];

    if (!bottle || !targetSlot) return;

    // Check if match is correct
    if (bottle.colorId === targetSlot.colorId) {
      // Correct match!
      this.placedSlots[slotIndex] = bottle;
      this.dockBottles.splice(this.selectedDockIndex, 1);
      this.selectedDockIndex = null;
      this.matchedCount++;

      window.sounds?.playMatchSuccess();
      this.updateHUD();
      this.render();

      // Trigger visual match pop animation
      const slotEl = document.querySelector(`.target-slot[data-slot="${slotIndex}"] .bottle-wrapper`);
      if (slotEl) slotEl.classList.add('match-pop');

      // Immediately report progress
      this.onProgress({
        matched: this.matchedCount,
        total: this.puzzle.bottleCount,
        errors: this.errorsCount
      });

      // AUTOMATIC FINISH CHECK:
      // Last correct match -> Puzzle completed -> Finish time automatically recorded
      if (this.matchedCount === this.puzzle.bottleCount) {
        this.triggerAutoFinish();
      }
    } else {
      // Wrong match attempt!
      this.errorsCount++;
      window.sounds?.playErrorBuzz();

      // Shake dock bottle to indicate error
      const dockBottleEl = document.querySelector(`.bottle-dock-item[data-index="${this.selectedDockIndex}"] .bottle-wrapper`);
      if (dockBottleEl) {
        dockBottleEl.classList.add('shake-error');
        setTimeout(() => dockBottleEl.classList.remove('shake-error'), 400);
      }

      this.updateHUD();

      // Immediately report progress with new error
      this.onProgress({
        matched: this.matchedCount,
        total: this.puzzle.bottleCount,
        errors: this.errorsCount
      });
    }
  }

  // ==========================================
  // Mystery Box Mode (TikTok Challenge Style)
  // ==========================================
  calculateMysteryMatches() {
    let count = 0;
    for (let i = 0; i < this.puzzle.bottleCount; i++) {
      if (this.placedSlots[i] && this.placedSlots[i].colorId === this.puzzle.targetSequence[i].colorId) {
        count++;
      }
    }
    return count;
  }

  handleMysterySlotClick(slotIndex) {
    if (this.selectedSlotIndex === null) {
      this.selectedSlotIndex = slotIndex;
      window.sounds?.playPop();
      this.render();
    } else if (this.selectedSlotIndex === slotIndex) {
      this.selectedSlotIndex = null;
      this.render();
    } else {
      // Swap two slots
      const idxA = this.selectedSlotIndex;
      const idxB = slotIndex;
      this.selectedSlotIndex = null;

      const prevMatches = this.matchedCount;
      [this.placedSlots[idxA], this.placedSlots[idxB]] = [this.placedSlots[idxB], this.placedSlots[idxA]];

      const newMatches = this.calculateMysteryMatches();
      this.matchedCount = newMatches;

      if (newMatches <= prevMatches && newMatches < this.puzzle.bottleCount) {
        // Swap did not improve matching -> count as error/failed attempt
        this.errorsCount++;
        window.sounds?.playErrorBuzz();
      } else {
        window.sounds?.playMatchSuccess();
      }

      this.updateHUD();
      this.render();

      this.onProgress({
        matched: this.matchedCount,
        total: this.puzzle.bottleCount,
        errors: this.errorsCount
      });

      // Automatic finish if all match
      if (this.matchedCount === this.puzzle.bottleCount) {
        this.triggerAutoFinish();
      }
    }
  }

  // ==========================================
  // Automatic Finish Handler
  // ==========================================
  triggerAutoFinish() {
    if (this.isCompleted) return;
    this.isCompleted = true;
    this.isRacing = false;
    this.stopTimer();

    const elapsed = (performance.now() - this.timerStartTime) / 1000;
    this.finishTime = Number(elapsed.toFixed(2));

    if (this.timeDisplay) {
      this.timeDisplay.textContent = `${this.finishTime.toFixed(2)}s`;
    }

    window.sounds?.playVictoryFanfare();

    // Call finish callback with recorded finish time and errors
    this.onFinish({
      finishTime: this.finishTime,
      errors: this.errorsCount
    });
  }

  // ==========================================
  // DOM Rendering
  // ==========================================
  render() {
    if (!this.puzzle) return;

    if (this.shelfTitleEl) {
      this.shelfTitleEl.textContent = this.settings.gameplayMode === 'mystery_box' 
        ? '📦 Mystery Sequence (Swap to Match)'
        : '🎯 Target Pattern (Match Bottles)';
    }

    if (this.modeNoteEl) {
      this.modeNoteEl.textContent = this.settings.gameplayMode === 'mystery_box'
        ? 'Tap two bottles to swap their positions. Matches update automatically.'
        : 'Tap a bottle below, then tap its matching color slot above.';
    }

    // 1. Render Slots
    this.shelfSlotsEl.innerHTML = '';
    const isMystery = this.settings.gameplayMode === 'mystery_box';

    for (let i = 0; i < this.puzzle.bottleCount; i++) {
      const slotEl = document.createElement('div');
      slotEl.className = 'target-slot';
      slotEl.dataset.slot = i;

      const target = this.puzzle.targetSequence[i];
      const placedBottle = this.placedSlots[i];
      const isCorrect = placedBottle && placedBottle.colorId === target.colorId;

      if (isCorrect) slotEl.classList.add('correct');

      if (isMystery) {
        // In mystery mode, render placed bottle with selection highlight if active
        const isSelected = this.selectedSlotIndex === i;
        slotEl.innerHTML = `
          <div class="bottle-wrapper ${isSelected ? 'selected' : ''}" style="--bottle-color: ${placedBottle.hex}">
            <div class="bottle-cork"></div>
            <div class="bottle-neck"></div>
            <div class="bottle-body">
              <div class="bottle-liquid" style="background: linear-gradient(180deg, ${placedBottle.secondary} 0%, ${placedBottle.hex} 100%);">
                <div class="liquid-wave"></div>
              </div>
            </div>
          </div>
          <span class="slot-index">#${i + 1}</span>
        `;
      } else {
        // Speed match mode
        if (placedBottle) {
          slotEl.innerHTML = `
            <div class="bottle-wrapper" style="--bottle-color: ${placedBottle.hex}">
              <div class="bottle-cork"></div>
              <div class="bottle-neck"></div>
              <div class="bottle-body">
                <div class="bottle-liquid" style="background: linear-gradient(180deg, ${placedBottle.secondary} 0%, ${placedBottle.hex} 100%);">
                  <div class="liquid-wave"></div>
                </div>
              </div>
            </div>
            <span class="slot-index" style="color: var(--accent-green)">✓ #${i + 1}</span>
          `;
        } else {
          // Empty slot with color target indicator
          slotEl.innerHTML = `
            <div class="slot-circle" style="background: radial-gradient(circle, ${target.hex}44 0%, transparent 70%); border-color: ${target.hex}">
              <div style="width: 18px; height: 18px; border-radius: 50%; background: ${target.hex}; box-shadow: 0 0 8px ${target.hex}"></div>
            </div>
            <span class="slot-index">#${i + 1}</span>
          `;
        }
      }

      slotEl.addEventListener('click', () => this.handleSlotClick(i));
      this.shelfSlotsEl.appendChild(slotEl);
    }

    // 2. Render Dock (Only relevant for Speed Match mode)
    if (this.dockBottlesEl) {
      if (isMystery) {
        this.dockBottlesEl.parentElement.style.display = 'none';
      } else {
        this.dockBottlesEl.parentElement.style.display = 'block';
        this.dockBottlesEl.innerHTML = '';

        this.dockBottles.forEach((bottle, idx) => {
          const itemEl = document.createElement('div');
          itemEl.className = 'bottle-dock-item';
          itemEl.dataset.index = idx;

          const isSelected = this.selectedDockIndex === idx;

          itemEl.innerHTML = `
            <div class="bottle-wrapper ${isSelected ? 'selected' : ''}" style="--bottle-color: ${bottle.hex}">
              <div class="bottle-cork"></div>
              <div class="bottle-neck"></div>
              <div class="bottle-body">
                <div class="bottle-liquid" style="background: linear-gradient(180deg, ${bottle.secondary} 0%, ${bottle.hex} 100%);">
                  <div class="liquid-wave"></div>
                </div>
              </div>
            </div>
          `;

          itemEl.addEventListener('click', () => this.handleDockBottleClick(idx));
          this.dockBottlesEl.appendChild(itemEl);
        });
      }
    }
  }
}

window.ColorBottleGame = ColorBottleGame;
