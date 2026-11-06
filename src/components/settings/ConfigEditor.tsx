// src/components/settings/ConfigEditor.tsx
// Advanced Settings › Devices: every device the Kiosk keeps settings for, one card each (EntityMapRow), its fields and
// the 3D objects that show it (its "3D object" field); the devices no object shows, the same card with that field
// empty; the 3D objects whose entity is gone ("Point it there"). Its title's counts show one list at a time, "on the
// map" first (owner, 2026-11-06: Villa's "Bound 3D objects" and Devices' pencil were two places for one link).
//
// Each row is its own React.memo'd component (EntityMapRow) with its own
// localized draft state — see that file's docstring for why: this used to be
// one flat draft Record per field living HERE, which meant a keystroke in any
// one row's Label field (or literally any HA state_changed event anywhere in
// the house, since `entities` below is read at this level) re-rendered the
// WHOLE table. Every callback passed down to rows (remove, a 3D object added
// or taken off) is given a STABLE identity — via useCallback reading the
// latest config through a ref, never closing over `config` directly — because
// React.memo's default shallow prop comparison only pays off if the props
// rows receive are actually referentially stable when nothing relevant to
// THEM changed.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ShowAll, useTruncated } from "@/components/common/TruncatedList";
import { useDeviceSearch } from "@/hooks/useDeviceSearch";
import { Link2 } from "lucide-react";
import SearchOrAdd, { SearchEmpty } from "@/components/common/SearchOrAdd";
import { TipTitle } from "@/components/common/InfoTip";
import { SectionViewButtons } from "@/components/common/FoldedList";
import type { AddOffer } from "@/config/searchOrAdd";
import { useConfig } from "@/config/ConfigContext";
import { addMapping, bindMesh, forgetMappings, repointDevice, takeObjectOff } from "@/config/mappingEdits";
import { deviceMatches, matchesQuery, objectLinks } from "@/config/deviceRecord";
import { inferTypeFromEntityId } from "@/config/EntityMap";
import { unshownEntities } from "@/config/deviceGroups";
import { loadMeshCatalog } from "@/utils/meshCatalog";
import { useHA } from "@/ha/HAStateStore";
import { useDeviceIdentity, useVillaModel } from "@/config/VillaModel";
import { useEntityLabel } from "@/hooks/useEntityLabel";
import EntityCard from "./EntityCard";
import EntityMapRow from "./EntityMapRow";
import EntityPicker from "./EntityPicker";
import { countOf } from "@/utils/countOf";

/** The list shown: the devices on the map, or those no 3D object shows. */
type ListView = "on" | "off";

/** A device no 3D object shows yet: its field's empty list (one array, so its card's props stay the same). */
const NO_OBJECTS: readonly string[] = [];

