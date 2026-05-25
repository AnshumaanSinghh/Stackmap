/**
 * Realtime Engine - Yjs and Socket.io integration
 */

import * as Y from "yjs";

export const ydoc = new Y.Doc();
export const yObjects = ydoc.getMap("objects");
export const yUsers = ydoc.getMap("users");

export interface RealtimeConfig {
  roomId: string;
  userId: string;
}

export class RealtimeEngine {
  private doc: Y.Doc;
  private objectsMap: Y.Map<any>;
  private roomId: string;
  private userId: string;

  constructor(config: RealtimeConfig) {
    this.doc = new Y.Doc();
    this.objectsMap = this.doc.getMap("objects");
    this.roomId = config.roomId;
    this.userId = config.userId;
  }

  public addObject(objectId: string, data: any) {
    this.objectsMap.set(objectId, data);
  }

  public updateObject(objectId: string, data: any) {
    const existing = this.objectsMap.get(objectId);
    if (existing) {
      const updated = { ...existing, ...data };
      this.objectsMap.set(objectId, updated);
    }
  }

  public deleteObject(objectId: string) {
    this.objectsMap.delete(objectId);
  }

  public getObjects() {
    return Array.from(this.objectsMap.entries()).map(([id, data]) => ({
      id,
      ...data,
    }));
  }

  public observeObjects(callback: (update: any) => void) {
    this.objectsMap.observe((event) => {
      callback({
        added: Array.from(event.keysAdded),
        removed: Array.from(event.keysRemoved),
        updated: Array.from(event.keysUpdated),
      });
    });
  }
}

export default RealtimeEngine;
