const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

app.use(express.static(path.join(__dirname, '../public')));

function looksLikeVerb(word) {
  const w = word.toLowerCase();
  if (/^[a-zàâäéèêëîïôùûüÿçæœ]{3,}(er|ir|re|oir)$/.test(w)) return true;
  if (/^[a-zàâäéèêëîïôùûüÿçæœ]{3,}(ons|ez|ent|ais|ait|ions|iez|aient|erai|eras|era|erons|erez|eront|irais|irait|ant)$/.test(w)) return true;
  return false;
}

const rooms = new Map();
const TURN_DURATION = 15;
const HOST_VERDICT_DURATION = 30;

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do { code = Array.from({length:4}, () => chars[Math.floor(Math.random()*chars.length)]).join(''); }
  while (rooms.has(code));
  return code;
}

function createRoom(code) {
  return {
    code, players: [], host: null, status: 'waiting',
    word: '', wordHistory: [],
    currentPlayerIndex: 0, round: 1, totalRounds: 5, scores: {},
    timer: null, timeLeft: TURN_DURATION,
    // Challenge en attente de validation hôte
    pendingChallenge: null, // { challengerId, challengedPlayerId, word }
  };
}

function roomPublicData(room) {
  return {
    code: room.code, players: room.players, host: room.host, status: room.status,
    word: room.word, currentPlayerIndex: room.currentPlayerIndex,
    round: room.round, totalRounds: room.totalRounds, wordHistory: room.wordHistory,
    scores: room.players.map(p => ({ id: p.id, name: p.name, score: room.scores[p.id]||0 })),
    pendingChallenge: room.pendingChallenge,
  };
}

function broadcastRoomsList() {
  const list = Array.from(rooms.values()).filter(r => r.status==='waiting' && r.players.length<5)
    .map(r => ({ code: r.code, players: r.players.length, maxPlayers: 5 }));
  io.emit('roomsList', list);
}

function clearTimer(room) {
  if (room.timer) { clearInterval(room.timer); room.timer = null; }
}

function startTimer(room) {
  clearTimer(room);
  room.timeLeft = TURN_DURATION;
  io.to(room.code).emit('timerTick', { timeLeft: room.timeLeft, max: TURN_DURATION });
  room.timer = setInterval(() => {
    room.timeLeft--;
    io.to(room.code).emit('timerTick', { timeLeft: room.timeLeft, max: TURN_DURATION });
    if (room.timeLeft <= 0) {
      clearTimer(room);
      const cur = room.players[room.currentPlayerIndex];
      if (cur) {
        io.to(room.code).emit('timerOut', { playerName: cur.name });
        endRound(room, cur.id, `⏱ ${cur.name} n'a pas joué à temps !`);
      }
    }
  }, 1000);
}

function endRound(room, loserId, reason, voluntary=false) {
  clearTimer(room);
  room.pendingChallenge = null;
  const loser = room.players.find(p => p.id === loserId);
  room.players.forEach(p => {
    if (p.id !== loserId) room.scores[p.id] = (room.scores[p.id]||0) + Math.max(room.word.length, 1);
  });
  room.status = 'roundEnd';
  const scores = room.players.map(p => ({ id: p.id, name: p.name, score: room.scores[p.id]||0 }))
    .sort((a,b) => b.score-a.score);
  io.to(room.code).emit('roundEnded', {
    loser: { id: loserId, name: loser?.name },
    word: room.word||'(vide)', reason: reason||'',
    scores, round: room.round, totalRounds: room.totalRounds, voluntary
  });
}

