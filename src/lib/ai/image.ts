/** Max edge length after resize — enough for OCR, small enough for free models. */
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.72;
const MAX_BYTES = 1_800_000; // ~1.8 MB data URL budget

/**
 * Read a camera/gallery File into a compressed JPEG data URL suitable for
 * vision APIs. Keeps free-tier payloads small without killing bill text.
 */
export async function fileToBillDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Please pick a photo of the bill (JPG, PNG, or WebP).");
  }
  if (file.size > 12 * 1024 * 1024) {
    throw new Error("That image is too large — try a clearer photo under 12 MB.");
  }

  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Could not prepare the image for upload.");
    ctx.drawImage(bitmap, 0, 0, w, h);

    let quality = JPEG_QUALITY;
    let dataUrl = canvas.toDataURL("image/jpeg", quality);
    while (dataUrl.length > MAX_BYTES && quality > 0.4) {
      quality -= 0.08;
      dataUrl = canvas.toDataURL("image/jpeg", quality);
    }
    if (dataUrl.length > MAX_BYTES) {
      throw new Error(
        "Could not compress the photo enough — try cropping to the bill only.",
      );
    }
    return dataUrl;
  } finally {
    bitmap.close();
  }
}

export function splitDataUrl(dataUrl: string): { mime: string; base64: string } {
  const m = /^data:([^;]+);base64,(.+)$/s.exec(dataUrl);
  if (!m) throw new Error("Invalid image data.");
  return { mime: m[1], base64: m[2] };
}
