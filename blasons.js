// Les dix blasons de clan (mon). Chaque dessin tient dans un carré -50..50, en currentColor.
'use strict';
const BLASONS = (() => {
  const rot = (motif, n, decalage = 0) => Array.from({ length: n }, (_, i) =>
    `<g transform="rotate(${decalage + (360 / n) * i})">${motif}</g>`).join('');

  return [
    { nom: 'Fleur de cerisier', svg: rot('<path d="M0,-8 C-13,-14 -17,-33 -7,-40 L0,-33 L7,-40 C17,-33 13,-14 0,-8 Z"/>', 5)
      + '<circle r="5" fill="none" stroke="currentColor" stroke-width="2.5"/>' },
    { nom: 'Trois écailles', svg: '<path d="M0,-38 L19,-5 L-19,-5 Z M-20,-1 L-1,32 L-39,32 Z M20,-1 L39,32 L1,32 Z"/>' },
    { nom: 'Quatre losanges', svg: '<path d="M0,-38 L14,-20 L0,-2 L-14,-20 Z M0,2 L14,20 L0,38 L-14,20 Z M-20,-14 L-2,0 L-20,14 L-38,0 Z M20,-14 L38,0 L20,14 L2,0 Z"/>' },
    { nom: 'Carapace de tortue', svg: '<path fill-rule="evenodd" d="M0,-36 L31,-18 L31,18 L0,36 L-31,18 L-31,-18 Z M0,-26 L22.5,-13 L22.5,13 L0,26 L-22.5,13 L-22.5,-13 Z"/>'
      + rot('<ellipse cy="-10" rx="5" ry="9"/>', 3) },
    { nom: 'Éventail', svg: '<path d="M0,26 L-34,-16 A44,44 0 0 1 34,-16 Z" fill="none" stroke="currentColor" stroke-width="5" stroke-linejoin="round"/>'
      + [-34, -17, 0, 17, 34].map((x) => `<line x1="0" y1="26" x2="${x * 0.92}" y2="${-16 - (34 - Math.abs(x)) * 0.62}" stroke="currentColor" stroke-width="3"/>`).join('')
      + '<path d="M-34,-16 A44,44 0 0 1 34,-16 L20,-2 A26,26 0 0 0 -20,-2 Z"/><circle cy="26" r="5"/>' },
    { nom: 'Roue de char', svg: '<circle r="34" fill="none" stroke="currentColor" stroke-width="7"/><circle r="9"/>'
      + rot('<rect x="-2.5" y="-32" width="5" height="22"/>', 8) },
    { nom: 'Vagues', svg: '<path fill="none" stroke="currentColor" stroke-width="6" d="M-36,24 A36,36 0 0 1 36,24 M-24,24 A24,24 0 0 1 24,24 M-12,24 A12,12 0 0 1 12,24 M-40,-6 A20,20 0 0 1 0,-6 A20,20 0 0 1 40,-6"/>' },
    { nom: 'Croissant de lune', svg: '<path d="M4.5,-35.7 A36,36 0 1 0 33.9,12.1 A29,29 0 1 1 4.5,-35.7 Z"/>' },
    { nom: 'Trois virgules', svg: rot('<path d="M0,-36 A17,17 0 0 1 0,-2 A34,34 0 0 0 -30,-17 A36,36 0 0 1 0,-36 Z"/>', 3) },
    { nom: 'Trois feuilles', svg: rot('<path d="M0,-4 C-14,-14 -12,-32 0,-40 C12,-32 14,-14 0,-4 Z"/><line y1="-4" y2="-34" stroke="var(--fond-mon, #0D1530)" stroke-width="2"/>', 3)
      + '<circle r="4"/>' },
  ];
})();

function dessinBlason(index) {
  const b = BLASONS[((index % BLASONS.length) + BLASONS.length) % BLASONS.length];
  return `<svg viewBox="-50 -50 100 100" aria-hidden="true" fill="currentColor"><circle r="46" fill="none" stroke="currentColor" stroke-width="4"/><g transform="scale(.86)">${b.svg}</g></svg>`;
}
