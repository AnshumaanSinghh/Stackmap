import { CanvasObject } from "@stackmap/shared";

export interface SnapGuideLine {
  axis: "x" | "y";
  position: number;
  distance: number;
}

const SNAP_THRESHOLD = 10;

/**
 * Calculate snap guides for an object being moved
 */
export function calculateSnapGuides(
  movingObject: Partial<CanvasObject>,
  otherObjects: CanvasObject[],
  threshold: number = SNAP_THRESHOLD
): SnapGuideLine[] {
  const guides: SnapGuideLine[] = [];

  if (!movingObject.x || !movingObject.y) return guides;

  const movX = movingObject.x;
  const movY = movingObject.y;
  const movWidth = ("width" in movingObject && movingObject.width) || 0;
  const movHeight = ("height" in movingObject && movingObject.height) || 0;

  otherObjects.forEach((obj) => {
    // Check X alignment
    const alignments = [
      { pos: obj.x, name: "left" },
      { pos: obj.x + ("width" in obj && obj.width ? obj.width : 0) / 2, name: "center" },
      { pos: obj.x + ("width" in obj && obj.width ? obj.width : 0), name: "right" },
    ];

    alignments.forEach((align) => {
      const distance = Math.abs(movX - align.pos);
      if (distance < threshold && distance < 50) {
        guides.push({
          axis: "x",
          position: align.pos,
          distance,
        });
      }
    });

    // Check Y alignment
    const verticalAlignments = [
      { pos: obj.y, name: "top" },
      { pos: obj.y + ("height" in obj && obj.height ? obj.height : 0) / 2, name: "center" },
      { pos: obj.y + ("height" in obj && obj.height ? obj.height : 0), name: "bottom" },
    ];

    verticalAlignments.forEach((align) => {
      const distance = Math.abs(movY - align.pos);
      if (distance < threshold && distance < 50) {
        guides.push({
          axis: "y",
          position: align.pos,
          distance,
        });
      }
    });
  });

  return guides;
}

/**
 * Snap a position to grid
 */
export function snapToGrid(value: number, gridSize: number): number {
  return Math.round(value / gridSize) * gridSize;
}

/**
 * Get the best snap position from guides
 */
export function getBestSnapPosition(
  guides: SnapGuideLine[],
  axis: "x" | "y"
): number | null {
  const axisGuides = guides.filter((g) => g.axis === axis);
  if (axisGuides.length === 0) return null;

  const closest = axisGuides.reduce((prev, curr) =>
    curr.distance < prev.distance ? curr : prev
  );

  return closest.position;
}

/**
 * Calculate object bounds
 */
export function calculateObjectBounds(objects: CanvasObject[]) {
  if (objects.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  }

  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;

  objects.forEach((obj) => {
    minX = Math.min(minX, obj.x);
    minY = Math.min(minY, obj.y);
    maxX = Math.max(maxX, obj.x + (("width" in obj && obj.width) || 100));
    maxY = Math.max(maxY, obj.y + (("height" in obj && obj.height) || 100));
  });

  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Check if point is inside object
 */
export function isPointInObject(
  point: { x: number; y: number },
  object: CanvasObject
): boolean {
  const px = point.x;
  const py = point.y;

  switch (object.type) {
    case "rectangle":
    case "sticky":
    case "text":
      if (!("width" in object) || !("height" in object)) return false;
      return (
        px >= object.x &&
        px <= object.x + object.width &&
        py >= object.y &&
        py <= object.y + object.height
      );

    case "ellipse":
      if (!("radiusX" in object) || !("radiusY" in object)) return false;
      const dx = px - (object.x + object.radiusX);
      const dy = py - (object.y + object.radiusY);
      return (
        (dx * dx) / (object.radiusX * object.radiusX) +
          (dy * dy) / (object.radiusY * object.radiusY) <=
        1
      );

    case "arrow":
      // Simplified: check bounding box
      if (!("endX" in object) || !("endY" in object)) return false;
      const minX = Math.min(object.x, object.endX);
      const maxX = Math.max(object.x, object.endX);
      const minY = Math.min(object.y, object.endY);
      const maxY = Math.max(object.y, object.endY);
      return px >= minX && px <= maxX && py >= minY && py <= maxY;

    default:
      return false;
  }
}

/**
 * Generate a unique ID
 */
export function generateObjectId(): string {
  return `obj_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
