// Maqam pitch sets in cents above the tonic (quarter tones as 150 / 350 / 1050).
// Every chapter sits on D so the drone and the lock bowls stay coherent across the game.
export const D3 = 146.83;

export const MAQAM = {
  hijaz: [0, 100, 400, 500, 700, 800, 1000],   // D E♭ F♯ G A B♭ C
  bayati: [0, 150, 300, 500, 700, 800, 1000],  // D E𝄳 F G A B♭ C
  saba: [0, 150, 300, 400, 700, 800, 1000],    // D E𝄳 F G♭ A B♭ C
  rast: [0, 200, 350, 500, 700, 900, 1050],    // D E F♯𝄳 G A B C♯𝄳
  ajam: [0, 200, 400, 500, 700, 900, 1100],    // D E F♯ G A B C♯
};

// frequency of scale degree `deg` (any integer, wraps into octaves) of maqam `name` on tonic `root`
export function degreeHz(name, deg, root = D3) {
  const s = MAQAM[name] || MAQAM.hijaz;
  const n = s.length, o = Math.floor(deg / n), i = ((deg % n) + n) % n;
  return root * Math.pow(2, o + s[i] / 1200);
}

// the chapter's maqam for a theme id
export const THEME_MAQAM = { menu: 'hijaz', souk: 'hijaz', sundown: 'bayati', night: 'saba', dawn: 'rast', credits: 'rast', lab: 'hijaz' };

// Chapter I finale melody (degrees), reused as the leitmotif in the menu and the credits
export const LEITMOTIF = [0, 1, 2, 3, 2, 1, 0, -1, 0, 2, 4, 3, 2, 1, 2, 0];
