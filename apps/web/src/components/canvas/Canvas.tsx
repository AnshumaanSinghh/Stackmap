import React, { useRef, useEffect, useState } from "react";
import Konva from "konva";
import { CanvasObject, RectangleObject } from "@stackmap/shared";
import { useCanvasStore } from "@/store/canvas";
import {
  generateObjectId,
  isPointInObject,
  snapToGrid,
  calculateSnapGuides,
  getBestSnapPosition,
} from "@/lib/canvas/utils";

interface CanvasProps {
  width?: number;
  height?: number;
  onObjectCreated?: (object: CanvasObject) => void;
  onObjectUpdated?: (object: CanvasObject) => void;
  onObjectDeleted?: (id: string) => void;
}

export const Canvas: React.FC<CanvasProps> = ({
  width = 1200,
  height = 800,
  onObjectCreated,
  onObjectUpdated,
  onObjectDeleted,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage | null>(null);
  const layerRef = useRef<Konva.Layer | null>(null);
  const [isInitialized, setIsInitialized] = useState(false);

  const {
    objects,
    selectedObjectIds,
    zoom,
    panX,
    panY,
    gridSize,
    showGrid,
    snapToGrid: snapEnabled,
    updateObject,
    selectObject,
    clearSelection,
    setDragging,
  } = useCanvasStore();

  // Initialize Konva stage
  useEffect(() => {
    if (!containerRef.current || isInitialized) return;

    const stage = new Konva.Stage({
      container: containerRef.current,
      width,
      height,
      draggable: true,
    });

    const layer = new Konva.Layer();
    stage.add(layer);

    stageRef.current = stage;
    layerRef.current = layer;

    // Handle click on stage
    stage.on("click", (e) => {
      if (e.target === stage) {
        clearSelection();
      }
    });

    // Handle zoom with mouse wheel
    stage.on("wheel", (e) => {
      e.evt.preventDefault();

      const oldScale = stage.scaleX();
      const pointer = stage.getPointerPosition();

      if (!pointer) return;

      const mousePointTo = {
        x: (pointer.x - stage.x()) / oldScale,
        y: (pointer.y - stage.y()) / oldScale,
      };

      const newScale =
        e.evt.deltaY > 0
          ? oldScale * 0.95
          : oldScale / 0.95;

      stage.scale({ x: newScale, y: newScale });

      const newPos = {
        x: pointer.x - mousePointTo.x * newScale,
        y: pointer.y - mousePointTo.y * newScale,
      };

      stage.position(newPos);
      layer.batchDraw();
    });

    setIsInitialized(true);

    return () => {
      stage.destroy();
    };
  }, [isInitialized, clearSelection]);

  // Render grid
  useEffect(() => {
    if (!layerRef.current) return;

    const layer = layerRef.current;

    // Clear grid lines
    layer.find(".grid-line").forEach((node) => node.destroy());

    if (!showGrid) {
      layer.draw();
      return;
    }

    // Draw grid
    for (let i = 0; i < width / gridSize; i++) {
      layer.add(
        new Konva.Line({
          points: [i * gridSize, 0, i * gridSize, height],
          stroke: "#e0e0e0",
          strokeWidth: 0.5,
          className: "grid-line",
        })
      );
    }

    for (let i = 0; i < height / gridSize; i++) {
      layer.add(
        new Konva.Line({
          points: [0, i * gridSize, width, i * gridSize],
          stroke: "#e0e0e0",
          strokeWidth: 0.5,
          className: "grid-line",
        })
      );
    }

    layer.draw();
  }, [showGrid, gridSize, width, height]);

  // Render objects
  useEffect(() => {
    if (!layerRef.current) return;

    const layer = layerRef.current;

    // Clear existing shapes
    layer.find("shape").forEach((shape) => {
      if (!shape.hasName("grid-line")) {
        shape.destroy();
      }
    });

    // Draw objects
    objects.forEach((obj) => {
      const isSelected = selectedObjectIds.has(obj.id);

      switch (obj.type) {
        case "rectangle": {
          const rectObj = obj as RectangleObject;
          const rect = new Konva.Rect({
            x: rectObj.x,
            y: rectObj.y,
            width: rectObj.width,
            height: rectObj.height,
            fill: rectObj.fill || "#3b82f6",
            stroke: isSelected ? "#1e40af" : rectObj.stroke || "black",
            strokeWidth: isSelected ? 2 : 1,
            id: obj.id,
            draggable: true,
          });

          rect.on("click", (e) => {
            e.cancelBubble = true;
            selectObject(obj.id, e.evt.ctrlKey || e.evt.metaKey);
          });

          rect.on("dragmove", () => {
            let newX = rect.x();
            let newY = rect.y();

            if (snapEnabled) {
              newX = snapToGrid(newX, gridSize);
              newY = snapToGrid(newY, gridSize);
            }

            rect.position({ x: newX, y: newY });

            updateObject(obj.id, { x: newX, y: newY });
            onObjectUpdated?.(
              { ...obj, x: newX, y: newY } as CanvasObject
            );
          });

          layer.add(rect);
          break;
        }

        case "text": {
          const text = new Konva.Text({
            x: obj.x,
            y: obj.y,
            text: "content" in obj ? obj.content : "Text",
            fontSize: "fontSize" in obj ? obj.fontSize : 16,
            fontFamily: "fontFamily" in obj ? obj.fontFamily : "Arial",
            fill: obj.fill || "black",
            id: obj.id,
            draggable: true,
          });

          text.on("click", (e) => {
            e.cancelBubble = true;
            selectObject(obj.id, e.evt.ctrlKey || e.evt.metaKey);
          });

          layer.add(text);
          break;
        }
      }
    });

    layerRef.current.draw();
  }, [objects, selectedObjectIds, selectObject, updateObject, snapEnabled, gridSize, onObjectUpdated]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full bg-white border border-gray-300 rounded"
    />
  );
};

export default Canvas;
