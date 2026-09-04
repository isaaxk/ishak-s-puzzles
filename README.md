# 🍾 ISHAK's BOTTLE RACE — Multiplayer Matching Game

A mobile-friendly real-time multiplayer web app inspired by the viral Color Bottle Matching Game. Compete head-to-head in synchronized race rooms, track competitors live, and finish automatically as soon as the final bottle is matched!

---

## 🚀 Features

- **🏁 Race Room & Host Settings**:
  - 5-character room code with shareable invite links and instant QR code for mobile joining.
  - Host controls: Select difficulty (Easy 5, Medium 8, Pro 10, Hard 12, Expert 14, Master 16 bottles), set max players, kick players, and start the synchronized race.
  - Any player can join or leave at any time; host privileges transfer automatically if the host leaves.
- **🎮 Synchronized Real-Time Race**:
  - All competitors receive the exact same puzzle sequence and start at the same moment after a 3-2-1-GO! countdown.
  - Real-time progress streaming: `Matched: 7 / 12`, `Errors: 2`, `Time: 24.37s`.
  - Live Rival Track: Shows competitors' progress bars in real time during the race.
- **⏱️ 100% Automatic Finish**:
  - No submit or finish button. As soon as the player correctly matches the last remaining bottle, the system automatically detects completion and records the finish time.
- **🏆 Exact Ranking & Tiebreaker Engine**:
  - **1. Completion Priority**: Completed players always rank above unfinished players.
  - **2. Finish Time**: Lowest finish time ranks higher.
  - **3. Errors as Tiebreaker (Default)**: When finish times are identical, fewer errors ranks higher.
  - **4. Shared Ranks**: When both time and errors are identical, players share the exact same ranking position (e.g. tied 🥇 1st place). Server timestamps are not used to break ties.
  - **5. Error Penalty (Optional)**: Host can enable error penalties (e.g. +2s per error). Final Time = Actual Time + (Errors × Penalty).

---

## ☁️ Deployment on Render

This project is configured and ready for instant deployment on [Render](https://render.com).

### Option A: Using Render Blueprint (Automatic)
1. In your Render Dashboard, click **New +** -> **Blueprint**.
2. Connect this repository (`isaaxk/ishak-s-puzzles`).
3. Render will read [`render.yaml`](render.yaml) and deploy the Web Service automatically!

### Option B: Manual Web Service
1. In your Render Dashboard, click **New +** -> **Web Service**.
2. Connect this repository (`isaaxk/ishak-s-puzzles`).
3. Set the following options:
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
4. Click **Deploy Web Service**!

---

## 💻 Local Development

```bash
# Clone the repository
git clone https://github.com/isaaxk/ishak-s-puzzles.git
cd ishak-s-puzzles

# Install dependencies
npm install

# Run automated tests
npm test

# Start local server
npm start
```

Open [http://localhost:3050](http://localhost:3050) in your browser.
