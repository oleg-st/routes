// Local artwork deformation; route coordinates remain in the reference frame.
export function warpedArtwork(index,warp){
  const {xs,ys,offsets}=warp;
  const nodes=ys.map((y,j)=>xs.map((x,i)=>({from:[x,y],to:[x+offsets[j][i][0],y+offsets[j][i][1]]})));
  let markup='',count=0;
  for(let j=0;j<ys.length-1;j++)for(let i=0;i<xs.length-1;i++){
    const a=nodes[j][i],b=nodes[j][i+1],c=nodes[j+1][i],d=nodes[j+1][i+1];
    for(const triangle of [[a,b,c],[b,d,c]]){
      const [p,q,r]=triangle,[x,y]=p.from;
      const ux=q.from[0]-x,uy=q.from[1]-y,vx=r.from[0]-x,vy=r.from[1]-y,det=ux*vy-uy*vx;
      const du=q.to.map((v,k)=>v-p.to[k]),dv=r.to.map((v,k)=>v-p.to[k]);
      const A=(du[0]*vy-dv[0]*uy)/det,B=(du[1]*vy-dv[1]*uy)/det;
      const C=(dv[0]*ux-du[0]*vx)/det,D=(dv[1]*ux-du[1]*vx)/det;
      const matrix=[A,B,C,D,p.to[0]-A*x-C*y,p.to[1]-B*x-D*y];
      const id=`warp-${index}-${count++}`;
      // Extend each triangle by a fraction of a pixel to hide rasterization
      // cracks along shared edges, without blurring the original linework.
      const center=[0,1].map(k=>triangle.reduce((sum,p)=>sum+p.to[k],0)/3);
      const clip=triangle.map(p=>p.to.map((v,k)=>v+(v-center[k])*.0005));
      markup+=`<clipPath id="${id}" clipPathUnits="userSpaceOnUse"><polygon points="${clip.map(p=>p.join(',')).join(' ')}"/></clipPath><g clip-path="url(#${id})"><use xlink:href="#source-${index}" transform="matrix(${matrix.join(' ')})"/></g>`;
    }
  }
  return `<g id="art-${index}">${markup}</g>`;
}
