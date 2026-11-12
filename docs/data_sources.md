# MARGA — NASA Data Sources & Data Provenance

## Primary Region: Gale Crater / Mount Sharp (Aeolis Mons)
- **Center Coordinates**: -4.63°N Latitude, 137.40°E Longitude
- **Crater Diameter**: ~154 km
- **Central Mound Height**: ~5.5 km above crater floor

---

## NASA Mission Instruments & Provenance

1. **CRISM (Compact Reconnaissance Imaging Spectrometer for Mars)**
   - *Spacecraft*: Mars Reconnaissance Orbiter (MRO)
   - *Utility*: Mineralogical identification (hematite, smectite clays, magnesium sulfates).

2. **Curiosity Rover Instruments (MSL)**
   - **CheMin**: X-ray diffraction instrument for quantitative mineral identification.
   - **APXS**: Alpha Particle X-ray Spectrometer for elemental chemistry.
   - **SAM**: Sample Analysis at Mars instrument suite.
   - **Mastcam / Navcam**: Surface imagery and sedimentary stratigraphy analysis.
   - **RAD**: Radiation Assessment Detector providing surface radiation dose rate baselines.

3. **MOLA (Mars Orbiter Laser Altimeter) & CTX / HiRISE DEM**
   - *Utility*: Topographic elevation, slope cost maps, and escarpment detection.

---

## Science Target Locations

The positions of the Curiosity-visited targets come from NASA's MSL rover localisation data
(`https://mars.nasa.gov/mmgis-maps/MSL/Layers/json/MSL_waypoints.json`: one position and geoid
elevation per drive), taken at a stop that NASA sources tie to the named feature. Each was checked
against the Mars Trek Gale DEM in `frontend/public/terrain/gale` (DEM minus rover elevation).

| Target | Position used | Evidence for the stop | Rover elev. | DEM diff |
| :--- | :--- | :--- | ---: | ---: |
| Bradbury Landing Site | -4.5895, 137.4417 | landing site (sol 3 position) | -4501 m | -2 m |
| Murray Buttes | -4.6942, 137.3531 | drive into the buttes on sol 1448; panorama sol 1451 | -4384 m | -3 m |
| Vera Rubin Ridge | -4.7284, 137.3782 | Rock Hall drill site on the ridge, parked sols 2257-2297 (selfie sol 2291) | -4144 m | +5 m |
| Glen Torridon | -4.7303, 137.3835 | Glen Etive drill site (3rd hole in the clay unit, sol 2486) | -4133 m | +2 m |
| Sulfate-Bearing Strata | -4.7608, 137.3993 | Canaima drill site (sol 3612; CheMin: -3879.8 m); unit reached sol 3574 | -3880 m | +14 m |

Before November 2026 the last four sat 3-5 km north of these features (their listed elevations were
200-400 m above the ground at the listed coordinates). Product IDs in the catalogue have not been
verified against PDS.

**Placeholders (not observed targets):** `target_crater_rim_fault` ("Northern Rim Approach") is a planning
waypoint on the crater floor; the real rim of Gale lies north of the terrain model. `target_rad_station_alpha`
is a representative point for the RAD dose baseline, not a specific RAD observation site.

---

## Data Age & Limitations Notice
All observation metadata in MARGA represent historical NASA Planetary Data System (PDS) observations. MARGA is a **decision-support prototype**. Traversal calculations are non-certified approximations intended for preliminary excursion planning.
