const express = require('express');
const http    = require('http');
const https   = require('https');
const { Server } = require('socket.io');
const path    = require('path');
const fs      = require('fs');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

app.use(express.static(path.join(__dirname, '../public')));

// ── DICTIONNAIRE FRANÇAIS COMPLET ─────────────────────────────────────────────
let DICT_FR = new Set();

function norm(w) { return w.toLowerCase().normalize('NFC').trim(); }

function loadDict() {
  const p = path.join(__dirname, 'french_words.txt');
  if (fs.existsSync(p)) {
    const lines = fs.readFileSync(p, 'utf8').split('\n');
    DICT_FR = new Set(lines.map(norm).filter(l => l.length >= 2));
    console.log(`📚 Dictionnaire : ${DICT_FR.size} mots`);
  } else {
    console.log('📥 Téléchargement dictionnaire...');
    const file = fs.createWriteStream(p);
    https.get('https://raw.githubusercontent.com/hbenbel/French-Dictionary/master/dictionary/dictionary.txt', res => {
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        const lines = fs.readFileSync(p, 'utf8').split('\n');
        DICT_FR = new Set(lines.map(norm).filter(l => l.length >= 2));
        console.log(`📚 Dictionnaire téléchargé : ${DICT_FR.size} mots`);
      });
    }).on('error', () => { fs.unlink(p, ()=>{}); DICT_FR = FALLBACK; console.log('⚠ Fallback dict'); });
  }
}

// Liste de secours si le téléchargement échoue
const FALLBACK = new Set([
  'maison','voiture','jardin','table','chaise','porte','fenetre','route','fleur','arbre',
  'soleil','nuage','pluie','neige','terre','pierre','riviere','montagne','foret','ocean',
  'cheval','chien','chat','oiseau','poisson','lapin','tigre','lion','elephant','girafe',
  'marge','image','plage','stage','usage','dogmatique','systematique','automatique',
  'probleme','exemple','nombre','lettre','phrase','texte','roman','poeme','chanson',
  'grand','petit','gros','mince','beau','vieux','jeune','fort','faible','rapide',
  'rouge','bleu','vert','blanc','noir','jaune','violet','rose','gris','beige',
  'lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche',
  'monde','pays','ville','village','quartier','place','pont','chemin',
  'musique','peinture','theatre','cinema','danse','opera','ballet',
  'piano','guitare','violon','trompette','tambour','flute','harpe',
  'pizza','sushi','burger','gateau','tarte','crepe','mousse','brioche',
  'football','tennis','basket','natation','cyclisme','rugby','volleyball',
  'ballon','stade','arbitre','gardien','attaque','defense','carton','trophee',
  'amour','amitie','bonheur','tristesse','joie','colere','peur','espoir',
  'medecin','hopital','pharmacie','maladie','sante','chirurgie','traitement',
  'ecole','classe','eleve','professeur','lycee','universite','diplome',
  'telephone','ordinateur','television','internet','clavier','souris','ecran',
  'argent','banque','travail','bureau','magasin','commerce','marche',
  'maradona','messi','ronaldo','neymar','mbappe',
]);

loadDict();

function looksLikeVerb(word) {
  const w = word.toLowerCase();
  if (/^[a-zàâäéèêëîïôùûüÿçæœ]{3,}(er|ir|re|oir)$/.test(w)) return true;
  if (/^[a-zàâäéèêëîïôùûüÿçæœ]{3,}(ons|ez|ent|ais|ait|ions|iez|aient|erai|eras|era|erons|erez|eront|irais|irait|ant)$/.test(w)) return true;
  return false;
}

function checkWord(word) {
  const w = norm(word);
  if (w.length < 5) return { valid: false, reason: 'trop_court' };
  if (looksLikeVerb(w)) return { valid: false, reason: 'verbe' };
  const valid = DICT_FR.has(w);
  return { valid, reason: valid ? 'ok' : 'inconnu' };
}

// ── ROOMS ─────────────────────────────────────────────────────────────────────
const rooms = new Map();
const TURN_DURATION = 15;

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do { code = Array.from({length:4}, () => chars[Math.floor(Math.random()*chars.length)]).join(''); }
  while (rooms.has(code));
  return code;
}

function createRoom(code) {
  return { code, players: [], host: null, status: 'waiting', word: '', wordHistory: [],
    currentPlayerIndex: 0, round: 1, totalRounds: 5, scores: {},
    timer: null, timeLeft: TURN_DURATION, challenged: false, challengerId: null, challengedPlayerId: null };
}

