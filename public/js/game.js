/**
 * game.js
 * Hidden-Order Bottle Position Matching Game Engine
 * 
 * Rules:
 * - Player sees scrambled bottles on a single shelf.
 * - The target arrangement is hidden.
 * - Player drags one bottle onto another to swap positions (or taps to swap).
 * - Immediate feedback after every swap: Matched: X / N, Errors.
 * - Automatic finish as soon as Matched === N.
 */

function formatTimeDisplay(seconds) {
  if (seconds === null || seconds === undefined || isNaN(seconds)) return '0.00s';
  const s = Number(seconds);
  if (s < 60) {
    return `${s.toFixed(2)}s`;
  }
  const mins = Math.floor(s / 60);
  const remSec = s - (mins * 60);
  const secStr = remSec < 10 ? `0${remSec.toFixed(2)}` : remSec.toFixed(2);
  return `${mins}:${secStr}`;
}
window.formatTimeDisplay = formatTimeDisplay;

class ColorBottleGame {
  constructor(options = {}) {
    this.onProgress = options.onProgress || (() => {});
    this.onFinish = options.onFinish || (() => {});

    this.puzzle = null;
    this.settings = null;
    this.isRacing = false;
    this.isCompleted = false;

    this.currentBottles = []; // Array of bottles currently on the shelf
    this.targetSequence = []; // Secret target arrangement
    this.bottleCount = 0;

    this.matchedCount = 0;
    this.errorsCount = 0;
    this.finishTime = null;

    this.timerStartTime = null;
    this.timerAnimationId = null;

    // Drag & Drop State
    this.draggedIndex = null;
    this.selectedTapIndex = null;
    this.touchGhostEl = null;

    // DOM Elements - Top Bar HUD
    this.matchedDisplay = document.getElementById('stat-matched');
    this.errorsDisplay = document.getElementById('stat-errors');
    this.timeDisplay = document.getElementById('stat-time');

    // DOM Elements - 3 Quick-view Side Bubbles
    this.bubbleMatchedDisplay = document.getElementById('bubble-stat-matched');
    this.bubbleErrorsDisplay = document.getElementById('bubble-stat-errors');
    this.bubbleTimeDisplay = document.getElementById('bubble-stat-time');

    this.shelfSlotsEl = document.getElementById('shelf-slots');
  }

  initRace(puzzle, settings, startTime) {
    this.stopTimer();
    this.puzzle = puzzle;
    this.settings = settings || {};
    this.isRacing = false;
    this.isCompleted = false;

    this.bottleCount = puzzle.bottleCount;
    this.targetSequence = [...puzzle.targetSequence];
    // Start with the identical scrambled bottles
    this.currentBottles = puzzle.initialBottles.map((b, idx) => ({
      ...b,
      uniqueKey: `${b.colorId}_${idx}`
    }));

    this.draggedIndex = null;
    this.selectedTapIndex = null;
    this.errorsCount = 0;
    this.finishTime = null;

    // Initial matches calculation
    this.matchedCount = this.calculateMatches();

    if (this.timeDisplay) this.timeDisplay.textContent = '0.00s';
    if (this.bubbleTimeDisplay) this.bubbleTimeDisplay.textContent = '0.00s';

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
    const formattedTime = formatTimeDisplay(elapsedSeconds);

    if (this.timeDisplay) {
      this.timeDisplay.textContent = formattedTime;
    }
    if (this.bubbleTimeDisplay) {
      this.bubbleTimeDisplay.textContent = formattedTime;
    }

    this.timerAnimationId = requestAnimationFrame(() => this.runTimer());
  }

  stopTimer() {
    if (this.timerAnimationId) {
      cancelAnimationFrame(this.timerAnimationId);
      this.timerAnimationId = null;
    }
  }

  calculateMatches() {
    let matches = 0;
    for (let i = 0; i < this.bottleCount; i++) {
      if (this.currentBottles[i].colorId === this.targetSequence[i].colorId) {
        matches++;
      }
    }
    return matches;
  }

  updateHUD() {
    const matchedText = `${this.matchedCount} / ${this.bottleCount}`;
    const errorsText = `${this.errorsCount}`;

    if (this.matchedDisplay) {
      this.matchedDisplay.textContent = matchedText;
    }
    if (this.errorsDisplay) {
      this.errorsDisplay.textContent = errorsText;
    }

    if (this.bubbleMatchedDisplay) {
      this.bubbleMatchedDisplay.textContent = `${this.matchedCount}/${this.bottleCount}`;
    }
    if (this.bubbleErrorsDisplay) {
      this.bubbleErrorsDisplay.textContent = errorsText;
    }
  }

