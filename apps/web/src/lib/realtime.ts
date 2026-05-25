import io, { Socket } from "socket.io-client";
import { CursorUpdate, ObjectUpdate } from "@stackmap/shared";

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "http://localhost:4001";

export class RealtimeClient {
  private socket: Socket | null = null;
  private roomId: string | null = null;
  private userId: string | null = null;

  connect(userId: string) {
    this.userId = userId;
    this.socket = io(WS_URL, {
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionAttempts: 5,
    });

    this.socket.on("connect", () => {
      console.log("Connected to WebSocket");
    });

    this.socket.on("disconnect", () => {
      console.log("Disconnected from WebSocket");
    });

    return this.socket;
  }

  joinRoom(roomId: string) {
    this.roomId = roomId;
    this.socket?.emit("join-room", { roomId });
  }

  leaveRoom() {
    if (this.roomId) {
      this.socket?.emit("leave-room", { roomId: this.roomId });
      this.roomId = null;
    }
  }

  updateCursor(x: number, y: number, userName: string) {
    if (!this.roomId || !this.userId) return;

    const payload: CursorUpdate = {
      userId: this.userId,
      roomId: this.roomId,
      x,
      y,
      userName,
    };

    this.socket?.emit("cursor-update", payload);
  }

  sendObjectUpdate(object: any, action: "create" | "update" | "delete") {
    if (!this.roomId) return;

    const payload: ObjectUpdate = {
      roomId: this.roomId,
      object,
      action,
    };

    this.socket?.emit("update", payload);
  }

  onCursorUpdate(callback: (payload: CursorUpdate) => void) {
    this.socket?.on("cursor-update", callback);
  }

  onObjectUpdate(callback: (payload: ObjectUpdate) => void) {
    this.socket?.on("update", callback);
  }

  offCursorUpdate(callback?: (payload: CursorUpdate) => void) {
    this.socket?.off("cursor-update", callback);
  }

  offObjectUpdate(callback?: (payload: ObjectUpdate) => void) {
    this.socket?.off("update", callback);
  }

  disconnect() {
    this.leaveRoom();
    this.socket?.disconnect();
    this.socket = null;
  }
}

export const realtimeClient = new RealtimeClient();
