import {pullColor} from '../route-model.js';
import {difficultyChoice} from '../difficulty.js';
import {assertPlayer, invariant, record, string, id, boolean, color, position, ids, uuid,
  rows, order, deleted, visibleIds, existing, newId, targetIndex, insertOrdered, moveOrdered,
  pointIds, writePoint, writeMembership, MODIFIERS, isDeleted, markDeleted} from './route-schema.js';

const commandFields = {
  'set-difficulty':['value'],
  'add-pull': ['id', 'name', 'color', 'note', 'beforeId', 'afterId'],
  'update-pull': ['pullId', 'patch'], 'delete-pull': ['pullId'],
  'move-pull': ['pullId', 'beforeId', 'afterId'], 'assign-mobs': ['pullId', 'mobIds', 'toggle'],
  'set-meta': ['patch'], 'set-excluded': ['mobId', 'excluded'], 'set-modifier': ['kind', 'patch'],
  'set-priority-target': ['mobId', 'priority'],
  'add-drawing': ['id', 'mapId', 'kind', 'color', 'width', 'icon', 'text', 'points', 'pointIds'],
  'update-drawing': ['drawingId', 'patch'], 'delete-drawing': ['drawingId'],
  'insert-point': ['drawingId', 'id', 'position', 'beforeId', 'afterId'],
  'move-point': ['drawingId', 'pointId', 'position'], 'delete-point': ['drawingId', 'pointId'],
  'add-marker': ['id', 'mapId', 'position', 'color', 'icon', 'label'],
  'update-marker': ['markerId', 'patch'], 'delete-marker': ['markerId'],
  'edit-text': ['group', 'id', 'index', 'deleteCount', 'text'], 'set-text': ['group', 'id', 'text'],
  'clear-route': [],
};
export const COMMAND_TYPES = Object.freeze(Object.keys(commandFields));
function shiftColors(doc, index, delta, value) {
  const map = doc.getMap('colors'), count = visibleIds(doc, 'pulls').length;
  if (delta > 0) {
    for (let i = count; i > index; i--) map.set(String(i), map.get(String(i - 1)) ?? pullColor(i - 1));
    map.set(String(index), value);
  } else {
    for (let i = index; i < count - 1; i++) map.set(String(i), map.get(String(i + 1)) ?? pullColor(i + 1));
    map.delete(String(count - 1));
  }
}
function textTarget(doc, group, key) {
  invariant(['pulls', 'drawings', 'markers'].includes(group), 'Invalid text target.');
  const row = existing(doc, group, key);
  return row.get(group === 'pulls' ? 'note' : group === 'markers' ? 'label' : 'text');
}
function textBoundary(text, index) {
  invariant(Number.isInteger(index) && index >= 0 && index <= text.length, 'Invalid text position.');
  const before = text.charCodeAt(index - 1), after = text.charCodeAt(index);
  invariant(!(before >= 0xD800 && before <= 0xDBFF && after >= 0xDC00 && after <= 0xDFFF), 'Cannot split a Unicode character.');
}

function writeDifficultyAffixes(doc, choice) {
  doc.getMap('meta').set('shadow',choice.modifiers.includes('shadow'));
  for(const kind of MODIFIERS)doc.getMap('modifiers').ensureMergeableMap(kind).set('active',choice.modifiers.includes(kind));
}
function retainAffixes(doc, context) {
  const meta=doc.getMap('meta');
  if(meta.get('manualAffixes')===true)return;
  // Older documents derived affixes from difficulty instead of storing their displayed state.
  const choice=difficultyChoice(context.dungeonId,meta.get('difficulty'));
  if(choice)writeDifficultyAffixes(doc,choice);
  meta.set('manualAffixes',true);
}

