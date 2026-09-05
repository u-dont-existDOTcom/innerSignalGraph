/**
 * Synthetic-only snapshot adapter for controller tests and prototypes.
 * It deliberately uses opaque object identity instead of persistence or hashes.
 * Do not substitute this for the approved real-history/vault adapter.
 */
const plain = value => value && typeof value === 'object' && !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));

const cloneFrozen = value => {
  const copy = structuredClone(value);
  const freeze = item => {
    if (item && typeof item === 'object') {
      for (const child of Object.values(item)) freeze(child);
      Object.freeze(item);
    }
    return item;
  };
  return freeze(copy);
};

export function createSyntheticSnapshotAdapter(initial) {
  if (!plain(initial)) throw new TypeError('Synthetic snapshot must be a plain record');
  let data = cloneFrozen(initial);
  let version = Object.freeze(Object.create(null));

  const advance = next => {
    if (!plain(next)) throw new TypeError('Synthetic snapshot must be a plain record');
    data = cloneFrozen(next);
    version = Object.freeze(Object.create(null));
  };

  return Object.freeze({
    capture() {
      return Object.freeze({ version, snapshot: data });
    },
    isCurrent(candidate) {
      return candidate === version;
    },
    replace(next) {
      advance(next);
    },
    invalidate() {
      version = Object.freeze(Object.create(null));
    }
  });
}
