"use client";

export type LocalOriginalDraft = {
  draftId: number;
  revision: number;
  title: string;
  editorStateJson: string;
  tagIds: number[];
  unlockSodaPrice: number;
  savedAt: number;
};

const DB_NAME = "novel-reader-original-editor";
const STORE_NAME = "drafts";
const DB_VERSION = 1;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: "draftId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB unavailable"));
  });
}

export async function readLocalOriginalDraft(draftId: number): Promise<LocalOriginalDraft | null> {
  try {
    const db = await openDatabase();
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readonly");
      const request = transaction.objectStore(STORE_NAME).get(draftId);
      request.onsuccess = () => resolve((request.result as LocalOriginalDraft | undefined) || null);
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => db.close();
    });
  } catch {
    return null;
  }
}

export async function writeLocalOriginalDraft(draft: LocalOriginalDraft): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(draft);
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } catch {
    // Server autosave remains available when IndexedDB is blocked.
  }
}

export async function deleteLocalOriginalDraft(draftId: number): Promise<void> {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(draftId);
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    });
  } catch {
    // Ignore storage policy failures.
  }
}
