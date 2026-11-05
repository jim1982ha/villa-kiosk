// src/components/settings/BindingsTable.tsx
// Unified editor for all 3D-object → entity bindings: each card (BindingRow) changes which entity the object controls;
// its display metadata is the device's, in Devices. Room is NOT
// editable here (or anywhere in the kiosk) any more — see config/devicePlace.ts's
// resolveEntityRoom docstring for why.
//
// Each row is its own React.memo'd component (BindingRow) — see its docstring
// and EntityMapRow's (ConfigEditor.tsx's sibling table) for why: draft state
// used to live in a flat Record HERE, so typing in any one row's Label field
// re-rendered every other bound row's JSX too, and this component reads
// live HA `entities` at the top level, so the same full-list re-render fired
// on every state_changed event for ANY device in the house, typing or not.
// bind/unbind/patchMeta are given a STABLE identity (read the latest config
// through a ref rather than closing over it) so React.memo's default shallow
// prop comparison actually has stable props to compare against.

import type { ReactNode } from "react";
import { useCallback, useMemo, useRef, useState } from "react";
import { useEntityLabel } from "@/hooks/useEntityLabel";
import SearchOrAdd, { SearchEmpty } from "@/components/common/SearchOrAdd";
import type { AddOffer } from "@/config/searchOrAdd";
import { deviceMatches, matchesQuery } from "@/config/deviceRecord";
import { useDeviceSearch } from "@/hooks/useDeviceSearch";
import Fold from "./Fold";
import { BoundObjectCard, UnboundObjectCard, UnshownEntityCard } from "./BindingRow";
import { useConfig } from "@/config/ConfigContext";
import { useHA } from "@/ha/HAStateStore";
import { addMapping, bindMesh, unbindMesh } from "@/config/mappingEdits";
import { loadMeshCatalog } from "@/utils/meshCatalog";
import { inferTypeFromEntityId } from "@/config/EntityMap";
import { unshownEntities } from "@/config/deviceGroups";
import { useCardRoom, useDeviceIdentity } from "@/config/VillaModel";
import { ShowAll, useTruncated } from "@/components/common/TruncatedList";

/** The list the section shows: its bound objects, its objects bound to nothing, the entities no object shows. */
type ListView = "bound" | "unbound" | "unshown";