// Validate the entire command before the first write: Loro transactions do not roll back.
function prepare(doc, c, context) {
  const fields = commandFields[c?.type];
  invariant(fields, 'Unknown route command.');
  record(c, ['type', ...fields]);
  const meta = doc.getMap('meta');
  switch (c.type) {
    case 'set-difficulty': {
      if(c.value===null){
        return ()=>{
          retainAffixes(doc,context);
          meta.delete('difficulty');
        };
      }
      context.difficulty(c.value);
      const choice=difficultyChoice(context.dungeonId,c.value);
      return ()=>{
        meta.set('difficulty',c.value);
        writeDifficultyAffixes(doc,choice);
        meta.set('manualAffixes',true);
        const assignments=doc.getMap('assignments'),pulls=visibleIds(doc,'pulls');
        for(const kind of ['ghorn','witch']){
          const targets=doc.getMap('modifiers').get(kind)?.get('replacement')?.replacedEnemies??[];
          for(const spawn of context.modifierSpawns(kind,targets)){
          const assigned=assignments.get(spawn.placementId);
          if(!choice.modifiers.includes(kind)){
            if(pulls.includes(assigned))for(const mob of spawn.replacedEnemies)if(!pulls.includes(assignments.get(mob)))assignments.set(mob,assigned);
            if(assigned!=null)assignments.set(spawn.placementId,null);
            continue;
          }
          if(pulls.includes(assigned))continue;
          const pull=pulls.find(key=>spawn.replacedEnemies.some(mob=>assignments.get(mob)===key));
          if(pull)assignments.set(spawn.placementId,pull);
          }
        }
      };
    }
    case 'set-meta': {
      const patch = record(c.patch, ['name', 'shadow']);
      if ('name' in patch) invariant(string(patch.name).trim().length > 0, 'Route name cannot be empty.');
      if ('shadow' in patch) boolean(patch.shadow);
      if (patch.shadow === true) context.modifier('shadow');
      return () => {
        if('shadow' in patch)retainAffixes(doc,context);
        for (const [key, value] of Object.entries(patch)) meta.set(key, value);
      };
    }
    case 'add-pull': {
      const key = newId(doc, 'pulls', c.id), live = visibleIds(doc, 'pulls');
      const index = targetIndex(live, c), name = string(c.name ?? '').trim(), note = string(c.note ?? '', 1_000_000);
      let shade = c.color;
      if (shade === undefined) {
        let n = live.length; shade = pullColor(n);
        const used = new Set(doc.getMap('colors').values());
        while (used.has(shade)) shade = pullColor(++n);
      }
      color(shade);
      return () => {
        shiftColors(doc, index, 1, shade);
        const row = rows(doc, 'pulls').ensureMergeableMap(key);
        row.set('name', name); row.set('customName', name !== '');
        row.ensureMergeableText('note').insert(0, note);
        insertOrdered(doc, 'pulls', key, index);
        return key;
      };
    }
    case 'update-pull': {
      const row = existing(doc, 'pulls', c.pullId), patch = record(c.patch, ['name', 'color']);
      const index = visibleIds(doc, 'pulls').indexOf(c.pullId);
      const name = 'name' in patch ? string(patch.name).trim() : undefined;
      if ('color' in patch) color(patch.color);
      return () => {
        if (name !== undefined) {
          const wasCustom = row.get('customName') === true;
          row.set('name', name); row.set('customName', name !== '' && (wasCustom || name !== `Pull ${index + 1}`));
        }
        if ('color' in patch) doc.getMap('colors').set(String(index), patch.color);
      };
    }
    case 'move-pull': {
      existing(doc, 'pulls', c.pullId);
      invariant(c.beforeId !== c.pullId && c.afterId !== c.pullId, 'A pull cannot anchor itself.');
      const target = targetIndex(visibleIds(doc, 'pulls').filter(key => key !== c.pullId), c);
      return () => moveOrdered(doc, 'pulls', c.pullId, target);
    }
    case 'delete-pull': {
      existing(doc, 'pulls', c.pullId);
      const index = visibleIds(doc, 'pulls').indexOf(c.pullId);
      return () => {shiftColors(doc, index, -1); markDeleted(deleted(doc, 'pulls'), c.pullId);};
    }
    case 'assign-mobs': {
      if (c.pullId !== null) existing(doc, 'pulls', c.pullId);
      const chosen = ids(c.mobIds); chosen.forEach(key => context.mob(key, doc));
      if (c.toggle !== undefined) boolean(c.toggle);
      const assignments = doc.getMap('assignments');
      const remove = c.pullId === null || (c.toggle === true && chosen.length > 0 && chosen.every(key => assignments.get(key) === c.pullId));
      return () => {for (const key of chosen) assignments.set(key, remove ? null : c.pullId);};
    }
    case 'set-excluded': {
      context.mob(id(c.mobId), doc); boolean(c.excluded);
      invariant(!context.bosses.has(c.mobId), 'Bosses cannot be excluded.');
      return () => doc.getMap('excluded').set(c.mobId, c.excluded);
    }
    case 'set-priority-target': {
      context.mob(id(c.mobId), doc); boolean(c.priority);
      return () => doc.getMap('priorityTargets').set(c.mobId, c.priority);
    }
    case 'set-modifier': {
      invariant(MODIFIERS.includes(c.kind), 'Invalid modifier.');
      const empowered = c.kind === 'empowered';
      const patch = record(c.patch, empowered ? ['active', 'enemies'] : ['active', 'packId', 'replacedEnemies']);
      if ('active' in patch) boolean(patch.active);
      if (patch.active === true) context.modifier(c.kind);
      const current = doc.getMap('modifiers').get(c.kind);
      let members, replacement;
      if (empowered && 'enemies' in patch) {
        members = ids(patch.enemies); members.forEach(key => context.originalMob(key));
      }
      if (!empowered) {
        const previous = current?.get('replacement') ?? {packId: null};
        if ('packId' in patch || 'replacedEnemies' in patch) {
          const packId = 'packId' in patch ? patch.packId : previous.packId;
          const replacedEnemies = 'replacedEnemies' in patch ? ids(patch.replacedEnemies) :
            packId === previous.packId ? previous.replacedEnemies : undefined;
          if (packId !== null) context.pack(id(packId), replacedEnemies);
          else invariant(!replacedEnemies?.length, 'A replacement needs a pack.');
          replacement = {packId, ...(replacedEnemies === undefined ? {} : {replacedEnemies})};
          const other = doc.getMap('modifiers').get(c.kind === 'ghorn' ? 'witch' : 'ghorn')?.get('replacement');
          invariant(!packId || !other || (packId !== other.packId && !replacedEnemies?.some(key => other.replacedEnemies?.includes(key))), 'Replacement packs overlap.');
        }
        invariant(patch.active !== true || (replacement ?? previous).packId, 'Choose a replacement pack.');
      }
      return () => {
        retainAffixes(doc,context);
        const row = doc.getMap('modifiers').ensureMergeableMap(c.kind);
        if (members) writeMembership(row.ensureMergeableMap('enemies'), members);
        if (replacement) {
          row.set('replacement', replacement);
          for(const id of context.modifierIds(c.kind)){
            doc.getMap('assignments').set(id, null);
            doc.getMap('excluded').set(id, false);
            doc.getMap('priorityTargets').set(id, false);
          }
          if (!replacement.packId) row.set('active', false);
        }
        if ('active' in patch) row.set('active', patch.active);
        // Match the existing activation behavior for presets, without assigning a changed replacement.
        if (!empowered && !replacement && patch.active === true) {
          for(const spawn of context.modifierSpawns(c.kind,row.get('replacement')?.replacedEnemies??[])){
          const mobId = spawn.placementId, assignments = doc.getMap('assignments');
          if (!visibleIds(doc, 'pulls').includes(assignments.get(mobId))) {
            const targets = spawn.replacedEnemies;
            const pull = visibleIds(doc, 'pulls').find(key => targets.some(mob => assignments.get(mob) === key));
            if (pull) assignments.set(mobId, pull);
          }
          }
        }
      };
    }
    case 'add-drawing': {
      const key = newId(doc, 'drawings', c.id); context.map(id(c.mapId));
      invariant(['line', 'portal', 'invis', 'note'].includes(c.kind), 'Invalid drawing kind.');
      invariant(Array.isArray(c.points) && c.points.length <= 5000, 'Invalid drawing points.');
      const coordinates = c.points.map(position), count = coordinates.length;
      invariant(c.kind === 'line' ? count >= 2 : count === (c.kind === 'note' ? 1 : 2), 'Invalid point count.');
      const keys = c.pointIds === undefined ? coordinates.map(uuid) : ids(c.pointIds);
      invariant(keys.length === count && (c.pointIds === undefined || c.pointIds.length === count), 'Point IDs must be unique and match coordinates.');
      const shade = color(c.color ?? '#e43969'), text = string(c.text ?? '', 1_000_000), width = c.width ?? 3;
      invariant([2, 3, 5].includes(width) && (c.width === undefined || c.kind === 'line'), 'Invalid line width.');
      if (c.icon !== undefined) {invariant(c.kind === 'note', 'Only notes support symbols.'); string(c.icon, 50);}
      return () => {
        const row = rows(doc, 'drawings').ensureMergeableMap(key);
        for (const [field, value] of Object.entries({mapId: c.mapId, kind: c.kind, color: shade})) row.set(field, value);
        if (c.kind === 'line') row.set('width', width);
        if (c.icon !== undefined) row.set('icon', c.icon);
        row.ensureMergeableText('text').insert(0, text);
        row.ensureMergeableMap('pointsDeleted');
        coordinates.forEach((point, index) => writePoint(row, keys[index], point, index));
        order(doc, 'drawings').push(key);
        return key;
      };
    }
    case 'update-drawing': {
      const row = existing(doc, 'drawings', c.drawingId), patch = record(c.patch, ['color', 'width', 'icon']);
      if ('icon' in patch) {invariant(row.get('kind') === 'note', 'Only notes support symbols.'); string(patch.icon, 50);}
      if ('color' in patch) color(patch.color);
      if ('width' in patch) invariant(row.get('kind') === 'line' && [2, 3, 5].includes(patch.width), 'Invalid line width.');
      return () => {for (const [key, value] of Object.entries(patch)) row.set(key, value);};
    }
    case 'delete-drawing':
    case 'delete-marker': {
      const group = c.type === 'delete-drawing' ? 'drawings' : 'markers', key = c.drawingId ?? c.markerId;
      existing(doc, group, key);
      return () => markDeleted(deleted(doc, group), key);
    }
    case 'insert-point': {
      const row = existing(doc, 'drawings', c.drawingId), key = id(c.id ?? uuid()), coordinates = position(c.position);
      invariant(row.get('kind') === 'line', 'Only line paths support additional points.');
      invariant(!row.get('points').get(key) && !isDeleted(row.get('pointsDeleted'), key), 'Point ID has already been used.');
      const live = pointIds(row), index = targetIndex(live, c), list = row.get('pointOrder');
      const anchor = live[index], rawIndex = anchor === undefined ? list.length : list.toArray().indexOf(anchor);
      return () => {writePoint(row, key, coordinates, rawIndex); return key;};
    }
    case 'move-point':
    case 'delete-point': {
      const row = existing(doc, 'drawings', c.drawingId), key = id(c.pointId), live = pointIds(row);
      invariant(live.includes(key), 'Point does not exist or was deleted.');
      if (c.type === 'move-point') {
        const coordinates = position(c.position);
        return () => row.get('points').get(key).set('position', coordinates);
      }
      invariant(row.get('kind') === 'line' && live.length > 2, 'A path needs at least two points.');
      return () => markDeleted(row.get('pointsDeleted'), key);
    }
    case 'add-marker': {
      const key = newId(doc, 'markers', c.id); context.map(id(c.mapId));
      const fields = {mapId: c.mapId, position: position(c.position), color: color(c.color ?? '#e43969'), icon: string(c.icon ?? 'pin', 50)};
      const label = string(c.label ?? '', 1_000_000);
      return () => {
        const row = rows(doc, 'markers').ensureMergeableMap(key);
        for (const [field, value] of Object.entries(fields)) row.set(field, value);
        row.ensureMergeableText('label').insert(0, label);
        order(doc, 'markers').push(key);
        return key;
      };
    }
    case 'update-marker': {
      const row = existing(doc, 'markers', c.markerId), patch = record(c.patch, ['position', 'color', 'icon']);
      const fields = {...patch};
      if ('position' in fields) fields.position = position(fields.position);
      if ('color' in fields) color(fields.color);
      if ('icon' in fields) string(fields.icon, 50);
      return () => {for (const [field, value] of Object.entries(fields)) row.set(field, value);};
    }
    case 'edit-text':
    case 'set-text': {
      const text = textTarget(doc, c.group, c.id), value = string(c.text, c.type === 'set-text' ? 1_000_000 : 4000);
      if (c.type === 'set-text') return () => text.update(value);
      const before = text.toString();
      invariant(Number.isInteger(c.deleteCount) && c.deleteCount >= 0, 'Invalid delete count.');
      textBoundary(before, c.index); textBoundary(before, c.index + c.deleteCount);
      invariant(before.length - c.deleteCount + value.length <= 1_000_000, 'Text is too long.');
      return () => {if (c.deleteCount) text.delete(c.index, c.deleteCount); if (value) text.insert(c.index, value);};
    }
    case 'clear-route': return () => {
      for (const group of ['pulls', 'drawings', 'markers']) for (const key of visibleIds(doc, group)) markDeleted(deleted(doc, group), key);
      for (const key of doc.getMap('colors').keys()) doc.getMap('colors').delete(key);
      for (const key of doc.getMap('assignments').keys()) doc.getMap('assignments').set(key, null);
      writeMembership(doc.getMap('excluded'), []);
      writeMembership(doc.getMap('priorityTargets'), []);
      if(meta.get('difficulty')===undefined)meta.set('shadow', false);
      for (const kind of meta.get('difficulty')===undefined?MODIFIERS:[]) {
        const row = doc.getMap('modifiers').ensureMergeableMap(kind); row.set('active', false);
        if (kind === 'empowered') writeMembership(row.ensureMergeableMap('enemies'), []);
        else row.set('replacement', {packId: null});
      }
    };
  }
}
export function executeCommand(doc, participantRole, command, context) {
  assertPlayer(participantRole);
  // Isolate caller-owned arrays/patches from callback-side mutation during commit.
  const c = structuredClone(command), apply = prepare(doc, c, context);
  const result = apply();
  doc.commit({origin: `command:${c.type}`});
  return result;
}
