// Offline pincode -> village lookup, built from the official Maharashtra
// pincode directory (src/pincodeData.json). This replaces the old
// data.gov.in API call, which was slow, rate-limited, and would silently
// fail whenever a village had a bad/flaky internet connection — exactly the
// conditions this app is normally used in.
//
// pincodeData.json shape: { "<pincode>": { villages: string[], taluka, district } }
// Loaded as a lazy dynamic import so its ~550KB doesn't bloat the main app
// bundle — it's only fetched the first time someone actually looks up a
// pincode.

let dataPromise = null;

function loadData() {
  if (!dataPromise) {
    dataPromise = import("./pincodeData.json").then((mod) => mod.default || mod);
  }
  return dataPromise;
}

/**
 * @param {string} pin - 6-digit pincode
 * @returns {Promise<{villages: string[], taluka: string, district: string} | null>}
 */
export async function lookupPincode(pin) {
  const data = await loadData();
  return data[pin] || null;
}

/**
 * Returns a Set of every known pincode, used by the card-scan parser to
 * confirm which 6-digit number on a card is actually the pincode (cards
 * often also carry a card number, serial number, etc. that can look like
 * one).
 * @returns {Promise<Set<string>>}
 */
export async function getPincodeSet() {
  const data = await loadData();
  return new Set(Object.keys(data));
}

function normalize(s) {
  return (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * When a pincode has several villages sharing it (very common in rural
 * Maharashtra), try to pick the one that matches whatever village text the
 * OCR pass already guessed from the card, so the person doesn't have to
 * manually pick it every time.
 * @param {string[]} candidateVillages
 * @param {string} ocrGuess
 * @returns {string|null}
 */
export function pickBestVillage(candidateVillages, ocrGuess) {
  const guess = normalize(ocrGuess);
  if (!guess) return null;
  let match = candidateVillages.find((v) => normalize(v) === guess);
  if (match) return match;
  match = candidateVillages.find((v) => {
    const nv = normalize(v);
    return nv.length > 2 && (nv.includes(guess) || guess.includes(nv));
  });
  return match || null;
}
