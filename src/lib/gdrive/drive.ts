/**
 * Minimal Google Drive API v3 client, scoped to the hidden appDataFolder.
 * Files there don't clutter the user's Drive and can't be edited by hand.
 */

const API = "https://www.googleapis.com/drive/v3";
const UPLOAD = "https://www.googleapis.com/upload/drive/v3";

export interface DriveFileRef {
  id: string;
  name: string;
  modifiedTime: string;
  size?: string;
}

async function checkOk(response: Response, what: string): Promise<void> {
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const data = (await response.json()) as { error?: { message?: string } };
      if (data.error?.message) detail = data.error.message;
    } catch {
      // keep status-only detail
    }
    throw new Error(`${what} failed: ${detail}`);
  }
}

export async function driveFindFile(
  token: string,
  name: string,
): Promise<DriveFileRef | null> {
  const q = encodeURIComponent(`name='${name.replace(/'/g, "\\'")}'`);
  const response = await fetch(
    `${API}/files?spaces=appDataFolder&q=${q}&fields=files(id,name,modifiedTime,size)&pageSize=5`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  await checkOk(response, "Drive search");
  const data = (await response.json()) as { files?: DriveFileRef[] };
  return data.files?.[0] ?? null;
}

/** Creates a new file in appDataFolder; returns its file id. */
export async function driveCreateFile(
  token: string,
  name: string,
  bytes: Uint8Array,
  mime = "application/octet-stream",
): Promise<string> {
  const boundary = "kite" + Math.random().toString(36).slice(2);
  const metadata = { name, parents: ["appDataFolder"] };
  const head =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify(metadata) +
    `\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`;
  const tail = `\r\n--${boundary}--`;
  const body = new Blob([head, bytes, tail]);

  const response = await fetch(`${UPLOAD}/files?uploadType=multipart&fields=id`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": `multipart/related; boundary=${boundary}`,
    },
    body,
  });
  await checkOk(response, "Drive upload");
  const data = (await response.json()) as { id: string };
  return data.id;
}

/** Overwrites a file's content (Drive keeps previous revisions ~30 days). */
export async function driveUpdateFile(
  token: string,
  fileId: string,
  bytes: Uint8Array,
  mime = "application/octet-stream",
): Promise<void> {
  const response = await fetch(
    `${UPLOAD}/files/${encodeURIComponent(fileId)}?uploadType=media`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": mime,
      },
      body: bytes,
    },
  );
  await checkOk(response, "Drive update");
}

export async function driveDownloadFile(
  token: string,
  fileId: string,
): Promise<Uint8Array> {
  const response = await fetch(
    `${API}/files/${encodeURIComponent(fileId)}?alt=media`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  await checkOk(response, "Drive download");
  return new Uint8Array(await response.arrayBuffer());
}
