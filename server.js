// L'Ombre du Shogun — serveur de jeu, en local ou en ligne (aucune dépendance, Node 18+)
// Lancement : node server.js   (port par défaut 3000, ou PORT=xxxx)

'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const qrcode = require('./qrcode.js');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, 'public');
const FAST = process.env.SHOGUN_FAST === '1'; // tests : minuteurs raccourcis

// ---------------------------------------------------------------- réglages

const DUREES = FAST
  ? { cour: 2, tigre: 2, gong: 1, conseil: 2, verdict: 1 }
  : { cour: 75, tigre: 25, gong: 12, conseil: 120, verdict: 12 };

const COULEURS = ['#C9A24A', '#B8323A', '#5E8C6A', '#4F7CAC', '#9A6BB0',
  '#D9824B', '#3E9C9C', '#C76B98', '#8C8C5A', '#7A6A58'];

function reglages(n) {
  return {
    objectif: n <= 4 || n >= 8 ? 4 : 5,
    manchesMax: n >= 8 ? 12 : 15,
    chanceSansNinja: n === 4 ? 0.25 : 0.2,
    modeLames: n === 3,
  };
}

function creerSalle(code, cle) {
let derniereActivite = Date.now();
// ---------------------------------------------------------------- état

let jeu = nouveauJeu([]);

function nouveauJeu(joueurs) {
  return {
    phase: 'salle',          // salle | cour | tigre | gong | conseil | verdict | fin
    joueurs,                 // {id, jeton, nom, couleur, score, connecte, disgraceManche}
    manche: 0,
    shogunId: null,
    heritierId: null,
    heritierPrecedent: null,
    ninjaId: null,           // secret
    actions: {},             // secret : id -> {type, cible}
    votes: {},               // secret jusqu'au verdict : id -> cible
    dechuId: null,
    resultat: null,          // public après révélation
    finPhase: null,
    chronique: [],
    gagnants: [],
    config: null,
  };
}

const id6 = () => Math.random().toString(36).slice(2, 8);
const joueur = (id) => jeu.joueurs.find((j) => j.id === id);
const nom = (id) => (joueur(id) ? joueur(id).nom : '?');
const hasard = (liste) => liste[Math.floor(Math.random() * liste.length)];
const estDisgracie = (j) => j.disgraceManche === jeu.manche;
const daimyos = () => jeu.joueurs.filter((j) => j.id !== jeu.shogunId);

function chronique(texte) {
  jeu.chronique.unshift({ manche: jeu.manche, texte });
  jeu.chronique = jeu.chronique.slice(0, 30);
}

// ---------------------------------------------------------------- minuteur

let minuteur = null;
function programmer(secondes, suite, garderDebut) {
  clearTimeout(minuteur);
  if (!garderDebut) jeu.debutPhase = Date.now();
  jeu.finPhase = Date.now() + secondes * 1000;
  minuteur = setTimeout(() => { minuteur = null; suite(); diffuser(); }, secondes * 1000);
}
function annulerMinuteur() { clearTimeout(minuteur); minuteur = null; jeu.finPhase = null; jeu.debutPhase = null; }

// ---------------------------------------------------------------- déroulé

function lancerPartie() {
  const n = jeu.joueurs.length;
  if (n < 3 || n > 10) return 'Il faut entre 3 et 10 joueurs.';
  jeu.config = reglages(n);
  jeu.joueurs.forEach((j) => { j.score = 0; j.disgraceManche = 0; });
  jeu.manche = 0;
  jeu.chronique = [];
  jeu.gagnants = [];
  jeu.shogunId = hasard(jeu.joueurs).id;
  jeu.heritierPrecedent = null;
  chronique(`${nom(jeu.shogunId)} monte sur le trône.`);
  nouvelleManche();
  return null;
}

function nouvelleManche() {
  jeu.manche += 1;
  jeu.actions = {};
  jeu.votes = {};
  jeu.ninjaId = null;
  jeu.dechuId = null;
  jeu.resultat = null;
  jeu.heritierId = null;
  if (jeu.config.modeLames) return debutTigre();
  jeu.phase = 'cour';
  programmer(DUREES.cour, () => {
    if (!jeu.heritierId) choisirHeritier(hasard(heritiersPossibles()).id, true);
  });
}

function heritiersPossibles() {
  const base = daimyos().filter((j) => !estDisgracie(j));
  const sansPrecedent = base.filter((j) => j.id !== jeu.heritierPrecedent);
  return sansPrecedent.length ? sansPrecedent : base.length ? base : daimyos();
}

function choisirHeritier(id, auto) {
  jeu.heritierId = id;
  jeu.heritierPrecedent = id;
  chronique(auto ? `Le sort désigne ${nom(id)} comme Héritier.` : `${nom(jeu.shogunId)} nomme ${nom(id)} Héritier.`);
  debutTigre();
}

function debutTigre() {
  jeu.phase = 'tigre';
  jeu.actions = {};
  const cfg = jeu.config;
  if (!cfg.modeLames) {
    const shogun = joueur(jeu.shogunId);
    const balleDeMatch = shogun.score >= cfg.objectif - 1;
    const eligibles = daimyos().filter((j) => !estDisgracie(j));
    const sansNinja = !balleDeMatch && Math.random() < cfg.chanceSansNinja;
    jeu.ninjaId = eligibles.length && !sansNinja ? hasard(eligibles).id : null;
  }
  programmer(DUREES.tigre, resoudreTigre);
}

// Ce qu'un joueur peut faire pendant l'Heure du Tigre
function optionsTigre(j) {
  if (estDisgracie(j)) return { type: 'disgrace' };
  const cfg = jeu.config;
  const surveillables = jeu.joueurs
    .filter((x) => x.id !== j.id && x.id !== jeu.shogunId && !estDisgracie(x))
    .map((x) => x.id);
  if (cfg.modeLames) {
    if (j.id === jeu.shogunId) return { type: 'surveiller', cibles: surveillables };
    return { type: 'lame' };
  }
  if (j.id === jeu.ninjaId) return { type: 'ninja' };
  return { type: 'surveiller', cibles: surveillables };
}

function tousOntAgi() {
  return jeu.joueurs.every((j) => jeu.actions[j.id]);
}

function resoudreTigre() {
  annulerMinuteur();
  const cfg = jeu.config;
  const shogun = joueur(jeu.shogunId);
  const veilleurs = (cible) => jeu.joueurs.filter((j) => {
    const a = jeu.actions[j.id];
    return a && a.type === 'surveiller' && a.cible === cible;
  });

  if (cfg.modeLames) {
    const surveille = (jeu.actions[jeu.shogunId] || {}).cible || null;
    const frappeurs = daimyos().filter((j) => (jeu.actions[j.id] || {}).type === 'frapper');
    const pris = frappeurs.filter((j) => j.id === surveille);
    const reussis = frappeurs.filter((j) => j.id !== surveille);
    if (reussis.length) {
      const nouveau = reussis[0];
      jeu.resultat = { type: 'coup-lames', ancien: shogun.id, nouveau: nouveau.id, pris: pris.map((j) => j.id) };
      chronique(`${nouveau.nom} renverse ${shogun.nom} et prend le trône.`);
      jeu.shogunId = nouveau.id;
      jeu.heritierPrecedent = null;
      jeu.heritierId = null;
    } else if (pris.length) {
      shogun.score += 1;
      jeu.resultat = { type: 'pris', ninja: pris[0].id, veilleurs: [], shogunVeille: true };
      chronique(`${shogun.nom} arrête la lame de ${pris[0].nom}.`);
    } else {
      shogun.score += 1;
      jeu.resultat = { type: 'calme' };
      chronique(`Nuit calme. ${shogun.nom} règne un jour de plus.`);
    }
    return debutGong();
  }

  const ninja = joueur(jeu.ninjaId);
  const frappe = ninja && (jeu.actions[ninja.id] || {}).type === 'frapper';
  if (!frappe) {
    shogun.score += 1;
    jeu.resultat = { type: 'calme' };
    chronique(`Nuit calme. ${shogun.nom} règne un jour de plus.`);
    return debutGong();
  }
  // Le regard du Shogun suffit ; les Daimyos doivent être au moins deux sur le même joueur.
  const pris = veilleurs(ninja.id);
  const shogunVeille = pris.some((j) => j.id === shogun.id);
  const daimyosVeillent = pris.filter((j) => j.id !== shogun.id).length;
  if (shogunVeille || daimyosVeillent >= 2) {
    shogun.score += 1;
    const gagnants = pris.filter((j) => j.id !== shogun.id);
    gagnants.forEach((j) => { j.score += 1; });
    ninja.disgraceManche = jeu.manche + 1;
    jeu.resultat = { type: 'pris', ninja: ninja.id, veilleurs: gagnants.map((j) => j.id), shogunVeille };
    chronique(`La lame de ${ninja.nom} est arrêtée.`);
    return debutGong();
  }
  jeu.dechuId = shogun.id;
  jeu.resultat = { type: 'assassinat', dechu: shogun.id };
  chronique(`La lame frappe ${shogun.nom}.`);
  debutGong();
}

function debutGong() {
  jeu.phase = 'gong';
  programmer(DUREES.gong, apresGong);
}

function apresGong() {
  annulerMinuteur();
  if (jeu.resultat && jeu.resultat.type === 'assassinat') {
    jeu.phase = 'conseil';
    jeu.votes = {};
    programmer(DUREES.conseil, resoudreConseil);
    return;
  }
  finDeManche();
}

function candidatsConseil(votantId) {
  return jeu.joueurs.filter((j) => j.id !== jeu.dechuId && j.id !== votantId).map((j) => j.id);
}

function resoudreConseil() {
  annulerMinuteur();
  const compte = {};
  Object.values(jeu.votes).forEach((c) => { compte[c] = (compte[c] || 0) + 1; });
  const max = Math.max(0, ...Object.values(compte));
  const tetes = Object.keys(compte).filter((k) => compte[k] === max);
  const accuse = max > 0 && tetes.length === 1 ? tetes[0] : null;
  const ninja = joueur(jeu.ninjaId);
  const demasque = accuse === ninja.id;
  const heritierNinja = jeu.heritierId === ninja.id;
  let nouveau;
  if (demasque) {
    nouveau = jeu.heritierId;
    if (!heritierNinja) ninja.disgraceManche = jeu.manche + 1;
    chronique(heritierNinja
      ? `Le Conseil trouve ${ninja.nom}… mais c'était l'Héritier, qui monte sur le trône.`
      : `Le Conseil démasque ${ninja.nom}. L'Héritier ${nom(nouveau)} monte sur le trône.`);
  } else {
    nouveau = ninja.id;
    chronique(`Le Ninja ${ninja.nom} échappe au Conseil et prend le trône.`);
  }
  jeu.resultat = {
    type: 'verdict', ninja: ninja.id, accuse, egalite: max > 0 && tetes.length > 1,
    demasque, heritierNinja, nouveau, votes: { ...jeu.votes }, compte,
  };
  jeu.shogunId = nouveau;
  jeu.heritierId = null;
  jeu.heritierPrecedent = null;
  jeu.phase = 'verdict';
  programmer(DUREES.verdict, finDeManche);
}

function finDeManche() {
  annulerMinuteur();
  const cfg = jeu.config;
  const meilleurs = () => {
    const max = Math.max(...jeu.joueurs.map((j) => j.score));
    return jeu.joueurs.filter((j) => j.score === max);
  };
  const atteints = jeu.joueurs.filter((j) => j.score >= cfg.objectif);
  if (atteints.length || jeu.manche >= cfg.manchesMax) {
    let g = meilleurs();
    if (g.length > 1 && g.some((j) => j.id === jeu.shogunId)) g = [joueur(jeu.shogunId)];
    jeu.gagnants = g.map((j) => j.id);
    jeu.phase = 'fin';
    chronique(`${g.map((j) => j.nom).join(' et ')} ${g.length > 1 ? 'partagent' : 'remporte'} la victoire.`);
    return;
  }
  nouvelleManche();
}

// ---------------------------------------------------------------- actions joueurs

function agir(j, corps) {
  const p = jeu.phase;
  switch (corps.type) {
    case 'heritier': {
      if (p !== 'cour' || j.id !== jeu.shogunId) return 'Ce n\'est pas le moment.';
      if (!heritiersPossibles().some((x) => x.id === corps.cible)) return 'Héritier impossible.';
      choisirHeritier(corps.cible, false);
      return null;
    }
    case 'nuit': {
      if (p !== 'tigre' || jeu.actions[j.id]) return 'Ce n\'est pas le moment.';
      const o = optionsTigre(j);
      let action;
      if (o.type === 'disgrace') action = { type: 'attendre' };
      else if (o.type === 'surveiller') {
        if (!o.cibles.includes(corps.cible)) return 'Cible impossible.';
        action = { type: 'surveiller', cible: corps.cible };
      } else {
        action = { type: corps.choix === 'frapper' ? 'frapper' : 'attendre' };
      }
      jeu.actions[j.id] = action;
      if (tousOntAgi()) setTimeout(() => { if (jeu.phase === 'tigre') { resoudreTigre(); diffuser(); } }, 1200);
      return null;
    }
    case 'vote': {
      if (p !== 'conseil' || jeu.votes[j.id]) return 'Ce n\'est pas le moment.';
      if (!candidatsConseil(j.id).includes(corps.cible)) return 'Vote impossible.';
      jeu.votes[j.id] = corps.cible;
      if (jeu.joueurs.every((x) => jeu.votes[x.id])) {
        setTimeout(() => { if (jeu.phase === 'conseil') { resoudreConseil(); diffuser(); } }, 1200);
      }
      return null;
    }
    default:
      return 'Action inconnue.';
  }
}

function commandePalais(corps) {
  switch (corps.cmd) {
    case 'lancer':
      if (jeu.phase !== 'salle') return 'Partie déjà lancée.';
      return lancerPartie();
    case 'passer':
      if (jeu.phase === 'cour') { choisirHeritier(hasard(heritiersPossibles()).id, true); return null; }
      if (jeu.phase === 'tigre') { resoudreTigre(); return null; }
      if (jeu.phase === 'gong') { apresGong(); return null; }
      if (jeu.phase === 'conseil') { resoudreConseil(); return null; }
      if (jeu.phase === 'verdict') { finDeManche(); return null; }
      return null;
    case 'prolonger':
      if (jeu.finPhase && minuteur) {
        const restant = jeu.finPhase - Date.now() + 30000;
        const suite = { cour: () => { if (!jeu.heritierId) choisirHeritier(hasard(heritiersPossibles()).id, true); },
          tigre: resoudreTigre, gong: apresGong, conseil: resoudreConseil, verdict: finDeManche }[jeu.phase];
        if (suite) programmer(restant / 1000, suite, true);
      }
      return null;
    case 'rejouer':
      annulerMinuteur();
      jeu = nouveauJeu(jeu.joueurs.map((j) => ({ ...j, score: 0, disgraceManche: 0 })));
      return null;
    case 'exclure':
      if (jeu.phase !== 'salle') return 'On ne peut exclure qu\'avant la partie.';
      jeu.joueurs = jeu.joueurs.filter((j) => j.id !== corps.id);
      return null;
    default:
      return 'Commande inconnue.';
  }
}

// ---------------------------------------------------------------- vues (ce que chacun a le droit de voir)

function vuePublique() {
  const r = jeu.resultat;
  const montrerResultat = ['gong', 'conseil', 'verdict', 'fin', 'cour', 'tigre'].includes(jeu.phase) && r;
  return {
    phase: jeu.phase,
    manche: jeu.manche,
    config: jeu.config,
    finPhase: jeu.finPhase,
    debutPhase: jeu.debutPhase,
    maintenant: Date.now(),
    shogunId: jeu.shogunId,
    heritierId: jeu.heritierId,
    dechuId: jeu.dechuId,
    joueurs: jeu.joueurs.map((j) => ({
      id: j.id, nom: j.nom, couleur: j.couleur, blason: COULEURS.indexOf(j.couleur), score: j.score, connecte: j.connecte,
      disgracie: jeu.phase !== 'salle' && estDisgracie(j),
    })),
    agis: jeu.phase === 'tigre' ? Object.keys(jeu.actions).length : 0,
    votants: jeu.phase === 'conseil' ? Object.keys(jeu.votes) : [],
    resultat: jeu.phase === 'tigre' || jeu.phase === 'cour' ? null : montrerResultat ? r : null,
    gagnants: jeu.gagnants,
    chronique: jeu.chronique.slice(0, 8),
    heritiersPossibles: jeu.phase === 'cour' ? heritiersPossibles().map((j) => j.id) : [],
  };
}

function vueJoueur(j) {
  const v = vuePublique();
  v.moi = { id: j.id, nom: j.nom, couleur: j.couleur, blason: COULEURS.indexOf(j.couleur) };
  if (jeu.phase === 'tigre') {
    v.nuit = { options: optionsTigre(j), fait: !!jeu.actions[j.id] };
  }
  if (jeu.phase === 'conseil') {
    v.conseil = { candidats: candidatsConseil(j.id), fait: jeu.votes[j.id] || null, suisNinja: j.id === jeu.ninjaId };
  }
  return v;
}

// ---------------------------------------------------------------- réseau

const clients = new Set(); // {res, jeton|null, url}

function envoyer(c) {
  let donnees;
  if (c.jeton) {
    const j = jeu.joueurs.find((x) => x.jeton === c.jeton);
    donnees = j ? vueJoueur(j) : { ...vuePublique(), moi: null };
    donnees.salle = code;
  } else {
    donnees = { ...vuePublique(), salle: code, urlJoueur: c.url };
  }
  c.res.write(`data: ${JSON.stringify(donnees)}\n\n`);
}

function diffuser() {
  derniereActivite = Date.now();
  const connectes = new Set([...clients].filter((c) => c.jeton).map((c) => c.jeton));
  jeu.joueurs.forEach((j) => { j.connecte = connectes.has(j.jeton); });
  clients.forEach(envoyer);
}


// ---------------------------------------------------------------- entrées du salon

function rejoindre(jeton, nomBrut) {
  const nomPropre = String(nomBrut || '').trim().replace(/\s+/g, ' ').slice(0, 16);
  const existant = jeu.joueurs.find((j) => j.jeton === jeton);
  if (existant) {
    if (nomPropre && jeu.phase === 'salle') existant.nom = nomPropre;
    diffuser();
    return null;
  }
  if (jeu.phase !== 'salle') return 'La partie a déjà commencé. Attends la prochaine.';
  if (!nomPropre) return 'Choisis un nom.';
  if (jeu.joueurs.length >= 10) return 'La cour est pleine (10 joueurs).';
  if (jeu.joueurs.some((j) => j.nom.toLowerCase() === nomPropre.toLowerCase())) return 'Ce nom est déjà pris.';
  const pris = new Set(jeu.joueurs.map((j) => j.couleur));
  jeu.joueurs.push({ id: id6(), jeton, nom: nomPropre, couleur: COULEURS.find((c) => !pris.has(c)) || COULEURS[0],
    score: 0, connecte: true, disgraceManche: 0 });
  diffuser();
  return null;
}

function quitter(jeton) {
  if (jeu.phase === 'salle') jeu.joueurs = jeu.joueurs.filter((j) => j.jeton !== jeton);
  diffuser();
}

function agirJeton(jeton, corps) {
  const j = jeu.joueurs.find((x) => x.jeton === jeton);
  if (!j) return 'Joueur inconnu.';
  const err = agir(j, corps);
  diffuser();
  return err;
}

function commander(corps) {
  const err = commandePalais(corps);
  diffuser();
  return err;
}

function brancher(c) { clients.add(c); diffuser(); }
function debrancher(c) { clients.delete(c); setTimeout(diffuser, 50); }

return {
  code, cle,
  rejoindre, quitter, agir: agirJeton, commander, brancher, debrancher,
  inactifDepuis: () => (clients.size ? 0 : Date.now() - derniereActivite),
  fermer: () => { annulerMinuteur(); clients.forEach((c) => c.res.end()); },
  _etat: () => jeu,
};
}

