# Canvas Engine - Quick Implementation Guide

## 🚀 Getting Started with Canvas Sprint 2

### Prerequisites
- Node.js 18+
- pnpm 9+
- Docker running (for API & database)

### Quick Setup

```bash
# 1. Install dependencies
pnpm install

# 2. Start services
docker-compose up -d

# 3. Setup database
pnpm db:push

# 4. Start development servers
pnpm dev
```

The canvas will be available at: **http://localhost:3000/canvas**

---

## 📁 Key Files for Canvas Development

### Frontend Components
- `apps/web/src/app/canvas/page.tsx` - Main canvas page
- `apps/web/src/components/canvas/Canvas.tsx` - Konva canvas component
- `apps/web/src/components/ui/Toolbar.tsx` - Zoom and view controls
- `apps/web/src/components/ui/LayersPanel.tsx` - Object list
- `apps/web/src/components/ui/PropertiesPanel.tsx` - Object properties

### State Management
- `apps/web/src/store/canvas.ts` - Zustand store with canvas logic
- `apps/web/src/lib/canvas/utils.ts` - Snap, bounds, interaction utilities
- `apps/web/src/lib/api.ts` - API client

### Backend API
- `apps/api/src/index.ts` - Fastify server setup
- `apps/api/src/routes/boards.ts` - Board CRUD endpoints
- `apps/api/src/routes/objects.ts` - Object CRUD endpoints
- `apps/api/src/middleware/auth.ts` - Authentication

### Database
- `prisma/schema.prisma` - Database models

---

## 🎯 Next Tasks to Complete

### Immediate (This Session)
1. [ ] Create rectangle object add functionality
2. [ ] Implement keyboard shortcuts
3. [ ] Add drag-to-select (selection box)
4. [ ] Implement delete key binding

### Short Term (This Week)
5. [ ] Resize handles on selection
6. [ ] Better snap guides visualization
7. [ ] Undo/redo system
8. [ ] Performance optimization

### Medium Term (This Sprint)
9. [ ] Circle/ellipse rendering
10. [ ] Arrow/connector objects
11. [ ] Text object editing
12. [ ] Copy/paste functionality

---

## 💻 Development Workflow

### Create New Feature
1. Add action to `canvas.ts` store
2. Create UI component in `components/`
3. Wire up in main canvas page
4. Add API endpoint if needed
5. Test in browser

### Example: Adding Rectangle Tool

```typescript
// 1. Add to store (canvas.ts)
createRectangle: (x: number, y: number) => {
  const obj: RectangleObject = {
    id: generateObjectId(),
    type: "rectangle",
    x, y,
    width: 100,
    height: 100,
    rotation: 0,
    fill: "#3b82f6",
    createdBy: "user_test",
    updatedAt: Date.now(),
  };
  set(state => ({
    objects: [...state.objects, obj]
  }));
}

// 2. Add to toolbar
<button onClick={() => setToolMode('rectangle')}>
  Draw Rectangle
</button>

// 3. Handle click on canvas
canvas.on('click', (e) => {
  if (toolMode === 'rectangle') {
    createRectangle(e.x, e.y);
  }
});
```

---

## 🧪 Testing Your Changes

### Check Console
```bash
# Watch for errors in browser console
# DevTools > Console tab
```

### TypeScript Validation
```bash
pnpm type-check
```

### API Testing
```bash
# Check API is running
curl http://localhost:4000/health

# Create a board
curl -X POST http://localhost:4000/api/boards \
  -H "Content-Type: application/json" \
  -d '{"title":"Test Board"}'
```

### Database Check
```bash
# View database
pnpm prisma studio
```

---

## 🎨 Canvas Interaction Patterns

### Selection Pattern
```typescript
// In Canvas.tsx
rect.on('click', (e) => {
  e.cancelBubble = true; // Prevent stage click
  selectObject(obj.id, e.evt.ctrlKey); // Multi-select with Ctrl
});

// In Toolbar or useEffect for keyboard
document.addEventListener('keydown', (e) => {
  if (e.key === 'Delete') {
    deleteSelected();
  }
  if (e.key === 'a' && e.ctrlKey) {
    selectAll();
  }
});
```

