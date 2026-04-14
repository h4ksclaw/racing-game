function hash2(x: number, y: number): number {
  return ((Math.sin(x * 127.1 + y * 311.7) * 43758.5453) % 1 + 1) % 1;
}
function valueNoise(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx*fx*(3-2*fx), sy = fy*fy*(3-2*fy);
  const a=hash2(ix,iy),b=hash2(ix+1,iy),c=hash2(ix,iy+1),d=hash2(ix+1,iy+1);
  return (a*(1-sx)+b*sx)*(1-sy)+(c*(1-sx)+d*sx)*sy;
}
function fbm(x,y){let v=0,a=.5;for(let i=0;i<5;i++){v+=a*valueNoise(x,y);x*=2.03;y*=2.03;a*=.5;}return v;}
function voronoi(x,y){const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy;let md=1;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const nx=dx+(hash2(ix+dx,iy+dy)*.8+.1),ny=dy+(hash2(ix+dx+57.1,iy+dy+93.3)*.8+.1);const d=Math.sqrt((nx-fx)**2+(ny-fy)**2);if(d<md)md=d;}return md;}
function voronoiFbm(x,y){return voronoi(x,y)*.5+voronoi(x*1.7+3.7,y*1.7+3.7)*.3+voronoi(x*3.1+7.3,y*3.1+7.3)*.2;}

const snowThreshold=40,rockThreshold=0.5,mossRange=25,dirtNearDist=0,dirtFarDist=-10,farDirtStart=40,farDirtEnd=80,patchNoiseStrength=0.7;

function detail(slope,aboveRoad,dist,wx,wz){
  const voroLarge=voronoiFbm(wx*.008),voroSmall=voronoiFbm(wx*.025+wz*.015);
  const fbmLarge=fbm(wx*.006,wz*.006),fbmSmall=fbm(wx*.02,wz*.02);
  const terrainNoise=fbmLarge*.4+voroLarge*.35+voroSmall*.15+fbmSmall*.1;
  const slopeBias=Math.max(0,Math.min(1,slope/.3));
  const lowBias=Math.max(0,Math.min(1,(5-aboveRoad)/15));
  const distBias=Math.max(0,Math.min(1,(dist-10)/40))*.3;

  let wRock=Math.max(0,Math.min(1,(slope-rockThreshold)/.15));
  wRock=Math.max(wRock,Math.max(0,Math.min(1,(terrainNoise-.55)/.15))*slopeBias*.5);
  const wSnowRaw=Math.max(0,Math.min(1,(aboveRoad-snowThreshold)/15));
  const snowBreakup=Math.max(0,Math.min(1,(terrainNoise-.3)/.4));
  const heightFactor=Math.max(0,Math.min(1,(aboveRoad-snowThreshold)/60));
  let wSnow=wSnowRaw*(snowBreakup*(1-heightFactor)+heightFactor);
  const wNearMoss=Math.max(0,Math.min(1,(mossRange-dist)/mossRange))*(0.5+0.5*valueNoise(wx*.1,wz*.1));
  const wBelowDirt=Math.max(0,Math.min(1,(dirtNearDist-aboveRoad)/(dirtFarDist-dirtNearDist)));
  const slopeBreak=Math.max(0,Math.min(1,(slope-.35)/.2))*(1-heightFactor*.5);
  wSnow*=(1-slopeBreak*.7);wRock=Math.max(wRock,slopeBreak*.5);
  const wFarDirt=Math.max(0,Math.min(1,(dist-farDirtStart)/(farDirtEnd-farDirtStart)))*(1-patchNoiseStrength+patchNoiseStrength*terrainNoise);
  let wGrass=1.0;
  const patchThreshold=.5+slopeBias*.15+lowBias*.1+distBias;
  const wGrassPatch=Math.max(0,Math.min(1,(terrainNoise-patchThreshold)/.15))*.35;
  wGrass-=wRock;wGrass-=wSnow;wGrass-=wNearMoss;wGrass-=wBelowDirt;wGrass-=wFarDirt;wGrass-=wGrassPatch;
  wGrass=Math.max(wGrass,0);
  return {wGrass,wRock,wSnow,wNearMoss,wBelowDirt,wFarDirt,wGrassPatch,terrainNoise};
}

// Key scenario: near road, moderate height - what's eating the weight?
console.log("=== DETAILED WEIGHT BREAKDOWN ===");
const scenarios = [
  [0.05, 5, 15, "near road, low"],
  [0.05, 20, 30, "mid height, mid dist"],
  [0.05, 40, 50, "at snow threshold"],
  [0.05, 60, 60, "above snow threshold"],
  [0.05, 80, 70, "high up"],
];
for (const [slope,ar,dist,label] of scenarios) {
  const wx=50, wz=50;
  const w = detail(slope,ar,dist,wx,wz);
  const total = w.wGrass+w.wRock+w.wSnow+w.wNearMoss+w.wBelowDirt+w.wFarDirt+w.wGrassPatch;
  console.log(`\n${label} (slope=${slope}, ar=${ar}, dist=${dist}):`);
  console.log(`  RAW (pre-normalize): grass=${w.wGrass.toFixed(3)} rock=${w.wRock.toFixed(3)} snow=${w.wSnow.toFixed(3)} moss=${w.wNearMoss.toFixed(3)} belowDirt=${w.wBelowDirt.toFixed(3)} farDirt=${w.wFarDirt.toFixed(3)} patch=${w.wGrassPatch.toFixed(3)}`);
  console.log(`  NORMALIZED (%): grass=${(w.wGrass/total*100).toFixed(0)}% rock=${(w.wRock/total*100).toFixed(0)}% snow=${(w.wSnow/total*100).toFixed(0)}% moss=${(w.wNearMoss/total*100).toFixed(0)}% belowDirt=${(w.wBelowDirt/total*100).toFixed(0)}% farDirt=${(w.wFarDirt/total*100).toFixed(0)}% patch=${(w.wGrassPatch/total*100).toFixed(0)}%`);
}