function adresseLocale() {
  const candidats = [];
  for (const [nomIf, adresses] of Object.entries(os.networkInterfaces())) {
    for (const a of adresses || []) {
      if (a.family === 'IPv4' && !a.internal) candidats.push({ nomIf, ip: a.address });
    }
  }
  const prefere = candidats.find((c) => /^192\.168\./.test(c.ip))
    || candidats.find((c) => /^10\./.test(c.ip))
    || candidats.find((c) => /^172\.(1[6-9]|2\d|3[01])\./.test(c.ip))
    || candidats[0];
  return prefere ? prefere.ip : 'localhost';
}
// Adresse à donner aux joueurs : déduite de la façon dont le Palais a ouvert le site
function baseSite(req) {
  const hote = String(req.headers['x-forwarded-host'] || req.headers.host || '');
  if (!hote || /^(localhost|127\.|\[::1\]|0\.0\.0\.0)/.test(hote)) return `http://${adresseLocale()}:${PORT}`;
  const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
  return `${proto}://${hote}`;
}
const urlJoueur = (req, code) => `${baseSite(req)}/j?s=${code}`;

// ---------------------------------------------------------------- salons

const salles = new Map();
const LETTRES = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
function nouveauCode() {
  for (;;) {
    const c = Array.from({ length: 4 }, () => LETTRES[Math.floor(Math.random() * LETTRES.length)]).join('');
    if (!salles.has(c)) return c;
  }
}
const salle = (code) => salles.get(String(code || '').toUpperCase().trim()) || null;