export default function ConfigEditor({ title, tip, initialSearch }: { title: string; tip?: ReactNode; initialSearch?: string }) {
  const { config, update } = useConfig();
  const { entities, suppressedEntityIds } = useHA();
  const villa = useVillaModel();
  const { sceneEntityIds } = villa;
  // each card's name and room, as every screen says them (a row reads no live table of its own: EntityMapRow)
  const nameOf = useEntityLabel();
  // Seed the filter when opened from a device panel's edit shortcut, so that
  // entity's row is shown immediately.
  const [search, setSearch] = useState(initialSearch ?? "");
  // ⚠️ THE TITLE'S COUNTS SHOW THE LISTS, ONE AT A TIME (owner, 2026-11-06), the devices on the map first
  const [view, setView] = useState<ListView>("on");

  // Opened via a device panel's edit shortcut: scroll the modal straight to
  // THIS entity's card instead of leaving it at the top (Villa location / 3D
  // model source), which is what the surrounding modal scrolls to by default.
  // Ref'd on the matched row below; only fires once, and only for that entry
  // point — a manual search shouldn't yank the scroll position around.
  const matchedRowRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (initialSearch) matchedRowRef.current?.scrollIntoView({ block: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // EVERY stored device, one row each (config/deviceRecord), and what is missing — the villa model's ONE answer
  // (dismissedEntities.inventoryGaps): `staleIds` are rows Home Assistant does not have and the model does not name
  // ("Remove N"); `orphanIds` objects the model names whose entity Home Assistant does not have (never removable,
  // listed below with "Point it there"). Both empty until Home Assistant's list is loaded. This screen wrote that
  // rule itself until 2.496.351 — a third copy beside the dismissal and the orphan list.
  const { rows: allRows, stale: staleIds, orphans: orphanIds } = villa.settings;
  const staleSet = useMemo(() => new Set(staleIds), [staleIds]);

  // The model's 3D objects (saved when it loaded) and the device each shows, as the map decides it: each card's
  // "3D object" field and its search (deviceRecord.objectLinks).
  const catalog = useMemo(() => loadMeshCatalog(), []);
  const links = useMemo(() => objectLinks(catalog, config.entityMap, config.meshBindings),
    [catalog, config.entityMap, config.meshBindings]);

  // "Not on the map": the villa's devices no 3D object shows (deviceGroups.unshownEntities: of a type this app can
  // draw, not hidden in the villa's system, not one a placed device already reads — a pump plug's energy meter is shown
  // under the pump's panel). Moved here from Villa's "Bound 3D objects" (owner, 2026-11-06).
  const { folding } = useDeviceIdentity();
  const offMap = useMemo(
    () => unshownEntities({
      entities, entityMap: config.entityMap, folding, suppressed: suppressedEntityIds,
      knownType: (id) => !!inferTypeFromEntityId(id),
    }),
    [entities, config.entityMap, folding, suppressedEntityIds],
  );
  const offMapSet = useMemo(() => new Set(offMap), [offMap]);

  // Both Remove buttons on this screen go through the ONE operation — see
  // dismissedEntities.forgetEntities. The decision is recorded alongside the
  // deletion because these ids are also derived from the model (a mesh named
  // after the entity), so deleting alone regenerated every one of them: the
  // reported "I press Remove and they come straight back, on this device and
  // the others".
  const removeStale = useCallback(() => update(forgetMappings(staleIds)), [staleIds, update]);

  // Live filter by what every device search finds a device by, or one of its 3D objects (deviceRecord.deviceMatches):
  // it filtered on the stored label, entity-id fallbacks included, which nobody sees. It narrows the list shown.
  const searchSource = useDeviceSearch();
  const entries = useMemo(
    () => allRows.filter((r) => deviceMatches(r.id, search, searchSource, links.byDevice.get(r.id))),
    [allRows, search, searchSource, links],
  );
  const offFound = useMemo(() => offMap.filter((id) => deviceMatches(id, search, searchSource)), [offMap, search, searchSource]);

  // ⚠️ THE FIRST FEW, NOT A COLLAPSE, and applied AFTER the filter above — so
  // typing narrows the list and the top of the RESULTS is what shows. This
  // table used to sit behind a collapse toggle, so the section opened on a
  // heading and nothing else, and the number of entities was invisible until
  // you clicked.
  const shown = useTruncated(entries);
  const offShown = useTruncated(offFound);

  // Stable-identity commit path: every edit is computed from the LATEST
  // config inside update() (config/mappingEdits.ts), so these callbacks close
  // over nothing that changes — every row receives the exact same callbacks
  // on every ConfigEditor render, which is what lets React.memo skip
  // re-rendering rows a given edit doesn't touch (the edit's shallow spread
  // also keeps every OTHER entry's `mapping` prop reference-equal). A row's
  // own field edits wait in the dialog's pending store (MappingFields).

  // ⚠️ THE SAME OPERATION AS THE BANNER ABOVE, AND IT USED NOT TO BE. This
  // deleted the row and recorded nothing, so it could not deliver the removal
  // it offered: a live entity's row is rebuilt by auto-detection on the next
  // model load, and a stale one merely disappeared from THIS table while
  // staying in the fault picker, the offline count and readiness.
  const remove = useCallback((key: string) => update(forgetMappings([key])), [update]);

  // Latest entities for the stable callbacks below (its name in the villa's system seeds a device made from nothing).
  const entitiesRef = useRef(entities);
  entitiesRef.current = entities;
  // a card's "3D object" field: an object picked shows this device (a device not on the map is then on it), its ✕
  // takes the object off it
  const addObject = useCallback((object: string, id: string) => update(bindMesh(object, id, entitiesRef.current[id])), [update]);
  const takeOff = useCallback((object: string, id: string) => update(takeObjectOff(object, id)), [update]);

  // The list's one field also prepares a device (moved from Villa's "Bound 3D objects", 2026-11-06): its settings are
  // ready the moment a model with an object named after it is uploaded; an id the villa's system does not have yet is
  // prepared too. A device in either list says which, and picking it shows that list narrowed to it.
  const offer: AddOffer = {
    placeOf: (id) => (config.entityMap[id] ? "On the map" : offMapSet.has(id) ? "Not on the map" : null),
    addWords: "Prepare it", exactWords: (d) => `Prepare ${d}`, ahead: (id) => `Prepare “${id}”`,
  };
  const addDevice = (id: string) => { update(addMapping(id, entities[id])); setView("on"); setSearch(""); };
  const found = (id: string) => { setView(config.entityMap[id] ? "on" : "off"); setSearch(id); };

  // EVERY 3D object whose entity Home Assistant does not have and that has no row of its own (auto-detection adopts
  // only entities HA has): one card each, with the one thing to do here — point it at another entity
  // (dismissedEntities.orphanObjects). It used to appear only when its exact id was typed in the search (owner,
  // 2026-10-14). The search narrows the cards like the rows. Only while HA's list is loaded.
  const orphans = useMemo(() => orphanIds.filter((id) => matchesQuery(search, id)), [orphanIds, search]);
  const [repointTo, setRepointTo] = useState<Record<string, string | undefined>>({});
  const repoint = useCallback((id: string) => {
    const to = repointTo[id];
    if (!to || to === id) return;
    update(repointDevice(id, to, entities[to]));
    setRepointTo((m) => ({ ...m, [id]: undefined }));
  }, [repointTo, update, entities]);

  const narrowed = search.trim() !== "";
  return (
    <div>
      {/* what this section does is its title's (i) (ConfigEditorModal, owner 2026-10-22: no visible description) */}
      <TipTitle title={title} tip={tip} after={
        <SectionViewButtons title={title} views={{
          items: [
            { key: "on", words: `${allRows.length} on the map` },
            { key: "off", words: `${offMap.length} not on the map` },
          ],
          shown: view, onShow: (k) => setView(k as ListView),
        }} />
      } />

      {staleIds.length > 0 && (
        <div className="config-stale-notice">
          <div>
            <strong>{countOf(staleIds.length, "entity", "entities")} no longer exist{staleIds.length === 1 ? "s" : ""}.</strong>
            <div className="muted body-text" style={{ marginTop: 2 }}>
              These entities no longer exist and the 3D model no longer
              names them (they came from an earlier model, or were added by hand).
              They do nothing except clutter this list.
            </div>
          </div>
          <button className="btn ghost" onClick={removeStale}>
            Remove {staleIds.length}
          </button>
        </div>
      )}

      {/* the list's one field (SearchOrAdd), as every list of Devices and Villa */}
      <SearchOrAdd query={search} onQuery={setSearch} placeholder="Search, or a device to prepare…"
        offer={offer} onAdd={addDevice} onFound={found} />

      {view === "on" && allRows.length === 0 && (
        <p className="muted body-text mt">No auto-detected entities yet.</p>
      )}

      {/* a 3D object whose entity is gone: a card like every device's, its state "No such entity", its one action in
          its bar (owner, 2026-11-06: every record of Settings is the Cockpit's card) */}
      {view === "on" && orphans.length > 0 && (
        <div className="fm-list settings-cards">
          {orphans.map((id) => (
            <EntityCard key={id} entityId={id}
              status={{ text: "No such entity", tone: "tone-warn" }}
              // what it means is its state's (i), never a visible paragraph (owner, 2026-10-22)
              statusTip="A 3D object in the model is named after it, so it shows as missing everywhere. If the entity was renamed, point the object at its new name; otherwise rename or remove the object in the model."
              body={<EntityPicker value={repointTo[id]} onChange={(v) => setRepointTo((m) => ({ ...m, [id]: v }))}
                hideCurrentLabel placeholder="The entity this 3D object is now…" />}
              actions={
                <button type="button" className="btn ghost fm-bar-main" disabled={!repointTo[id] || repointTo[id] === id} onClick={() => repoint(id)}>
                  <Link2 size={16} aria-hidden />Point it there
                </button>
              } />
          ))}
        </div>
      )}
      {view === "on" && allRows.length > 0 && entries.length === 0 && orphans.length === 0 && (
        <SearchEmpty query={search} noun="device" offer={offer} onAdd={addDevice} />
      )}

      {/* ⚠️ ONE CARD PER DEVICE, THE COCKPIT'S (RecordCard, owner 2026-11-06): it was a table drawn as cards */}
      {view === "on" && entries.length > 0 && (
        <div className="fm-list settings-cards">
          {shown.visible.map(({ id: key, mapping: m0 }) => (
            <EntityMapRow
              key={key}
              entryKey={key}
              mapping={m0}
              objects={links.byDevice.get(key) ?? NO_OBJECTS}
              links={links}
              onAddObject={addObject}
              onTakeObjectOff={takeOff}
              entity={entities[key]}
              name={nameOf(key)}
              stale={staleSet.has(key)}
              matchedRowRef={key === initialSearch ? matchedRowRef : undefined}
              onRemove={sceneEntityIds.has(key) ? undefined : remove}
            />
          ))}
        </div>
      )}
      {view === "on" && <ShowAll list={shown} noun="entity" plural="entities" />}

      {/* the devices no 3D object shows: the same card, its "3D object" field empty; an object picked puts it on the map */}
      {view === "off" && (offMap.length === 0 ? <p className="muted body-text mt">Every device is on the map.</p>
        : narrowed && offFound.length === 0 ? <SearchEmpty query={search} noun="device" offer={offer} onAdd={addDevice} /> : (
        <div className="fm-list settings-cards">
          {offShown.visible.map((id) => (
            <EntityMapRow key={id} entryKey={id} objects={NO_OBJECTS} links={links} onAddObject={addObject}
              onTakeObjectOff={takeOff} entity={entities[id]} name={nameOf(id)} />
          ))}
        </div>
      ))}
      {view === "off" && <ShowAll list={offShown} noun="entity" plural="entities" />}
    </div>
  );
}
