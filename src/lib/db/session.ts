import type { AppUser } from "./users";

let currentUser: AppUser | null = null;

export function setCurrentUser(user: AppUser | null) {
  currentUser = user;
}

export function getCurrentUser(): AppUser | null {
  return currentUser;
}