// Un salon vide depuis 2 heures est supprimé
setInterval(() => {
  for (const [code, s] of salles) if (s.inactifDepuis() > 2 * 3600 * 1000) { s.fermer(); salles.delete(code); }
}, 10 * 60 * 1000).unref();

function lireCorps(req) {
  return new Promise((ok) => {
    let b = '';
    req.on('data', (d) => { b += d; if (b.length > 1e5) req.destroy(); });
    req.on('end', () => { try { ok(JSON.parse(b || '{}')); } catch { ok({}); } });
  });
}

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.webp': 'image/webp' };

// Version « un seul fichier » : les fichiers du jeu sont embarqués dans l'exécutable.
const EMBARQUES = globalThis.__OMBRE_FICHIERS__ || null;

function servirFichier(res, fichier) {
  const chemin = path.normalize(path.join(PUBLIC, fichier));
  if (!chemin.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  const lire = EMBARQUES
    ? (c, cb) => {
      const cle = path.relative(PUBLIC, c).split(path.sep).join('/');
      return EMBARQUES[cle] ? cb(null, Buffer.from(EMBARQUES[cle], 'base64')) : cb(new Error('absent'));
    }
    : (c, cb) => fs.readFile(c, (err, data) => {
      if (!err) return cb(null, data);
      // Version « à plat » (tous les fichiers côte à côte, sans dossier) : on cherche le fichier à la racine
      const aPlat = path.join(__dirname, path.basename(c));
      if (!/\.(html|css|js|woff2|webp|svg|png)$/.test(aPlat) || /^(server|qrcode)\.js$/.test(path.basename(c))) return cb(err);
      fs.readFile(aPlat, cb);
    });
  lire(chemin, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Introuvable'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(chemin)] || 'application/octet-stream',
      'Cache-Control': chemin.endsWith('.woff2') ? 'max-age=86400' : 'no-cache' });
    res.end(data);
  });
}

