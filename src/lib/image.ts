import sharp from "sharp";

export const TARGET_JOB_PHOTO_MAX_BYTES = 300 * 1024; // ~300 KB
const MAX_DIMENSION_PX = 1400;

export interface ProcessedJobPhoto {
  buffer: Buffer;
  contentType: "image/jpeg";
  sizeBytes: number;
}

/**
 * Strips ALL EXIF/GPS/camera metadata and compresses an uploaded job photo
 * to ~300 KB (or smaller) for fast loading on Nigerian mobile networks.
 *
 * Note: sharp strips all EXIF/XMP/IPTC metadata by default whenever `.withMetadata()`
 * is NOT called, and `.rotate()` auto-orients pixels before discarding EXIF orientation!
 */
export async function stripExifAndCompressJobPhoto(
  inputBuffer: Buffer,
  targetMaxBytes = TARGET_JOB_PHOTO_MAX_BYTES,
): Promise<ProcessedJobPhoto> {
  if (!inputBuffer || inputBuffer.length === 0) {
    throw new Error("Image file is empty.");
  }

  let widthLimit = MAX_DIMENSION_PX;
  let quality = 80;
  let output: Buffer = inputBuffer;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    output = await sharp(inputBuffer)
      .rotate() // Apply EXIF orientation to pixels, then strip all EXIF metadata
      .resize({
        width: widthLimit,
        height: widthLimit,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({
        quality,
        mozjpeg: true,
        progressive: true,
      })
      .toBuffer();

    if (output.length <= targetMaxBytes) {
      break;
    }

    if (quality > 45) {
      quality -= 12;
    } else {
      widthLimit = Math.max(640, Math.round(widthLimit * 0.75));
      quality = Math.max(35, quality - 5);
    }
  }

  return {
    buffer: output,
    contentType: "image/jpeg",
    sizeBytes: output.length,
  };
}
