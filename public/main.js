const ROWS = 6;
const COLS = 7;
const EMPTY = 0;
const RED = 1;
const YELLOW = 2;

const modeButtons = document.querySelectorAll(".mode-btn");
const boardEl = document.getElementById("board");
const statusTextEl = document.getElementById("statusText");
const presenceTextEl = document.getElementById("presenceText");
const turnBadgeEl = document.getElementById("turnBadge");
const onlineToolsEl = document.getElementById("onlineTools");
const roomCodeInput = document.getElementById("roomCodeInput");
const joinRoomBtn = document.getElementById("joinRoomBtn");
const createRoomBtn = document.getElementById("createRoomBtn");
const copyLinkBtn = document.getElementById("copyLinkBtn");
const restartBtn = document.getElementById("restartBtn");

const socket = io();

let mode = "cpu";
let board = makeEmptyBoard();
let turn = RED;
let winner = EMPTY;
let draw = false;
let lastMove = null;
let winningCells = [];

let roomId = null;
let myOnlinePlayer = null;
let playersConnected = 0;

const cpuDepth = 4;

function makeEmptyBoard() {
  return Array.from({ length: ROWS }, () => Array(COLS).fill(EMPTY));
}

function randomRoomCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function playerName(player) {
  return player === RED ? "Red" : "Yellow";
}

function modeTitle(value) {
  if (value === "cpu") return "Vs CPU";
  if (value === "local") return "2 Players";
  return "Online";
}

function setMode(nextMode) {
  mode = nextMode;
  modeButtons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.mode === mode);
  });
  onlineToolsEl.classList.toggle("hidden", mode !== "online");

  if (mode !== "online") {
    roomId = null;
    myOnlinePlayer = null;
    playersConnected = 0;
    presenceTextEl.textContent = "";
  }

  resetLocalState();
  render();
}

function resetLocalState() {
  board = makeEmptyBoard();
  turn = RED;
  winner = EMPTY;
  draw = false;
  lastMove = null;
  winningCells = [];
}

function getLowestOpenRow(localBoard, col) {
  for (let row = ROWS - 1; row >= 0; row -= 1) {
    if (localBoard[row][col] === EMPTY) return row;
  }
  return -1;
}

function inBounds(row, col) {
  return row >= 0 && row < ROWS && col >= 0 && col < COLS;
}

function getWinningCells(localBoard, row, col, player) {
  const dirs = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ];

  for (const [dr, dc] of dirs) {
    const line = [[row, col]];

    let r = row + dr;
    let c = col + dc;
    while (inBounds(r, c) && localBoard[r][c] === player) {
      line.push([r, c]);
      r += dr;
      c += dc;
    }

    r = row - dr;
    c = col - dc;
    while (inBounds(r, c) && localBoard[r][c] === player) {
      line.push([r, c]);
      r -= dr;
      c -= dc;
    }

    if (line.length >= 4) return line;
  }

  return [];
}

function checkTerminal(localBoard) {
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const cell = localBoard[r][c];
      if (cell === EMPTY) continue;
      const cells = getWinningCells(localBoard, r, c, cell);
      if (cells.length) {
        return { winner: cell, draw: false, winningCells: cells };
      }
    }
  }

  const isDraw = localBoard.every((row) => row.every((cell) => cell !== EMPTY));
  return { winner: EMPTY, draw: isDraw, winningCells: [] };
}

function cloneBoard(source) {
  return source.map((row) => [...row]);
}

function getAvailableMoves(localBoard) {
  const moves = [];
  for (let c = 0; c < COLS; c += 1) {
    if (getLowestOpenRow(localBoard, c) !== -1) moves.push(c);
  }
  return moves;
}

