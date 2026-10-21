const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

app.get('/player', (req, res) => res.sendFile(path.join(__dirname, 'public/player.html')));
app.get('/host', (req, res) => res.sendFile(path.join(__dirname, 'public/host.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public/dashboard.html')));

const TARGET_CODE = 'GAME_TARGET_TOKEN_2026'; // QR code text to match
const WINNING_SCORE = 1000;
const TICK_RATE_MS = 100;
const POINTS_PER_TICK = 5; // Reaches 1000 in ~20 cumulative seconds

let gameState = {
  status: 'IDLE', // 'IDLE', 'PLAYING', 'PAUSED', 'ENDED'
  winner: null,
  players: {
    p1: { socketId: null, name: 'Player 1', score: 0, isScanning: false },
    p2: { socketId: null, name: 'Player 2', score: 0, isScanning: false }
  }
};

// 10Hz authoritative scoring engine
setInterval(() => {
  if (gameState.status !== 'PLAYING') return;

  const p1Scanning = gameState.players.p1.isScanning;
  const p2Scanning = gameState.players.p2.isScanning;

  // Mutual exclusion: Points earned ONLY when one scans and the other does not
  if (p1Scanning && !p2Scanning) {
    gameState.players.p1.score += POINTS_PER_TICK;
  } else if (p2Scanning && !p1Scanning) {
    gameState.players.p2.score += POINTS_PER_TICK;
  }

  // Check victory condition
  if (gameState.players.p1.score >= WINNING_SCORE) {
    gameState.status = 'ENDED';
    gameState.winner = 'Player 1';
  } else if (gameState.players.p2.score >= WINNING_SCORE) {
    gameState.status = 'ENDED';
    gameState.winner = 'Player 2';
  }

  io.emit('stateUpdate', gameState);
}, TICK_RATE_MS);

io.on('connection', (socket) => {
  socket.emit('stateUpdate', gameState);

  // Player joins slot ('p1' or 'p2')
  socket.on('joinGame', (slot) => {
    if (gameState.players[slot]) {
      gameState.players[slot].socketId = socket.id;
      io.emit('stateUpdate', gameState);
    }
  });

  // Client scanning status event
  socket.on('scanPing', ({ slot, detected, codeData }) => {
    if (gameState.players[slot] && gameState.status === 'PLAYING') {
      const isValidTarget = detected && codeData === TARGET_CODE;
      gameState.players[slot].isScanning = isValidTarget;
    }
  });

  // Host commands
  socket.on('hostCommand', (action) => {
    if (action === 'START' || action === 'RESUME') {
      if (gameState.status !== 'ENDED') gameState.status = 'PLAYING';
    } else if (action === 'PAUSE') {
      gameState.status = 'PAUSED';
      gameState.players.p1.isScanning = false;
      gameState.players.p2.isScanning = false;
    } else if (action === 'RESTART') {
      gameState.status = 'PLAYING';
      gameState.winner = null;
      gameState.players.p1.score = 0;
      gameState.players.p1.isScanning = false;
      gameState.players.p2.score = 0;
      gameState.players.p2.isScanning = false;
    }
    io.emit('stateUpdate', gameState);
  });

  socket.on('disconnect', () => {
    ['p1', 'p2'].forEach((slot) => {
      if (gameState.players[slot].socketId === socket.id) {
        gameState.players[slot].socketId = null;
        gameState.players[slot].isScanning = false;
      }
    });
    io.emit('stateUpdate', gameState);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));