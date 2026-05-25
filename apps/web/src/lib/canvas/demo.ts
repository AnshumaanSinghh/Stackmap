import { RectangleObject, TextObject } from "@stackmap/shared";
import { generateObjectId } from "./utils";

/**
 * Create demo objects for testing
 */
export function createDemoObjects() {
  const objects: (RectangleObject | TextObject)[] = [
    {
      id: generateObjectId(),
      type: "rectangle",
      x: 100,
      y: 100,
      width: 150,
      height: 100,
      rotation: 0,
      fill: "#3b82f6",
      stroke: "#1e40af",
      createdBy: "user_test",
      updatedAt: Date.now(),
    },
    {
      id: generateObjectId(),
      type: "rectangle",
      x: 350,
      y: 100,
      width: 150,
      height: 100,
      rotation: 0,
      fill: "#ef4444",
      stroke: "#991b1b",
      createdBy: "user_test",
      updatedAt: Date.now(),
    },
    {
      id: generateObjectId(),
      type: "rectangle",
      x: 600,
      y: 100,
      width: 150,
      height: 100,
      rotation: 0,
      fill: "#10b981",
      stroke: "#065f46",
      createdBy: "user_test",
      updatedAt: Date.now(),
    },
    {
      id: generateObjectId(),
      type: "text",
      x: 150,
      y: 250,
      rotation: 0,
      content: "Canvas Engine",
      fontSize: 24,
      fontFamily: "Arial",
      fill: "#1f2937",
      createdBy: "user_test",
      updatedAt: Date.now(),
    },
    {
      id: generateObjectId(),
      type: "text",
      x: 150,
      y: 300,
      rotation: 0,
      content: "Sprint 2 - Click objects to select, drag to move, scroll to zoom",
      fontSize: 14,
      fontFamily: "Arial",
      fill: "#6b7280",
      createdBy: "user_test",
      updatedAt: Date.now(),
    },
  ];

  return objects;
}
