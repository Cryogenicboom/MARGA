# MARGA — Development & Integration Guide

## Prerequisites
- **Node.js**: v18.0.0 or higher (v24.x tested)
- **NPM**: v9.0.0 or higher
- **Python**: v3.10+ (for backend core engine development)

---

## Repository Structure Overview

```
MARGA/
├── frontend/             # React + TypeScript + OpenLayers UI (Person 1)
├── engine/               # Python / Core Route & Mission Engine (Person 2)
├── science_data/         # Verified NASA Data & GeoJSON Catalogue (Person 3)
├── test_data/            # Synthetic Rasters & Verification Datasets (Person 4)
├── shared/               # Shared TypeScript Types & JSON Schemas
├── docs/                 # System Architecture & Documentation
└── README.md
```

---

## Getting Started (Frontend Development)

1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start local development server:
   ```bash
   npm run dev
   ```
   Open `http://localhost:3000` in your web browser.

4. Build for production and verify type checks:
   ```bash
   npm run build
   ```

---

## Coding Conventions
- **Strict TypeScript**: Avoid `any`. Use shared interfaces from `@shared/types`.
- **Modular Components**: Keep React components single-purpose under `src/components/`.
- **Coordinate Order**: GeoJSON array order is `[longitude, latitude]`. Standard display is `Latitude°N, Longitude°E`.
- **Styling**: Tailwind utility classes with Orbitron (headlines) and Space Mono / Rajdhani fonts.
