import { execFile } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export class GalleryDownloadError extends Error {
  constructor(
    public galleryUrl: string,
    message: string | null,
  ) {
    super(message ?? "Failed to download gallery");
    this.name = "GalleryDownloadError";
  }
}

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp"]);

function findImageFiles(dir: string): string[] {
  const files: string[] = [];
  try {
    const entries = readdirSync(dir, { recursive: true });
    for (const entry of entries) {
      const filePath = join(dir, String(entry));
      const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
      if (IMAGE_EXTENSIONS.has(ext) && statSync(filePath).isFile()) {
        files.push(filePath);
      }
    }
  } catch {
    // Directory may not exist if download failed
  }
  return files;
}

export async function downloadGallery(outputDir: string, url: string): Promise<string[]> {
  await new Promise<void>((resolve, reject) => {
    execFile("gallery-dl", ["-d", outputDir, "--range", "1-10", "--filesize-max", "10M", url], (error) => {
      if (error) {
        reject(new GalleryDownloadError(url, error.message));
        return;
      }
      resolve();
    });
  });

  const files = findImageFiles(outputDir);
  if (files.length === 0) {
    throw new GalleryDownloadError(url, "No images found in gallery");
  }
  return files;
}
