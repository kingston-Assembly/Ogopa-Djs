/**
 * IndexedDB Persistent Storage for Ogopa DJ's Tracks, Audio Blobs & Playlists
 * Uses idb wrapper for offline-first persistent storage.
 */

import { openDB, DBSchema, IDBPDatabase } from 'idb';
import { DJTrack } from '../utils/crateLogic.js';
import { synthesizeDemoTrack } from '../audio/demoTracks.js';

interface OgopaDBSchema extends DBSchema {
  tracks: {
    key: string;
    value: DJTrack;
    indexes: {
      'by-bpm': number;
      'by-camelot': string;
      'by-genre': string;
    };
  };
  audioBlobs: {
    key: string;
    value: Blob;
  };
  crates: {
    key: string;
    value: {
      id: string;
      name: string;
      icon?: string;
    };
  };
}

const DB_NAME = 'ogopa-djs-db';
const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase<OgopaDBSchema>> | null = null;

// In-memory audio buffer cache for zero-delay deck loading
export const audioBufferCache = new Map<string, AudioBuffer>();

export async function getDb(): Promise<IDBPDatabase<OgopaDBSchema>> {
  if (!dbPromise) {
    dbPromise = openDB<OgopaDBSchema>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (!db.objectStoreNames.contains('tracks')) {
          const trackStore = db.createObjectStore('tracks', { keyPath: 'id' });
          trackStore.createIndex('by-bpm', 'bpm');
          trackStore.createIndex('by-camelot', 'camelot');
          trackStore.createIndex('by-genre', 'genre');
        }
        if (!db.objectStoreNames.contains('audioBlobs')) {
          db.createObjectStore('audioBlobs');
        }
        if (!db.objectStoreNames.contains('crates')) {
          db.createObjectStore('crates', { keyPath: 'id' });
        }
      },
    });
  }
  return dbPromise;
}

/**
 * Requests browser persistent storage to prevent eviction
 */
export async function requestPersistentStorage(): Promise<boolean> {
  if (navigator.storage && navigator.storage.persist) {
    const isPersisted = await navigator.storage.persist();
    return isPersisted;
  }
  return false;
}

export async function saveTrackWithBlob(track: DJTrack, blob?: Blob): Promise<void> {
  const db = await getDb();
  // Don't store huge blob directly inside track metadata object
  const { audioBlob, ...metaOnly } = track;
  await db.put('tracks', metaOnly);

  if (blob || audioBlob) {
    const targetBlob = blob || audioBlob;
    if (targetBlob) {
      await db.put('audioBlobs', targetBlob, track.id);
    }
  }
}

export async function getTrackBlob(trackId: string): Promise<Blob | undefined> {
  const db = await getDb();
  return db.get('audioBlobs', trackId);
}

export async function getAllTracksFromDb(): Promise<DJTrack[]> {
  const db = await getDb();
  return db.getAll('tracks');
}

export async function deleteTrackFromDb(id: string): Promise<void> {
  const db = await getDb();
  await db.delete('tracks', id);
  await db.delete('audioBlobs', id);
  audioBufferCache.delete(id);
}

export async function toggleTrackFavoriteInDb(id: string, isFav: boolean): Promise<void> {
  const db = await getDb();
  const track = await db.get('tracks', id);
  if (track) {
    track.isFavorite = isFav;
    await db.put('tracks', track);
  }
}

/**
 * Resolves an AudioBuffer for any track (in-memory, demo, or decoded from IndexedDB blob)
 */
export async function resolveAudioBufferForTrack(
  track: DJTrack,
  ctx: AudioContext,
  providedBuffer?: AudioBuffer
): Promise<AudioBuffer | null> {
  // 1. Provided directly (e.g. freshly decoded during upload)
  if (providedBuffer) {
    audioBufferCache.set(track.id, providedBuffer);
    return providedBuffer;
  }

  // 2. In-memory cache
  if (audioBufferCache.has(track.id)) {
    return audioBufferCache.get(track.id)!;
  }

  // 3. Demo track synthesis
  if (track.isDemo) {
    const synthesized = synthesizeDemoTrack(ctx, track.id);
    audioBufferCache.set(track.id, synthesized.buffer);
    return synthesized.buffer;
  }

  // 4. In-memory blob on track
  if (track.audioBlob) {
    try {
      const arrayBuffer = await track.audioBlob.arrayBuffer();
      const decoded = await ctx.decodeAudioData(arrayBuffer);
      audioBufferCache.set(track.id, decoded);
      return decoded;
    } catch {
      // fallback to indexedDB
    }
  }

  // 5. Retrieve stored Blob from IndexedDB
  try {
    const blob = await getTrackBlob(track.id);
    if (blob) {
      const arrayBuffer = await blob.arrayBuffer();
      const decoded = await ctx.decodeAudioData(arrayBuffer);
      audioBufferCache.set(track.id, decoded);
      return decoded;
    }
  } catch (err) {
    console.error('Failed to resolve audio buffer from storage', err);
  }

  return null;
}