### Dragging Pattern
```typescript
// In Canvas.tsx
shape.on('dragmove', () => {
  // Apply snap if enabled
  let x = shape.x();
  let y = shape.y();
  
  if (snapToGrid) {
    x = snapToGrid(x, gridSize);
    y = snapToGrid(y, gridSize);
  }
  
  // Update store
  updateObject(id, { x, y });
});
```

### Zoom Pattern
```typescript
// In Canvas.tsx
stage.on('wheel', (e) => {
  e.evt.preventDefault();
  
  const scale = e.evt.deltaY > 0 ? 0.95 : 1.05;
  const newZoom = zoom * scale;
  
  setZoom(newZoom);
  stage.scale({ x: newZoom, y: newZoom });
});
```

---

## 🔧 Common Issues & Solutions

### Canvas Not Showing
- Check if container ref is set: `containerRef.current`
- Verify Konva stage dimensions
- Check browser console for errors

### Objects Not Dragging
- Ensure `draggable: true` on Konva shapes
- Check if click handler is cancelling bubble
- Verify `dragmove` event listener

### Zoom Not Working
- Ensure `wheel` event listener is attached
- Check preventDefault is called
- Verify stage scale is being updated

### API Not Returning Data
- Check if Docker services are running: `docker-compose ps`
- Verify API port 4000 is accessible
- Check Network tab in DevTools

### Database Not Persisting
- Ensure `pnpm db:push` was run
- Check Prisma schema is correct
- View database with `pnpm prisma studio`

---

## 📚 Reference

### Canvas Store Methods
```typescript
// Selection
selectObject(id, multiSelect?)
deselectObject(id)
clearSelection()
setSelectedObjects(ids)

// Objects
addObject(object)
updateObject(id, updates)
deleteObject(id)
deleteSelected()

// Viewport
setZoom(zoom)
zoomIn() / zoomOut()
resetView()
zoomToFit()

// Grid & Snap
setShowGrid(show)
setSnapToGrid(snap)
setGridSize(size)
```

### Utility Functions
```typescript
// In lib/canvas/utils.ts
snapToGrid(value, gridSize)
isPointInObject(point, object)
calculateObjectBounds(objects)
calculateSnapGuides(moving, others)
generateObjectId()
```

### API Endpoints
```bash
# Boards
GET    /api/boards
POST   /api/boards
GET    /api/boards/:boardId
PUT    /api/boards/:boardId
DELETE /api/boards/:boardId

# Objects
GET    /api/boards/:boardId/objects
POST   /api/boards/:boardId/objects
PUT    /api/boards/:boardId/objects/:objectId
DELETE /api/boards/:boardId/objects/:objectId
```

---

## 🎯 Success Checklist

By end of Sprint 2, you should have:

- [ ] Canvas rendering rectangles, circles, text, arrows
- [ ] Click to select objects
- [ ] Ctrl+click for multi-select
- [ ] Drag objects to move them
- [ ] Resize handles on selection
- [ ] Zoom in/out with buttons and mouse wheel
- [ ] Pan with middle mouse
- [ ] Grid visibility toggle
- [ ] Snap-to-grid toggle
- [ ] Delete key deletes selected
- [ ] Keyboard shortcuts working
- [ ] Object list in layers panel
- [ ] Properties display
- [ ] No console errors
- [ ] API integration working

---

## 💡 Tips for Success

1. **Start Simple**: Get one object type rendering first
2. **Test Often**: Check browser console after each change
3. **Small Steps**: Implement one feature at a time
4. **Read Errors**: Browser console shows exactly what's wrong
5. **Use DevTools**: React and Konva DevTools are your friends
6. **Check Types**: TypeScript errors prevent runtime bugs
7. **Version Control**: Commit small, working changes

---

## 🚀 You're Ready!

The foundation is in place. The canvas is set up. The API is ready. 

Start by running `pnpm dev` and visiting http://localhost:3000/canvas

**Happy building! 🎉**

---

**Sprint 2 Goal**: Interactive canvas with rendering, selection, and viewport controls

**Target Completion**: 2-3 weeks from May 25, 2026
