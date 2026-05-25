import React from "react";
import { useCanvasStore } from "@/store/canvas";

export const PropertiesPanel: React.FC = () => {
  const { objects, selectedObjectIds } = useCanvasStore();

  const selectedObjects = Array.from(selectedObjectIds)
    .map((id) => objects.find((obj) => obj.id === id))
    .filter(Boolean);

  if (selectedObjects.length === 0) {
    return (
      <div className="w-64 bg-gray-50 border-l border-gray-300 p-4">
        <h3 className="font-semibold text-gray-700 mb-4">Properties</h3>
        <p className="text-sm text-gray-500">Select an object to edit properties</p>
      </div>
    );
  }

  const obj = selectedObjects[0];

  return (
    <div className="w-64 bg-gray-50 border-l border-gray-300 p-4 overflow-y-auto">
      <h3 className="font-semibold text-gray-700 mb-4">Properties</h3>

      {selectedObjects.length > 1 && (
        <div className="mb-4 p-2 bg-blue-50 border border-blue-200 rounded text-sm text-blue-700">
          {selectedObjects.length} objects selected
        </div>
      )}

      {/* Object info */}
      <div className="mb-4 space-y-2">
        <div>
          <label className="text-xs font-semibold text-gray-600">Type</label>
          <p className="text-sm text-gray-900 capitalize">{obj?.type}</p>
        </div>

        <div>
          <label className="text-xs font-semibold text-gray-600">ID</label>
          <p className="text-xs text-gray-500 font-mono break-all">{obj?.id}</p>
        </div>
      </div>

      <div className="border-t border-gray-300 my-4" />

      {/* Position and size */}
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs font-semibold text-gray-600">X</label>
            <input
              type="number"
              value={Math.round(obj?.x || 0)}
              readOnly
              className="w-full px-2 py-1 text-sm border border-gray-300 rounded bg-white"
            />
          </div>
          <div>
            <label className="text-xs font-semibold text-gray-600">Y</label>
            <input
              type="number"
              value={Math.round(obj?.y || 0)}
              readOnly
              className="w-full px-2 py-1 text-sm border border-gray-300 rounded bg-white"
            />
          </div>
        </div>

        {obj && "width" in obj && obj.width && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-semibold text-gray-600">Width</label>
              <input
                type="number"
                value={Math.round(obj.width)}
                readOnly
                className="w-full px-2 py-1 text-sm border border-gray-300 rounded bg-white"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-gray-600">Height</label>
              <input
                type="number"
                value={Math.round((obj.height || 0))}
                readOnly
                className="w-full px-2 py-1 text-sm border border-gray-300 rounded bg-white"
              />
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-gray-300 my-4" />

      {/* Appearance */}
      {obj && ("fill" in obj || "stroke" in obj) && (
        <div className="space-y-3">
          <h4 className="text-xs font-semibold text-gray-700">Appearance</h4>

          {"fill" in obj && obj.fill && (
            <div>
              <label className="text-xs font-semibold text-gray-600">Fill</label>
              <div className="flex items-center gap-2">
                <div
                  className="w-8 h-8 rounded border border-gray-300"
                  style={{ backgroundColor: obj.fill }}
                />
                <span className="text-xs text-gray-600">{obj.fill}</span>
              </div>
            </div>
          )}

          {obj && "stroke" in obj && obj.stroke && (
            <div>
              <label className="text-xs font-semibold text-gray-600">Stroke</label>
              <div className="flex items-center gap-2">
                <div
                  className="w-8 h-8 rounded border border-gray-300"
                  style={{ backgroundColor: obj.stroke }}
                />
                <span className="text-xs text-gray-600">{obj.stroke}</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default PropertiesPanel;
