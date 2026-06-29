# ⚽ Las Palabras del Pibe de Oro

Jeu de lettres multijoueur en ligne — 5 joueurs, mots espagnols, système de salons.

---

## 🚀 Étapes pour lancer en local (VS Code)

### 1. Prérequis
- [Node.js](https://nodejs.org) installé (v18+ recommandé)
- [VS Code](https://code.visualstudio.com) installé

### 2. Ouvrir le projet dans VS Code
```
File → Open Folder → choisir le dossier palabras-del-pibe
```

### 3. Ouvrir le terminal dans VS Code
```
Terminal → New Terminal   (ou  Ctrl+` )
```

### 4. Installer les dépendances
```bash
npm install
```

### 5. Lancer le serveur en développement
```bash
npm run dev
```
Tu verras : `🚀 Palabras del Pibe de Oro · http://localhost:3000`

### 6. Jouer
Ouvre **http://localhost:3000** dans ton navigateur.
Pour jouer à plusieurs en local, ouvre plusieurs onglets.

---

## 🌐 Mettre en ligne gratuitement (Railway)

### Option A : Railway (le plus simple, gratuit)

1. Crée un compte sur https://railway.app
2. Clique **"New Project" → "Deploy from GitHub repo"**
3. Pousse ton code sur GitHub d'abord :
```bash
git init
git add .
git commit -m "first commit"
git branch -M main
git remote add origin https://github.com/TON_USER/palabras-del-pibe.git
git push -u origin main
```
4. Dans Railway : sélectionne ton repo → Railway détecte Node.js automatiquement
5. Va dans **Settings → Networking → Generate Domain**
6. Ton jeu est en ligne ! Partage le lien à tes amis.

### Option B : Render (gratuit aussi)

1. Crée un compte sur https://render.com
2. **New → Web Service → Connect your GitHub repo**
3. Paramètres :
   - **Build Command** : `npm install`
   - **Start Command** : `npm start`
   - **Plan** : Free
4. Clique **Create Web Service**
5. Après le build (~2 min), ton URL est disponible.

### Option C : VPS / Serveur perso

```bash
# Sur le serveur :
git clone https://github.com/TON_USER/palabras-del-pibe.git
cd palabras-del-pibe
npm install
npm start

# Pour garder le serveur actif avec PM2 :
npm install -g pm2
pm2 start server/server.js --name palabras
pm2 save
pm2 startup
```

---

## 📁 Structure du projet

```
palabras-del-pibe/
├── public/
│   └── index.html       ← Interface complète (HTML + CSS + JS client)
├── server/
│   └── server.js        ← Serveur Node.js + Socket.io
├── package.json
└── README.md
```

---

## 🎮 Règles du jeu

- 5 joueurs (minimum 2) dans un salon
- Chaque joueur ajoute **une lettre** à tour de rôle
- Quand le mot fait **5+ lettres et est valide en espagnol**, celui qui a posé la dernière lettre **perd la manche → 0 point**
- Les autres joueurs gagnent **autant de points que le nombre de lettres** du mot
- Partie en **5 manches** — le plus haut score gagne le Ballon d'Or 🏆

---

## 🛠 Extensions possibles

- [ ] Minuterie par tour (ex. 15 secondes)
- [ ] Dictionnaire espagnol complet (fichier .txt chargé au démarrage)
- [ ] Chat entre joueurs dans le salon
- [ ] Niveaux de difficulté (4 / 5 / 6 lettres minimum)
- [ ] Scores persistants avec une base de données (SQLite ou PostgreSQL)