function scoreBoard(localBoard) {
  const terminal = checkTerminal(localBoard);
  if (terminal.winner === YELLOW) return 100000;
  if (terminal.winner === RED) return -100000;
  if (terminal.draw) return 0;

  let score = 0;
  const centerCount = localBoard.map((row) => row[3]).filter((c) => c === YELLOW).length;
  score += centerCount * 3;

  const windows = [];
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS - 3; c += 1) windows.push([localBoard[r][c], localBoard[r][c + 1], localBoard[r][c + 2], localBoard[r][c + 3]]);
  }
  for (let c = 0; c < COLS; c += 1) {
    for (let r = 0; r < ROWS - 3; r += 1) windows.push([localBoard[r][c], localBoard[r + 1][c], localBoard[r + 2][c], localBoard[r + 3][c]]);
  }
  for (let r = 0; r < ROWS - 3; r += 1) {
    for (let c = 0; c < COLS - 3; c += 1) windows.push([localBoard[r][c], localBoard[r + 1][c + 1], localBoard[r + 2][c + 2], localBoard[r + 3][c + 3]]);
  }
  for (let r = 3; r < ROWS; r += 1) {
    for (let c = 0; c < COLS - 3; c += 1) windows.push([localBoard[r][c], localBoard[r - 1][c + 1], localBoard[r - 2][c + 2], localBoard[r - 3][c + 3]]);
  }

  for (const w of windows) {
    const cpu = w.filter((v) => v === YELLOW).length;
    const human = w.filter((v) => v === RED).length;
    const empty = w.filter((v) => v === EMPTY).length;

    if (cpu === 4) score += 100;
    else if (cpu === 3 && empty === 1) score += 10;
    else if (cpu === 2 && empty === 2) score += 4;

    if (human === 3 && empty === 1) score -= 9;
    else if (human === 2 && empty === 2) score -= 3;
  }

  return score;
}

function minimax(localBoard, depth, alpha, beta, maximizing) {
  const terminal = checkTerminal(localBoard);
  if (depth === 0 || terminal.winner || terminal.draw) {
    return { score: scoreBoard(localBoard), col: null };
  }

  const moves = getAvailableMoves(localBoard);
  if (!moves.length) return { score: 0, col: null };

  if (maximizing) {
    let best = { score: -Infinity, col: moves[0] };
    for (const col of moves) {
      const row = getLowestOpenRow(localBoard, col);
      const next = cloneBoard(localBoard);
      next[row][col] = YELLOW;
      const result = minimax(next, depth - 1, alpha, beta, false);
      if (result.score > best.score) {
        best = { score: result.score, col };
      }
      alpha = Math.max(alpha, result.score);
      if (alpha >= beta) break;
    }
    return best;
  }

  let best = { score: Infinity, col: moves[0] };
  for (const col of moves) {
    const row = getLowestOpenRow(localBoard, col);
    const next = cloneBoard(localBoard);
    next[row][col] = RED;
    const result = minimax(next, depth - 1, alpha, beta, true);
    if (result.score < best.score) {
      best = { score: result.score, col };
    }
    beta = Math.min(beta, result.score);
    if (alpha >= beta) break;
  }
  return best;
}

function applyMove(col, player) {
  if (winner || draw) return false;
  const row = getLowestOpenRow(board, col);
  if (row === -1) return false;

  board[row][col] = player;
  lastMove = { row, col, player };
  const terminal = checkTerminal(board);
  winner = terminal.winner;
  draw = terminal.draw;
  winningCells = terminal.winningCells;
  if (!winner && !draw) turn = player === RED ? YELLOW : RED;
  return true;
}

function isOnlineMyTurn() {
  return mode === "online" && myOnlinePlayer && turn === myOnlinePlayer;
}

function maybeCpuTurn() {
  if (mode !== "cpu" || winner || draw || turn !== YELLOW) return;
  setTimeout(() => {
    const best = minimax(board, cpuDepth, -Infinity, Infinity, true);
    if (best.col !== null) {
      applyMove(best.col, YELLOW);
      render();
    }
  }, 250);
}

function canPlayColumn(col) {
  if (col < 0 || col >= COLS) return false;
  if (winner || draw) return false;
  if (mode === "online") return isOnlineMyTurn();
  if (mode === "cpu") return turn === RED;
  return true;
}

function handleColumnClick(col) {
  if (!canPlayColumn(col)) return;

  if (mode === "online") {
    socket.emit("make-move", { roomId, col });
    return;
  }

  if (applyMove(col, turn)) {
    render();
    maybeCpuTurn();
  }
}

