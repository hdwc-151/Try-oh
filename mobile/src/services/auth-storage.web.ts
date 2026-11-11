const memory = new Map<string, string>();

const browserStorage = () => typeof window === 'undefined' ? null : window.localStorage;

export const authStorage = {
  getItem: async (key: string) => browserStorage()?.getItem(key) ?? memory.get(key) ?? null,
  setItem: async (key: string, value: string) => {
    const storage = browserStorage();
    if (storage) storage.setItem(key, value);
    else memory.set(key, value);
  },
  removeItem: async (key: string) => {
    const storage = browserStorage();
    if (storage) storage.removeItem(key);
    memory.delete(key);
  },
};
