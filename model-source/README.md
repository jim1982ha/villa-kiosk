# Model source

`TheLysHouse_1F.sh3d` — the canonical SweetHome 3D source for Floor 1.

Interactive objects are already named with their full Home Assistant entity IDs
(e.g. `camera.livingroom_cam`, `climate.living_room_air_conditioner`), so a clean
export maps to entities automatically.

➡️ To produce the `.glb` the kiosk loads, follow **[../MODEL_PIPELINE.md](../MODEL_PIPELINE.md)**.

Floor 2 will be added to this same `.sh3d` later — the app already detects a
second floor by mesh height and enables the **Floor 2** button automatically.
