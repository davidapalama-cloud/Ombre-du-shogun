// Outils partagés entre le Palais et l'écran joueur
'use strict';

const Ombre = (() => {
  let decalage = 0; // horloge du serveur - horloge locale

  // Écoute les mises à jour d'un salon. Renvoie de quoi arrêter l'écoute.
  function ecouter(url, surEtat, surEtatConnexion) {
    let es, ferme = false;
    function ouvrir() {
      es = new EventSource(url);
      es.onopen = () => surEtatConnexion && surEtatConnexion(true);
      es.onmessage = (e) => {
        const etat = JSON.parse(e.data);
        if (etat.salleInconnue) { fermer(); surEtatConnexion && surEtatConnexion(true); return surEtat(etat); }
        decalage = etat.maintenant - Date.now();
        surEtat(etat);
      };
      es.onerror = () => {
        if (ferme) return;
        surEtatConnexion && surEtatConnexion(false);
        if (es.readyState === EventSource.CLOSED) setTimeout(() => { if (!ferme) ouvrir(); }, 1500);
      };
    }
    // Signal régulier : empêche l'hébergeur gratuit d'endormir le serveur pendant une partie
    const battement = setInterval(() => { if (!ferme) fetch('/ping', { cache: 'no-store' }).catch(() => {}); }, 4 * 60 * 1000);
    function fermer() { ferme = true; clearInterval(battement); if (es) es.close(); }
    ouvrir();
    return { fermer };
  }

  async function poster(url, corps) {
    try {
      const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps) });
      const d = await r.json().catch(() => ({}));
      return r.ok ? { ...d, ok: true } : { ok: false, erreur: d.erreur || 'Erreur inconnue.' };
    } catch {
      return { ok: false, erreur: 'Connexion au jeu impossible. Vérifie ta connexion internet ou ton wifi.' };
    }
  }

  const restant = (fin) => (fin ? Math.max(0, (fin - (Date.now() + decalage)) / 1000) : null);

  // Bâton d'encens : remplit un conteneur .encens et le met à jour chaque seconde
  function encens(el) {
    el.innerHTML = '<div class="cendre"></div><div class="baton"></div><div class="fumee"></div><div class="braise"></div>';
    const [cendre, baton, fumee, braise] = el.children;
    let fin = null, total = 1;
    const tic = setInterval(() => { if (!el.isConnected) clearInterval(tic); else maj(); }, 250);
    function maj() {
      const r = restant(fin);
      if (r === null) { el.style.visibility = 'hidden'; return; }
      el.style.visibility = 'visible';
      const f = Math.min(1, r / total);
      const pct = (f * 100).toFixed(2) + '%';
      baton.style.width = pct; braise.style.left = pct; fumee.style.left = pct; cendre.style.left = pct;
      el.classList.toggle('urgent', r <= 5);
    }
    return {
      regler(debut, nouvelleFin) {
        fin = nouvelleFin;
        total = debut && fin ? Math.max(1, (fin - debut) / 1000) : Math.max(1, restant(fin) || 1);
        maj();
      },
    };
  }

  const nomDe = (etat, id) => (etat.joueurs.find((j) => j.id === id) || { nom: '?' }).nom;
  const liste = (noms) => (noms.length <= 1 ? noms.join('') : `${noms.slice(0, -1).join(', ')} et ${noms[noms.length - 1]}`);

  const PHASES = {
    salle: 'La Salle d\'attente',
    cour: 'La Cour',
    tigre: 'L\'Heure du Tigre',
    gong: 'Le Gong',
    conseil: 'Le Conseil des Daimyos',
    verdict: 'Le Verdict',
    fin: 'Fin de l\'ère',
  };

  // Le texte d'un résultat, identique sur le Palais et les téléphones
  function texteResultat(etat) {
    const r = etat.resultat;
    if (!r) return null;
    const n = (id) => nomDe(etat, id);
    switch (r.type) {
      case 'calme':
        return { ton: 'or', titre: 'Nuit calme', detail: `Aucune lame n'a frappé. ${n(etat.shogunId)} règne un jour de plus et gagne 1 point.` };
      case 'pris': {
        const lames = etat.config && etat.config.modeLames;
        const v = liste(r.veilleurs.map(n));
        const qui = r.veilleurs.length
          ? `${v} ${r.veilleurs.length > 1 ? 'surveillaient la bonne personne et gagnent' : 'surveillait la bonne personne et gagne'} 1 point.`
          : 'Le Shogun surveillait la bonne personne.';
        return { ton: 'mousse', titre: 'Lame arrêtée',
          detail: `La lame de ${n(r.ninja)} a été arrêtée. ${qui}`
            + (lames ? '' : ` ${n(r.ninja)} est en disgrâce à la prochaine manche.`) + ` Le Shogun garde le trône et gagne 1 point.` };
      }
      case 'coup-lames':
        return { ton: 'beni', titre: 'Coup d\'État',
          detail: `${n(r.nouveau)} a frappé sans être vu et renverse ${n(r.ancien)}.`
            + (r.pris.length ? ` La lame de ${liste(r.pris.map(n))} a été arrêtée au même moment.` : '') };
      case 'assassinat':
        return { ton: 'beni', titre: 'Le Shogun est tombé',
          detail: `La lame a frappé ${n(r.dechu)}. L'assassin est parmi vous : trouvez qui, ou il prend le trône.` };
      case 'verdict': {
        if (r.demasque && r.heritierNinja) {
          return { ton: 'beni', titre: 'L\'Héritier était l\'assassin',
            detail: `Le Conseil a trouvé ${n(r.ninja)}… mais le Ninja était aussi l'Héritier. ${n(r.ninja)} monte quand même sur le trône.` };
        }
        if (r.demasque) {
          return { ton: 'mousse', titre: 'Assassin démasqué',
            detail: `${n(r.ninja)} était le Ninja. L'Héritier ${n(r.nouveau)} monte sur le trône. ${n(r.ninja)} est en disgrâce à la prochaine manche.` };
        }
        const pourquoi = r.egalite ? 'Le Conseil n\'a pas su trancher.'
          : r.accuse ? `Le Conseil a accusé ${n(r.accuse)}, à tort.` : 'Personne n\'a voté.';
        return { ton: 'beni', titre: 'L\'assassin s\'échappe',
          detail: `${pourquoi} Le Ninja était ${n(r.ninja)}, qui prend le trône.` };
      }
      default: return null;
    }
  }

  // Gong synthétisé (aucun fichier son)
  let audio = null;
  function debloquerSon() {
    if (!audio) { try { audio = new (window.AudioContext || window.webkitAudioContext)(); } catch { audio = null; } }
    if (audio && audio.state === 'suspended') audio.resume();
  }
  function gong(grave = 1) {
    if (!audio) return;
    const t = audio.currentTime;
    const sortie = audio.createGain();
    sortie.gain.setValueAtTime(0.0001, t);
    sortie.gain.exponentialRampToValueAtTime(0.5, t + 0.02);
    sortie.gain.exponentialRampToValueAtTime(0.0001, t + 5.5);
    sortie.connect(audio.destination);
    [[1, 1], [2.02, .5], [2.76, .35], [4.07, .18], [5.4, .1]].forEach(([mult, vol]) => {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(92 * grave * mult, t);
      o.frequency.exponentialRampToValueAtTime(88 * grave * mult, t + 4);
      g.gain.value = vol;
      o.connect(g).connect(sortie);
      o.start(t); o.stop(t + 6);
    });
  }

  function mon(j, plein) {
    const s = document.createElement('span');
    s.className = 'mon' + (plein ? ' plein' : '');
    s.style.setProperty('--c', j.couleur);
    s.innerHTML = dessinBlason(j.blason || 0);
    s.setAttribute('aria-hidden', 'true');
    return s;
  }

  // Quelle illustration pour quel moment du jeu
  function scenePour(etat) {
    switch (etat.phase) {
      case 'cour': return 'cour';
      case 'tigre': return 'tigre';
      case 'gong': return 'gong';
      case 'conseil': case 'verdict': return 'conseil';
      case 'fin': return 'aube';
      default: return 'chateau';
    }
  }
  const lameVisible = (etat) => ['gong', 'conseil'].includes(etat.phase) && etat.resultat
    && ['assassinat', 'coup-lames'].includes(etat.resultat.type);

  // Scènes peintes : point d'intérêt à garder visible quand l'image est recadrée
  const SCENES_PEINTES = { chateau: '86% 40%', tigre: '84% 55%', cour: '50% 60%' };

  // Décor en fondu : deux calques qui se relaient
  function decor(conteneur) {
    conteneur.innerHTML = '<img class="couche" alt=""><img class="couche" alt=""><img class="lame" alt="" src="illustrations/sang.webp">';
    const [a, b, lame] = conteneur.querySelectorAll('img');
    let actif = a, actuel = null;
    return {
      montrer(nom, avecLame) {
        lame.classList.toggle('visible', !!avecLame);
        if (nom === actuel) return;
        actuel = nom;
        conteneur.classList.toggle('peinte', !!SCENES_PEINTES[nom]);
        const suivant = actif === a ? b : a;
        suivant.style.objectPosition = SCENES_PEINTES[nom] || '';
        suivant.onload = () => { suivant.classList.add('visible'); actif.classList.remove('visible'); actif = suivant; };
        suivant.src = `illustrations/${nom}.webp`;
      },
    };
  }

  function el(tag, attrs = {}, ...enfants) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else if (k === 'style') e.style.cssText = v;
      else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
    }
    for (const c of enfants.flat()) if (c != null && c !== false) e.append(c instanceof Node ? c : String(c));
    return e;
  }

  return { ecouter, poster, restant, encens, nomDe, liste, PHASES, texteResultat, debloquerSon, gong, mon, el, scenePour, lameVisible, decor };
})();
