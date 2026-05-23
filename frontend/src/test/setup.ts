import '@testing-library/jest-dom';

class LocalStorageMock implements Storage {
  private store: Record<string, string> = {};

  clear() {
    this.store = {};
  }

  getItem(key: string): string | null {
    return this.store[key] || null;
  }

  setItem(key: string, value: string) {
    this.store[key] = String(value);
  }

  removeItem(key: string) {
    delete this.store[key];
  }

  get length(): number {
    return Object.keys(this.store).length;
  }

  key(index: number): string | null {
    return Object.keys(this.store)[index] || null;
  }
}

const mockStorage = new LocalStorageMock();

Object.defineProperty(globalThis, 'localStorage', {
  value: mockStorage,
  writable: true,
});

Object.defineProperty(globalThis, 'sessionStorage', {
  value: mockStorage,
  writable: true,
});

if (typeof window !== 'undefined') {
  Object.defineProperty(window, 'localStorage', {
    value: mockStorage,
    writable: true,
  });
  Object.defineProperty(window, 'sessionStorage', {
    value: mockStorage,
    writable: true,
  });
}

