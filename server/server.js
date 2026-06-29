const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');
const https   = require('https');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

app.use(express.static(path.join(__dirname, '../public')));

// ── CACHE DICTIONNAIRE ────────────────────────────────────────────────────────
const wordCache = new Map();

// Suffixes verbaux français courants → mot probablement un verbe
const VERB_SUFFIXES = [
  'er','ir','re','oir',
  'ons','ez','ent','ais','ait','ions','iez','aient',
  'erai','eras','era','erons','erez','eront',
  'irais','irait','irions','iriez','iraient',
  'ant','ants','ante','antes',
];

function looksLikeVerb(word) {
  const w = word.toLowerCase();
  // Infinitifs classiques
  if (/^[a-zàâäéèêëîïôùûüÿçæœ]{3,}(er|ir|re|oir)$/.test(w)) return true;
  // Formes conjuguées communes
  if (/^[a-zàâäéèêëîïôùûüÿçæœ]{3,}(ons|ez|ent|ais|ait|ions|iez|aient|erai|eras|era|erons|erez|eront|irais|irait|ant)$/.test(w)) return true;
  return false;
}

async function checkWord(word) {
  const w = word.toLowerCase().trim();
  if (w.length < 5) return { valid: false, reason: 'trop_court' };
  if (looksLikeVerb(w)) return { valid: false, reason: 'verbe' };
  if (wordCache.has(w)) return wordCache.get(w);

  return new Promise((resolve) => {
    // On essaie le dictionnaire fr via une API publique
    const req = https.get(
      `https://api.dictionaryapi.dev/api/v2/entries/fr/${encodeURIComponent(w)}`,
      { timeout: 4000 },
      (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          if (res.statusCode === 200) {
            const result = { valid: true, reason: 'ok' };
            wordCache.set(w, result);
            resolve(result);
          } else {
            // Fallback liste locale
            const local = FALLBACK_FR.has(w);
            const result = local ? { valid: true, reason: 'ok' } : { valid: false, reason: 'inconnu' };
            wordCache.set(w, result);
            resolve(result);
          }
        });
      }
    );
    req.on('error', () => {
      const local = FALLBACK_FR.has(w);
      resolve(local ? { valid: true, reason: 'ok' } : { valid: false, reason: 'inconnu' });
    });
    req.on('timeout', () => {
      req.destroy();
      const local = FALLBACK_FR.has(w);
      resolve(local ? { valid: true, reason: 'ok' } : { valid: false, reason: 'inconnu' });
    });
  });
}

// Liste de secours noms/adjectifs français uniquement
const FALLBACK_FR = new Set([
  'maison','voiture','jardin','table','chaise','porte','fenetre','route','fleur','arbre',
  'soleil','nuage','pluie','neige','terre','pierre','riviere','montagne','foret','ocean',
  'cheval','chien','chat','oiseau','poisson','lapin','tigre','lion','elephant','girafe',
  'pain','beurre','fromage','pomme','poire','orange','banane','raisin','tomate','salade',
  'rouge','bleu','vert','blanc','noir','jaune','violet','rose','gris','dorado',
  'lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche',
  'grand','petit','gros','mince','beau','vieux','jeune','fort','faible','rapide','lent',
  'mairie','ecole','hopital','marche','cinema','musee','eglise','gare','metro',
  'football','tennis','basket','natation','cyclisme','rugby','volleyball','boxeur',
  'france','paris','lyon','marseille','bordeaux','toulouse','nantes','strasbourg','lille','nice',
  'frere','soeur','parent','enfant','cousin','oncle','tante','neveu','niece',
  'livre','cahier','crayon','stylo','gomme','regle','cartable','tableau','classe','eleve',
  'medecin','pharmacie','maladie','sante','corps','tete','bras','jambe','ventre','coeur',
  'telephone','ordinateur','television','radio','journal','musique','photo',
  'argent','banque','travail','bureau','magasin','commerce','produit',
  'amour','amitie','bonheur','tristesse','joie','colere','peur','espoir','reve',
  'monde','pays','ville','village','quartier','place','pont','chemin',
  'bateau','train','camion','moto','velo','tracteur','avion','fusee',
  'cuisine','chambre','salon','couloir','cave','grenier','garage','balcon',
  'printemps','automne','hiver','saison','matin','soir','minuit','aurore',
  'football','ballon','stade','gardien','attaque','defense','arbitre','carton',
  'maradona','messi','ronaldo','neymar','mbappe',
  'palais','chateau','moulin','abbaye','temple','mosquee','statue','fontaine',
  'desert','jungle','savane','prairie','marais','volcan','glacier','falaise',
  'diamant','rubis','emeraude','saphir','perle','cristal','marbre','granit',
  'pirate','chevalier','dragon','sorcier','geant','nain','elfe','viking',
  'atlas','globe','carte','boussole','telescope','microscope','pendule',
  'guitare','piano','violon','trompette','tambour','flute','harpe','orgue',
  'pizza','sushi','burger','tacos','crepe','gateau','tarte','souffle','mousse',
  'lion','tigre','jaguar','puma','guepard','leopard','ocelot','lynx',
  'requin','dauphin','baleine','pieuvre','meduse','corail','crevette','homard',
  'cactus','bambou','palmier','sapin','chene','erable','bouleau','tilleul',
  'tulipe','orchidee','jasmin','lavande','pivoine','dahlia','coquelicot',
  'espace','galaxie','planete','comete','asteroid','satellite','nebuleuse',
  'magie','mystere','legende','tresor','secret','enigme','labyrinthe',
]);

