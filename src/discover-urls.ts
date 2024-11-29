import getUrls from "get-urls";
import type { logger as globalLogger } from "./utils/logger.js";

export function discoverUrls(
  logger: typeof globalLogger,
  text: string,
  /**
   * If undefined, all URLs will be downloaded.
   */
  whitelist: undefined | string[],
): string[] {
  logger.debug("Received download command", { text });
  if (whitelist !== undefined && whitelist.length === 0) return [];
  const urls = whitelist
    ? [...getUrls(text)].filter((url) => whitelist?.some((allowedUrl) => url.includes(allowedUrl)))
    : [...getUrls(text)];
  if (!urls.length) {
    logger.debug("No urls found");
    return [];
  }
  logger.debug("Found URLs", { urls });
  return urls;
}
