# STACKMAP DEVELOPMENT GUIDE

## 📖 Table of Contents
1. [Project Overview](#project-overview)
2. [Architecture](#architecture)
3. [Getting Started](#getting-started)
4. [Development Workflow](#development-workflow)
5. [API Endpoints](#api-endpoints)
6. [WebSocket Events](#websocket-events)
7. [Database Schema](#database-schema)
8. [Environment Variables](#environment-variables)
9. [Deployment](#deployment)
10. [Troubleshooting](#troubleshooting)

## Project Overview

**Stackmap** is an AI-native system design workspace that enables architects and engineers to:
- Visually design system architectures
- Collaborate in real-time with teams
- Get AI-powered reviews and suggestions
- Generate architecture from descriptions
- Export and document designs

### Core Technology Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14, React 18, Konva.js, Tailwind |
| Backend | Fastify, Node.js |
| Real-time | Socket.io, Yjs (CRDT) |
| Database | PostgreSQL + Prisma |
| Cache | Redis |
| Storage | MinIO (S3-compatible) |
| AI | Claude API (Anthropic) |
| Deployment | Vercel/Railway/Supabase |

## Architecture

### System Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend (Vercel)                     │
│  Next.js 14 → React → Konva Canvas → Tailwind + Zustand    │
│                                                               │
│  - Canvas rendering and interaction                          │
│  - Real-time collaboration UI                               │
│  - Board management interface                               │
└──────────────────────┬──────────────────────────────────────┘
                       │ HTTP + WebSocket
        ┌──────────────┼──────────────┐
        │              │              │
        ▼              ▼              ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ API Server   │ │ WS Server    │ │ Worker       │
│ (Railway)    │ │ (Railway)    │ │ (Railway)    │
│ Fastify 4000 │ │ Socket.io    │ │ Bull + Redis │
│              │ │ 4001         │ │              │
└──────┬───────┘ └──────┬───────┘ └──────┬───────┘
       │                │                │
       └────────────────┼────────────────┘
                        │
       ┌────────────────┼────────────────┐
       ▼                ▼                ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ PostgreSQL   │ │ Redis        │ │ MinIO        │
│ (Supabase)   │ │ (Upstash)    │ │ (R2/Local)   │
│              │ │              │ │              │
│ Boards       │ │ Cache/Queue  │ │ Storage      │
│ Objects      │ │ Sessions     │ │              │
│ Users        │ │              │ │              │
└──────────────┘ └──────────────┘ └──────────────┘
```

### Monorepo Structure

```
stackmap/
├── apps/
│   ├── web/              # Next.js frontend
│   ├── api/              # Fastify REST API
│   ├── ws/               # Socket.io WebSocket
│   └── worker/           # Background jobs
│
├── packages/
│   ├── canvas-engine/    # Konva wrapper & utilities
│   ├── realtime/         # Yjs + Socket.io sync
│   ├── ai-runtime/       # Claude API client
│   ├── ui/              # React components
│   ├── database/         # Prisma client
│   ├── auth/            # JWT + bcrypt
│   └── shared/          # Types & utilities
│
├── prisma/              # Database schema
├── docker/              # Docker files
├── scripts/             # Setup & utility scripts
└── [config files]
```

## Getting Started

### Prerequisites
```bash
# Check versions
node --version      # 18+
pnpm --version      # 9+
docker --version    # 20+
```

### Initial Setup

**Option 1: Automated Setup**
```bash
# Windows
.\scripts\setup.ps1

# Unix/Linux/Mac
bash scripts/setup.sh
```

**Option 2: Manual Setup**
```bash
# Install dependencies
pnpm install

# Copy environment
cp .env.example .env.local

# Start Docker services
docker-compose up -d

# Wait for services to be healthy
docker-compose ps

# Setup database
pnpm db:generate
pnpm db:push

# Start development
pnpm dev
```

### Verify Setup

```bash
# Check all services running
curl http://localhost:4000/health     # API
curl http://localhost:3000            # Frontend
ws://localhost:4001                   # WebSocket

# View database
pnpm prisma studio
```

## Development Workflow

### Common Commands

```bash
# Development
pnpm dev                # Start all services

# Building
pnpm build              # Build all packages
pnpm build --filter=api # Build single package

# Testing
pnpm test               # Run all tests
pnpm lint               # Lint code

# Database
pnpm db:push            # Sync schema to DB
pnpm db:generate        # Generate Prisma client
pnpm prisma studio     # Open DB browser UI

# Docker
docker-compose up -d    # Start services
docker-compose down     # Stop services
docker-compose logs api # View logs
```

### Adding New Features

#### 1. Add a new type
**File**: `packages/shared/src/types.ts`
```typescript
export interface NewFeature {
  id: string;
  // ... properties
}
```

#### 2. Add API endpoint
**File**: `apps/api/src/routes/new-route.ts`
```typescript
import Fastify from 'fastify';

export async function newRouteHandler(fastify: FastifyInstance) {
  fastify.get('/api/feature', async (request, reply) => {
    return { data: [] };
  });
}
```

#### 3. Create UI component
**File**: `packages/ui/src/components/Feature.tsx`
```typescript
export default function Feature() {
  return <div>Feature Component</div>;
}
```

#### 4. Use in app
**File**: `apps/web/src/app/page.tsx`
```typescript
import Feature from '@stackmap/ui/components/Feature';

export default function Page() {
  return <Feature />;
}
```

## API Endpoints

### Authentication
```
POST   /auth/register      # Register new user
POST   /auth/login         # Login user
POST   /auth/logout        # Logout
POST   /auth/refresh       # Refresh token
```

### Boards
```
GET    /api/boards         # List user's boards
POST   /api/boards         # Create new board
GET    /api/boards/:id     # Get board details
PUT    /api/boards/:id     # Update board
DELETE /api/boards/:id     # Delete board
```

### Objects
```
GET    /api/boards/:id/objects      # List objects
POST   /api/boards/:id/objects      # Add object
PUT    /api/boards/:id/objects/:oid # Update object
DELETE /api/boards/:id/objects/:oid # Delete object
```

### AI Operations
```
POST   /api/ai/review      # Review architecture
POST   /api/ai/generate    # Generate architecture
POST   /api/ai/cleanup     # Cleanup/organize
POST   /api/ai/search      # Semantic search
```

## WebSocket Events

### Client → Server

```typescript
// Join a board room
socket.emit('join-room', { roomId: string });

// Cursor position update
socket.emit('cursor-update', {
  roomId: string;
  x: number;
  y: number;
  userId: string;
});

// Object update (via Yjs)
socket.emit('update', {
  roomId: string;
  update: Uint8Array;  // Yjs update
});
```

### Server → Client

```typescript
// Cursor from another user
socket.on('cursor-update', (payload) => {
  // { userId, x, y, userName }
});

// Object update from others
socket.on('update', (payload) => {
  // { roomId, update }
});

// User joined
socket.on('user-joined', (payload) => {
  // { userId, userName }
});

// User left
socket.on('user-left', (payload) => {
  // { userId }
});
```

## Database Schema

### Core Models

```prisma
// User account
User {
  id, email, password, name, avatar
  boards, comments, sessions
}

// Workspace/project
Board {
  id, title, description, ownerId, createdAt
  objects, comments, versions
}

// Canvas element
BoardObject {
  id, boardId, type, x, y, rotation
  width, height, data (JSON), createdBy
}

// Collaboration data
Comment {
  id, content, boardId, authorId, objectId
}

// AI tracking
AISession {
  id, userId, boardId, type, prompt, response
  status, createdAt
}

// History/undo
BoardVersion {
  id, boardId, snapshot (JSON), createdAt
}
```

### Key Relationships

```
User 1──────→ M Board
Board 1──────→ M BoardObject
Board 1──────→ M Comment ←────M User
Board 1──────→ M AISession
Board 1──────→ M BoardVersion
```

## Environment Variables

### Required
```
DATABASE_URL=postgresql://user:pass@host:5432/db
REDIS_URL=redis://localhost:6379
CLAUDE_API_KEY=sk-ant-xxx
JWT_SECRET=your-secret
```

### Optional
```
API_PORT=4000
WS_PORT=4001
NODE_ENV=development
MINIO_ENDPOINT=http://localhost:9000
SMTP_HOST=localhost
SMTP_PORT=1025
```

## Deployment

### Production Checklist

- [ ] Update JWT_SECRET to random string
- [ ] Set strong database password
- [ ] Configure CLAUDE_API_KEY
- [ ] Setup environment variables in deployment platform
- [ ] Configure CORS properly (no wildcard origin)
- [ ] Enable HTTPS
- [ ] Setup monitoring & logging
- [ ] Configure backups
- [ ] Test database migrations

### Deploy to Vercel (Frontend)

```bash
# Frontend deploys automatically on git push
# Set environment variables in Vercel dashboard
NEXT_PUBLIC_API_URL=https://api.stackmap.app
NEXT_PUBLIC_WS_URL=https://ws.stackmap.app
```

### Deploy to Railway (Backend)

```bash
# Push to Railway
railway up

# Or connect GitHub for auto-deploy
# Set environment variables in Railway dashboard
```

## Troubleshooting

### Docker Issues

```bash
# Reset everything
docker-compose down -v
docker-compose up -d --force-recreate

# Check health
docker-compose ps

# View logs
docker-compose logs -f postgres
docker-compose logs -f redis
```

### Database Issues

```bash
# Connection refused
# → Check DATABASE_URL in .env.local
# → Ensure PostgreSQL is running: docker-compose ps

# Migration failed
pnpm db:push --force-reset  # CAUTION: Deletes data!

# Generate client
pnpm db:generate
```

### WebSocket Issues

```bash
# Connection refused
# → Check WS_PORT matches docker-compose.yml
# → Verify CORS settings in apps/ws/src/index.ts

# Events not updating
# → Check browser console for errors
# → Verify Socket.io rooms with: socket.id
```

### Performance Issues

```bash
# Check bundle size
pnpm build --filter=web
npx analyze-bundle-size

# Profile API
NODE_OPTIONS='--prof' pnpm dev --filter=api
node --prof-process isolate-*.log > analysis.txt
```

### Port Conflicts

```bash
# Find process using port
# Windows
netstat -ano | findstr :4000

# Unix
lsof -i :4000

# Kill and restart
pkill -f "node" && pnpm dev
```

---

## Quick Links

- **GitHub**: https://github.com/stackmap/stackmap
- **Documentation**: https://docs.stackmap.app
- **Issues**: https://github.com/stackmap/stackmap/issues
- **Discord**: https://discord.gg/stackmap

## Support

For issues or questions:
1. Check [Troubleshooting](#troubleshooting) section
2. Search GitHub issues
3. Ask in Discord
4. Create a new issue with detailed reproduction steps

---

**Last Updated**: May 25, 2026
**Sprint**: 1 Complete
