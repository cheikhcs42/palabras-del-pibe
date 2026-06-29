const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

app.use(express.static(path.join(__dirname, '../public')));

// ── WORD LIST (espagnol) ──────────────────────────────────────────────────────
const VALID_WORDS = new Set([
  'caballo','camino','ciudad','puerta','tiempo','fuerte','tierra','grande','blanco','negro',
  'llegar','pensar','querer','traer','volver','tomar','poner','abrir','salir','venir',
  'partido','jugador','pelota','estadio','goleador','defensa','portero','delantero',
  'corazon','familia','trabajo','dinero','amigos','escuela','cocina','jardin',
  'medico','musica','teatro','lengua','idioma','numero','nombre','orden','papel',
  'padre','madre','noche','tarde','plaza','calle','campo','monte','playa',
  'libro','carta','banco','bolsa','cesta','mesa','silla','puerta','ventana','techo',
  'flores','plumas','barcos','trenes','avion','vuelo','viaje','hotel','plazas',
  'cinco','cuatro','nueve','siete','ocho','veinte','ciento','miles','meses',
  'bonito','rapido','lento','bueno','nuevo','viejo','joven','sabio',
  'abuela','abuelo','animal','arboles','camisa','zapato','tienda','mercado',
  'pueblo','lago','bosque','cielo','luna','nube','lluvia','viento',
  'comer','beber','dormir','correr','nadar','jugar','bailar','cantar','reir','llorar',
  'hermano','hermana','primo','tio','sobrino','nieto',
  'lunes','martes','miercoles','jueves','viernes','sabado','domingo',
  'enero','febrero','marzo','abril','mayo','junio','julio','agosto','octubre','noviembre','diciembre',
  'agua','fuego','hueso','miedo','sueno','vuelta','mundo','mujer','hombre',
  'verde','azul','rojo','naranja','morado','marron','rosa','gris','dorado','plateado',
  'perro','gato','pato','lobo','oso','toro','leon','tigre','tigra','aguila',
  'arbol','flores','prado','selva','desierto','oceano','montana',
  'cuento','novela','poema','carta','libro','diario','revista','pagina',
  'cocina','comida','bebida','cena','desayuno','almuerzo',
  'zapato','pantalon','camisa','vestido','abrigo','sombrero','bufanda','guante',
  'carro','moto','tren','barco','avion','bicicleta',
  'escuela','colegio','universidad','maestro','alumno','clase','examen','tarea',
  'computadora','telefono','pantalla','teclado','raton','impresora',
  'hospital','doctor','enfermera','medicina','pastilla','operacion',
  'teatro','cine','museo','galeria','concierto','festival','mercado','feria',
  'futbol','tenis','beisbol','basquetbol','natacion','atletismo','ciclismo',
  'maradona','messi','ronaldo','neymar','mbappe','striker','corner','penal',
  'ganas','fuerza','rapido','energia','poder','destreza',
  'campo','cancha','porteria','balon','uniforme','arbitro','silbato',
  'pase','chute','remate','driblar','marcar','ganar','perder','empatar',
]);

function isValidWord(word) {
  return word.length >= 5 && VALID_WORDS.has(word.toLowerCase());
}

// ── ROOMS ─────────────────────────────────────────────────────────────────────
const rooms = new Map(); // code → Room

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do { code = Array.from({length: 4}, () => chars[Math.floor(Math.random() * chars.length)]).join(''); }
  while (rooms.has(code));
  return code;
}

function createRoom(code) {
  const room = {
    code,
    players: [],         // [{id, name}]
    host: null,
    status: 'waiting',   // waiting | playing | roundEnd
    word: '',
    currentPlayerIndex: 0,
    round: 1,
    totalRounds: 5,
    scores: {},          // id → score
  };
  rooms.set(code, room);
  return room;
}

function roomPublicData(room) {
  return {
    code: room.code,
    players: room.players,
    host: room.host,
    status: room.status,
    word: room.word,
    currentPlayerIndex: room.currentPlayerIndex,
    round: room.round,
    totalRounds: room.totalRounds,
    scores: room.players.map(p => ({ id: p.id, name: p.name, score: room.scores[p.id] || 0 })),
  };
}

function broadcastRoomsList() {
  const list = Array.from(rooms.values())
    .filter(r => r.status === 'waiting' && r.players.length < 5)
    .map(r => ({ code: r.code, players: r.players.length, maxPlayers: 5, status: 'En attente' }));
  io.emit('roomsList', list);
}

