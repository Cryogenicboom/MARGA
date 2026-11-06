# MARGA — Mars Adaptive Route Guidance Architecture

![MARGA System Prototype](https://img.shields.io/badge/MARGA-v1.0--PROTOTYPE-orange?style=for-the-badge)
![React](https://img.shields.io/badge/React-18.3-cyan?style=for-the-badge&logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5.4-blue?style=for-the-badge&logo=typescript)
![OpenLayers](https://img.shields.io/badge/OpenLayers-9.2-emerald?style=for-the-badge)

MARGA is an offline-first, lightweight Mars surface excursion planning application. It integrates scientific target observations from NASA Mars missions (Curiosity, CRISM, MOLA, HiRISE) with terrain-aware traversal routing to assist astronaut mission planning in **Gale Crater / Mount Sharp**.

---

## Features (Person 1 - Frontend & Framework Lead)
- 🛰️ **Interactive Mars Surface Map**: OpenLayers Equirectangular CRS (EPSG:4326) centered on Gale Crater.
- 🎯 **Science Target Catalogue**: Filterable NASA target observations (Hydration, Mineralogy, Sedimentary, Geological, Radiation) with confidence scores and metadata provenance.
- 🔬 **Mission Objective Selection**: Connects high-level scientific goals to relevant target clusters.
- ⚙️ **Configurable Traversal Constraints**: Adjustable astronaut walking speed, maximum slope limits, total EVA duration budget, and safety reserve margins.
- 🧮 **Terrain-Aware Route Diagnostics**: Real-time distance ($m$/$km$), estimated travel time, EVA time budget bars, return safety margins, slope breakdown charts, and GeoJSON export.
- 🔌 **Shared Integration Architecture**: Clean interfaces (`shared/types/index.ts`) connecting Frontend, Core Engine, NASA Data, and Test Modules.

---

## Project Structure

```
MARGA/
├── frontend/             # React + TypeScript + OpenLayers Web Application
│   ├── src/
│   │   ├── components/   # UI Panels (Goals, Targets, Constraints, Diagnostics)
│   │   ├── map/          # OpenLayers Mars map, styles, coordinate projections
│   │   ├── services/     # Mock data and client-side route calculation engine
│   │   ├── styles/       # Dark sci-fi mission control theme
│   │   ├── App.tsx       # Main dashboard layout shell
│   │   └── main.tsx
│   └── package.json
├── engine/               # Python A* Route Engine & Terrain Cost Module (Person 2)
├── science_data/         # NASA GeoJSON Catalogues & Metadata (Person 3)
├── test_data/            # Synthetic Terrain Rasters & Test Scenarios (Person 4)
├── shared/               # Shared Data Schemas & TypeScript Types
├── docs/                 # System Architecture & Development Documentation
└── README.md
```

---

## Quick Start (Frontend)

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to launch the MARGA Mission Control Interface.

---

## Verification & Build

```bash
cd frontend
npm run build
```

---

## Team Roles & Responsibilities

| Role | Developer | Responsibilities |
| :--- | :--- | :--- |
| **Person 1** | Application Architect & Frontend Lead | Main React framework, OpenLayers map, shared types, UI panels, mock data |
| **Person 2** | Core Engine & Technical Lead | Deterministic A* routing, terrain-cost calculation, EVA time budget logic |
| **Person 3** | NASA Data & Science Catalogue Lead | NASA dataset inventory, Gale Crater GeoJSON target catalogue, data provenance |
| **Person 4** | Testing, Validation & Data Prep | Synthetic test rasters, distance/coordinate validation, offline loading tests |

---

## License & Disclaimers
MARGA is a decision-support prototype using historical NASA data. Traversal paths do not constitute guaranteed safety or certified mobility parameters.
