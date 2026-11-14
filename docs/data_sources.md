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

## Curiosity mineralogy (CheMin)

**Source.** NASA Planetary Data System, Geosciences Node: *MSL CheMin Mineral Abundance RDR*
(data set `MSL-M-CHEMIN-5-RDR-V1.0`, PDS4 collection `msl_chemin_derived:data_chemin_min`; citation: Vaniman,
D., Mars Science Laboratory Chemistry & Mineralogy RDR Data V1.0, NASA PDS, 2012).
[Archive page](https://pds-geosciences.wustl.edu/missions/msl/chemin.htm).

**What is shown.**
- Each MIN product is a table published by the CheMin team: mineral, weight % and estimated 2σ error, for
  the crystalline phases. Every table sums to 100 %.
- Each product's PDS3 label names the sample, for example "the Rock Hall drill sample". Where the label
  states them, it also gives the modelled clay and X-ray amorphous fractions of the whole sample. MARGA
  quotes these with the label sentence they come from.
- Where a table was revised (P2, P3 versions), only the latest version is shown; the superseded product
  IDs are listed with it.
- Counts: 66 products, 53 current tables, 46 sampling sites.

**Location.** The product file name carries sol, site and drive. The convention comes from the CheMin RDR
Archive Volume SIS, section 2.2. The site and drive identify the rover position in NASA's MSL localisation
(`MSL_waypoints.json`, the same file the target positions use). All 46 sites match an exact RMC.

A sample is located where it was first analysed. Labels that say "reanalysis of this sample" describe a
stored sample analysed after the rover had driven on, so they are not used for the location.

**Limits.**
- The position is the rover's, not the drill hole's: it is within the rover's footprint.
- Mineral families (feldspar, sulfate and so on) only colour the display; the tables are shown as published.

Rebuild: `python -m marga_gis.msl fetch --only chemin`, then `build --only chemin`, from `gis/`.
Provenance (URLs, SHA-256, times): `data/msl/manifest.json`.

## Rover views (Navcam)

**Source.** NASA's MSL raw-image API (`https://mars.nasa.gov/api/v1/raw_image_items/`), left Navcam full
frames, credit NASA/JPL-Caltech. Each frame record carries:
- its site and drive (RMC);
- the CAHVOR (or CAHV) camera model in the rover frame;
- the rover attitude quaternion.

The attitude was checked against NASA's waypoint yaw: at RMC 76_3002 the quaternion gives −123.6° and the
waypoint −123.48°. Each built view records this difference.

**Stops.** For each Curiosity-visited catalogue target:
- the localised stop nearest it (within 150 m) whose frames cover at least 6 of 8 azimuth octants;
- the nearest such stops before and after it on the traverse.

Frames pointed above +15° are sky observations and are left out.

**Panorama.** An equirectangular image, 4096 × 1024 px, azimuth 0–360° from north and elevation +20° to
−60°. For each pixel:
1. The site-frame direction is rotated into the rover frame with the quaternion.
2. It is projected through the frame's camera model with the standard CAHVOR equations.
3. The pixel takes its value from the frame that sees it nearest that frame's centre.

Per-frame brightness gains (least squares on overlaps) even out exposure. Black means not imaged.

**Horizon check.** The skyline detected in the panorama is compared with the horizon computed from the
Mars Trek DEM, searching every azimuth shift. The check reports:
- **aligned:** the best shift is within 2° of zero and clearly better than any shift more than 3° away;
- **offset:** the best shift is clearly better, but more than 2° from zero;
- **inconclusive:** the visible skyline and the horizon resolved inside the DEM overlap too little, or are
  too flat to fix a rotation.

**Results of the current build (17 views).**
- The horizon check is inconclusive at all 17: the skyline visible in the frames is mostly terrain beyond
  the DEM (the crater rim, Mount Sharp's upper slopes).
- The attitude check is therefore the orientation evidence: at every stop the frames' attitude matches
  NASA's waypoint yaw within 0.01°.
- The panoramas cover 85–100 % of the horizon band.

**Limits.**
- Raw frames: seams, exposure steps and the rover's own hardware are visible as delivered.
- Nearby ground is not corrected for the small parallax between frames.

Rebuild: `python -m marga_gis.msl fetch --only navcam`, then `build --only navcam`. Raw frames (~250 MB) go
to `data/raw/msl/navcam/` (kept in the repository); the panoramas go to `frontend/public/rover/`.

---

## Data Age & Limitations Notice
All observation metadata in MARGA represent historical NASA Planetary Data System (PDS) observations. MARGA is a **decision-support prototype**. Traversal calculations are non-certified approximations intended for preliminary excursion planning.