// ── ROOMS ─────────────────────────────────────────────────────────────────────
const rooms = new Map();
const TURN_DURATION = 10; // secondes

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do { code = Array.from({length:4}, () => chars[Math.floor(Math.random()*chars.length)]).join(''); }
  while (rooms.has(code));
  return code;
}

function createRoom(code) {
  return {
    code, players: [], host: null,
    status: 'waiting',
    word: '',
    wordHistory: [], // [{letter, playerId, playerName}]
    currentPlayerIndex: 0,
    round: 1, totalRounds: 5,
    scores: {},
    timer: null, timeLeft: TURN_DURATION,
    challenged: false, challengerId: null, challengedPlayerId: null,
  };
}

function roomPublicData(room) {
  return {
    code: room.code, players: room.players, host: room.host,
    status: room.status, word: room.word,
    currentPlayerIndex: room.currentPlayerIndex,
    round: room.round, totalRounds: room.totalRounds,
    scores: room.players.map(p => ({ id: p.id, name: p.name, score: room.scores[p.id]||0 })),
    challenged: room.challenged, challengerId: room.challengerId,
    wordHistory: room.wordHistory,
  };
}

function broadcastRoomsList() {
  const list = Array.from(rooms.values())
    .filter(r => r.status==='waiting' && r.players.length < 5)
    .map(r => ({ code: r.code, players: r.players.length, maxPlayers: 5 }));
  io.emit('roomsList', list);
}

// ── TIMER ─────────────────────────────────────────────────────────────────────
function clearTimer(room) {
  if (room.timer) { clearInterval(room.timer); room.timer = null; }
}

function startTimer(room) {
  clearTimer(room);
  room.timeLeft = TURN_DURATION;
  io.to(room.code).emit('timerTick', { timeLeft: room.timeLeft });

  room.timer = setInterval(() => {
    room.timeLeft--;
    io.to(room.code).emit('timerTick', { timeLeft: room.timeLeft });

    if (room.timeLeft <= 0) {
      clearTimer(room);
      // Le joueur actuel perd son tour → il perd la manche
      const cur = room.players[room.currentPlayerIndex];
      if (cur) {
        io.to(room.code).emit('timerOut', { playerName: cur.name });
        endRound(room, cur.id, `⏱ ${cur.name} n'a pas joué à temps !`);
      }
    }
  }, 1000);
}

// ── ROUND END ─────────────────────────────────────────────────────────────────
function endRound(room, loserId, reason) {
  clearTimer(room);
  const loser = room.players.find(p => p.id === loserId);
  room.players.forEach(p => {
    if (p.id !== loserId) room.scores[p.id] = (room.scores[p.id]||0) + Math.max(room.word.length, 1);
  });
  room.status = 'roundEnd';
  room.challenged = false;

  const scores = room.players
    .map(p => ({ id: p.id, name: p.name, score: room.scores[p.id]||0 }))
    .sort((a,b) => b.score - a.score);

  io.to(room.code).emit('roundEnded', {
    loser: { id: loserId, name: loser?.name },
    word: room.word || '(vide)',
    reason: reason || '',
    scores,
    round: room.round, totalRounds: room.totalRounds,
  });
}

