// src/utils/entityDomain.ts
// An entity's DOMAIN — the part of its id before the dot ("light" of
// "light.kitchen") — read once (2.496.263). It was `id.split(".")[0]` at
// twelve sites and a private `domainOf` in activeDevices. Import-free, so any
// module may use it. Given a bare domain it returns it unchanged.
export function domainOf(entityId: string): string {
  const dot = entityId.indexOf(".");
  return dot < 0 ? entityId : entityId.slice(0, dot);
}
