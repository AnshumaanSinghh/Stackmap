/**
 * Shared Types - Core domain models used across Stackmap
 */

export type CanvasObjectType =
  | "rectangle"
  | "ellipse"
  | "arrow"
  | "text"
  | "sticky";

export interface BaseCanvasObject {
  id: string;
  type: CanvasObjectType;
  x: number;
  y: number;
  rotation: number;
  createdBy: string;
  updatedAt: number;
}

export interface RectangleObject extends BaseCanvasObject {
  type: "rectangle";
  width: number;
  height: number;
  fill?: string;
  stroke?: string;
}

export interface EllipseObject extends BaseCanvasObject {
  type: "ellipse";
  radiusX: number;
  radiusY: number;
  fill?: string;
  stroke?: string;
}

export interface TextObject extends BaseCanvasObject {
  type: "text";
  content: string;
  fontSize: number;
  fontFamily: string;
  fill?: string;
}

export interface StickyObject extends BaseCanvasObject {
  type: "sticky";
  content: string;
  color: string;
  width: number;
  height: number;
}

export interface ArrowObject extends BaseCanvasObject {
  type: "arrow";
  endX: number;
  endY: number;
  startObjectId?: string;
  endObjectId?: string;
  stroke?: string;
}

export type CanvasObject =
  | RectangleObject
  | EllipseObject
  | TextObject
  | StickyObject
  | ArrowObject;

export interface Board {
  id: string;
  title: string;
  description?: string;
  ownerId: string;
  objects: CanvasObject[];
  createdAt: Date;
  updatedAt: Date;
}

export interface User {
  id: string;
  email: string;
  name: string;
  avatar?: string;
}

// API Response types
export interface ApiResponse<T> {
  data?: T;
  error?: string;
  message?: string;
}

// WebSocket event types
export interface CursorUpdate {
  userId: string;
  roomId: string;
  x: number;
  y: number;
  userName: string;
}

export interface ObjectUpdate {
  roomId: string;
  object: CanvasObject;
  action: "create" | "update" | "delete";
}
