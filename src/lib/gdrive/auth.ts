/**
 * Google sign-in for the serverless PWA.
 *
 * One OAuth token client covers both identity (userinfo endpoint) and
 * the Drive scope, so the user consents once. Access tokens live ~1 hour
 * in memory only; a stored profile keeps the UI signed-in across reloads
 * and tokens are refreshed silently on demand.
 */

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
const SCOPES =
  "openid email profile https://www.googleapis.com/auth/drive.appdata";
const PROFILE_KEY = "kite.google.profile";

export interface GoogleProfile {
  sub: string;
  name: string;
  email: string;
  picture: string;
}

let gsiPromise: Promise<void> | null = null;
let accessToken: string | null = null;
let tokenExpiresAt = 0;

export class GoogleInteractionRequired extends Error {
  constructor() {
    super("Google sign-in required again.");
    this.name = "GoogleInteractionRequired";
  }
}

/** The feature is only offered when a client ID was baked in at build time. */
export function googleAuthAvailable(): boolean {
  return Boolean(CLIENT_ID);
}

function loadGsi(): Promise<void> {
  if (gsiPromise) return gsiPromise;
  gsiPromise = new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Could not load Google sign-in."));
    document.head.appendChild(script);
  });
  return gsiPromise;
}

function requestToken(prompt: "consent" | ""): Promise<string> {
  if (!CLIENT_ID) {
    return Promise.reject(new Error("Google sign-in is not configured."));
  }
  return loadGsi().then(
    () =>
      new Promise<string>((resolve, reject) => {
        const client = window.google!.accounts.oauth2.initTokenClient({
          client_id: CLIENT_ID,
          scope: SCOPES,
          callback: (response) => {
            if (response.error || !response.access_token) {
              reject(
                response.error === "access_denied" && prompt === ""
                  ? new GoogleInteractionRequired()
                  : new Error(
                      response.error_description ||
                        response.error ||
                        "Google sign-in failed.",
                    ),
              );
              return;
            }
            accessToken = response.access_token;
            tokenExpiresAt = Date.now() + (response.expires_in - 60) * 1000;
            resolve(response.access_token);
          },
          error_callback: () =>
            reject(
              prompt === ""
                ? new GoogleInteractionRequired()
                : new Error("Google sign-in was closed."),
            ),
        });
        client.requestAccessToken({ prompt });
      }),
  );
}

async function fetchProfile(token: string): Promise<GoogleProfile> {
  const response = await fetch(
    "https://openidconnect.googleapis.com/v1/userinfo",
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!response.ok) throw new Error("Could not read your Google profile.");
  const data = (await response.json()) as GoogleProfile;
  return data;
}

/** Interactive sign-in (shows Google's consent sheet). */
export async function signInWithGoogle(): Promise<GoogleProfile> {
  const token = await requestToken("consent");
  const profile = await fetchProfile(token);
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
  } catch {
    // profile persistence is a nicety
  }
  return profile;
}

export function getGoogleProfile(): GoogleProfile | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    return raw ? (JSON.parse(raw) as GoogleProfile) : null;
  } catch {
    return null;
  }
}

/**
 * Token for Drive calls. Refreshes silently while the Google session is
 * alive; throws GoogleInteractionRequired when the user must re-consent.
 */
export async function getAccessToken(): Promise<string> {
  if (accessToken && Date.now() < tokenExpiresAt) return accessToken;
  return requestToken("");
}

export function signOutGoogle(): void {
  const token = accessToken;
  accessToken = null;
  tokenExpiresAt = 0;
  try {
    localStorage.removeItem(PROFILE_KEY);
  } catch {
    // ignore
  }
  if (token && window.google?.accounts?.oauth2) {
    window.google.accounts.oauth2.revoke(token, () => {});
  }
}
