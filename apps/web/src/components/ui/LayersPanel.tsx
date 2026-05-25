import React from "react";
import { useCanvasStore } from "@/store/canvas";

export const LayersPanel: React.FC = () => {
  const { objects, selectedObjectIds, selectObject, deleteObject } =
    useCanvasStore();

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    deleteObject(id);
  };

  return (
    <div className="w-56 bg-gray-50 border-r border-gray-300 overflow-y-auto max-h-screen">
      <div className="p-4 border-b border-gray-300">
        <h3 className="font-semibold text-gray-700">Objects ({objects.length})</h3>
      </div>

      <div className="p-2 space-y-1">
        {objects.length === 0 ? (
          <p className="text-sm text-gray-500 p-2">No objects yet</p>
        ) : (
          objects.map((obj) => (
            <div
              key={obj.id}
              className={`flex items-center justify-between p-2 rounded cursor-pointer text-sm transition-colors ${
                selectedObjectIds.has(obj.id)
                  ? "bg-blue-100 text-blue-900"
                  : "hover:bg-gray-100 text-gray-700"
              }`}
              onClick={() => selectObject(obj.id)}
            >
              <div className="flex items-center gap-2 flex-1 min-w-0">
                <span className="text-xs font-semibold text-gray-400 uppercase">
                  {obj.type === "rectangle" && "█"}
                  {obj.type === "ellipse" && "●"}
                  {obj.type === "text" && "T"}
                  {obj.type === "sticky" && "■"}
                  {obj.type === "arrow" && "→"}
                </span>
                <span className="truncate">
                  {obj.type} {obj.id.slice(0, 8)}
                </span>
              </div>

              <button
                onClick={(e) => handleDelete(obj.id, e)}
                className="p-1 hover:bg-red-200 hover:text-red-700 rounded ml-1"
                title="Delete object"
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default LayersPanel;
