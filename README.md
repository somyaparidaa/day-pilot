# DayPilot

DayPilot is an AI-powered proactive day planning and execution assistant built for the Amazon Developer Hackathon 2026.

## Technology Stack (MVP Baseline)
- **Framework:** Next.js (App Router, React 19)
- **Language:** TypeScript
- **Styling:** Tailwind CSS
- **Testing:** Vitest
- **Linting:** ESLint (flat config)

## Prerequisites
- Node.js >= 20 (tested on v24.11.0)
- npm >= 10 (tested on 11.6.1)

## Getting Started

### 1. Installation
Clone the repository and install dependencies:
```bash
npm install
```

### 2. Environment Configuration
Copy `.env.example` to `.env.local`:
```bash
cp .env.example .env.local
```

### 3. Verification & Quality Commands
Run quality checks and test suites:
```bash
# Type checking
npm run typecheck

# Linting
npm run lint

# Automated tests
npm run test

# Production build
npm run build
```

### 4. Running the Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to view the application.

## Project Structure
```text
day-pilot/
├── src/
│   ├── app/             # Next.js App Router (pages, layout, styles)
│   └── __tests__/       # Vitest unit & integration tests
├── .env.example         # Environment template with placeholders
├── eslint.config.mjs    # ESLint configuration
├── next.config.ts       # Next.js configuration
├── postcss.config.mjs   # PostCSS configuration for Tailwind CSS
├── tsconfig.json        # TypeScript configuration
└── vitest.config.ts     # Vitest configuration
```