const serveur = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  if (p === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const s = salle(url.searchParams.get('salle'));
    const cle = url.searchParams.get('cle');
    if (!s || (cle && cle !== s.cle)) {
      res.write('retry: 30000\n\n');
      res.write(`data: ${JSON.stringify({ salleInconnue: true })}\n\n`);
      return res.end();
    }
    res.write('retry: 1500\n\n');
    const c = cle ? { res, jeton: null, url: urlJoueur(req, s.code) } : { res, jeton: url.searchParams.get('jeton') || null };
    s.brancher(c);
    const ping = setInterval(() => res.write(': ping\n\n'), 15000);
    req.on('close', () => { clearInterval(ping); s.debrancher(c); });
    return;
  }

  if (p === '/ping') { res.writeHead(204, { 'Cache-Control': 'no-store' }); return res.end(); }

  if (p === '/qr.svg') {
    const s = salle(url.searchParams.get('salle'));
    const qr = qrcode(0, 'M');
    qr.addData(s ? urlJoueur(req, s.code) : `${baseSite(req)}/j`);
    qr.make();
    res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
    return res.end(qr.createSvgTag({ cellSize: 8, margin: 2, scalable: true }));
  }

  if (req.method === 'POST' && p.startsWith('/api/')) {
    const b = await lireCorps(req);

    if (p === '/api/salle/creer') {
      if (salles.size >= 500) return json(res, 503, { erreur: 'Trop de parties en cours. Réessaie dans quelques minutes.' });
      const code = nouveauCode();
      const cle = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      salles.set(code, creerSalle(code, cle));
      return json(res, 200, { salle: code, cle });
    }

    const s = salle(b.salle);
    if (!s) return json(res, 404, { erreur: 'Ce salon n\'existe pas (ou plus). Vérifie le code affiché sur l\'écran du Palais.' });

    if (p === '/api/salle/reprendre') {
      return b.cle === s.cle ? json(res, 200, { salle: s.code }) : json(res, 403, { erreur: 'Clé incorrecte.' });
    }
    if (p === '/api/palais') {
      if (b.cle !== s.cle) return json(res, 403, { erreur: 'Seul l\'écran du Palais peut faire ça.' });
      const err = s.commander(b);
      return err ? json(res, 409, { erreur: err }) : json(res, 200, { ok: true });
    }
    const jeton = String(b.jeton || '').slice(0, 40);
    if (!jeton) return json(res, 400, { erreur: 'Jeton manquant.' });
    if (p === '/api/rejoindre') {
      const err = s.rejoindre(jeton, b.nom);
      return err ? json(res, 409, { erreur: err }) : json(res, 200, { ok: true, salle: s.code });
    }
    if (p === '/api/quitter') { s.quitter(jeton); return json(res, 200, { ok: true }); }
    if (p === '/api/agir') {
      const err = s.agir(jeton, b);
      return err ? json(res, err === 'Joueur inconnu.' ? 403 : 409, { erreur: err }) : json(res, 200, { ok: true });
    }
    return json(res, 404, { erreur: 'Inconnu.' });
  }

  if (p === '/' || p === '/palais') return servirFichier(res, 'palais.html');
  if (p === '/j' || p === '/jouer') return servirFichier(res, 'joueur.html');
  return servirFichier(res, p.slice(1));
});

