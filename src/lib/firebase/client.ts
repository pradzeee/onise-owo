"use client";

import { getApp, getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? "",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? "",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ?? "",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID ?? "",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID ?? "",
};

/** Returns true when public Firebase Web SDK configuration is present. */
export function isFirebaseClientConfigured(): boolean {
  return Boolean(
    firebaseConfig.apiKey &&
      firebaseConfig.authDomain &&
      firebaseConfig.projectId &&
      firebaseConfig.appId,
  );
}

/** Returns the singleton Firebase App instance on the browser. */
export function getFirebaseApp(): FirebaseApp {
  if (!isFirebaseClientConfigured()) {
    throw new Error("Firebase client configuration is missing.");
  }
  return getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
}

/** Returns the Firebase Auth client instance. */
export function getFirebaseAuth(): Auth {
  return getAuth(getFirebaseApp());
}

/** Returns the Cloud Firestore client instance. */
export function getFirebaseDb(): Firestore {
  return getFirestore(getFirebaseApp());
}

/** Returns a configured Google OAuth provider that prompts account selection cleanly. */
export function getGoogleAuthProvider(): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  provider.addScope("email");
  provider.addScope("profile");
  provider.setCustomParameters({ prompt: "select_account" });
  return provider;
}

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  "auth/email-already-in-use":
    "An account with this email already exists. Please log in instead.",
  "auth/invalid-credential":
    "Invalid email or password. Please check your details and try again.",
  "auth/wrong-password":
    "Incorrect password. Please try again or reset your password.",
  "auth/user-not-found":
    "No account found with this email. Please sign up first.",
  "auth/weak-password": "Password must be at least 6 characters long.",
  "auth/invalid-email": "Please enter a valid email address.",
  "auth/popup-closed-by-user":
    "Google sign-in was cancelled before finishing. Please try again.",
  "auth/popup-blocked":
    "Your browser blocked the Google popup. Please allow popups for this site and retry.",
  "auth/cancelled-popup-request":
    "Another sign-in popup is already open. Please finish or retry.",
  "auth/unauthorized-domain":
    "This domain is not yet authorized for Google Sign-In in Firebase settings.",
  "auth/too-many-requests":
    "Too many attempts right now. Please wait a couple of minutes and try again.",
  "auth/user-disabled":
    "This account has been disabled or suspended. Contact support for help.",
  "auth/account-exists-with-different-credential":
    "An account already exists for this email using password login. Sign in with your password instead.",
  "auth/network-request-failed":
    "Network error connecting to authentication servers. Check your internet and try again.",
};

/** Maps Firebase Auth errors to clear, user-friendly UI error messages. */
export function mapFirebaseAuthError(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    const code = String((error as { code?: unknown }).code ?? "");
    if (code in AUTH_ERROR_MESSAGES) {
      return AUTH_ERROR_MESSAGES[code];
    }
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Authentication could not be completed. Please try again.";
}
