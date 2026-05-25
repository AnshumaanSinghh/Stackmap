#!/bin/bash

# Setup script for Stackmap development environment

echo "🚀 Setting up Stackmap development environment..."

# Check prerequisites
if ! command -v node &> /dev/null; then
  echo "❌ Node.js is not installed"
  exit 1
fi

if ! command -v pnpm &> /dev/null; then
  echo "Installing pnpm..."
  npm install -g pnpm@9
fi

if ! command -v docker &> /dev/null; then
  echo "⚠️  Docker is not installed. Please install Docker to use the full development setup."
fi

# Create .env.local if it doesn't exist
if [ ! -f .env.local ]; then
  echo "Creating .env.local..."
  cp .env.example .env.local
  echo "✅ Created .env.local - please update with your configuration"
fi

# Install dependencies
echo "📦 Installing dependencies..."
pnpm install

# Generate Prisma client
echo "🗄️  Generating Prisma client..."
pnpm db:generate

echo "✅ Setup complete!"
echo ""
echo "📖 Next steps:"
echo "1. Update .env.local with your configuration"
echo "2. Start services: docker-compose up -d"
echo "3. Push database schema: pnpm db:push"
echo "4. Start development: pnpm dev"
