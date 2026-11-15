# MARGA — Third-Party Licenses, Citations & Credits

This repository contains original work created for the **NASA Space Apps Challenge 2026**, licensed under the **Apache License, Version 2.0** (see [`LICENSE`](./LICENSE)).

In compliance with NASA's solution terms, this document provides full citations, credits, and license disclosures for all third-party open-source software libraries and NASA open data sources integrated into MARGA.

---

## 1. NASA Planetary Data & Open Scientific Resources

All NASA data products utilized in MARGA are in the **Public Domain** (U.S. Government Work) unless otherwise specified.

### A. MSL CheMin Mineral Abundance RDR
- **Source**: NASA Planetary Data System (PDS), Geosciences Node
- **Data Set ID**: `MSL-M-CHEMIN-5-RDR-V1.0`
- **PDS4 Collection**: `msl_chemin_derived:data_chemin_min`
- **Citation**: Vaniman, D., *Mars Science Laboratory Chemistry & Mineralogy RDR Data V1.0*, NASA Planetary Data System, 2012. [PDS Archive](https://pds-geosciences.wustl.edu/missions/msl/chemin.htm).
- **License / Terms**: Public Domain / U.S. Government Work.

### B. MSL Curiosity Rover Localization & Navcam Imagery
- **Source**: NASA Jet Propulsion Laboratory (JPL) / Caltech
- **Datasets**: MSL Waypoint Localizations (`MSL_waypoints.json`) and Navcam Raw Image Stream (`https://mars.nasa.gov/api/v1/raw_image_items/`)
- **Credit**: NASA/JPL-Caltech
- **License / Terms**: Public Domain / NASA Open Data Policy.

### C. Orbital Imagery and Topographic Models (DEMs)
- **Instruments**:
  - **MOLA** (Mars Orbiter Laser Altimeter, Mars Global Surveyor)
  - **CTX** (Context Camera, Mars Reconnaissance Orbiter)
  - **HiRISE** (High Resolution Imaging Science Experiment, MRO / University of Arizona)
  - **CRISM** (Compact Reconnaissance Imaging Spectrometer for Mars, MRO / JHUAPL)
- **Distribution Platform**: NASA Mars Trek / USGS Astrogeology Science Center / PDS Cartography and Imaging Sciences Node
- **Credit**: NASA / JPL-Caltech / USGS / University of Arizona / JHUAPL
- **License / Terms**: Public Domain / U.S. Government Work.

---

## 2. Third-Party Software Libraries

### Frontend Libraries

| Package | Version | License | Copyright / Publisher |
| :--- | :--- | :--- | :--- |
| **React** | `^18.3.1` | MIT | Meta Platforms, Inc. and affiliates |
| **React DOM** | `^18.3.1` | MIT | Meta Platforms, Inc. and affiliates |
| **OpenLayers (`ol`)** | `^9.2.4` | BSD 2-Clause | OpenLayers Contributors |
| **Lucide React** | `^0.468.0` | MIT | Lucide Contributors |
| **Vite** | `^5.3.1` | MIT | Yuxi (Evan) You & Vite Contributors |
| **@vitejs/plugin-react** | `^4.3.1` | MIT | Yuxi (Evan) You & Vite Contributors |
| **Tailwind CSS** | `^4.3.4` | MIT | Tailwind Labs, Inc. |
| **Autoprefixer** | `^10.6.2` | MIT | Andrey Sitnik |
| **PostCSS** | `^8.5.32` | MIT | Andrey Sitnik |
| **TypeScript** | `^5.4.5` | Apache-2.0 | Microsoft Corporation |

### Engine & GIS Python Libraries

| Package | Version | License | Copyright / Publisher |
| :--- | :--- | :--- | :--- |
| **NumPy** | `>=1.24` | BSD 3-Clause | NumPy Developers |
| **Rasterio** | `>=1.4` | BSD 3-Clause | Mapbox & Rasterio Contributors |
| **GeoPandas** | `>=1.0` | BSD 3-Clause | GeoPandas Development Team |
| **Shapely** | `>=2.0` | BSD 3-Clause | Sean Gillies & Shapely Contributors |
| **Pyproj** | `>=3.6` | MIT | Pyproj Contributors |
| **Tifffile** | `>=2023.1` | BSD 3-Clause | Christoph Gohlke |
| **FastAPI** | `>=0.110` | MIT | Sebastián Ramírez |
| **Uvicorn** | `>=0.29` | BSD 3-Clause | Encode OSS |
| **Pytest** | `>=7.0` | MIT | Holger Krekel & Pytest Contributors |
| **HTTPX** | `>=0.27` | BSD 3-Clause | Encode OSS |

---

## 3. License Texts Summary

### Apache License 2.0
Used by MARGA original source code and TypeScript. See full text in [`LICENSE`](./LICENSE).

### MIT License
Used by React, Lucide, Vite, Tailwind CSS, Pyproj, FastAPI, Pytest.
> Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software.

### BSD 2-Clause & 3-Clause Licenses
Used by OpenLayers, NumPy, Rasterio, GeoPandas, Shapely, Tifffile, Uvicorn, HTTPX.
> Redistribution and use in source and binary forms, with or without modification, are permitted provided that the copyright notices and conditions are retained.
