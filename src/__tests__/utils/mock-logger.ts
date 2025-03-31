import winston from "winston";

/**
 * Mock logger that can be used in tests
 * This mimics the interface of the real logger but doesn't output anything
 */
export const createMockLogger = (): ReturnType<typeof winston.createLogger> => {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    log: () => {}
  } as unknown as ReturnType<typeof winston.createLogger>;
}; 