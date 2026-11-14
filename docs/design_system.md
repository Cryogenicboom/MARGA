# MARGA — NASA Design System & Research Notes
**NASA Space Apps Challenge 2026:** *Interplanetary Survival Guide: Martian Map*  
**Design Specification & Ergonomic Guidelines**

---

## 1. Challenge & Mission Context

MARGA addresses the NASA Space Apps Challenge **Interplanetary Survival Guide: Martian Map** by translating decades of NASA robotic planetary data (MOLA, CRISM, HiRISE, CTX, MSL Curiosity) into a real-time, deterministic decision-support interface for astronaut extravehicular activities (EVAs).

---

## 2. Design System Architecture (NASA Horizon & USWDS Baseline)

### Typography

| Family | Role | Font Name |
| :--- | :--- | :--- |
| **Headline** | System Titles & Badges | `Orbitron` |
| **Display** | Dashboard Section Headers | `Inter` |
| **Sans** | Interface Body Copy | `Public Sans` |
| **Mono** | Coordinates, Telemetry & Timestamps | `DM Mono` / `Space Mono` |

### Palette Tokens

- **Space Dark Background**: `#06090e`
- **Control Panel Surface**: `#0b0e14`
- **Interactive Card Surface**: `#0d121d`
- **Active Card Highlight**: `#101622`
- **NASA Blue Accent**: `#105bd8`
- **NASA Meatball Red**: `#fc3d21`
- **Mission Cyan**: `#00a6d2`
- **Mission Amber**: `#f59e0b`
- **Mission Emerald**: `#10b981`

---

## 3. UI Component Structure

1. **Header Bar** (`Header.tsx`): Agency identifier, MARGA title, sector info, status indicators.
2. **Control Sidebar** (`App.tsx`):
   - `01 GOALS`: Scientific Objectives (`MissionSelectionPanel.tsx`)
   - `02 TARGETS`: PDS Target Catalogue (`TargetSelectionPanel.tsx`)
   - `03 PARAMS`: Mobility & Safety Constraints (`MissionConstraintsPanel.tsx`)
   - `04 ROUTE`: Traversal Telemetry & Diagnostics (`RouteDetailsPanel.tsx`)
3. **Spatial Map** (`MarsMap.tsx`): OpenLayers map, layer switcher, HUD overlays, neon route polyline.
4. **Telemetry Footer** (`DataProvenanceFooter.tsx`): Cursor Lat/Lon readouts, datum info, data provenance statement.
