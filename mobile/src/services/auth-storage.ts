const memory = new Map<string, string>();

export const authStorage = {
  getItem: async (key: string) => memory.get(key) ?? null,
  setItem: async (key: string, value: string) => { memory.set(key, value); },
  removeItem: async (key: string) => { memory.delete(key); },
};