  // ==========================================
  // Bottle Swap Action (Core Game Logic)
  // ==========================================
  swapBottles(indexA, indexB) {
    if (!this.isRacing || this.isCompleted) return;
    if (indexA === indexB || indexA === null || indexB === null) return;
    if (indexA < 0 || indexA >= this.bottleCount || indexB < 0 || indexB >= this.bottleCount) return;

    const prevMatches = this.matchedCount;

    // Swap the two bottles in current arrangement
    const temp = this.currentBottles[indexA];
    this.currentBottles[indexA] = this.currentBottles[indexB];
    this.currentBottles[indexB] = temp;

    // Calculate new matches
    const newMatches = this.calculateMatches();
    this.matchedCount = newMatches;

    // Evaluate if attempt improved the puzzle or was an error
    let wasError = false;
    if (newMatches <= prevMatches && newMatches < this.bottleCount) {
      this.errorsCount++;
      wasError = true;
      window.sounds?.playErrorBuzz();
    } else {
      window.sounds?.playMatchSuccess();
    }

    this.updateHUD();
    this.render();

    // Visual feedback animations
    const slotA = this.shelfSlotsEl.querySelector(`.bottle-slot[data-index="${indexA}"] .bottle-wrapper`);
    const slotB = this.shelfSlotsEl.querySelector(`.bottle-slot[data-index="${indexB}"] .bottle-wrapper`);
    
    if (wasError) {
      if (slotA) {
        slotA.classList.add('shake-error');
        setTimeout(() => slotA.classList.remove('shake-error'), 400);
      }
      if (slotB) {
        slotB.classList.add('shake-error');
        setTimeout(() => slotB.classList.remove('shake-error'), 400);
      }
    } else {
      if (slotA) slotA.classList.add('match-pop');
      if (slotB) slotB.classList.add('match-pop');
    }

    // Immediately emit progress to rivals
    this.onProgress({
      matched: this.matchedCount,
      total: this.bottleCount,
      errors: this.errorsCount
    });

    // AUTOMATIC FINISH CHECK:
    // As soon as all bottles reach their correct positions (Matched: N / N),
    // automatically end and record finish time!
    if (this.matchedCount === this.bottleCount) {
      this.triggerAutoFinish();
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
    const formatted = formatTimeDisplay(this.finishTime);

    if (this.timeDisplay) {
      this.timeDisplay.textContent = formatted;
    }
    if (this.bubbleTimeDisplay) {
      this.bubbleTimeDisplay.textContent = formatted;
    }

    window.sounds?.playVictoryFanfare();

    this.onFinish({
      finishTime: this.finishTime,
      errors: this.errorsCount
    });
  }

  // ==========================================
  // DOM Rendering & Drag/Drop Event Binding
  // ==========================================
  render() {
    if (!this.shelfSlotsEl || !this.currentBottles) return;
    this.shelfSlotsEl.innerHTML = '';

    for (let i = 0; i < this.bottleCount; i++) {
      const bottle = this.currentBottles[i];
      const slotEl = document.createElement('div');
      slotEl.className = 'bottle-slot';
      slotEl.dataset.index = i;

      const isSelected = this.selectedTapIndex === i;

      slotEl.innerHTML = `
        <div class="bottle-wrapper ${isSelected ? 'selected' : ''}" draggable="true" data-index="${i}" style="--bottle-color: ${bottle.hex}">
          <div class="bottle-cork"></div>
          <div class="bottle-neck"></div>
          <div class="bottle-body">
            <div class="bottle-liquid" style="background: linear-gradient(180deg, ${bottle.secondary} 0%, ${bottle.hex} 100%);">
              <div class="liquid-wave"></div>
            </div>
          </div>
        </div>
        <span class="slot-index">#${i + 1}</span>
      `;

      const bottleWrapper = slotEl.querySelector('.bottle-wrapper');

      // ----------------------------------------------------
      // 1. Desktop HTML5 Drag & Drop
      // ----------------------------------------------------
      bottleWrapper.addEventListener('dragstart', (e) => {
        if (!this.isRacing || this.isCompleted) {
          e.preventDefault();
          return;
        }
        this.draggedIndex = i;
        this.selectedTapIndex = null;
        bottleWrapper.classList.add('dragging');
        e.dataTransfer.setData('text/plain', i.toString());
        e.dataTransfer.effectAllowed = 'move';
      });

      bottleWrapper.addEventListener('dragend', () => {
        bottleWrapper.classList.remove('dragging');
        this.draggedIndex = null;
        this.shelfSlotsEl.querySelectorAll('.bottle-slot').forEach(s => s.classList.remove('drag-over'));
      });

      slotEl.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (this.draggedIndex !== null && this.draggedIndex !== i) {
          slotEl.classList.add('drag-over');
        }
      });

      slotEl.addEventListener('dragleave', () => {
        slotEl.classList.remove('drag-over');
      });

      slotEl.addEventListener('drop', (e) => {
        e.preventDefault();
        slotEl.classList.remove('drag-over');
        if (this.draggedIndex !== null && this.draggedIndex !== i) {
          const fromIdx = this.draggedIndex;
          this.draggedIndex = null;
          this.swapBottles(fromIdx, i);
        }
      });

      // ----------------------------------------------------
      // 2. Mobile Touch Drag & Drop
      // ----------------------------------------------------
      let touchMoved = false;
      let startX = 0;
      let startY = 0;

      bottleWrapper.addEventListener('touchstart', (e) => {
        if (!this.isRacing || this.isCompleted) return;
        const touch = e.touches[0];
        startX = touch.clientX;
        startY = touch.clientY;
        touchMoved = false;
        this.draggedIndex = i;
      }, { passive: true });

      bottleWrapper.addEventListener('touchmove', (e) => {
        if (!this.isRacing || this.isCompleted || this.draggedIndex === null) return;
        const touch = e.touches[0];
        const distX = Math.abs(touch.clientX - startX);
        const distY = Math.abs(touch.clientY - startY);

        if (distX > 8 || distY > 8) {
          touchMoved = true;
          // Create touch ghost if not present
          if (!this.touchGhostEl) {
            this.touchGhostEl = bottleWrapper.cloneNode(true);
            this.touchGhostEl.classList.add('touch-ghost');
            document.body.appendChild(this.touchGhostEl);
          }
          this.touchGhostEl.style.left = `${touch.clientX}px`;
          this.touchGhostEl.style.top = `${touch.clientY}px`;

          // Highlight slot under finger
          const targetEl = document.elementFromPoint(touch.clientX, touch.clientY);
          const hoveredSlot = targetEl ? targetEl.closest('.bottle-slot') : null;
          
          this.shelfSlotsEl.querySelectorAll('.bottle-slot').forEach(s => {
            if (s === hoveredSlot && Number(s.dataset.index) !== this.draggedIndex) {
              s.classList.add('drag-over');
            } else {
              s.classList.remove('drag-over');
            }
          });
        }
      }, { passive: true });

      bottleWrapper.addEventListener('touchend', (e) => {
        if (this.touchGhostEl) {
          this.touchGhostEl.remove();
          this.touchGhostEl = null;
        }

        if (touchMoved && this.draggedIndex !== null) {
          const touch = e.changedTouches[0];
          const targetEl = document.elementFromPoint(touch.clientX, touch.clientY);
          const dropSlot = targetEl ? targetEl.closest('.bottle-slot') : null;

          if (dropSlot) {
            const toIdx = Number(dropSlot.dataset.index);
            if (!isNaN(toIdx) && toIdx !== this.draggedIndex) {
              const fromIdx = this.draggedIndex;
              this.draggedIndex = null;
              this.swapBottles(fromIdx, toIdx);
            }
          }
        }

        this.shelfSlotsEl.querySelectorAll('.bottle-slot').forEach(s => s.classList.remove('drag-over'));
        this.draggedIndex = null;
      });

      // ----------------------------------------------------
      // 3. Mobile Tap-to-Swap (Convenient Fast Fallback)
      // ----------------------------------------------------
      bottleWrapper.addEventListener('click', () => {
        if (!this.isRacing || this.isCompleted) return;
        if (touchMoved) return; // ignore tap if dragged

        if (this.selectedTapIndex === null) {
          // Select bottle A
          this.selectedTapIndex = i;
          window.sounds?.playPop();
          this.render();
        } else if (this.selectedTapIndex === i) {
          // Deselect
          this.selectedTapIndex = null;
          this.render();
        } else {
          // Swap bottle A and bottle B
          const fromIdx = this.selectedTapIndex;
          this.selectedTapIndex = null;
          this.swapBottles(fromIdx, i);
        }
      });

      this.shelfSlotsEl.appendChild(slotEl);
    }
  }
}

window.ColorBottleGame = ColorBottleGame;
