// Heuristic parser that turns raw OCR text (from a photographed/uploaded
// ST card or note) into best-guess form field values.
//
// This never auto-saves anything — it only pre-fills the Add/Edit form,
// which the person still reviews and confirms before hitting save.

const CATEGORY_KEYWORDS = [
  { key: "handicapped", words: ["handicap", "divyang", "disable", "अपंग"] },
  { key: "senior", words: ["senior citizen", "senior", "ज्येष्ठ"] },
  { key: "student", words: ["student", "विद्यार्थी"] },
  { key: "amrut", words: ["amrut", "अमृत"] },
  { key: "female", words: ["female", "woman", "महिला"] },
];

const NOISE_WORDS = /card|number|no\.?|mobile|phone|village|category|date|name|pin\s*code/i;

// Printed/embossed cards frequently get OCR'd with digits swapped for
// look-alike letters (0/O, 1/I/L, 2/Z, 5/S, 8/B). These maps let us recover
// the intended digits wherever we know a run of characters *should* be
// numeric (card number, pincode).
const LETTER_TO_DIGIT = { O: "0", I: "1", L: "1", Z: "2", S: "5", B: "8" };
const DIGIT_CHAR_CLASS = { "0": "[0oO]", "1": "[1iIlL]", "2": "[2zZ]", "5": "[5sS]", "8": "[8bB]" };

function toDigits(s) {
  return s
    .split("")
    .map((ch) => LETTER_TO_DIGIT[ch.toUpperCase()] || ch)
    .join("")
    .replace(/[^0-9]/g, "");
}

function findLabeledValue(lines, labels) {
  for (const line of lines) {
    for (const label of labels) {
      const re = new RegExp(`${label}\\s*[:\\-]\\s*(.+)`, "i");
      const m = line.match(re);
      if (m && m[1].trim()) return m[1].trim();
    }
  }
  return "";
}

/**
 * @param {string} rawText - raw text returned by the OCR engine
 * @param {string} cardPrefix - the fixed prefix all card numbers start with (e.g. "M260")
 * @param {Set<string>} [validPincodes] - known-good pincodes (e.g. from the
 *   local Maharashtra pincode directory). When supplied, this is used to
 *   pick the right 6-digit run out of several look-alike numbers on the
 *   card (card number, serial number, mobile number, etc. can all look like
 *   a pincode to a naive regex).
 * @returns {{name:string, mobile:string, cardNumber:string, village:string, category:string, pincode:string}}
 */
export function parseCardText(rawText, cardPrefix, validPincodes) {
  const text = rawText || "";
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const flat = text.replace(/\s+/g, " ");

  const result = { name: "", mobile: "", cardNumber: "", village: "", category: "", pincode: "" };

  // Mobile number: any 10-digit run starting 6-9 (Indian mobile numbers),
  // stripping stray spaces/dashes OCR sometimes inserts mid-number.
  const digitsOnly = flat.replace(/[\s-]/g, "");
  const mobileMatch = digitsOnly.match(/[6-9]\d{9}/);
  if (mobileMatch) result.mobile = mobileMatch[0];

  // Pincode: 6-digit Indian PIN code (first digit 1-9). We collect every
  // standalone 6-digit candidate in the text (a card can have several
  // look-alike numbers), then pick the best one in this order:
  //   1. A number explicitly labeled "PIN"/"Pincode" on its own line.
  //   2. Whichever candidate is an actual pincode in validPincodes, if we
  //      were given that list — this is what makes extraction reliable
  //      instead of just grabbing the first 6-digit-looking number.
  //   3. The first remaining candidate, as a last resort.
  const labeledPin = findLabeledValue(lines, ["pin\\s*code", "pincode", "pin"]);
  const pinFromLabel = labeledPin && toDigits(labeledPin).match(/^[1-9]\d{5}/);

  const pinCandidateRe = /\b[1-9]\d{5}\b/g;
  const rawCandidates = [...flat.matchAll(pinCandidateRe)].map((m) => m[0]);
  const candidates = result.mobile
    ? rawCandidates.filter((c) => !result.mobile.includes(c))
    : rawCandidates;

  if (pinFromLabel) {
    result.pincode = pinFromLabel[0];
  } else if (validPincodes && validPincodes.size > 0) {
    const known = candidates.find((c) => validPincodes.has(c));
    result.pincode = known || candidates[0] || "";
  } else {
    result.pincode = candidates[0] || "";
  }

  // Card number: look for the known prefix (allowing OCR to have split its
  // letters/digits with stray spaces, or swapped a digit for a look-alike
  // letter — e.g. "M26O" instead of "M260"), else fall back to a labeled
  // line.
  const prefixPattern = cardPrefix
    .split("")
    .map((ch) => DIGIT_CHAR_CLASS[ch] || ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s*");
  const prefixRe = new RegExp(prefixPattern + "[\\s-]*([0-9oOiIlLzZsSbB]{3,8})", "i");
  const prefixMatch = flat.match(prefixRe);
  if (prefixMatch) {
    result.cardNumber = cardPrefix + toDigits(prefixMatch[1]);
  } else {
    const labeled = findLabeledValue(lines, ["card\\s*no\\.?", "card\\s*number"]);
    if (labeled) result.cardNumber = labeled.toUpperCase().replace(/\s/g, "");
  }

  // Category: keyword match anywhere in the text.
  const lower = flat.toLowerCase();
  for (const cat of CATEGORY_KEYWORDS) {
    if (cat.words.some((w) => lower.includes(w.toLowerCase()))) {
      result.category = cat.key;
      break;
    }
  }

  // Name: prefer an explicitly labeled line ("Name: ..."), else the first
  // clean-looking line of letters that isn't a field label itself.
  result.name = findLabeledValue(lines, ["name", "नाव"]);
  if (!result.name) {
    const candidate = lines.find(
      (l) => /^[A-Za-z .]{4,40}$/.test(l) && !NOISE_WORDS.test(l)
    );
    if (candidate) result.name = candidate;
  }

  // Village: prefer an explicitly labeled line. This is kept only as a
  // fallback guess — the caller cross-checks it against the official
  // village list for the detected pincode (see pincodeLookup.js) and
  // prefers that whenever the pincode is known.
  result.village = findLabeledValue(lines, ["village", "gaon", "गाव", "address", "addr"]);

  return result;
}