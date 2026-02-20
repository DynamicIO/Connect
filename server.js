const path = require("path");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const MAX_ROOMS = 5000;
const rooms = new Map();

app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (_, res) => {
  res.json({ ok: true });
});

function createRoom(roomId) {
  if (!rooms.has(roomId)) {
    if (rooms.size >= MAX_ROOMS) {
      const firstKey = rooms.keys().next().value;
      rooms.delete(firstKey);
    }

    rooms.set(roomId, {
      players: {},
      board: Array.from({ length: 6 }, () => Array(7).fill(0)),
      turn: 1,
      winner: 0,
      draw: false,
      moves: 0,
      updatedAt: Date.now(),
    });
  }

  return rooms.get(roomId);
}

function resetRoomState(room) {
  room.board = Array.from({ length: 6 }, () => Array(7).fill(0));
  room.turn = 1;
  room.winner = 0;
  room.draw = false;
  room.moves = 0;
  room.updatedAt = Date.now();
}

function getLowestOpenRow(board, col) {
  for (let row = board.length - 1; row >= 0; row -= 1) {
    if (board[row][col] === 0) return row;
  }
  return -1;
}

function hasWin(board, row, col, player) {
  const dirs = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ];

  for (const [dr, dc] of dirs) {
    let count = 1;
    let r = row + dr;
    let c = col + dc;
    while (r >= 0 && r < 6 && c >= 0 && c < 7 && board[r][c] === player) {
      count += 1;
      r += dr;
      c += dc;
    }

    r = row - dr;
    c = col - dc;
    while (r >= 0 && r < 6 && c >= 0 && c < 7 && board[r][c] === player) {
      count += 1;
      r -= dr;
      c -= dc;
    }

    if (count >= 4) return true;
  }

  return false;
}

function cleanStaleRooms() {
  const now = Date.now();
  for (const [id, room] of rooms.entries()) {
    if (now - room.updatedAt > 1000 * 60 * 60) {
      rooms.delete(id);
    }
  }
}

setInterval(cleanStaleRooms, 1000 * 60 * 10);

io.on("connection", (socket) => {
  socket.on("join-room", ({ roomId }) => {
    if (!roomId || typeof roomId !== "string") return;
    const normalized = roomId.trim().toUpperCase();
    if (!normalized) return;

    const room = createRoom(normalized);
    socket.join(normalized);
    socket.data.roomId = normalized;

    const assignedPlayer =
      !room.players[1]
        ? 1
        : !room.players[2]
          ? 2
          : Math.random() > 0.5
            ? 1
            : 2;

    room.players[assignedPlayer] = socket.id;
    room.updatedAt = Date.now();

    socket.emit("room-joined", {
      roomId: normalized,
      assignedPlayer,
      board: room.board,
      turn: room.turn,
      winner: room.winner,
      draw: room.draw,
      moves: room.moves,
    });

    io.to(normalized).emit("presence", {
      playersConnected: [1, 2].filter((p) => Boolean(room.players[p])).length,
    });
  });

  socket.on("make-move", ({ roomId, col }) => {
    if (!roomId || typeof col !== "number") return;
    const normalized = roomId.trim().toUpperCase();
    const room = rooms.get(normalized);
    if (!room) return;

    const player =
      room.players[1] === socket.id ? 1 : room.players[2] === socket.id ? 2 : 0;
    if (!player) return;
    if (room.winner || room.draw) return;
    if (player !== room.turn) return;
    if (col < 0 || col > 6) return;

    const row = getLowestOpenRow(room.board, col);
    if (row === -1) return;

    room.board[row][col] = player;
    room.moves += 1;
    room.updatedAt = Date.now();

    if (hasWin(room.board, row, col, player)) {
      room.winner = player;
    } else if (room.moves >= 42) {
      room.draw = true;
    } else {
      room.turn = player === 1 ? 2 : 1;
    }

    io.to(normalized).emit("state-update", {
      board: room.board,
      turn: room.turn,
      winner: room.winner,
      draw: room.draw,
      moves: room.moves,
      lastMove: { row, col, player },
    });
  });

  socket.on("restart-room", ({ roomId }) => {
    if (!roomId) return;
    const normalized = roomId.trim().toUpperCase();
    const room = rooms.get(normalized);
    if (!room) return;

    const isPlayer =
      room.players[1] === socket.id || room.players[2] === socket.id;
    if (!isPlayer) return;

    resetRoomState(room);
    io.to(normalized).emit("state-update", {
      board: room.board,
      turn: room.turn,
      winner: room.winner,
      draw: room.draw,
      moves: room.moves,
      lastMove: null,
    });
  });

  socket.on("disconnect", () => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    const room = rooms.get(roomId);
    if (!room) return;

    if (room.players[1] === socket.id) delete room.players[1];
    if (room.players[2] === socket.id) delete room.players[2];
    room.updatedAt = Date.now();

    io.to(roomId).emit("presence", {
      playersConnected: [1, 2].filter((p) => Boolean(room.players[p])).length,
    });
  });
});

server.listen(PORT, () => {
  console.log(`Connect Four running on http://localhost:${PORT}`);
});
