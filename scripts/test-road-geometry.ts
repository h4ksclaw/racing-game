interface V3{x:number;y:number;z:number;}
interface Sample extends V3{left:V3;right:V3;kerbLeft:V3;kerbRight:V3;grassLeft:V3;grassRight:V3;tangent:V3;binormal:V3;}
function v3(x:number,y:number,z:number):V3{return{x,y,z};}
function v3Add(a:V3,b:V3):V3{return{x:a.x+b.x,y:a.y+b.y,z:a.z+b.z};}
function v3Scale(a:V3,s:number):V3{return{x:a.x*s,y:a.y*s,z:a.z*s};}
function v3Cross(a:V3,b:V3):V3{return{x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x};}
function v3Len(a:V3):number{return Math.sqrt(a.x*a.x+a.y*a.y+a.z*a.z);}
function v3Norm(a:V3):V3{const l=v3Len(a);return l>0.001?v3Scale(a,1/l):v3(1,0,0);}
function v3Dist(a:V3,b:V3):number{return v3Len(v3(b.x-a.x,b.y-a.y,b.z-a.z));}

function makeTestSamples():Sample[]{
    const samples:Sample[]=[];const R=50,W=6,KW=0.8,SW=2;const up=v3(0,1,0);
    for(let i=0;i<20;i++){
        const t=(i/20)*Math.PI*2;
        const px=Math.cos(t)*R,pz=Math.sin(t)*R,py=0;
        const tangent=v3Norm(v3(-Math.sin(t),0,Math.cos(t)));
        let binormal=v3Cross(tangent,up);binormal=v3Norm(binormal);
        const pt=v3(px,py,pz);
        samples.push({x:px,y:py,z:pz,
            left:v3Add(pt,v3Scale(binormal,-W)),right:v3Add(pt,v3Scale(binormal,W)),
            kerbLeft:v3Add(pt,v3Scale(binormal,-(W+KW))),kerbRight:v3Add(pt,v3Scale(binormal,W+KW)),
            grassLeft:v3Add(pt,v3Scale(binormal,-(W+KW+SW))),grassRight:v3Add(pt,v3Scale(binormal,W+KW+SW)),
            tangent,binormal});
    }
    return samples;
}

function buildConcreteGeometry(samples:Sample[]){
    const verts:number[]=[],uvs:number[]=[],indices:number[]=[];
    const slabSteps=5;
    let roadDist=0;
    for(let i=0;i<samples.length;i++){
        const s=samples[i];
        if(i>0){const dx=s.x-samples[i-1].x,dz=s.z-samples[i-1].z;roadDist+=Math.sqrt(dx*dx+dz*dz);}
        const n1L=Math.sin(i*0.13+roadDist*0.05)*0.4+Math.sin(i*0.37+roadDist*0.02)*0.25;
        const n2L=Math.sin(i*0.71+1.3)*0.15+Math.sin(i*1.53+roadDist*0.08)*0.1;
        const n3L=Math.sin(i*3.17+2.7)*0.06;
        const deformL=n1L+n2L+n3L;
        const n1R=Math.sin(i*0.17+roadDist*0.04+2.0)*0.4+Math.sin(i*0.29+roadDist*0.03+0.5)*0.25;
        const n2R=Math.sin(i*0.63+3.1)*0.15+Math.sin(i*1.41+roadDist*0.07+1.2)*0.1;
        const n3R=Math.sin(i*2.93+0.8)*0.06;
        const deformR=n1R+n2R+n3R;
        const slabBase=0.75;
        const extL=slabBase+deformL*0.3;
        const extR=slabBase+deformR*0.3;
        const leftPts:[number,number,number][]=[];
        const rightPts:[number,number,number][]=[];
        for(let j=0;j<slabSteps;j++){
            const t=j/(slabSteps-1);
            const drop=t*t*(0.15+Math.abs(t<0.5?deformL:deformL+n3L)*0.08);
            const lateralNoise=deformL*t*t*0.6;
            const lx=s.left.x+s.binormal.x*(-extL*t)+lateralNoise;
            const lz=s.left.z+s.binormal.z*(-extL*t)+lateralNoise*0.5;
            leftPts.push([lx,s.left.y+0.02-drop,lz]);
            const dropR=t*t*(0.15+Math.abs(t<0.5?deformR:deformR+n3R)*0.08);
            const lateralNoiseR=deformR*t*t*0.6;
            const rx=s.right.x+s.binormal.x*(extR*t)+lateralNoiseR;
            const rz=s.right.z+s.binormal.z*(extR*t)+lateralNoiseR*0.5;
            rightPts.push([rx,s.right.y+0.02-dropR,rz]);
        }
        for(const p of leftPts)verts.push(p[0],p[1],p[2]);
        for(const p of rightPts)verts.push(p[0],p[1],p[2]);
        for(let j=0;j<slabSteps;j++)uvs.push(j/(slabSteps-1),roadDist/3);
        for(let j=0;j<slabSteps;j++)uvs.push(j/(slabSteps-1),roadDist/3);
        if(i>=samples.length-1)break;
        const slabN=5;
        const stride=slabN*2;
        const cb=i*stride;
        for(let j=0;j<slabN-1;j++){
            indices.push(cb+j,cb+slabN+j,cb+j+1,cb+slabN+j,cb+slabN+j+1,cb+j+1);
        }
        const slabRb=cb+slabN;
        for(let j=0;j<slabN-1;j++){
            indices.push(slabRb+j,slabRb+j+1,slabRb+stride+j,slabRb+j+1,slabRb+stride+j+1,slabRb+stride+j);
        }
    }
    return{verts,uvs,indices};
}

