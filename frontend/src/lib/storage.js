// localStorage-sleutels dragen de merknaam. Bij de hernoeming van Kompas naar
// MetricMelon verhuizen bestaande sleutels eenmalig mee, zodat gekozen
// property, periode, thema en organisatie bewaard blijven.

const LEGACY_PREFIX = "kompas-";
const PREFIX = "mm-";

export const key = (name) => `${PREFIX}${name}`;

export function migrateLegacyKeys() {
  for (const store of [localStorage, sessionStorage]) {
    try {
      const legacy = Object.keys(store).filter((k) => k.startsWith(LEGACY_PREFIX));
      for (const old of legacy) {
        const next = PREFIX + old.slice(LEGACY_PREFIX.length);
        if (store.getItem(next) === null) store.setItem(next, store.getItem(old));
        store.removeItem(old);
      }
    } catch {
      // Private mode of geblokkeerde storage: de app werkt door zonder voorkeuren.
    }
  }
}