serveur.listen(PORT, '0.0.0.0', () => {
  const palais = `http://localhost:${PORT}/`;
  console.log('\n  L\'Ombre du Shogun est prêt.\n');
  console.log(`  Écran du Palais (tablette ou cet ordinateur) : http://${adresseLocale()}:${PORT}/`);
  console.log('  Les joueurs scannent le QR code affiché sur l\'écran du Palais.\n');
  console.log('  Laisse cette fenêtre ouverte pendant la partie. Ferme-la pour arrêter le jeu.\n');
  if (!process.env.SHOGUN_NO_OPEN && !process.env.RENDER && !process.env.SHOGUN_EN_LIGNE) {
    const cmd = process.platform === 'darwin' ? `open "${palais}"`
      : process.platform === 'win32' ? `start "" "${palais}"` : `xdg-open "${palais}"`;
    exec(cmd, () => {});
  }
});

serveur.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n  Le port ${PORT} est déjà utilisé : le jeu tourne peut-être déjà dans une autre fenêtre.\n`);
  } else console.error(e);
  if (EMBARQUES) {
    // Double-clic : laisser le temps de lire le message avant que la fenêtre ne se ferme
    console.error('  Cette fenêtre se fermera dans 30 secondes.\n');
    setTimeout(() => process.exit(1), 30000);
  } else process.exit(1);
});

module.exports = { _salles: salles };
