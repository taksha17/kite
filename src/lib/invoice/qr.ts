import QRCode from "qrcode";

/** Render the IRP SignedQRCode JWT as a PNG data URL for screen/PDF. */
export async function irnQrDataUrl(signedQr: string): Promise<string> {
  if (!signedQr.trim()) return "";
  return QRCode.toDataURL(signedQr, {
    errorCorrectionLevel: "M",
    margin: 0,
    width: 160,
    color: { dark: "#000000", light: "#ffffff" },
  });
}
