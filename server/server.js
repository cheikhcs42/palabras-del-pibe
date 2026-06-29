const express = require('express');
const http    = require('http');
const { Server } = require('socket.io');
const path    = require('path');
const https   = require('https');

const app    = express();
const server = http.createServer(app);
const io     = new Server(server);

app.use(express.static(path.join(__dirname, '../public')));

// ── DICTIONNAIRE FRANÇAIS FIABLE ─────────────────────────────────────────────
// On utilise l'API du CNRTL (Centre National de Ressources Textuelles et Lexicales)
// + fallback sur une liste locale très large
const wordCache = new Map();

function looksLikeVerb(word) {
  const w = word.toLowerCase();
  if (/^[a-zàâäéèêëîïôùûüÿçæœ]{3,}(er|ir|re|oir)$/.test(w)) return true;
  if (/^[a-zàâäéèêëîïôùûüÿçæœ]{3,}(ons|ez|ent|ais|ait|ions|iez|aient|erai|eras|era|erons|erez|eront|irais|irait|ant)$/.test(w)) return true;
  return false;
}

// Vérification via l'API Wiktionary (beaucoup plus complète pour le français)
async function checkViaWiktionary(word) {
  return new Promise((resolve) => {
    const w = encodeURIComponent(word.toLowerCase());
    const req = https.get(
      `https://fr.wiktionary.org/api/rest_v1/page/definition/${w}`,
      { timeout: 5000 },
      (res) => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              const json = JSON.parse(data);
              // Vérifier que c'est bien un mot français (clé 'fr' présente)
              const hasFr = json.fr && json.fr.length > 0;
              resolve(hasFr);
            } catch { resolve(false); }
          } else {
            resolve(false);
          }
        });
      }
    );
    req.on('error', () => resolve(null)); // null = erreur réseau
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

async function checkWord(word) {
  const w = word.toLowerCase().trim();
  if (w.length < 5) return { valid: false, reason: 'trop_court' };
  if (looksLikeVerb(w)) return { valid: false, reason: 'verbe' };
  if (wordCache.has(w)) return wordCache.get(w);

  // 1. Vérifier d'abord dans la liste locale (rapide)
  if (DICT_FR.has(w)) {
    const r = { valid: true, reason: 'ok' };
    wordCache.set(w, r);
    return r;
  }

  // 2. Wiktionary pour les mots hors liste
  const wikt = await checkViaWiktionary(w);
  if (wikt === true) {
    const r = { valid: true, reason: 'ok' };
    wordCache.set(w, r);
    return r;
  }
  if (wikt === false) {
    const r = { valid: false, reason: 'inconnu' };
    wordCache.set(w, r);
    return r;
  }
  // wikt === null (erreur réseau) → on dit valide pour ne pas pénaliser injustement
  return { valid: true, reason: 'ok_fallback' };
}

