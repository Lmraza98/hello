export type Setter<T> = (value: T | ((prev: T) => T)) => void;

export type BridgeApi = {
  [key: string]: (...args: unknown[]) => Promise<unknown> | unknown;
};

export type UnknownRecord = Record<string, unknown>;