let errors=0;
function check(msg:string,ok:boolean){if(!ok){console.error('❌ '+msg);errors++;}else{console.log('✅ '+msg);}}

const samples=makeTestSamples();
console.log('\nTest track: '+samples.length+' samples (oval, R=50m)\n');
const{verts,uvs,indices}=buildConcreteGeometry(samples);
const vc=verts.length/3,tc=indices.length/3;
const slabSteps=5;

check('Vertex count: '+vc+' (expected '+(samples.length*slabSteps*2)+')',vc===samples.length*slabSteps*2);
check('Triangle count: '+tc+' (expected '+((samples.length-1)*(slabSteps-1)*2*2)+')',tc===(samples.length-1)*(slabSteps-1)*2*2);
check('Max index '+Math.max(...indices)+' < '+vc,Math.max(...indices)<vc);
check('Min index >= 0',Math.min(...indices)>=0);

let degen=0;
for(let t=0;t<tc;t++){const a=indices[t*3],b=indices[t*3+1],c=indices[t*3+2];if(a===b||b===c||a===c)degen++;}
check('Degenerate triangles: '+degen,degen===0);

let badWind=0;
for(let t=0;t<tc;t++){
    const i0=indices[t*3],i1=indices[t*3+1],i2=indices[t*3+2];
    const e1x=verts[i1*3]-verts[i0*3],e1z=verts[i1*3+2]-verts[i0*3+2];
    const e2x=verts[i2*3]-verts[i0*3],e2z=verts[i2*3+2]-verts[i0*3+2];
    const ny=e1z*e2x-e1x*e2z;
    if(ny<-0.001)badWind++;
}
check('Downward-facing normals: '+badWind,badWind===0);

// Outer edge (last vertex per side) should extend beyond road edge
let slabWiderL=0,slabWiderR=0;
for(let i=0;i<samples.length;i++){
    const center=v3(samples[i].x,0,samples[i].z);
    const roadL=v3(samples[i].left.x,0,samples[i].left.z);
    const outerL=v3(verts[(i*slabSteps*2+slabSteps-1)*3],0,verts[(i*slabSteps*2+slabSteps-1)*3+2]);
    const roadR=v3(samples[i].right.x,0,samples[i].right.z);
    const outerR=v3(verts[(i*slabSteps*2+slabSteps*2-1)*3],0,verts[(i*slabSteps*2+slabSteps*2-1)*3+2]);
    if(v3Dist(center,outerL)>v3Dist(center,roadL))slabWiderL++;
    if(v3Dist(center,outerR)>v3Dist(center,roadR))slabWiderR++;
}
check('Left outer beyond road: '+slabWiderL+'/'+samples.length,slabWiderL>=samples.length*0.8);
check('Right outer beyond road: '+slabWiderR+'/'+samples.length,slabWiderR>=samples.length*0.8);

// Outer edge must be lower than inner edge (continuous slope)
let slopeCorrect=0;
for(let i=0;i<samples.length;i++){
    const innerY=verts[i*slabSteps*2*3+1]; // first left vert Y
    const outerY=verts[(i*slabSteps*2+slabSteps-1)*3+1]; // last left vert Y
    if(outerY<innerY)slopeCorrect++;
}
check('Outer edge lower than inner: '+slopeCorrect+'/'+samples.length,slopeCorrect===samples.length);

// Monotonic drop: each successive vertex should be <= previous
let monotonic=0,totalChecks=0;
for(let i=0;i<samples.length;i++){
    for(let j=1;j<slabSteps;j++){
        const prevY=verts[(i*slabSteps*2+j-1)*3+1];
        const curY=verts[(i*slabSteps*2+j)*3+1];
        if(curY<=prevY+0.001)monotonic++; // allow tiny float tolerance
        totalChecks++;
    }
}
check('Monotonic Y drop (left): '+monotonic+'/'+totalChecks,monotonic===totalChecks);

let nanV=0;
for(const v of verts)if(isNaN(v))nanV++;
check('NaN vertices: '+nanV,nanV===0);

console.log('\n'+(errors===0?'✅ All checks passed!':'❌ '+errors+' error(s) found'));
process.exit(errors>0?1:0);