function renderBoard() {
  boardEl.innerHTML = "";
  for (let r = 0; r < ROWS; r += 1) {
    for (let c = 0; c < COLS; c += 1) {
      const cell = document.createElement("button");
      cell.className = "cell";
      cell.type = "button";
      cell.setAttribute("aria-label", `Drop in column ${c + 1}`);
      cell.addEventListener("click", () => handleColumnClick(c));

      if (board[r][c] === RED) cell.classList.add("red");
      if (board[r][c] === YELLOW) cell.classList.add("yellow");

      if (winningCells.some(([wr, wc]) => wr === r && wc === c)) {
        cell.classList.add("win");
      }

      boardEl.appendChild(cell);
    }
  }
}

function modeSpecificStatus() {
  if (winner) return `${playerName(winner)} wins!`;
  if (draw) return "Draw game. Nobody blinked first.";

  if (mode === "cpu") {
    return turn === RED ? "Your move (Red)." : "CPU is thinking...";
  }
  if (mode === "local") {
    return `${playerName(turn)} player's turn.`;
  }
  if (!roomId) return "Create or join a room to play online.";

  if (playersConnected < 2) {
    return "Waiting for another player to join...";
  }
  if (myOnlinePlayer !== RED && myOnlinePlayer !== YELLOW) {
    return "You are spectating this room.";
  }

  return isOnlineMyTurn()
    ? `Your turn (${playerName(myOnlinePlayer)}).`
    : `Opponent's turn (${playerName(turn)}).`;
}

function render() {
  renderBoard();
  statusTextEl.textContent = modeSpecificStatus();

  turnBadgeEl.textContent = `Turn: ${playerName(turn)}`;
  turnBadgeEl.style.color = turn === RED ? "#ff9fb0" : "#ffeb88";

  if (mode === "online" && roomId) {
    presenceTextEl.textContent = `Room ${roomId} • Players connected: ${playersConnected}/2`;
  } else {
    presenceTextEl.textContent = mode === "online" ? "Not in a room yet." : `${modeTitle(mode)} mode`;
  }
}

function joinRoom(code) {
  const clean = (code || "").trim().toUpperCase();
  if (!clean) return;
  roomId = clean;
  socket.emit("join-room", { roomId: clean });
}

function createRoomAndJoin() {
  const code = randomRoomCode();
  roomCodeInput.value = code;
  joinRoom(code);
}

function inviteUrl() {
  if (!roomId) return "";
  const url = new URL(window.location.href);
  url.searchParams.set("room", roomId);
  return url.toString();
}

async function copyInvite() {
  const url = inviteUrl();
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
    statusTextEl.textContent = "Invite link copied to clipboard.";
  } catch {
    statusTextEl.textContent = `Copy this link: ${url}`;
  }
}

socket.on("connect_error", () => {
  if (mode === "online") {
    statusTextEl.textContent = "Could not connect to game server.";
  }
});

socket.on("room-joined", (payload) => {
  myOnlinePlayer = payload.assignedPlayer;
  board = payload.board;
  turn = payload.turn;
  winner = payload.winner;
  draw = payload.draw;
  lastMove = null;
  winningCells = checkTerminal(board).winningCells;

  const url = new URL(window.location.href);
  url.searchParams.set("room", payload.roomId);
  window.history.replaceState({}, "", url);

  render();
});

socket.on("state-update", (payload) => {
  board = payload.board;
  turn = payload.turn;
  winner = payload.winner;
  draw = payload.draw;
  lastMove = payload.lastMove || null;
  winningCells = checkTerminal(board).winningCells;
  render();
});

socket.on("presence", (payload) => {
  playersConnected = payload.playersConnected;
  render();
});

modeButtons.forEach((btn) => {
  btn.addEventListener("click", () => setMode(btn.dataset.mode));
});

joinRoomBtn.addEventListener("click", () => joinRoom(roomCodeInput.value));
createRoomBtn.addEventListener("click", createRoomAndJoin);
copyLinkBtn.addEventListener("click", copyInvite);

roomCodeInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") joinRoom(roomCodeInput.value);
});

restartBtn.addEventListener("click", () => {
  if (mode === "online" && roomId) {
    socket.emit("restart-room", { roomId });
    return;
  }
  resetLocalState();
  render();
  maybeCpuTurn();
});

const initialRoomFromUrl = new URL(window.location.href).searchParams.get("room");
if (initialRoomFromUrl) {
  setMode("online");
  roomCodeInput.value = initialRoomFromUrl.toUpperCase();
  joinRoom(initialRoomFromUrl);
} else {
  render();
}
