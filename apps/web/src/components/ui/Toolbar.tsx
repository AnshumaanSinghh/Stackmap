import React from "react";
import { useCanvasStore } from "@/store/canvas";

export const Toolbar: React.FC = () => {
  const {
    zoom,
    showGrid,
    snapToGrid,
    zoomIn,
    zoomOut,
    resetView,
    zoomToFit,
    setShowGrid,
    setSnapToGrid,
  } = useCanvasStore();

  return (
    <div className="flex items-center gap-4 p-4 bg-gray-100 border-b border-gray-300">
      {/* Zoom controls */}
      <div className="flex items-center gap-2">
        <button
          onClick={zoomOut}
          className="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50"
          title="Zoom out (Ctrl+-)"
        >
          −
        </button>
        <span className="px-3 py-2 text-sm font-medium text-gray-700 min-w-[60px] text-center">
          {Math.round(zoom * 100)}%
        </span>
        <button
          onClick={zoomIn}
          className="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50"
          title="Zoom in (Ctrl++)"
        >
          +
        </button>
      </div>

      <div className="w-px h-6 bg-gray-300" />

      {/* View controls */}
      <div className="flex items-center gap-2">
        <button
          onClick={resetView}
          className="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50"
          title="Reset view"
        >
          Reset
        </button>
        <button
          onClick={zoomToFit}
          className="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded hover:bg-gray-50"
          title="Zoom to fit all objects"
        >
          Fit All
        </button>
      </div>

      <div className="w-px h-6 bg-gray-300" />

      {/* Grid and snap */}
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={showGrid}
            onChange={(e) => setShowGrid(e.target.checked)}
            className="w-4 h-4"
            title="Toggle grid visibility"
          />
          <span className="text-sm font-medium text-gray-700">Grid</span>
        </label>

        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={snapToGrid}
            onChange={(e) => setSnapToGrid(e.target.checked)}
            className="w-4 h-4"
            title="Toggle snap to grid"
          />
          <span className="text-sm font-medium text-gray-700">Snap</span>
        </label>
      </div>

      <div className="flex-1" />

      {/* Help text */}
      <div className="text-xs text-gray-500 pr-4">
        Click objects to select • Ctrl+Click to multi-select • Drag to move • Scroll to zoom
      </div>
    </div>
  );
};

export default Toolbar;
