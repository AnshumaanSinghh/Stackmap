# Stackmap

AI-native system design workspace for architecture visualization and collaboration.

## Tech Stack

- **Frontend**: Next.js 14, React 18, Tailwind CSS, Konva.js
- **Backend**: Fastify, Node.js
- **Realtime**: Socket.io, Yjs (CRDT)
- **Database**: PostgreSQL with Prisma ORM
- **Caching**: Redis
- **Storage**: MinIO (S3-compatible)
- **AI**: Claude API
- **Monorepo**: pnpm, Turbo

## Project Structure

```
architect-ai/
├── apps/
│   ├── web/          # Next.js frontend
│   ├── api/          # Fastify backend API
│   ├── ws/           # Socket.io websocket server
│   └── worker/       # Background job worker
├── packages/
│   ├── canvas-engine/    # Konva canvas runtime
│   ├── realtime/         # Yjs collaboration
│   ├── ai-runtime/       # Claude AI integration
│   ├── ui/              # React component library
│   ├── database/         # Prisma client
│   ├── auth/            # Authentication
│   └── shared/          # Shared types and utils
├── prisma/          # Database schema
├── docker/          # Docker configuration
└── scripts/         # Utility scripts
```

## Getting Started

### Prerequisites

- Node.js 18+
- pnpm 9+
- Docker & Docker Compose

### Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   pnpm install
   ```

3. Set up environment variables:
   ```bash
   cp .env.example .env.local
   ```

4. Start services:
   ```bash
   docker-compose up -d
   ```

5. Push database schema:
   ```bash
   pnpm db:push
   ```

6. Start development server:
   ```bash
   pnpm dev
   ```

The application will be available at:
- Frontend: http://localhost:3000
- API: http://localhost:4000
- WebSocket: http://localhost:4001
- MinIO Console: http://localhost:9001

## Development

### Scripts

- `pnpm dev` - Start all dev servers
- `pnpm build` - Build all packages
- `pnpm lint` - Lint all packages
- `pnpm test` - Test all packages
- `pnpm format` - Format code
- `pnpm db:push` - Sync database schema
- `pnpm db:generate` - Generate Prisma client

## Core Features (Sprint 1 Foundation)

- [x] Monorepo structure
- [x] Database schema
- [x] WebSocket server foundation
- [x] Next.js frontend setup
- [x] Docker development environment
- [ ] Canvas rendering engine (Sprint 2)
- [ ] Real-time collaboration (Sprint 2)
- [ ] AI integration (Sprint 3)

## MVP Deployment

- **Frontend**: Vercel
- **Backend**: Railway
- **Database**: Supabase
- **Storage**: Cloudflare R2
- **Cache**: Upstash

## License

MIT
