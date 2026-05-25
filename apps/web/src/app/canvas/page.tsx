"use client";

import React, { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Toolbar from "@/components/ui/Toolbar";
import PropertiesPanel from "@/components/ui/PropertiesPanel";
import LayersPanel from "@/components/ui/LayersPanel";
import { useCanvasStore } from "@/store/canvas";
import { useCanvasKeyboardShortcuts } from "@/lib/canvas/keyboard";
import { createDemoObjects } from "@/lib/canvas/demo";
import { boardApi, objectApi } from "@/lib/api";
import { CanvasObject } from "@stackmap/shared";

const DEMO_BOARD_ID = "board_demo_123";
const Canvas = dynamic(() => import("@/components/canvas/Canvas"), {
  ssr: false,
});

export default function CanvasPage() {
  const { setBoard, setObjects, addObject, updateObject, deleteObject } =
    useCanvasStore();
  const [isLoading, setIsLoading] = useState(true);

  // Enable keyboard shortcuts
  useCanvasKeyboardShortcuts();

  // Load board on mount
  useEffect(() => {
    const loadBoard = async () => {
      try {
        // Try to fetch from API, fall back to demo data
        const response = await boardApi.get(DEMO_BOARD_ID);
        const board = response.data.data;
        if (!board) {
          throw new Error("Board response did not include data");
        }
        setBoard(board);
        setObjects(board.objects || createDemoObjects());
      } catch (error) {
        console.log("Using demo board");
        // Demo board setup with demo objects
        setBoard({
          id: DEMO_BOARD_ID,
          title: "Canvas Engine Demo",
          description: "Sprint 2 - Interactive Canvas",
          ownerId: "user_test",
          objects: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        });
        setObjects(createDemoObjects());
      } finally {
        setIsLoading(false);
      }
    };

    loadBoard();
  }, [setBoard, setObjects]);

  const handleObjectCreated = async (object: CanvasObject) => {
    try {
      const response = await objectApi.create(DEMO_BOARD_ID, object);
      addObject(response.data.data || object);
    } catch (error) {
      console.error("Failed to create object", error);
      addObject(object);
    }
  };

  const handleObjectUpdated = async (object: CanvasObject) => {
    try {
      const response = await objectApi.update(
        DEMO_BOARD_ID,
        object.id,
        object
      );
      updateObject(object.id, response.data.data || object);
    } catch (error) {
      console.error("Failed to update object", error);
      updateObject(object.id, object);
    }
  };

  const handleObjectDeleted = async (id: string) => {
    try {
      await objectApi.delete(DEMO_BOARD_ID, id);
      deleteObject(id);
    } catch (error) {
      console.error("Failed to delete object", error);
      deleteObject(id);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-lg text-gray-600">Loading canvas...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-white">
      {/* Header */}
      <div className="bg-white border-b border-gray-300 p-4">
        <h1 className="text-2xl font-bold text-gray-900">Stackmap Canvas</h1>
        <p className="text-sm text-gray-600">Sprint 2 Canvas Engine</p>
      </div>

      {/* Toolbar */}
      <Toolbar />

      {/* Main canvas area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Layers panel */}
        <LayersPanel />

        {/* Canvas */}
        <div className="flex-1 bg-white">
          <Canvas
            width={1200}
            height={800}
            onObjectCreated={handleObjectCreated}
            onObjectUpdated={handleObjectUpdated}
            onObjectDeleted={handleObjectDeleted}
          />
        </div>

        {/* Properties panel */}
        <PropertiesPanel />
      </div>
    </div>
  );
}
