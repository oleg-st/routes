import {migrateRoute} from './route-migration.js';

export async function migrateLegacyLibrary(storage, legacy, options) {
  if (await storage.isMigrated()) return [];
  const documents = new Map(), drafts = {}, saved = [], errors = [];
  let maximum = 0;
  const normalize = value => {
    const doc = migrateRoute(value, options);
    const view = doc.snapshot();
    maximum = Math.max(maximum, Number(/^Route (\d+)$/.exec(view.name)?.[1]) || 0);
    return {doc, view};
  };
  try {
    for (const value of legacy?.saved ?? []) {
      try {
        const {doc, view} = normalize(value); saved.push(view);
        documents.get(view.id)?.dispose(); documents.set(view.id, doc);
      } catch (error) {errors.push(error.message);}
    }
    // The latest draft wins over the older library checkpoint for the same route ID.
    for (const value of Object.values(legacy?.drafts ?? {})) {
      try {
        const {doc, view} = normalize(value); drafts[view.dungeonId] = view.id;
        documents.get(view.id)?.dispose(); documents.set(view.id, doc);
      } catch (error) {errors.push(error.message);}
    }
    await storage.migrate({packets: [...documents.values()].map(doc => doc.exportSnapshot()), drafts, saved,
      lastDungeon: legacy?.lastDungeon ?? null, nextRouteNumber: Math.max(maximum + 1, Number(legacy?.nextRouteNumber) || 1)});
    return errors;
  } finally {for (const doc of documents.values()) doc.dispose();}
}