// ── SOCKET HANDLERS ───────────────────────────────────────────────────────────
io.on('connection', (socket) => {
  console.log(`[+] ${socket.id} connected`);
  broadcastRoomsList();

  // ── joinRoom ──
  socket.on('joinRoom', ({ name, code }) => {
    if (!name || name.trim().length < 1) return socket.emit('error', { message: 'Nom invalide.' });

    let room;
    if (code) {
      room = rooms.get(code.toUpperCase());
      if (!room) return socket.emit('error', { message: 'Salon introuvable.' });
      if (room.status === 'playing') return socket.emit('error', { message: 'Partie en cours.' });
      if (room.players.length >= 5) return socket.emit('error', { message: 'Salon plein.' });
    } else {
      const newCode = generateCode();
      room = createRoom(newCode);
    }

    room.players.push({ id: socket.id, name: name.trim() });
    room.scores[socket.id] = 0;
    if (!room.host) room.host = socket.id;
    socket.join(room.code);
    socket.data.room = room.code;

    socket.emit('roomJoined', { room: roomPublicData(room), code: room.code });
    io.to(room.code).emit('roomUpdated', roomPublicData(room));
    broadcastRoomsList();
    console.log(`[room:${room.code}] ${name} joined (${room.players.length}/5)`);
  });

  // ── startGame ──
  socket.on('startGame', () => {
    const room = rooms.get(socket.data.room);
    if (!room || room.host !== socket.id) return;
    if (room.players.length < 2) return socket.emit('error', { message: 'Pas assez de joueurs.' });

    room.status = 'playing';
    room.word = '';
    room.currentPlayerIndex = 0;
    room.round = 1;
    room.players.forEach(p => room.scores[p.id] = 0);

    const state = { ...roomPublicData(room), host: room.host };
    io.to(room.code).emit('gameStarted', state);
    broadcastRoomsList();
    console.log(`[room:${room.code}] Game started`);
  });

  // ── playLetter ──
  socket.on('playLetter', ({ letter }) => {
    const room = rooms.get(socket.data.room);
    if (!room || room.status !== 'playing') return;
    const cur = room.players[room.currentPlayerIndex];
    if (!cur || cur.id !== socket.id) return socket.emit('error', { message: "Ce n'est pas ton tour !" });
    if (!letter || !/^[A-ZÑÁÉÍÓÚÜ]$/i.test(letter)) return socket.emit('error', { message: 'Lettre invalide.' });

    room.word += letter.toUpperCase();
    const word = room.word;

    io.to(room.code).emit('letterPlayed', { playerName: cur.name, letter: letter.toUpperCase(), word });
    io.to(room.code).emit('gameUpdated', { ...roomPublicData(room), host: room.host });

    if (isValidWord(word)) {
      // current player loses
      endRound(room, socket.id);
    } else {
      room.currentPlayerIndex = (room.currentPlayerIndex + 1) % room.players.length;
      io.to(room.code).emit('gameUpdated', { ...roomPublicData(room), host: room.host });
    }
  });

  function endRound(room, loserId) {
    const loser = room.players.find(p => p.id === loserId);
    room.players.forEach(p => {
      if (p.id !== loserId) room.scores[p.id] = (room.scores[p.id] || 0) + room.word.length;
    });
    room.status = 'roundEnd';

    const scores = room.players.map(p => ({ id: p.id, name: p.name, score: room.scores[p.id] || 0 }))
      .sort((a, b) => b.score - a.score);

    io.to(room.code).emit('roundEnded', {
      loser: { id: loserId, name: loser?.name },
      word: room.word,
      scores,
      round: room.round,
      totalRounds: room.totalRounds,
    });
    console.log(`[room:${room.code}] Round ${room.round} ended. Loser: ${loser?.name}, word: ${room.word}`);
  }

  // ── nextRound ──
  socket.on('nextRound', () => {
    const room = rooms.get(socket.data.room);
    if (!room || room.host !== socket.id || room.status !== 'roundEnd') return;
    if (room.round >= room.totalRounds) return;

    room.round++;
    room.word = '';
    room.status = 'playing';
    // loser starts next round — find last loser from scores (lowest)
    const scoresArr = room.players.map(p => ({ id: p.id, score: room.scores[p.id] || 0 }));
    const minScore = Math.min(...scoresArr.map(s => s.score));
    const loserPlayer = scoresArr.find(s => s.score === minScore);
    const loserIndex = room.players.findIndex(p => p.id === loserPlayer?.id);
    room.currentPlayerIndex = loserIndex >= 0 ? loserIndex : 0;

    io.to(room.code).emit('gameStarted', { ...roomPublicData(room), host: room.host });
    io.to(room.code).emit('gameUpdated', { ...roomPublicData(room), host: room.host });
  });

  // ── requestGameEnd / restartGame ──
  socket.on('requestGameEnd', () => {
    const room = rooms.get(socket.data.room);
    if (!room) return;
    const scores = room.players.map(p => ({ id: p.id, name: p.name, score: room.scores[p.id] || 0 }))
      .sort((a, b) => b.score - a.score);
    io.to(room.code).emit('gameEnded', { scores });
  });

  socket.on('restartGame', () => {
    const room = rooms.get(socket.data.room);
    if (!room || room.host !== socket.id) return;
    room.word = '';
    room.currentPlayerIndex = 0;
    room.round = 1;
    room.status = 'playing';
    room.players.forEach(p => room.scores[p.id] = 0);
    io.to(room.code).emit('gameStarted', { ...roomPublicData(room), host: room.host });
  });

  // ── leaveRoom ──
  socket.on('leaveRoom', () => cleanupSocket(socket));
  socket.on('disconnect', () => {
    console.log(`[-] ${socket.id} disconnected`);
    cleanupSocket(socket);
  });

  function cleanupSocket(socket) {
    const code = socket.data.room;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;
    room.players = room.players.filter(p => p.id !== socket.id);
    delete room.scores[socket.id];
    socket.leave(code);
    socket.data.room = null;

    if (room.players.length === 0) {
      rooms.delete(code);
      console.log(`[room:${code}] Deleted (empty)`);
    } else {
      if (room.host === socket.id) room.host = room.players[0].id;
      if (room.currentPlayerIndex >= room.players.length) room.currentPlayerIndex = 0;
      io.to(code).emit('roomUpdated', roomPublicData(room));
    }
    broadcastRoomsList();
  }
});

// ── START ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`🚀 Palabras del Pibe de Oro · http://localhost:${PORT}`));
