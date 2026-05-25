import { useEffect } from "react";
import { useCanvasStore } from "@/store/canvas";

/**
 * Hook to handle keyboard shortcuts in the canvas
 */
export function useCanvasKeyboardShortcuts() {
  const {
    zoomIn,
    zoomOut,
    resetView,
    deleteSelected,
    clearSelection,
    setSelectedObjects,
    objects,
  } = useCanvasStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMeta = e.ctrlKey || e.metaKey;

      // Zoom shortcuts
      if (isMeta && e.key === "+") {
        e.preventDefault();
        zoomIn();
      }
      if (isMeta && (e.key === "-" || e.key === "_")) {
        e.preventDefault();
        zoomOut();
      }
      if (isMeta && e.key === "0") {
        e.preventDefault();
        resetView();
      }

      // Selection shortcuts
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        deleteSelected();
      }

      if (isMeta && e.key === "a") {
        e.preventDefault();
        setSelectedObjects(objects.map((obj) => obj.id));
      }

      if (e.key === "Escape") {
        e.preventDefault();
        clearSelection();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [zoomIn, zoomOut, resetView, deleteSelected, clearSelection, setSelectedObjects, objects]);
}

/**
 * Keyboard shortcuts reference
 */
export const KEYBOARD_SHORTCUTS = [
  { keys: "Ctrl/Cmd + +", action: "Zoom in" },
  { keys: "Ctrl/Cmd + -", action: "Zoom out" },
  { keys: "Ctrl/Cmd + 0", action: "Reset view" },
  { keys: "Delete", action: "Delete selected" },
  { keys: "Ctrl/Cmd + A", action: "Select all" },
  { keys: "Escape", action: "Deselect all" },
  { keys: "Click", action: "Select object" },
  { keys: "Ctrl/Cmd + Click", action: "Multi-select" },
  { keys: "Drag", action: "Move selected" },
  { keys: "Scroll", action: "Zoom in/out" },
];
