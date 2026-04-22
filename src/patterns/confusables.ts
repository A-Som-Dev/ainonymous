// Curated Unicode confusables folded to a Latin ASCII baseline for detection.
// Intentionally narrower than CLDR to keep legitimate non-Latin text intact.
// Rehydrate always restores the original codepoints.
export const CONFUSABLES: ReadonlyMap<number, string> = new Map([
  // Latin-Extended that NFKC leaves alone
  [0x017f, 's'],
  [0x0131, 'i'],
  [0x0130, 'i'],

  // Cyrillic lowercase → Latin lowercase
  [0x0430, 'a'],
  [0x0435, 'e'],
  [0x043e, 'o'],
  [0x0440, 'p'],
  [0x0441, 'c'],
  [0x0445, 'x'],
  [0x0443, 'y'],
  [0x0456, 'i'],
  [0x0458, 'j'],
  [0x0455, 's'],
  [0x04bb, 'h'],
  [0x051b, 'q'],
  [0x051d, 'w'],

  // Cyrillic uppercase → Latin uppercase
  [0x0410, 'A'],
  [0x0412, 'B'],
  [0x0415, 'E'],
  [0x041a, 'K'],
  [0x041c, 'M'],
  [0x041d, 'H'],
  [0x041e, 'O'],
  [0x0420, 'P'],
  [0x0421, 'C'],
  [0x0422, 'T'],
  [0x0425, 'X'],
  [0x0423, 'Y'],
  [0x0406, 'I'],
  [0x0408, 'J'],
  [0x0405, 'S'],
  [0x0417, '3'],

  // Greek lowercase → Latin lowercase (selective; only unambiguous shapes)
  [0x03bf, 'o'],
  [0x03b1, 'a'],
  [0x03c1, 'p'],
  [0x03c5, 'u'],
  [0x03c7, 'x'],

  // Greek uppercase → Latin uppercase
  [0x0391, 'A'],
  [0x0392, 'B'],
  [0x0395, 'E'],
  [0x0396, 'Z'],
  [0x0397, 'H'],
  [0x0399, 'I'],
  [0x039a, 'K'],
  [0x039c, 'M'],
  [0x039d, 'N'],
  [0x039f, 'O'],
  [0x03a1, 'P'],
  [0x03a4, 'T'],
  [0x03a5, 'Y'],
  [0x03a7, 'X'],

  // Letterlike Symbols block - NFKC leaves these alone.
  [0x210d, 'H'],
  [0x210e, 'h'],
  [0x2115, 'N'],
  [0x2124, 'Z'],
  [0x2128, 'Z'],
  [0x212f, 'e'],
  [0x2130, 'E'],
  [0x2131, 'F'],
  [0x2133, 'M'],
  [0x2134, 'o'],
  [0x2139, 'i'],
  [0x211d, 'R'],

  // Armenian letters that render as Latin caps/lowercase.
  [0x0555, 'O'],
  [0x0585, 'o'],
  [0x054f, 'S'],
  [0x057d, 's'],

  // Cherokee letters whose glyphs collide with Latin capitals.
  [0x13a0, 'A'],
  [0x13a3, 'D'],
  [0x13a6, 'E'],
  [0x13b3, 'L'],
  [0x13b7, 'M'],
  [0x13d9, 'V'],
  [0x13de, 'T'],

  // Supplementary-plane historic scripts that collide with Latin capitals.
  [0x10300, 'A'],
  [0x10302, 'C'],
  [0x10304, 'E'],
  [0x10308, 'I'],
  [0x1030a, 'K'],
  [0x1030e, 'M'],
  [0x1030f, 'O'],
  [0x10310, 'P'],
  [0x10317, 'V'],
  [0x1031a, 'X'],

  // Gothic letters that look like Latin uppercase.
  [0x10330, 'A'],
  [0x10343, 'G'],
  [0x10349, 'R'],
  [0x1034a, 'S'],

  // Deseret capitals (Latin-lookalike subset).
  [0x10400, 'E'],
  [0x1040d, 'S'],
]);

export function foldConfusable(codepoint: number): string | undefined {
  return CONFUSABLES.get(codepoint);
}
