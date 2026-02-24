export {};

declare global {
  interface Window {
    __LP_DEBUG__?: boolean;
    pywebview?: {
      api?: {
        [key: string]: (...args: unknown[]) => Promise<unknown> | unknown;
      };
    };
  }
}