export default function BindingsTable({ title, tip }: { title: string; tip?: ReactNode }) {
  // THE name a device is shown by (useEntityLabel) — this list printed HA's raw friendly_name.
  const entityLabel = useEntityLabel();
  const { config, update } = useConfig();
  const { entities, suppressedEntityIds } = useHA();
  const roomOf = useCardRoom();
  // ⚠️ THE TITLE'S COUNTS OPEN THE LISTS, ONE AT A TIME (owner, 2026-11-06: "4 bound · 829 unbound · 88 not shown" in the
  // title, then again as a line of three toggles under it): bound first
  const [view, setView] = useState<ListView>("bound");
  // "Pre-configure a new entity" — moved here from ConfigEditor.tsx (Auto-
  // detected entity settings): sets label/room/panel type for an entity_id
  // whose 3D object doesn't exist YET, so it's ready the moment a matching
  // model is uploaded. Lives here now since it's the same "add something new
  // to the entity↔object map" action this whole section is about.
  // ⚠️ ONE FIELD (owner, 2026-11-06: as every list of Devices): it narrows the list shown, and its suggestions are the
  // devices to prepare, one already a device saying so ("Already in Devices": picking it narrows the list to it); an id
  // the villa's system does not have yet is prepared too. It was a picker and an Add button, with no filter.
  const [search, setSearch] = useState("");
  const src = useDeviceSearch();
  const offer: AddOffer = {
    placeOf: (id) => (config.entityMap[id] ? "Already in Devices" : null),
    addWords: "Prepare it", exactWords: (d) => `Prepare ${d}`, ahead: (id) => `Prepare “${id}”`,
  };
  const addEntity = (id: string) => { update(addMapping(id, entities[id])); setSearch(""); };

  const catalog = useMemo(() => loadMeshCatalog(), []);
  const bound = Object.keys(config.meshBindings);
  const unbound = useMemo(
    () => catalog.filter((m) => !config.meshBindings[m]),
    [catalog, config.meshBindings],
  );

  // The INVERSE audit: real HA entities this kiosk has no way to show
  // anywhere, because no 3D object in the model resolves to them (the
  // "unbound objects" list above answers the opposite question — meshes
  // with no entity). Scoped to domains this app actually knows how to
  // render (inferTypeFromEntityId's known list — the same gate auto-detect
  // itself uses) so this isn't every one of HA's hundreds of sensors, and
  // excludes anything already hidden/diagnostic in HA (suppressedEntityIds
  // — the same filter the summary tiles use), since those are entities the
  // installer already told HA don't belong on a main dashboard.
  // deviceGroups.unshownEntities (2.496.260): NOT one that belongs to a placed
  // device — a pump plug's energy meter is shown, under the pump's panel. This
  // list offered it as lost.
  const { folding } = useDeviceIdentity();
  const unmappedHaEntities = useMemo(
    () => unshownEntities({
      entities, entityMap: config.entityMap, folding, suppressed: suppressedEntityIds,
      knownType: (id) => !!inferTypeFromEntityId(id),
    }),
    [entities, config.entityMap, folding, suppressedEntityIds],
  );
  // each list narrowed by the field: an object by its name or its entity's, an entity as any device is found
  const boundFound = useMemo(() => bound.filter((m) => matchesQuery(search, m) || deviceMatches(config.meshBindings[m], search, src)),
    [bound, search, src, config.meshBindings]);
  const unboundFound = useMemo(() => unbound.filter((m) => matchesQuery(search, m)), [unbound, search]);
  const unmappedFound = useMemo(() => unmappedHaEntities.filter((id) => deviceMatches(id, search, src)), [unmappedHaEntities, search, src]);
  const boundShown = useTruncated(boundFound);
  const unboundShown = useTruncated(unboundFound);
  const unmappedShown = useTruncated(unmappedFound);
  const narrowed = search.trim() !== "";

  // Latest entities via a ref, read inside the stable callbacks below (the
  // config edits read the latest config themselves, inside update()) — see
  // the module docstring for why identity stability matters here.
  const entitiesRef = useRef(entities);
  entitiesRef.current = entities;

  const bind = useCallback((mesh: string, entityId: string) =>
    update(bindMesh(mesh, entityId, entitiesRef.current[entityId])), [update]);
  const unbind = useCallback((mesh: string) => update(unbindMesh(mesh)), [update]);

  return (
    <div>
      {/* ONE section, one voice (owner, 2026-10-12): "Pre-configure a new
          entity" sat under its own smaller heading and finer print, as if it
          were another section — it is this section's way to add an entity. */}
      {/* what this section does is its title's (i) (ConfigEditorModal, owner 2026-10-22: no visible description) */}

      <Fold title={title} tip={tip} views={{
        items: [
          { key: "bound", words: `${bound.length} bound` },
          { key: "unbound", words: `${unbound.length} unbound` },
          { key: "unshown", words: `${unmappedHaEntities.length} not shown` },
        ],
        shown: view, onShow: (k) => setView(k as ListView),
      }}>

      <SearchOrAdd query={search} onQuery={setSearch} placeholder="Search objects, or a device to prepare…"
        offer={offer} onAdd={addEntity} onFound={setSearch} />

      {/* each record the Cockpit's card (BindingRow), the list the title's count opened */}
      {view === "bound" && (bound.length === 0 ? <p className="muted body-text mt">No objects bound yet.</p>
        : narrowed && boundFound.length === 0 ? <SearchEmpty query={search} noun="bound object" offer={offer} onAdd={addEntity} /> : (
        <div className="fm-list settings-cards">
          {boundShown.visible.map((mesh) => (
            <BoundObjectCard key={mesh} mesh={mesh} entityId={config.meshBindings[mesh]} name={entityLabel(config.meshBindings[mesh])}
              room={roomOf({ entityId: config.meshBindings[mesh] })} onBind={bind} onUnbind={unbind} />
          ))}
        </div>
      ))}
      {view === "bound" && <ShowAll list={boundShown} noun="bound object" />}

      {view === "unbound" && (catalog.length === 0 ? <p className="muted body-text mt">No 3D model loaded yet.</p>
        : unbound.length === 0 ? <p className="muted body-text mt">Every 3D object is bound.</p>
        : narrowed && unboundFound.length === 0 ? <SearchEmpty query={search} noun="unbound object" offer={offer} onAdd={addEntity} /> : (
        <div className="fm-list settings-cards">
          {unboundShown.visible.map((mesh) => <UnboundObjectCard key={mesh} mesh={mesh} onBind={bind} />)}
        </div>
      ))}
      {view === "unbound" && <ShowAll list={unboundShown} noun="unbound object" />}

      {/* the inverse audit: entities no 3D object shows */}
      {view === "unshown" && (unmappedHaEntities.length === 0 ? <p className="muted body-text mt">Every entity is on the map.</p>
        : narrowed && unmappedFound.length === 0 ? <SearchEmpty query={search} noun="entity" offer={offer} onAdd={addEntity} /> : (
        <div className="fm-list settings-cards">
          {unmappedShown.visible.map((id) => (
            <UnshownEntityCard key={id} entityId={id} name={entityLabel(id)} room={roomOf({ entityId: id })}
              objects={unbound} onBind={bind} />
          ))}
        </div>
      ))}
      {view === "unshown" && <ShowAll list={unmappedShown} noun="entity" plural="entities" />}
      </Fold>
    </div>
  );
}