io.on('connection', (socket) => {
  broadcastRoomsList();

  socket.on('joinRoom', ({ name, code }) => {
    if (!name?.trim()) return socket.emit('error', { message: 'Nom invalide.' });
    let room;
    if (code) {
      room = rooms.get(code.toUpperCase());
      if (!room) return socket.emit('error', { message: 'Salon introuvable.' });
      if (room.status !== 'waiting') return socket.emit('error', { message: 'Partie en cours.' });
      if (room.players.length >= 5) return socket.emit('error', { message: 'Salon plein.' });
    } else {
      const nc = generateCode(); room = createRoom(nc); rooms.set(nc, room);
    }
    room.players.push({ id: socket.id, name: name.trim() });
    room.scores[socket.id] = 0;
    if (!room.host) room.host = socket.id;
    socket.join(room.code); socket.data.room = room.code;
    socket.emit('roomJoined', { room: roomPublicData(room), code: room.code });
    io.to(room.code).emit('roomUpdated', roomPublicData(room));
    broadcastRoomsList();
  });

  socket.on('startGame', () => {
    const room = rooms.get(socket.data.room);
    if (!room || room.host !== socket.id) return;
    if (room.players.length < 2) return socket.emit('error', { message: 'Pas assez de joueurs.' });
    room.status = 'playing'; room.word = ''; room.wordHistory = [];
    room.currentPlayerIndex = 0; room.round = 1; room.pendingChallenge = null;
    room.players.forEach(p => room.scores[p.id] = 0);
    io.to(room.code).emit('gameStarted', { ...roomPublicData(room), host: room.host });
    broadcastRoomsList(); startTimer(room);
  });

  socket.on('playLetter', ({ letter }) => {
    const room = rooms.get(socket.data.room);
    if (!room || room.status !== 'playing' || room.pendingChallenge) return;
    const cur = room.players[room.currentPlayerIndex];
    if (!cur || cur.id !== socket.id) return socket.emit('error', { message: "Pas ton tour !" });
    if (!letter || !/^[A-ZÀÂÄÉÈÊËÎÏÔÙÛÜŸÇÆŒa-zàâäéèêëîïôùûüÿçæœ]$/i.test(letter)) {
      return socket.emit('error', { message: 'Lettre invalide.' });
    }
    clearTimer(room);
    const l = letter.toUpperCase();
    room.word += l; room.wordHistory.push({ letter: l, playerId: socket.id, playerName: cur.name });
    io.to(room.code).emit('letterPlayed', { playerName: cur.name, letter: l, word: room.word });

    // Si mot >= 5 lettres → l'hôte doit valider si c'est un vrai mot
    if (room.word.length >= 5) {
      room.pendingChallenge = {
        type: 'wordCheck',
        loserId: socket.id, // celui qui a posé la dernière lettre perd si le mot est valide
        loserName: cur.name,
        word: room.word,
      };
      io.to(room.code).emit('wordCheckPending', {
        word: room.word,
        loserName: cur.name,
        hostId: room.host,
      });
      // Timer 30s pour l'hôte — si pas de réponse, mot invalide → partie continue
      room.hostTimer = setTimeout(() => {
        if (!room.pendingChallenge) return;
        room.pendingChallenge = null;
        room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length;
        io.to(room.code).emit('wordCheckResult', { word: room.word, valid: false, reason: `Temps écoulé — "${room.word}" non validé. La partie continue !` });
        io.to(room.code).emit('gameUpdated', { ...roomPublicData(room), host: room.host });
        startTimer(room);
      }, HOST_VERDICT_DURATION * 1000);
      room.hostTimeLeft = HOST_VERDICT_DURATION;
      room.hostTimerTick = setInterval(() => {
        room.hostTimeLeft--;
        io.to(room.code).emit('hostTimerTick', { timeLeft: room.hostTimeLeft, max: HOST_VERDICT_DURATION });
        if (room.hostTimeLeft <= 0) clearInterval(room.hostTimerTick);
      }, 1000);
      io.to(room.code).emit('hostTimerTick', { timeLeft: HOST_VERDICT_DURATION, max: HOST_VERDICT_DURATION });
      return; // pas de timer joueur, on attend l'hôte
    }

    room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length;
    io.to(room.code).emit('gameUpdated', { ...roomPublicData(room), host: room.host });
    startTimer(room);
  });

  // ── TERMINER VOLONTAIREMENT ──
  socket.on('finishWord', ({ letter }) => {
    const room = rooms.get(socket.data.room);
    if (!room || room.status !== 'playing' || room.pendingChallenge) return;
    const cur = room.players[room.currentPlayerIndex];
    if (!cur || cur.id !== socket.id) return socket.emit('error', { message: "Pas ton tour !" });
    if (!letter || !/^[A-ZÀÂÄÉÈÊËÎÏÔÙÛÜŸÇÆŒa-zàâäéèêëîïôùûüÿçæœ]$/i.test(letter)) {
      return socket.emit('error', { message: 'Lettre invalide.' });
    }
    clearTimer(room);
    const l = letter.toUpperCase();
    room.word += l;
    room.wordHistory.push({ letter: l, playerId: socket.id, playerName: cur.name });
    io.to(room.code).emit('letterPlayed', { playerName: cur.name, letter: l, word: room.word });
    const reason = `${cur.name} a choisi de terminer le mot sur "${room.word}" (${room.word.length} lettres).`;
    setTimeout(() => endRound(room, socket.id, reason, true), 600);
  });

  // ── CHALLENGE → l'hôte décide si un mot est possible avec ces lettres ──
  socket.on('challenge', () => {
    const room = rooms.get(socket.data.room);
    if (!room || room.status !== 'playing' || room.pendingChallenge) return;
    if (!room.wordHistory.length) return socket.emit('error', { message: 'Rien à challenger.' });
    const lastPlay = room.wordHistory[room.wordHistory.length - 1];
    if (lastPlay.playerId === socket.id) return socket.emit('error', { message: 'Tu ne peux pas te challenger.' });

    clearTimer(room);
    const challenger = room.players.find(p => p.id === socket.id);
    const challenged = room.players.find(p => p.id === lastPlay.playerId);

    room.pendingChallenge = {
      type: 'challenge',
      challengerId: socket.id, challengerName: challenger?.name,
      challengedId: lastPlay.playerId, challengedName: challenged?.name,
      word: room.word,
    };

    io.to(room.code).emit('challengePending', {
      challengerName: challenger?.name,
      challengedName: challenged?.name,
      word: room.word,
      hostId: room.host,
    });

    // Timer 30s — si hôte ne répond pas, challenge annulé, partie continue
    room.hostTimer = setTimeout(() => {
      if (!room.pendingChallenge) return;
      room.pendingChallenge = null;
      if (room.hostTimerTick) { clearInterval(room.hostTimerTick); room.hostTimerTick = null; }
      const reason = 'Temps écoulé — challenge annulé. La partie continue !';
      io.to(room.code).emit('challengeResult', { word: room.word, valid: false, reason, loserName: null, cancelled: true });
      room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length;
      io.to(room.code).emit('gameUpdated', { ...roomPublicData(room), host: room.host });
      startTimer(room);
    }, HOST_VERDICT_DURATION * 1000);
    room.hostTimeLeft = HOST_VERDICT_DURATION;
    room.hostTimerTick = setInterval(() => {
      room.hostTimeLeft--;
      io.to(room.code).emit('hostTimerTick', { timeLeft: room.hostTimeLeft, max: HOST_VERDICT_DURATION });
      if (room.hostTimeLeft <= 0) clearInterval(room.hostTimerTick);
    }, 1000);
    io.to(room.code).emit('hostTimerTick', { timeLeft: HOST_VERDICT_DURATION, max: HOST_VERDICT_DURATION });
    console.log(`[${room.code}] Challenge "${room.word}" par ${challenger?.name} — en attente hôte`);
  });

  // ── HÔTE VALIDE OU REJETTE ──
  socket.on('hostVerdict', ({ valid }) => {
    const room = rooms.get(socket.data.room);
    if (!room || room.host !== socket.id || !room.pendingChallenge) return;

    const pc = room.pendingChallenge;
    room.pendingChallenge = null;
    if (room.hostTimer) { clearTimeout(room.hostTimer); room.hostTimer = null; }
    if (room.hostTimerTick) { clearInterval(room.hostTimerTick); room.hostTimerTick = null; }

    // Cas 1 : vérification automatique d'un mot ≥ 5 lettres
    if (pc.type === 'wordCheck') {
      if (valid) {
        // Mot valide → celui qui a posé la dernière lettre perd
        const reason = `"${pc.word}" validé par l'hôte ! ${pc.loserName} perd la manche.`;
        io.to(room.code).emit('wordCheckResult', { word: pc.word, valid: true, reason, loserName: pc.loserName });
        setTimeout(() => endRound(room, pc.loserId, reason), 1200);
      } else {
        // Mot invalide → la partie continue, on passe au joueur suivant
        room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length;
        io.to(room.code).emit('wordCheckResult', { word: pc.word, valid: false, reason: `"${pc.word}" n'est pas un mot valide. La partie continue !` });
        io.to(room.code).emit('gameUpdated', { ...roomPublicData(room), host: room.host });
        startTimer(room);
      }
      return;
    }

    // Cas 2 : challenge — "un mot est-il possible avec ces lettres ?"
    // valid = true  → oui un mot existe → challengeur avait tort → challengeur perd
    // valid = false → non aucun mot possible → challengé a bloqué → challengé perd
    const { challengerId, challengerName, challengedId, challengedName, word } = pc;
    let loserId, reason;
    if (valid) {
      // Un mot existe avec ces lettres → challengeur avait tort
      loserId = challengerId;
      reason = `Un mot est possible ! ${challengerName} avait tort, il perd la manche.`;
    } else {
      // Aucun mot possible → challengé a posé une lettre qui bloquait tout
      loserId = challengedId;
      reason = `Aucun mot possible ! ${challengedName} perd la manche.`;
    }
    io.to(room.code).emit('challengeResult', { word, valid, reason, loserName: room.players.find(p=>p.id===loserId)?.name });
    setTimeout(() => endRound(room, loserId, reason), 1500);
  });

  socket.on('nextRound', () => {
    const room = rooms.get(socket.data.room);
    if (!room || room.host !== socket.id || room.status !== 'roundEnd') return;
    if (room.round >= room.totalRounds) {
      const scores = room.players.map(p => ({ id: p.id, name: p.name, score: room.scores[p.id]||0 }))
        .sort((a,b) => b.score-a.score);
      return io.to(room.code).emit('gameEnded', { scores });
    }
    room.round++;
    room.word = ''; room.wordHistory = [];
    room.status = 'playing'; room.pendingChallenge = null;
    const minScore = Math.min(...room.players.map(p => room.scores[p.id]||0));
    const loserIdx = room.players.findIndex(p => (room.scores[p.id]||0) === minScore);
    room.currentPlayerIndex = loserIdx >= 0 ? loserIdx : 0;
    io.to(room.code).emit('gameStarted', { ...roomPublicData(room), host: room.host });
    startTimer(room);
  });

  socket.on('requestGameEnd', () => {
    const room = rooms.get(socket.data.room);
    if (!room) return;
    const scores = room.players.map(p => ({ id: p.id, name: p.name, score: room.scores[p.id]||0 }))
      .sort((a,b) => b.score-a.score);
    io.to(room.code).emit('gameEnded', { scores });
  });

  socket.on('restartGame', () => {
    const room = rooms.get(socket.data.room);
    if (!room || room.host !== socket.id) return;
    clearTimer(room);
    room.word = ''; room.wordHistory = []; room.currentPlayerIndex = 0;
    room.round = 1; room.status = 'playing'; room.pendingChallenge = null;
    room.players.forEach(p => room.scores[p.id] = 0);
    io.to(room.code).emit('gameStarted', { ...roomPublicData(room), host: room.host });
    startTimer(room);
  });

  socket.on('leaveRoom', () => cleanup(socket));
  socket.on('disconnect', () => cleanup(socket));

  function cleanup(s) {
    const code = s.data.room; if (!code) return;
    const room = rooms.get(code); if (!room) return;
    room.players = room.players.filter(p => p.id !== s.id);
    delete room.scores[s.id];
    s.leave(code); s.data.room = null;
    if (room.players.length === 0) { clearTimer(room); rooms.delete(code); }
    else {
      if (room.host === s.id) room.host = room.players[0].id;
      if (room.currentPlayerIndex >= room.players.length) room.currentPlayerIndex = 0;
      io.to(code).emit('roomUpdated', roomPublicData(room));
    }
    broadcastRoomsList();
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Las Palabras del Pibe de Oro · http://localhost:${PORT}`));
