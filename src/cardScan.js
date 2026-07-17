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

const NOISE_WORDS = /card|number|no\.?|mobile|phone|village|category|date|name/i;

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
 * @returns {{name:string, mobile:string, cardNumber:string, village:string, category:string, pincode:string}}
 */
export function parseCardText(rawText, cardPrefix) {
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

  // Pincode: 6-digit Indian PIN code (first digit 1-9), preferring a labeled
  // "PIN"/"Pincode" line, else the first standalone 6-digit number that
  // isn't just part of the 10-digit mobile number already matched above.
  const labeledPin = findLabeledValue(lines, ["pin\\s*code", "pincode", "pin"]);
  const pinFromLabel = labeledPin && labeledPin.match(/\b[1-9]\d{5}\b/);
  if (pinFromLabel) {
    result.pincode = pinFromLabel[0];
  } else {
    const searchText = result.mobile ? flat.replace(result.mobile, " ") : flat;
    const pinMatch = searchText.match(/\b[1-9]\d{5}\b/);
    if (pinMatch) result.pincode = pinMatch[0];
  }

  // Card number: look for the known prefix (allowing OCR to have split its
  // letters/digits with stray spaces), else fall back to a labeled line.
  const prefixPattern = cardPrefix
    .split("")
    .map((ch) => ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s*");
  const prefixRe = new RegExp(prefixPattern + "[\\s-]*([0-9]{3,8})", "i");
  const prefixMatch = flat.match(prefixRe);
  if (prefixMatch) {
    result.cardNumber = cardPrefix + prefixMatch[1].replace(/\s/g, "");
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

  // Village: prefer an explicitly labeled line. (If a pincode was found,
  // the caller will prefer looking up the official village/post-office
  // name from the pincode over this OCR guess.)
  result.village = findLabeledValue(lines, ["village", "gaon", "गाव", "address", "addr"]);

  return result;
}
