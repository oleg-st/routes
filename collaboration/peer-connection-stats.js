export async function peerConnectionStats(connection){
  if(!connection)return {connection:'unknown',pingMs:null};
  const stats=await connection.getStats();
  let pair;
  for(const row of stats.values())if(row.type==='transport'&&row.selectedCandidatePairId)pair=stats.get(row.selectedCandidatePairId);
  if(!pair)for(const row of stats.values())if(row.type==='candidate-pair'&&row.nominated&&row.state==='succeeded')pair=row;
  if(!pair)return {connection:'unknown',pingMs:null};
  const relay=[stats.get(pair.localCandidateId),stats.get(pair.remoteCandidateId)].some(candidate=>candidate?.candidateType==='relay');
  const rtt=pair.currentRoundTripTime;
  return {connection:relay?'relay':'direct',pingMs:connection.connectionState==='connected'&&Number.isFinite(rtt)&&rtt>=0?Math.round(rtt*1000):null};
}