// Dictionnaire local français étendu — noms communs et adjectifs uniquement
const DICT_FR = new Set([
  // Corps & médecine
  'corps','tete','bras','jambe','ventre','coeur','cerveau','poumon','foie','reins',
  'genou','epaule','poignet','cheville','talon','orteil','menton','tempe','nuque',
  'thorax','bassin','colonne','sternum','clavicule','tibia','fibula','radius',
  'medecin','docteur','infirmier','pharmacie','maladie','sante','hopital','clinique',
  'chirurgie','medecine','guerison','symptome','traitement','medicament','vaccin',
  'fracture','blessure','infection','fievre','grippe','allergie','douleur','plaie',
  // Famille
  'famille','parent','enfant','frere','soeur','cousin','cousine','oncle','tante',
  'neveu','niece','grand','aieul','ancetre','epoux','epouse','conjoint','fiancee',
  'jumeau','jumelle','parrain','marraine','fillleul','belle','gendre','beau',
  // Nature
  'nature','arbre','foret','montagne','riviere','fleuve','ocean','desert','savane',
  'jungle','prairie','marais','volcan','glacier','falaise','plage','dune','vallee',
  'colline','plateau','grotte','cascade','torrent','etang','lagune','delta','recif',
  'soleil','lune','etoile','nuage','pluie','neige','grele','brume','brouillard',
  'orage','tempete','cyclone','tsunami','seisme','eruption','avalanche','inondation',
  'aurore','crepuscule','zenith','horizon','atmosphere','troposphere','stratosphere',
  // Animaux
  'cheval','chien','chat','oiseau','poisson','lapin','tigre','lion','elephant','girafe',
  'jaguar','puma','guepard','leopard','ocelot','lynx','panthère','hyène','chacal',
  'requin','dauphin','baleine','pieuvre','meduse','corail','crevette','homard','moule',
  'aigle','faucon','hibou','chouette','perroquet','flamant','pelican','cigogne','grue',
  'serpent','crocodile','lezard','tortue','grenouille','crapaud','salamandre','vipere',
  // Végétaux
  'cactus','bambou','palmier','sapin','chene','erable','bouleau','tilleul','frene',
  'tulipe','orchidee','jasmin','lavande','pivoine','dahlia','coquelicot','marguerite',
  'rosier','lierre','fougere','mousse','algue','champignon','truffe','cèdre','sequoia',
  // Alimentation
  'maison','voiture','jardin','table','chaise','porte','fenetre','route','fleur',
  'pain','beurre','fromage','pomme','poire','orange','banane','raisin','tomate','salade',
  'pizza','sushi','burger','tacos','crepe','gateau','tarte','souffle','mousse','brioche',
  'croissant','baguette','macaron','eclair','madeleine','quiche','ratatouille','bouillabaisse',
  'saumon','thon','cabillaud','sardine','anchois','truite','carpe','brochet',
  'poulet','canard','dindon','lapin','agneau','veau','porc','boeuf','cerf','sanglier',
  'carotte','poireau','navet','radis','betterave','courgette','aubergine','poivron',
  'artichaut','asperge','brocoli','choufleur','epinard','endive','cresson','fenouil',
  'fraise','framboise','cerise','abricot','peche','prune','melon','pastèque','mangue',
  'ananas','kiwi','litchi','grenade','figue','datte','noix','noisette','amande','pistache',
  // Couleurs / adjectifs courants
  'rouge','bleu','vert','blanc','noir','jaune','violet','rose','gris','beige','turquoise',
  'ecarlate','cramoisi','carmin','vermeil','azur','indigo','emeraude','ocre','ivoire',
  'grand','petit','gros','mince','beau','laid','vieux','jeune','fort','faible','rapide',
  'lent','doux','dur','chaud','froid','humide','sec','lourd','leger','etroit','large',
  'profond','superficiel','ancien','moderne','simple','complexe','riche','pauvre',
  // Temps / calendrier
  'lundi','mardi','mercredi','jeudi','vendredi','samedi','dimanche',
  'janvier','fevrier','mars','avril','juin','juillet','aout','septembre','octobre','novembre','decembre',
  'heure','minute','seconde','matin','soir','nuit','midi','minuit','aurore','crepuscule',
  'printemps','automne','hiver','saison','annee','decennie','siecle','millenaire','epoque',
  // Lieux & ville
  'ville','village','quartier','banlieue','metropole','capitale','province','region',
  'place','avenue','boulevard','impasse','ruelle','chemin','sentier','autoroute',
  'mairie','eglise','cathedrale','mosquee','synagogue','temple','abbaye','monastere',
  'palais','chateau','donjon','forteresse','manoir','chalet','pavillon','immeuble',
  'gare','aeroport','port','marina','quai','jetee','embarcadere','passerelle','tunnel',
  'marche','supermarche','boutique','magasin','pharmacie','librairie','boulangerie',
  'boucherie','poissonnerie','fromagerie','patisserie','charcuterie','epicerie',
  'cinema','theatre','musee','galerie','bibliotheque','stade','gymnase','piscine',
  // Transport
  'voiture','camion','moto','velo','scooter','trottinette','autobus','tramway',
  'metro','train','avion','helicoptere','bateau','yacht','ferry','sous-marin',
  'fusee','navette','satellite','station','vaisseau','dirigeable','montgolfiere',
  // Maison / objet
  'cuisine','chambre','salon','salle','couloir','cave','grenier','garage','balcon',
  'fenetre','porte','escalier','ascenseur','toit','mur','sol','plafond','terrasse',
  'table','chaise','canape','fauteuil','bureau','armoire','commode','etagere','buffet',
  'miroir','tableau','rideau','tapis','coussin','couette','oreiller','drap','serviette',
  'telephone','ordinateur','ecran','clavier','souris','imprimante','television',
  'radio','enceinte','camera','telescope','microscope','thermometre','barometre',
  // Sport
  'football','tennis','basket','natation','cyclisme','rugby','volleyball','boxe',
  'judo','karate','aikido','escrime','tir','plongeon','aviron','kayak','surf',
  'athletisme','marathon','sprint','saut','lancer','disque','marteau','javelot',
  'equitation','polo','golf','cricket','baseball','hockey','patinage','luge','bobsleigh',
  'alpinisme','escalade','parachutisme','deltaplane','planche','snowboard','slalom',
  'ballon','terrain','arbitre','gardien','attaque','defense','carton','penalty',
  'stade','podium','medaille','trophee','champion','victoire','defaite','match',
  // Art & culture
  'musique','peinture','sculpture','dessin','gravure','photographie','cinema',
  'theatre','danse','opera','ballet','cirque','magie','poesie','roman','nouvelle',
  'conte','fable','legende','mythe','saga','epopee','chronique','reportage',
  'guitare','piano','violon','trompette','tambour','flute','harpe','orgue','accordeon',
  'symphonie','sonate','concerto','opera','cantate','fugue','valse','tango','reggae',
  // Matières & matériaux
  'pierre','marbre','granit','ardoise','calcaire','gres','basalte','obsidienne',
  'bois','chene','acajou','bambou','liege','balsa','erable','noyer','cerisier',
  'metal','acier','bronze','cuivre','argent','platine','titane','aluminium',
  'verre','cristal','plastique','caoutchouc','nylon','kevlar','carbone','silicone',
  'tissu','coton','soie','laine','lin','chanvre','velours','dentelle','satin',
  // Sciences & nature
  'physique','chimie','biologie','geologie','astronomie','mathematique','informatique',
  'atome','molecule','electron','proton','neutron','photon','quark','lepton',
  'planete','comete','asteroid','nebuleuse','galaxie','univers','cosmos','espace',
  'acide','base','oxyde','metal','cristal','polymere','enzyme','hormone','proteine',
  // Noms propres devenus noms communs ou très connus
  'maradona','messi','ronaldo','neymar','mbappe',
  // Mots courants souvent challengés
  'marge','image','plage','stage','usage','cage','page','rage','sage','nage',
  'rouge','bouge','louge','joue','douce','mousse','rousse','pousse','tousse',
  'large','farge','charge','marge','varge',
  'belle','selle','celle','telle','quelle','uelle','pelle','gelle','nelle',
  'force','torce','berce','perce','merce','terce',
  'monde','ronde','blonde','fronde','seconde','profonde','feconde',
  'place','grace','trace','efface','glace','brace','espace',
  'chose','prose','rose','dose','pose','nose','expose','impose','compose',
  'prise','crise','brise','frise','grise','cerise','surprise','entreprise',
  'table','cable','sable','fable','gable','stable','rentable','notable','portable',
  'carte','parte','marte','tarte','farte','smarte','charte','quarte',
  'porte','forte','morte','sorte','torte','norte','escorte','exhorte',
  'ville','fille','bille','gille','mille','nille','sille','grille','brille','trille',
  'livre','litre','titre','pitre','vitre','mitre','nitre','etre','etre',
  'arbre','marbre','entre','centre','ventre','contre','montre','nombre','ombre',
]);

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

  socket.on('challenge', async () => {
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
    const result = await checkWord(room.word);
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
