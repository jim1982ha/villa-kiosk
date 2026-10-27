// src/babylon/valueAdvance.ts
// HOW WIDE A BADGE'S READING IS DRAWN, in em of its own font: the advance of each character of Public Sans at weight
// 600, the font and weight badgeText draws every value in (public/fonts/public-sans-var.woff2, self-hosted). Pure:
// tests/oracles/badge_box.mjs drives it by value.
//
// ⚠️ ONE AVERAGE FOR EVERY CHARACTER (VALUE_CHAR_ADVANCE, 0.56 em) UNTIL 2.496.553. Digits are 0.62 to 0.66 em in this
// font, "%" 0.92 and "W" 0.96, so a reading was drawn wider than placement measured it: "929 W" by 11%, "100%" by 16%,
// "88%" by 34%. The box placement keeps clear was smaller than the badge on the screen.
//
// The table is the font's own advance widths (hmtx at wght 600, read with fontTools); regenerate it if the font file
// changes. A character outside it counts as the widest one in it, so an unknown glyph can only make the box wider.

/** Advance width per character, in em (Public Sans, weight 600). */
const ADVANCE_EM: Readonly<Record<string, number>> = {
  " ": 0.234, "!": 0.268, "\"": 0.455, "#": 0.61, "$": 0.67, "%": 0.923, "&": 0.75, "'": 0.255, "(": 0.32,
  ")": 0.324, "*": 0.437, "+": 0.573, ",": 0.261, "-": 0.386, ".": 0.249, "/": 0.367, "0": 0.629, "1": 0.418,
  "2": 0.618, "3": 0.649, "4": 0.643, "5": 0.659, "6": 0.643, "7": 0.615, "8": 0.66, "9": 0.643, ":": 0.249,
  ";": 0.261, "<": 0.563, "=": 0.573, ">": 0.563, "?": 0.528, "@": 0.829, "A": 0.719, "B": 0.678, "C": 0.705,
  "D": 0.708, "E": 0.628, "F": 0.605, "G": 0.747, "H": 0.768, "I": 0.296, "J": 0.396, "K": 0.701, "L": 0.578,
  "M": 0.903, "N": 0.769, "O": 0.749, "P": 0.645, "Q": 0.761, "R": 0.687, "S": 0.682, "T": 0.606, "U": 0.714,
  "V": 0.69, "W": 0.962, "X": 0.704, "Y": 0.64, "Z": 0.654, "[": 0.322, "\\": 0.367, "]": 0.322, "^": 0.479,
  "_": 0.536, "`": 0.243, "a": 0.56, "b": 0.603, "c": 0.545, "d": 0.603, "e": 0.572, "f": 0.397, "g": 0.626,
  "h": 0.585, "i": 0.258, "j": 0.277, "k": 0.572, "l": 0.317, "m": 0.881, "n": 0.586, "o": 0.571, "p": 0.602,
  "q": 0.602, "r": 0.403, "s": 0.517, "t": 0.404, "u": 0.589, "v": 0.513, "w": 0.784, "x": 0.577, "y": 0.55,
  "z": 0.489, "{": 0.358, "|": 0.266, "}": 0.36, "~": 0.592, "°": 0.469, "µ": 0.596, "²": 0.381, "³": 0.414,
  "·": 0.245, "…": 0.837, "–": 0.576, "−": 0.573, "×": 0.56, "±": 0.573, "€": 0.628, "£": 0.632, "¥": 0.637,
};

/** The widest advance in the table ("W"): what a character it does not know counts as. */
const WIDEST_EM = Math.max(...Object.values(ADVANCE_EM));

/** How wide `text` is drawn, in em of the value font: the sum of its characters' advances. */
export function valueAdvanceEm(text: string): number {
  let em = 0;
  for (const c of text) em += ADVANCE_EM[c] ?? WIDEST_EM;
  return em;
}
