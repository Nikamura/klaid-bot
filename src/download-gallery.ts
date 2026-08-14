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
const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".mkv", ".webm"]);

function findMediaFiles(dir: string, extensions: Set<string>): string[] {
  const files: string[] = [];
  try {
    const entries = readdirSync(dir, { recursive: true });
    for (const entry of entries) {
      const filePath = join(dir, String(entry));
      const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
      if (extensions.has(ext) && statSync(filePath).isFile()) {
        files.push(filePath);
      }
    }
  } catch {
    // Directory may not exist if download failed
  }
  return files;
}

function findImageFiles(dir: string): string[] {
  return findMediaFiles(dir, IMAGE_EXTENSIONS);
}

function findVideoFiles(dir: string): string[] {
  return findMediaFiles(dir, VIDEO_EXTENSIONS);
}

async function runGalleryDl(outputDir: string, url: string, maxFileSize: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    execFile("gallery-dl", ["-d", outputDir, "--range", "1-10", "--filesize-max", maxFileSize, url], (error) => {
      if (error) {
        reject(new GalleryDownloadError(url, error.message));
        return;
      }
      resolve();
    });
  });
}

export async function downloadGallery(outputDir: string, url: string): Promise<string[]> {
  await runGalleryDl(outputDir, url, "10M");

  const files = findImageFiles(outputDir);
  if (files.length === 0) {
    throw new GalleryDownloadError(url, "No images found in gallery");
  }
  return files;
}

export async function downloadGalleryVideo(outputDir: string, url: string): Promise<string> {
  await runGalleryDl(outputDir, url, "50M");

  const files = findVideoFiles(outputDir);
  if (files.length === 0) {
    throw new GalleryDownloadError(url, "No video found in gallery download");
  }
  return files[0];
}
