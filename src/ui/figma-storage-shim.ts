/**
 * Figma plugin UI runs in a sandboxed `data:` iframe where `localStorage` /
 * `sessionStorage` throw SecurityError. Spiral's ThemeProvider reads storage,
 * so install an in-memory shim first.
 */
const memory = new Map<string, string>();

const memoryStorage: Storage = {
  get length() {
    return memory.size;
  },
  clear() {
    memory.clear();
  },
  getItem(key) {
    return memory.has(key) ? memory.get(key)! : null;
  },
  key(index) {
    return [...memory.keys()][index] ?? null;
  },
  removeItem(key) {
    memory.delete(key);
  },
  setItem(key, value) {
    memory.set(String(key), String(value));
  }
};

const install = (name: 'localStorage' | 'sessionStorage') => {
  try {
    const storage = window[name];
    storage.getItem('__matchcat_probe__');
  } catch {
    Object.defineProperty(window, name, {
      configurable: true,
      enumerable: true,
      get: () => memoryStorage
    });
  }
};

install('localStorage');
install('sessionStorage');