// ── SOCKET HANDLERS ───────────────────────────────────────────────────────────
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
      const nc = generateCode();
      room = createRoom(nc);
      rooms.set(nc, room);
    }
    room.players.push({ id: socket.id, name: name.trim() });
    room.scores[socket.id] = 0;
    if (!room.host) room.host = socket.id;
    socket.join(room.code);
    socket.data.room = room.code;
    socket.emit('roomJoined', { room: roomPublicData(room), code: room.code });
    io.to(room.code).emit('roomUpdated', roomPublicData(room));
    broadcastRoomsList();
  });

  socket.on('startGame', () => {
    const room = rooms.get(socket.data.room);
    if (!room || room.host !== socket.id) return;
    if (room.players.length < 2) return socket.emit('error', { message: 'Pas assez de joueurs.' });
    room.status = 'playing';
    room.word = ''; room.wordHistory = [];
    room.currentPlayerIndex = 0; room.round = 1;
    room.challenged = false;
    room.players.forEach(p => room.scores[p.id] = 0);
    io.to(room.code).emit('gameStarted', { ...roomPublicData(room), host: room.host });
    broadcastRoomsList();
    startTimer(room);
  });

  socket.on('playLetter', ({ letter }) => {
    const room = rooms.get(socket.data.room);
    if (!room || room.status !== 'playing' || room.challenged) return;
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
    room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length;
    io.to(room.code).emit('gameUpdated', { ...roomPublicData(room), host: room.host });
    startTimer(room);
  });

  // ── CHALLENGE ──
  socket.on('challenge', async () => {
    const room = rooms.get(socket.data.room);
    if (!room || room.status !== 'playing' || room.challenged) return;
    if (room.wordHistory.length === 0) return socket.emit('error', { message: 'Rien à challenger.' });
    const lastPlay = room.wordHistory[room.wordHistory.length - 1];
    if (lastPlay.playerId === socket.id) return socket.emit('error', { message: 'Tu ne peux pas te challenger.' });

    clearTimer(room);
    room.challenged = true;
    room.challengerId = socket.id;
    room.challengedPlayerId = lastPlay.playerId;

    const challenger = room.players.find(p => p.id === socket.id);
    const challenged = room.players.find(p => p.id === lastPlay.playerId);

    io.to(room.code).emit('challengeStarted', {
      challengerName: challenger?.name,
      challengedName: challenged?.name,
      word: room.word,
    });

    const result = await checkWord(room.word);
    console.log(`[${room.code}] Challenge "${room.word}" → valid:${result.valid} reason:${result.reason}`);

    let loserName, loserId, reason;

    if (result.reason === 'verbe') {
      // Mot est un verbe → celui qui a posé la dernière lettre perd
      loserId = lastPlay.playerId;
      loserName = challenged?.name;
      reason = `"${room.word}" est un verbe, c'est interdit ! ${loserName} perd la manche.`;
    } else if (result.valid) {
      // Mot valide → challengeur perd
      loserId = socket.id;
      loserName = challenger?.name;
      reason = `"${room.word}" existe bien en français ! ${loserName} (challengeur) perd la manche.`;
    } else {
      // Mot inexistant → challengé perd
      loserId = lastPlay.playerId;
      loserName = challenged?.name;
      reason = `"${room.word}" n'existe pas en français ! ${loserName} perd la manche.`;
    }

    io.to(room.code).emit('challengeResult', {
      word: room.word, valid: result.valid, reason,
      loserName, winnerName: loserId === socket.id ? challenged?.name : challenger?.name,
    });

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
    const min = Math.min(...room.players.map(p => room.scores[p.id]||0));
    const loserIdx = room.players.findIndex(p => (room.scores[p.id]||0) === min);
    room.currentPlayerIndex = loserIdx >= 0 ? loserIdx : 0;
    io.to(room.code).emit('gameStarted', { ...roomPublicData(room), host: room.host });
    io.to(room.code).emit('gameUpdated', { ...roomPublicData(room), host: room.host });
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
    room.word = ''; room.wordHistory = [];
    room.currentPlayerIndex = 0; room.round = 1;
    room.status = 'playing'; room.challenged = false;
    room.players.forEach(p => room.scores[p.id] = 0);
    io.to(room.code).emit('gameStarted', { ...roomPublicData(room), host: room.host });
    startTimer(room);
  });

  socket.on('leaveRoom', () => cleanup(socket));
  socket.on('disconnect', () => cleanup(socket));

  function cleanup(socket) {
    const code = socket.data.room;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;
    room.players = room.players.filter(p => p.id !== socket.id);
    delete room.scores[socket.id];
    socket.leave(code);
    socket.data.room = null;
    if (room.players.length === 0) {
      clearTimer(room);
      rooms.delete(code);
    } else {
      if (room.host === socket.id) room.host = room.players[0].id;
      if (room.currentPlayerIndex >= room.players.length) room.currentPlayerIndex = 0;
      io.to(code).emit('roomUpdated', roomPublicData(room));
    }
    broadcastRoomsList();
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Las Palabras del Pibe de Oro · http://localhost:${PORT}`));