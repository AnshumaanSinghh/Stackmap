# Windows setup script for Stackmap

Write-Host "🚀 Setting up Stackmap development environment..." -ForegroundColor Green

# Check Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "❌ Node.js is not installed" -ForegroundColor Red
  exit 1
}

# Check or install pnpm
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
  Write-Host "📦 Installing pnpm..." -ForegroundColor Yellow
  npm install -g pnpm@9
}

# Check Docker
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Host "⚠️  Docker is not installed. Please install Docker for full development setup." -ForegroundColor Yellow
}

# Create .env.local if it doesn't exist
if (-not (Test-Path ".env.local")) {
  Write-Host "Creating .env.local..." -ForegroundColor Yellow
  Copy-Item ".env.example" ".env.local"
  Write-Host "✅ Created .env.local - please update with your configuration" -ForegroundColor Green
}

# Install dependencies
Write-Host "📦 Installing dependencies..." -ForegroundColor Yellow
pnpm install

# Generate Prisma client
Write-Host "🗄️  Generating Prisma client..." -ForegroundColor Yellow
pnpm db:generate

Write-Host "✅ Setup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "📖 Next steps:" -ForegroundColor Cyan
Write-Host "1. Update .env.local with your configuration"
Write-Host "2. Start services: docker-compose up -d"
Write-Host "3. Push database schema: pnpm db:push"
Write-Host "4. Start development: pnpm dev"