function roomPublicData(room) {
  return {
    code: room.code, players: room.players, host: room.host, status: room.status,
    word: room.word, currentPlayerIndex: room.currentPlayerIndex,
    round: room.round, totalRounds: room.totalRounds, wordHistory: room.wordHistory,
    scores: room.players.map(p => ({ id: p.id, name: p.name, score: room.scores[p.id]||0 })),
    challenged: room.challenged, challengerId: room.challengerId,
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
      if (cur) { io.to(room.code).emit('timerOut', { playerName: cur.name }); endRound(room, cur.id, `⏱ ${cur.name} n'a pas joué à temps !`); }
    }
  }, 1000);
}

function endRound(room, loserId, reason) {
  clearTimer(room);
  const loser = room.players.find(p => p.id === loserId);
  room.players.forEach(p => { if (p.id !== loserId) room.scores[p.id] = (room.scores[p.id]||0) + Math.max(room.word.length, 1); });
  room.status = 'roundEnd'; room.challenged = false;
  const scores = room.players.map(p => ({ id: p.id, name: p.name, score: room.scores[p.id]||0 })).sort((a,b) => b.score-a.score);
  io.to(room.code).emit('roundEnded', { loser: { id: loserId, name: loser?.name }, word: room.word||'(vide)', reason: reason||'', scores, round: room.round, totalRounds: room.totalRounds });
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
    room.currentPlayerIndex = 0; room.round = 1; room.challenged = false;
    room.players.forEach(p => room.scores[p.id] = 0);
    io.to(room.code).emit('gameStarted', { ...roomPublicData(room), host: room.host });
    broadcastRoomsList(); startTimer(room);
  });

  socket.on('playLetter', ({ letter }) => {
    const room = rooms.get(socket.data.room);
    if (!room || room.status !== 'playing' || room.challenged) return;
    const cur = room.players[room.currentPlayerIndex];
    if (!cur || cur.id !== socket.id) return socket.emit('error', { message: "Pas ton tour !" });
    if (!letter || !/^[A-ZÀÂÄÉÈÊËÎÏÔÙÛÜŸÇÆŒa-zàâäéèêëîïôùûüÿçæœ]$/i.test(letter)) return socket.emit('error', { message: 'Lettre invalide.' });
    clearTimer(room);
    const l = letter.toUpperCase();
    room.word += l; room.wordHistory.push({ letter: l, playerId: socket.id, playerName: cur.name });
    io.to(room.code).emit('letterPlayed', { playerName: cur.name, letter: l, word: room.word });
    room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length;
    io.to(room.code).emit('gameUpdated', { ...roomPublicData(room), host: room.host });
    startTimer(room);
  });

  // ── TERMINER VOLONTAIREMENT ──
  socket.on('finishWord', ({ letter }) => {
    const room = rooms.get(socket.data.room);
    if (!room || room.status !== 'playing' || room.challenged) return;
    const cur = room.players[room.currentPlayerIndex];
    if (!cur || cur.id !== socket.id) return socket.emit('error', { message: "Pas ton tour !" });
    if (!letter || !/^[A-Za-z\u00c0-\u024f]/i.test(letter)) return socket.emit('error', { message: 'Lettre invalide.' });
    clearTimer(room);
    const l = letter.toUpperCase();
    room.word += l;
    room.wordHistory.push({ letter: l, playerId: socket.id, playerName: cur.name });
    io.to(room.code).emit('letterPlayed', { playerName: cur.name, letter: l, word: room.word });
    // Le joueur perd volontairement — le mot s'arrete ici
    const reason = `${cur.name} a choisi de terminer le mot sur "${room.word}" (${room.word.length} lettres).`;
    io.to(room.code).emit('voluntaryFinish', { playerName: cur.name, word: room.word });
    setTimeout(() => {
      const scores = room.players.map(p => ({ id: p.id, name: p.name, score: room.scores[p.id]||0 }));
      // Donner les points avant endRound
      room.players.forEach(p => { if (p.id !== socket.id) room.scores[p.id] = (room.scores[p.id]||0) + room.word.length; });
      room.status = 'roundEnd';
      clearTimer(room);
      const scoresSorted = room.players.map(p => ({ id: p.id, name: p.name, score: room.scores[p.id]||0 })).sort((a,b) => b.score-a.score);
      io.to(room.code).emit('roundEnded', { loser: { id: socket.id, name: cur.name }, word: room.word, reason, scores: scoresSorted, round: room.round, totalRounds: room.totalRounds, voluntary: true });
    }, 800);
  });

  socket.on('challenge', () => {
    const room = rooms.get(socket.data.room);
    if (!room || room.status !== 'playing' || room.challenged) return;
    if (!room.wordHistory.length) return socket.emit('error', { message: 'Rien à challenger.' });
    const lastPlay = room.wordHistory[room.wordHistory.length - 1];
    if (lastPlay.playerId === socket.id) return socket.emit('error', { message: 'Tu ne peux pas te challenger.' });
    clearTimer(room);
    room.challenged = true; room.challengerId = socket.id; room.challengedPlayerId = lastPlay.playerId;
    const challenger = room.players.find(p => p.id === socket.id);
    const challenged = room.players.find(p => p.id === lastPlay.playerId);
    io.to(room.code).emit('challengeStarted', { challengerName: challenger?.name, challengedName: challenged?.name, word: room.word });

    // Synchrone maintenant — plus besoin d'async !
    const result = checkWord(room.word);
    console.log(`[${room.code}] Challenge "${room.word}" → valid:${result.valid} reason:${result.reason}`);

    let loserId, reason;
    if (result.reason === 'verbe') {
      loserId = lastPlay.playerId;
      reason = `"${room.word}" est un verbe, interdit ! ${challenged?.name} perd la manche.`;
    } else if (result.valid) {
      loserId = socket.id;
      reason = `"${room.word}" existe en français ! ${challenger?.name} (challengeur) perd.`;
    } else {
      loserId = lastPlay.playerId;
      reason = `"${room.word}" n'existe pas ! ${challenged?.name} perd la manche.`;
    }
    io.to(room.code).emit('challengeResult', { word: room.word, valid: result.valid, reason, loserName: room.players.find(p=>p.id===loserId)?.name });
    setTimeout(() => endRound(room, loserId, reason), 1500);
  });

  socket.on('nextRound', () => {
    const room = rooms.get(socket.data.room);
    if (!room || room.host !== socket.id || room.status !== 'roundEnd') return;
    if (room.round >= room.totalRounds) {
      const scores = room.players.map(p => ({ id: p.id, name: p.name, score: room.scores[p.id]||0 })).sort((a,b) => b.score-a.score);
      return io.to(room.code).emit('gameEnded', { scores });
    }
    room.round++;
    room.word = ''; room.wordHistory = [];
    room.status = 'playing'; room.challenged = false;
    const minScore = Math.min(...room.players.map(p => room.scores[p.id]||0));
    const loserIdx = room.players.findIndex(p => (room.scores[p.id]||0) === minScore);
    room.currentPlayerIndex = loserIdx >= 0 ? loserIdx : 0;
    io.to(room.code).emit('gameStarted', { ...roomPublicData(room), host: room.host });
    startTimer(room);
  });

  socket.on('requestGameEnd', () => {
    const room = rooms.get(socket.data.room);
    if (!room) return;
    const scores = room.players.map(p => ({ id: p.id, name: p.name, score: room.scores[p.id]||0 })).sort((a,b) => b.score-a.score);
    io.to(room.code).emit('gameEnded', { scores });
  });

  socket.on('restartGame', () => {
    const room = rooms.get(socket.data.room);
    if (!room || room.host !== socket.id) return;
    clearTimer(room);
    room.word = ''; room.wordHistory = []; room.currentPlayerIndex = 0;
    room.round = 1; room.status = 'playing'; room.challenged = false;
    room.players.forEach(p => room.scores[p.id] = 0);
    io.to(room.code).emit('gameStarted', { ...roomPublicData(room), host: room.host });
    startTimer(room);
  });

  socket.on('leaveRoom', () => cleanup(socket));
  socket.on('disconnect', () => cleanup(socket));

  function cleanup(socket) {
    const code = socket.data.room; if (!code) return;
    const room = rooms.get(code); if (!room) return;
    room.players = room.players.filter(p => p.id !== socket.id);
    delete room.scores[socket.id];
    socket.leave(code); socket.data.room = null;
    if (room.players.length === 0) { clearTimer(room); rooms.delete(code); }
    else {
      if (room.host === socket.id) room.host = room.players[0].id;
      if (room.currentPlayerIndex >= room.players.length) room.currentPlayerIndex = 0;
      io.to(code).emit('roomUpdated', roomPublicData(room));
    }
    broadcastRoomsList();
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Las Palabras del Pibe de Oro · http://localhost:${PORT}`));
