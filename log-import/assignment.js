// Minimum-cost one-to-one assignment. Rows are observations, columns placements.
// Costs are evidence scores, never probabilities or proof of identity.
export function minimumAssignment(costs) {
  const n = costs.length;
  if (!n) return {cost: 0, columns: []};
  const m = costs[0].length;
  if (m < n || costs.some(row => row.length !== m || row.some(c => !Number.isFinite(c) || c < 0))) {
    throw new Error('Assignment requires a rectangular finite nonnegative matrix with at least as many columns as rows.');
  }
  const u = Array(n + 1).fill(0), v = Array(m + 1).fill(0);
  const owner = Array(m + 1).fill(0), previous = Array(m + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    owner[0] = i;
    let column = 0;
    const distance = Array(m + 1).fill(Infinity), visited = Array(m + 1).fill(false);
    do {
      visited[column] = true;
      const row = owner[column];
      let delta = Infinity, next = 0;
      for (let j = 1; j <= m; j++) if (!visited[j]) {
        const reduced = costs[row - 1][j - 1] - u[row] - v[j];
        if (reduced < distance[j]) { distance[j] = reduced; previous[j] = column; }
        if (distance[j] < delta) { delta = distance[j]; next = j; }
      }
      for (let j = 0; j <= m; j++) {
        if (visited[j]) { u[owner[j]] += delta; v[j] -= delta; }
        else distance[j] -= delta;
      }
      column = next;
    } while (owner[column]);
    do {
      const next = previous[column]; owner[column] = owner[next]; column = next;
    } while (column);
  }
  const columns = Array(n);
  for (let j = 1; j <= m; j++) if (owner[j]) columns[owner[j] - 1] = j - 1;
  return {cost: columns.reduce((sum, j, i) => sum + costs[i][j], 0), columns};
}

// Whether these placements can use distinct observations, allowing at most
// maxUnmatched missing members. Reassign earlier choices through augmenting
// paths; a greedy match would incorrectly discard valid pack combinations.
export function hasCompatibleAssignment(choices,maxUnmatched=0){
  const owner=new Map();let unmatched=0;
  function assign(row,visited){
    for(const observation of choices[row]){
      if(visited.has(observation))continue;
      visited.add(observation);
      if(!owner.has(observation)||assign(owner.get(observation),visited)){
        owner.set(observation,row);return true;
      }
    }
    return false;
  }
  for(let row=0;row<choices.length;row++)if(!assign(row,new Set())&&++unmatched>maxUnmatched)return false;
  return true;
}

// Cover all observations and all required positions. Start with a matching
// covering required columns, then augment unmatched rows without uncovering
// those columns. Optional columns need not be occupied.
export function hasRequiredAssignment(choices,required){
  const rowsByColumn=new Map();
  choices.forEach((cs,row)=>{for(const col of cs){if(!rowsByColumn.has(col))rowsByColumn.set(col,[]);rowsByColumn.get(col).push(row);}});
  const rowToColumn=new Map(),columnToRow=new Map();
  function assignColumn(col,visited){
    for(const row of rowsByColumn.get(col)??[]){
      if(visited.has(row))continue;visited.add(row);
      if(!rowToColumn.has(row)||assignColumn(rowToColumn.get(row),visited)){
        rowToColumn.set(row,col);columnToRow.set(col,row);return true;
      }
    }
    return false;
  }
  for(const col of required)if(!assignColumn(col,new Set()))return false;
  function assignRow(row,visited){
    for(const col of choices[row]){
      if(visited.has(col))continue;visited.add(col);
      if(!columnToRow.has(col)||assignRow(columnToRow.get(col),visited)){
        columnToRow.set(col,row);rowToColumn.set(row,col);return true;
      }
    }
    return false;
  }
  for(let row=0;row<choices.length;row++)if(!rowToColumn.has(row)&&!assignRow(row,new Set()))return false;
  return true;
}
