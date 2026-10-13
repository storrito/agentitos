// Kinetic world — the illustrative three.js layer behind the typography.
// Everything is a pure function of (plan, time): no clocks, no frame history.
//
// Bundled by tools/build.mjs (esbuild, IIFE, global `KineticWorld`).

import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { PALETTES, createSignals } from "./signals.js";

// ---------------------------------------------------------------- helpers

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp01 = (x) => Math.min(1, Math.max(0, x));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

const NOISE_GLSL = /* glsl */ `
  float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
  float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
    return mix(mix(hash12(i),hash12(i+vec2(1,0)),f.x), mix(hash12(i+vec2(0,1)),hash12(i+vec2(1,1)),f.x), f.y); }
  float fbm(vec2 p){ float v=0., a=.5; mat2 m=mat2(1.6,1.2,-1.2,1.6); for(int i=0;i<5;i++){ v+=a*vnoise(p); p=m*p; a*=.5; } return v; }
`;

const additive = (uniforms, vertexShader, fragmentShader, extra = {}) =>
  new THREE.ShaderMaterial({
    uniforms, vertexShader, fragmentShader,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, ...extra,
  });

// ---------------------------------------------------------------- mount

export function mount(canvas, plan, opts = {}) {
  const W = plan.width, H = plan.height, aspect = W / H;
  const rnd = mulberry32(plan.seed * 9973 + 17);
  const S = createSignals(plan);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, preserveDrawingBuffer: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.autoClear = false;

  // Worlds: cosmos (nebula + stars), aurora (colour fields), editorial (ink on paper),
  // geometry (lit studio objects). Editorial reuses every motif: the glowing scene is
  // rendered as usual and then composited subtractively onto paper, so light becomes ink.
  const WORLD = plan.world || "cosmos";
  const INK = WORLD === "editorial", STUDIO = WORLD === "geometry", AURORA = WORLD === "aurora";
  const VIDEO = !!plan.video;
  const BOKEH = WORLD === "bokeh", NEON = WORLD === "neon", NOIR = WORLD === "noir";
  if (INK || STUDIO) renderer.toneMapping = THREE.NeutralToneMapping;
  if (STUDIO) { renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; }

  // Camera framing works for any aspect: keep the *short* side's FOV constant.
  const camera = new THREE.PerspectiveCamera(40, aspect, 0.1, 200);
  const baseVFov = aspect >= 1 ? 40 : THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(20)) / aspect));
  camera.fov = baseVFov;
  const CAM_Z = 10;
  // conversations get a steady camera; lyric videos may push in on the hero words
  const CAM_MOVE = plan.style?.drift ?? 1;
  const halfH = Math.tan(THREE.MathUtils.degToRad(baseVFov / 2)) * CAM_Z; // visible half height at z=0
  const halfW = halfH * aspect;
  const U = Math.min(halfW, halfH); // layout unit: half of the short side at z=0
  // over footage the face fills the upper half: centred motifs (rings, network, chart, pulse
  // rings, sun) move down into the dark band and shrink to fit it
  const VY = VIDEO ? -halfH * 0.42 : 0, VS = VIDEO ? 0.68 : 1;

  // ------------------------------------------------ background (own scene, ortho)
  const bgScene = new THREE.Scene();
  const bgCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const bgU = {
    uTime: { value: 0 }, uRes: { value: new THREE.Vector2(W, H) },
    uC0: { value: new THREE.Color() }, uC1: { value: new THREE.Color() }, uC2: { value: new THREE.Color() }, uC3: { value: new THREE.Color() },
    uFog: { value: 0 }, uCloud: { value: 0 }, uSun: { value: 0 }, uFlash: { value: 0 }, uHorizon: { value: 0 },
    uPulse: { value: 0 }, uFade: { value: 1 }, uCamY: { value: 0 }, uWarp: { value: 0 }, uSunY: { value: 0 },
    uWorld: { value: AURORA ? 1 : STUDIO ? 2 : BOKEH ? 3 : NEON ? 4 : NOIR ? 5 : 0 },
  };
  bgScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    uniforms: bgU, depthWrite: false, depthTest: false,
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }`,
    fragmentShader: /* glsl */ `
      precision highp float; varying vec2 vUv;
      uniform float uTime,uFog,uCloud,uSun,uFlash,uHorizon,uPulse,uFade,uCamY,uWarp,uSunY,uWorld; uniform vec2 uRes;
      uniform vec3 uC0,uC1,uC2,uC3;
      ${NOISE_GLSL}
      void main(){
        vec2 p=(vUv-.5)*vec2(uRes.x/uRes.y,1.); float s=min(1.,uRes.x/uRes.y); p/=max(s,.6);
        float dith=(hash12(gl_FragCoord.xy+fract(uTime)*91.)-.5)/255.;
        if(uWorld>4.5){
          // noir: a dark room cut by slanted light through blinds – the beams sweep slowly,
          // dust hangs in them (the particles); light / idea words open the blinds wider
          float tt=uTime*.05;
          vec2 q=p*mat2(.86,-.5,.5,.86);
          float beam=smoothstep(.55,.0,abs(q.x-.35*sin(tt*1.3)-.15))*.9+smoothstep(.35,.0,abs(q.x+.55+.2*cos(tt)))*.45;
          float slats=mix(.45,1.,smoothstep(-.7,.9,sin(q.y*26.+tt*2.)))*(1.-uSun*.5)+uSun*.5;
          float haze=.6+.4*fbm(p*2.+vec2(tt,0.));
          vec3 col=uC0+mix(uC1,uC3,.25)*beam*slats*haze*(.32+uFlash*.3+uPulse*.05);
          col*=1.-.6*smoothstep(.35,1.2,length((vUv-.5)*vec2(1.25,1.)));
          gl_FragColor=vec4(col*uFade+dith,1.); return;
        }
        if(uWorld>3.5){
          // neon: near-black, a glowing horizon over the grid floor, faint scanlines
          vec3 col=mix(uC0,uC1*.55,smoothstep(.9,-.35,p.y));
          float hz=exp(-abs(p.y+.28)*7.)*.5+exp(-abs(p.y+.28)*40.)*.5;
          col+=mix(uC2,uC3,.35)*hz*(.32+uPulse*.08+uFlash*.2);
          col+=uC3*uSun*.1*exp(-length(p-vec2(0.,uSunY))*2.5);
          col*=.92+.08*sin(gl_FragCoord.y*1.6);
          col*=1.-.4*smoothstep(.45,1.3,length((vUv-.5)*vec2(1.3,1.)));
          gl_FragColor=vec4(col*uFade+dith,1.); return;
        }
        if(uWorld>2.5){
          // bokeh: a warm, filmic dark room – soft light pools that drift very slowly
          float tt=uTime*.03;
          vec3 col=mix(uC0,uC1*.6,smoothstep(-.9,.8,p.y+.25*fbm(p*.8+tt)));
          col+=uC2*.07*smoothstep(.95,.0,length(p-vec2(sin(tt*2.)*.5,-.35)));
          col+=uC3*.05*smoothstep(.8,.0,length(p-vec2(cos(tt*1.7)*.55,.4)));
          col+=uC3*uSun*.1*exp(-length(p-vec2(0.,uSunY))*2.);
          col*=1.+uPulse*.05;
          col*=1.-.5*smoothstep(.4,1.25,length((vUv-.5)*vec2(1.25,1.)));
          gl_FragColor=vec4(col*uFade+dith,1.); return;
        }
        if(uWorld>1.5){
          // studio: seamless backdrop, light from above, soft floor shade
          vec3 col=mix(uC1,uC0,smoothstep(.0,.72,vUv.y));
          float spot=exp(-pow(length((vUv-vec2(.5,.64))*vec2(uRes.x/uRes.y,1.)),2.)*2.4);
          col=mix(col,mix(uC0,vec3(1.),.55),spot*.65);
          col+=uC2*uSun*.08*spot;
          col*=1.-.16*smoothstep(.55,1.35,length((vUv-.5)*vec2(1.2,1.)));
          gl_FragColor=vec4(col*uFade+dith,1.); return;
        }
        if(uWorld>.5){
          // aurora: drifting colour fields and soft light bands
          float tt=uTime*.06;
          float w=fbm(p*1.2+tt*.5);
          vec2 a1=vec2(sin(tt*1.3)*.45,cos(tt*1.1)*.3+.12), a2=vec2(cos(tt*.9+2.)*.5,sin(tt*1.2+1.)*.35-.18), a3=vec2(sin(tt*.7+4.)*.42,cos(tt*.8+3.)*.4);
          vec3 col=uC0;
          // wide, soft falloffs and saturated mid tones: light accents as fields read as grey smudges
          col=mix(col,uC1,smoothstep(1.25,.0,length(p-a1)+w*.25)*.85);
          col=mix(col,mix(uC1,uC2,.4),smoothstep(1.1,.0,length(p-a2)+w*.3)*.4);
          col=mix(col,mix(uC1,uC3,.2),smoothstep(.95,.0,length(p-a3)+w*.2)*.16);
          float band=sin(p.x*2.4+fbm(p*1.4+tt)*3.2+tt*2.)*.5+.5;
          col+=uC2*pow(band,8.)*.14*smoothstep(-.7,.6,p.y);
          // darkness sinks the colours instead of greying them
          col=mix(col,vec3(dot(col,vec3(.299,.587,.114))),uFog*.15)*(1.-uFog*.4);
          col+=uC3*uSun*.16*exp(-length(p-vec2(0.,uSunY))*2.2);
          col+=uFlash*uC3*.15;
          col*=1.+uPulse*.05;
          col*=1.-.35*smoothstep(.5,1.3,length((vUv-.5)*vec2(1.25,1.)));
          gl_FragColor=vec4(col*uFade+dith,1.); return;
        }
        float t=uTime*.035;
        vec2 q=vec2(fbm(p*1.3+vec2(t,-uCamY*.02)), fbm(p*1.3+vec2(5.2,1.3)-t));
        vec2 r=vec2(fbm(p*1.6+2.2*q+vec2(1.7,9.2)+t*.6), fbm(p*1.6+2.2*q+vec2(8.3,2.8)));
        float n=fbm(p*1.7+2.4*r+vec2(0.,uCamY*.04));
        vec3 col=mix(uC0,uC1,smoothstep(.25,.95,n));
        col+=uC2*pow(smoothstep(.55,1.,n),3.)*.45;
        col*=mix(.55,1.05,smoothstep(-.7,.6,p.y+.15*sin(t*3.)));
        // clouds / sky
        float c=fbm(p*2.2+vec2(uTime*.05,0.)+r*1.5);
        col=mix(col, mix(uC1*1.25,uC3,.16), uCloud*smoothstep(.42,.9,c)*.55);
        // sun / light source behind the type
        float d=length(p-vec2(0.,uSunY));
        col+=uC3*uSun*(.12*exp(-d*4.)+.05*exp(-d*1.3));
        col+=uC2*uSun*.06*exp(-d*.7);
        // horizon line for grid / waves
        col+=uC2*uHorizon*exp(-abs(p.y+.16)*10.)*.55;
        // warp tunnel vignette
        col+=uC2*uWarp*.18*smoothstep(.3,1.2,d);
        // fog: desaturate, sink
        float g=dot(col,vec3(.299,.587,.114));
        col=mix(col,vec3(g)*.55+uC0*.4,uFog*.65);
        col+=uFlash*mix(uC2,vec3(1.),.4)*.22;
        col*=1.+uPulse*.06;
        // soft vignette
        col*=1.-.55*smoothstep(.45,1.25,length((vUv-.5)*vec2(1.25,1.)));
        // dithering against banding
        col+=(hash12(gl_FragCoord.xy+fract(uTime)*91.)-.5)/255.;
        col=min(col,vec3(.55));
        gl_FragColor=vec4(col*uFade,1.);
      }`,
  })));

  // ------------------------------------------------ main scene
  const scene = new THREE.Scene();
  const sharedU = {
    uTime: { value: 0 }, uAccent: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() },
    uMid: { value: new THREE.Color() }, uFade: { value: 1 },
  };

  // ---- particles: dust / embers / rising / rain / warp / stars
  const NP = 5200;
  const pGeo = new THREE.BufferGeometry();
  const seeds = new Float32Array(NP * 4);
  for (let i = 0; i < NP * 4; i++) seeds[i] = rnd();
  pGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(NP * 3), 3));
  pGeo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 4));
  const box = new THREE.Vector3(halfW * 2.4, halfH * 2.4, 0);
  const motionU = {
    uRainPh: { value: 0 }, uRisePh: { value: 0 }, uWarpPh: { value: 0 }, uSwirlPh: { value: 0 },
    uRain: { value: 0 }, uRise: { value: 0 }, uWarp: { value: 0 }, uEmber: { value: 0 }, uStars: { value: 0 },
    uFog: { value: 0 }, uPulse: { value: 0 }, uBox: { value: box }, uShock: { value: 0 }, uWave: { value: 0 },
    uPresence: { value: STUDIO ? 0 : AURORA ? 0.3 : INK ? 0.55 : WORLD === "noir" ? 0.45 : 1 },
  };
  const PARTICLE_POS = /* glsl */ `
    attribute vec4 aSeed;
    uniform float uTime,uRainPh,uRisePh,uWarpPh,uSwirlPh,uRain,uRise,uWarp,uShock; uniform vec3 uBox;
    float wrapc(float v,float h){ return mod(v+h,2.*h)-h; }
    vec3 particlePos(vec4 s, out float sp){
      sp=.45+s.w*1.1;
      vec3 p=vec3((s.x*2.-1.)*uBox.x,(s.y*2.-1.)*uBox.y,mix(-34.,7.5,s.z));
      p.x+=sin(uTime*.21*sp+s.w*31.)*.35; p.y+=cos(uTime*.17*sp+s.x*23.)*.35;
      p.y=wrapc(p.y-uRainPh*sp*1.3+uRisePh*sp*.9,uBox.y);
      p.x=wrapc(p.x-uRainPh*sp*.18,uBox.x);
      p.z=-34.+mod(p.z+34.+uWarpPh*sp*2.2,41.5);
      float a=uSwirlPh*(.15+.6/(1.+length(p.xy)*.25));
      p.xy=mat2(cos(a),-sin(a),sin(a),cos(a))*p.xy;
      p.xy*=1.+uShock*.25*(1.-s.z);
      return p;
    }`;
  const particles = new THREE.Points(pGeo, additive({ ...sharedU, ...motionU }, /* glsl */ `
    ${PARTICLE_POS}
    uniform float uEmber,uStars,uFog,uPulse,uFade,uPresence; uniform vec3 uAccent,uGlow,uMid;
    varying float vA; varying vec3 vCol; varying float vStar;
    void main(){
      float sp; vec3 p=particlePos(aSeed,sp);
      vec4 mv=modelViewMatrix*vec4(p,1.); gl_Position=projectionMatrix*mv;
      float depth=-mv.z;
      float tw=.55+.45*sin(uTime*(1.5+aSeed.w*4.)+aSeed.x*60.);
      vStar=step(.82,aSeed.w)*uStars;
      float size=(1.4+aSeed.w*2.6)*(1.+uPulse*.35)+vStar*3.5*tw+uEmber*aSeed.z*2.;
      gl_PointSize=min(size*(${(H / 1080).toFixed(4)}*36./max(depth,1.)),${(H / 1080 * 42).toFixed(2)});
      vA=(.22+.55*aSeed.z)*(1.-uFog*.55)*(.75+.25*tw)*smoothstep(48.,6.,depth)*smoothstep(.2,1.2,depth);
      vA*=1.+vStar*2.*tw;
      vec3 ember=mix(vec3(1.,.42,.12),vec3(1.,.8,.45),aSeed.x);
      vCol=mix(mix(uGlow,uAccent,aSeed.x*.7),ember,uEmber*step(.35,aSeed.y));
      vA*=mix(1.,.6+.9*fract(sin(floor(uTime*14.+aSeed.w*50.)*12.9)*43758.),uEmber*.6)*uFade*uPresence;
    }`, /* glsl */ `
    varying float vA; varying vec3 vCol; varying float vStar;
    void main(){
      vec2 c=gl_PointCoord-.5; float d=length(c);
      float a=smoothstep(.5,.0,d); a*=a;
      float cross=vStar*(smoothstep(.06,0.,abs(c.x))+smoothstep(.06,0.,abs(c.y)))*smoothstep(.5,.1,d)*.6;
      gl_FragColor=vec4(vCol*(a+cross),1.)*vA;
    }`));
  particles.frustumCulled = false;
  scene.add(particles);

  // ---- streaks (rain + warp lines) – same motion field, drawn as short segments
  const NS = 1400;
  const sGeo = new THREE.BufferGeometry();
  const sSeeds = new Float32Array(NS * 2 * 4), sTail = new Float32Array(NS * 2);
  for (let i = 0; i < NS; i++) {
    const s = [rnd(), rnd(), rnd(), rnd()];
    for (let k = 0; k < 2; k++) { sSeeds.set(s, (i * 2 + k) * 4); sTail[i * 2 + k] = k; }
  }
  sGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(NS * 2 * 3), 3));
  sGeo.setAttribute("aSeed", new THREE.BufferAttribute(sSeeds, 4));
  sGeo.setAttribute("aTail", new THREE.BufferAttribute(sTail, 1));
  const streaks = new THREE.LineSegments(sGeo, additive({ ...sharedU, ...motionU }, /* glsl */ `
    ${PARTICLE_POS}
    attribute float aTail; uniform float uFade; uniform vec3 uAccent,uGlow; varying float vA; varying vec3 vCol;
    void main(){
      float sp; vec3 p=particlePos(aSeed,sp);
      vec3 dir=vec3(-.18*uRain,1.3*uRain-.9*uRise,-2.2*uWarp)*sp;
      p+=dir*aTail*(.35+.9*uWarp);
      vec4 mv=modelViewMatrix*vec4(p,1.); gl_Position=projectionMatrix*mv;
      float on=step(.45,aSeed.y);
      vA=on*max(max(uRain*.9,uWarp),uRise*.35)*(1.-aTail*.9)*(.25+.75*aSeed.z)*smoothstep(40.,4.,-mv.z)*uFade;
      vCol=mix(uGlow,uAccent,aSeed.x);
    }`, /* glsl */ `varying float vA; varying vec3 vCol; void main(){ gl_FragColor=vec4(vCol,1.)*vA*.8; }`));
  streaks.frustumCulled = false;
  scene.add(streaks);

  // ---- bokeh (bokeh world): big out-of-focus lights – flat discs with a brighter rim, drifting up
  const NBK = 90;
  const bkGeo = new THREE.BufferGeometry();
  const bkSeeds = new Float32Array(NBK * 4);
  for (let i = 0; i < NBK * 4; i++) bkSeeds[i] = rnd();
  bkGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(NBK * 3), 3));
  bkGeo.setAttribute("aSeed", new THREE.BufferAttribute(bkSeeds, 4));
  const bokehU = { ...sharedU, uLevel: { value: 0 }, uRisePh: { value: 0 }, uGlowUp: { value: 0 }, uBox: { value: new THREE.Vector3(halfW * 1.5, halfH * 1.35, 0) } };
  const bokeh = new THREE.Points(bkGeo, additive(bokehU, /* glsl */ `
    attribute vec4 aSeed; uniform float uTime,uRisePh,uGlowUp,uLevel; uniform vec3 uBox,uAccent,uGlow,uMid;
    varying float vA; varying vec3 vCol; varying float vRim;
    float wrapc(float v,float h){ return mod(v+h,2.*h)-h; }
    void main(){
      float sp=.35+aSeed.w*.9;
      vec3 p=vec3((aSeed.x*2.-1.)*uBox.x,(aSeed.y*2.-1.)*uBox.y,mix(-14.,3.,aSeed.z));
      p.y=wrapc(p.y+uTime*.08*sp+uRisePh*.25*sp,uBox.y);
      p.x+=sin(uTime*.11*sp+aSeed.w*20.)*.6;
      vec4 mv=modelViewMatrix*vec4(p,1.); gl_Position=projectionMatrix*mv;
      float depth=-mv.z;
      // near and far discs are the most defocused (= biggest, faintest)
      float defocus=abs(depth-11.)/9.;
      gl_PointSize=min(${(H / 1080).toFixed(4)}*(60.+aSeed.w*120.)*(.6+defocus)*12./max(depth,1.),${(H / 1080 * 240).toFixed(1)});
      float tw=.75+.25*sin(uTime*(.6+aSeed.w)+aSeed.x*40.);
      vA=uLevel*(.1+.16*aSeed.z)*tw*(1.+uGlowUp*1.4)/(.7+defocus*.8)*smoothstep(.5,2.5,depth);
      vec3 warm=vec3(1.,.78,.5);
      vCol=mix(mix(uAccent,uGlow,aSeed.y),warm,step(.62,aSeed.x)*.6);
      vRim=.25+.5*aSeed.w;
    }`, /* glsl */ `
    varying float vA; varying vec3 vCol; varying float vRim;
    void main(){
      float d=length(gl_PointCoord-.5)*2.;
      float disc=smoothstep(1.,.9,d);
      float rim=smoothstep(.72,.95,d)*disc*vRim;
      gl_FragColor=vec4(vCol*(disc*.55+rim),1.)*vA;
    }`));
  bokeh.frustumCulled = false;
  bokeh.visible = BOKEH;
  scene.add(bokeh);

  // ---- rings (time / spin / around)
  const rings = new THREE.Group();
  const ringMats = [];
  const ringDefs = [[1.0, 0.0105], [1.24, 0.006], [1.52, 0.0045], [0.82, 0.004]];
  for (const [r, tube] of ringDefs) {
    const m = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    ringMats.push(m);
    rings.add(new THREE.Mesh(new THREE.TorusGeometry(r * U * 0.95, tube * U * 2.2, 6, 256), m));
  }
  // clock ticks
  {
    const pts = [];
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2, r0 = U * 1.72, r1 = r0 + U * (i % 5 === 0 ? 0.12 : 0.05);
      pts.push(Math.cos(a) * r0, Math.sin(a) * r0, 0, Math.cos(a) * r1, Math.sin(a) * r1, 0);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    const m = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    ringMats.push(m);
    rings.add(new THREE.LineSegments(g, m));
  }
  // satellites
  const sats = [];
  for (let i = 0; i < 3; i++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(U * 0.028, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true }));
    sats.push(m); rings.add(m);
  }
  rings.position.z = -4.5; rings.position.y = VY;
  scene.add(rings);

  // ---- planet (world / earth / home)
  const planet = new THREE.Group();
  const R = U * 1.55;
  {
    const N = 6000, pos = new Float32Array(N * 3), rr = new Float32Array(N);
    const golden = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(1 - y * y), th = golden * i;
      pos[i * 3] = Math.cos(th) * r * R; pos[i * 3 + 1] = y * R; pos[i * 3 + 2] = Math.sin(th) * r * R;
      rr[i] = rnd();
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aR", new THREE.BufferAttribute(rr, 1));
    const pu = { ...sharedU, uLevel: { value: 0 } };
    const dots = new THREE.Points(g, additive(pu, /* glsl */ `
      attribute float aR; uniform float uLevel,uTime; varying float vA; varying float vLand;
      ${NOISE_GLSL}
      void main(){
        vec3 n=normalize(position);
        vec4 mv=modelViewMatrix*vec4(position,1.); gl_Position=projectionMatrix*mv;
        vec3 vn=normalize(normalMatrix*n);
        float facing=clamp(vn.z,0.,1.);
        float land=smoothstep(.48,.62,fbm(vec2(atan(n.z,n.x)*1.6,n.y*2.6)+3.));
        vLand=land;
        gl_PointSize=(1.6+land*2.2)*${(H / 1080).toFixed(4)}*1.6;
        vA=uLevel*(.12+facing*.9)*(.35+land*.9);
      }`, /* glsl */ `
      uniform vec3 uAccent,uGlow; uniform float uFade; varying float vA; varying float vLand;
      void main(){ float d=length(gl_PointCoord-.5); float a=smoothstep(.5,.1,d);
        gl_FragColor=vec4(mix(uAccent,uGlow,vLand),1.)*a*vA*uFade; }`));
    planet.add(dots);
    const atm = new THREE.Mesh(new THREE.SphereGeometry(R * 1.04, 64, 48), additive(pu, /* glsl */ `
      varying vec3 vN; varying vec3 vV;
      void main(){ vN=normalize(normalMatrix*normal); vec4 mv=modelViewMatrix*vec4(position,1.); vV=normalize(-mv.xyz); gl_Position=projectionMatrix*mv; }`, /* glsl */ `
      uniform vec3 uAccent; uniform float uLevel,uFade; varying vec3 vN; varying vec3 vV;
      void main(){ float f=pow(1.-max(dot(vN,vV),0.),3.2); gl_FragColor=vec4(uAccent*f*1.6,1.)*uLevel*uFade; }`, { side: THREE.FrontSide }));
    planet.add(atm);
    planet.userData.u = pu;
  }
  planet.rotation.z = 0.32;
  scene.add(planet);

  // ---- waves (ocean / water) – a field of dots on a sine sea
  const waveU = { ...sharedU, uLevel: { value: 0 }, uPh: { value: 0 } };
  {
    const NX = 150, NZ = 64, pos = new Float32Array(NX * NZ * 3);
    let k = 0;
    for (let z = 0; z < NZ; z++) for (let x = 0; x < NX; x++) {
      // rows get sparser with distance so the far sea doesn't turn into haze
      const zz = Math.pow(z / (NZ - 1), 1.35);
      pos[k++] = (x / (NX - 1) - 0.5) * 60; pos[k++] = 0; pos[k++] = 7 - zz * 42;
    }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const sea = new THREE.Points(g, additive(waveU, /* glsl */ `
      uniform float uTime,uLevel,uPh; varying float vA; varying float vH;
      void main(){
        vec3 p=position;
        float h=sin(p.x*.32+uPh*1.6)*.45+sin(p.z*.42-uPh*1.25+p.x*.12)*.55+sin((p.x+p.z)*.9+uPh*2.7)*.14;
        p.y=h*(.5+uLevel*1.1);
        vH=h;
        vec4 mv=modelViewMatrix*vec4(p,1.); gl_Position=projectionMatrix*mv;
        float depth=-mv.z;
        gl_PointSize=${(H / 1080).toFixed(4)}*(70.+vH*30.)/max(depth,1.);
        vA=uLevel*uLevel*smoothstep(48.,6.,depth)*smoothstep(.5,3.,depth)*(.55+.45*smoothstep(-.6,.9,vH));
      }`, /* glsl */ `
      uniform vec3 uAccent,uGlow; uniform float uFade; varying float vA; varying float vH;
      void main(){ float d=length(gl_PointCoord-.5); float a=smoothstep(.5,.05,d);
        gl_FragColor=vec4(mix(uAccent,uGlow,smoothstep(.2,1.,vH)),1.)*a*vA*uFade*.9; }`));
    sea.frustumCulled = false;
    sea.position.y = -halfH * 0.75 - 1.2;
    sea.rotation.x = 0.05;
    scene.add(sea);
    waveU.mesh = sea;
  }

  // ---- neon grid floor + skyline (city / street)
  const gridU = { ...sharedU, uLevel: { value: 0 }, uPh: { value: 0 } };
  {
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(120, 90, 1, 1), additive(gridU, /* glsl */ `
      varying vec3 vW; void main(){ vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`, /* glsl */ `
      uniform float uLevel,uPh,uFade; uniform vec3 uAccent,uGlow; varying vec3 vW;
      float line(float v,float w){ float f=abs(fract(v)-.5); float d=fwidth(v); return smoothstep(w+d,w-d*.5,.5-f); }
      void main(){
        float gx=line(vW.x/2.2,.03), gz=line((vW.z+uPh*4.)/2.2,.03);
        float depth=clamp((8.-vW.z)/70.,0.,1.);
        float g=max(gx,gz)*(1.-depth)*(1.-depth);
        vec3 c=mix(uAccent,uGlow,gz*.5);
        gl_FragColor=vec4(c*g*.8,1.)*uLevel*uFade;
      }`, { side: THREE.DoubleSide, extensions: { derivatives: true } }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, -halfH * 0.7 - 0.4, -30);
    scene.add(floor);
    gridU.floor = floor;
    // skyline: instanced towers with window lights
    const NB = 70;
    const towers = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.ShaderMaterial({
      uniforms: gridU, transparent: true, depthWrite: true,
      vertexShader: /* glsl */ `varying vec3 vL; varying vec3 vS; varying float vId;
        void main(){ vL=position; vS=vec3(instanceMatrix[0][0],instanceMatrix[1][1],instanceMatrix[2][2]); vId=float(gl_InstanceID);
          gl_Position=projectionMatrix*viewMatrix*modelMatrix*instanceMatrix*vec4(position,1.); }`,
      fragmentShader: /* glsl */ `uniform float uLevel,uFade,uTime; uniform vec3 uAccent,uGlow,uMid; varying vec3 vL; varying vec3 vS; varying float vId;
        float h(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }
        void main(){
          vec2 cell=floor(vec2((vL.x+.5)*vS.x*2.2,(vL.y+.5)*vS.y*2.6));
          vec2 f=fract(vec2((vL.x+.5)*vS.x*2.2,(vL.y+.5)*vS.y*2.6));
          float win=step(.3,f.x)*step(f.x,.75)*step(.3,f.y)*step(f.y,.72);
          float on=step(.62,h(cell+vId*7.1+floor(uTime*.4+h(cell)*9.)*.0));
          vec3 base=uMid*.18;
          vec3 c=base+win*on*mix(uGlow,uAccent,h(cell+3.))*.55;
          float edge=smoothstep(.47,.5,abs(vL.y));
          c+=uAccent*edge*.12;
          gl_FragColor=vec4(c*uFade,uLevel);
        }`,
    }), NB);
    const m4 = new THREE.Matrix4();
    for (let i = 0; i < NB; i++) {
      const w = 1.2 + rnd() * 2.6, h = 1.5 + rnd() ** 2.2 * 9, d = 1.2 + rnd() * 2;
      const x = (i / (NB - 1) - 0.5) * 120 + (rnd() - 0.5) * 2, z = -46 - rnd() * 12;
      m4.compose(new THREE.Vector3(x, floor.position.y + h / 2, z), new THREE.Quaternion(), new THREE.Vector3(w, h, d));
      towers.setMatrixAt(i, m4);
    }
    towers.frustumCulled = false;
    scene.add(towers);
    gridU.towers = towers;
  }

  // ---- sun / light source (behind the type)
  const sunU = { ...sharedU, uLevel: { value: 0 } };
  const sun = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), additive(sunU, `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`, /* glsl */ `
    uniform float uLevel,uTime,uFade; uniform vec3 uAccent,uGlow; varying vec2 vUv;
    ${NOISE_GLSL}
    void main(){
      vec2 p=vUv-.5; float d=length(p)*2.; float a=atan(p.y,p.x);
      float core=smoothstep(.05,.04,d)*.6;
      float halo=exp(-d*8.)*.32+exp(-d*2.6)*.1;
      float rays=pow(fbm(vec2(a*4.+uTime*.05,d*.3-uTime*.1)),3.)*.9*exp(-d*2.2)*smoothstep(.08,.25,d);
      float rays2=pow(.5+.5*sin(a*14.+uTime*.25),22.)*exp(-d*2.6)*.45;
      vec3 c=uGlow*(core*1.6+halo)+uAccent*(rays+rays2);
      gl_FragColor=vec4(c,1.)*uLevel*uFade*smoothstep(1.,.7,d);
    }`));
  sun.position.z = -14;
  const sunScale = (halfW + halfH) * 2.4;
  sun.scale.setScalar(sunScale);
  scene.add(sun);

  // ---- pulse rings (heartbeat / shockwaves) – screen-facing plane, up to 8 live pulses
  const MAXP = 8;
  const pulseU = { ...sharedU, uP: { value: Array.from({ length: MAXP }, () => new THREE.Vector4(-99, 0, 0, 0)) }, uAsp: { value: aspect } };
  const pulsePlane = new THREE.Mesh(new THREE.PlaneGeometry(halfW * 2 * 1.2, halfH * 2 * 1.2), additive(pulseU,
    `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`, /* glsl */ `
    uniform vec4 uP[${MAXP}]; uniform float uTime,uAsp,uFade; uniform vec3 uAccent,uGlow; varying vec2 vUv;
    void main(){
      vec2 p=(vUv-.5)*vec2(uAsp,1.)*1.2;
      float d=length(p); vec3 c=vec3(0.);
      for(int i=0;i<${MAXP};i++){
        vec4 P=uP[i]; float age=uTime-P.x; if(age<0.||age>3.) continue;
        float speed=mix(.55,1.5,P.z); float r=age*speed+.05;
        float w=mix(.006,.022,P.z)+age*.012;
        float ring=exp(-pow((d-r)/w,2.))*(1.-smoothstep(0.,mix(2.2,1.4,P.z),age));
        c+=mix(uAccent,uGlow,P.z*.6)*ring*P.y*.9;
      }
      gl_FragColor=vec4(c,1.)*uFade;
    }`));
  pulsePlane.position.z = -1.5; pulsePlane.position.y = VY;
  scene.add(pulsePlane);

  // ---- shards (break / shatter)
  const breakEvents = plan.events.filter((e) => e.motif === "shards").map((e) => {
    const w = plan.words[e.word];
    return { t: w.start + Math.min(0.35, (w.end - w.start) * 0.6), strength: e.strength };
  });
  const NSH = 140;
  const shardGeo = new THREE.BufferGeometry();
  {
    const v = [];
    // irregular triangle, slightly thick
    v.push(-0.5, -0.4, 0, 0.55, -0.3, 0, -0.05, 0.6, 0);
    shardGeo.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
    shardGeo.computeVertexNormals();
  }
  const shardU = { ...sharedU, uLevel: { value: 0 } };
  const shards = new THREE.InstancedMesh(shardGeo, new THREE.ShaderMaterial({
    uniforms: shardU, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `varying float vF; varying vec3 vB;
      void main(){ vec4 w=modelMatrix*instanceMatrix*vec4(position,1.);
        vec3 n=normalize(mat3(modelMatrix*instanceMatrix)*vec3(0.,0.,1.));
        vF=abs(n.z); vB=position; gl_Position=projectionMatrix*viewMatrix*w; }`,
    fragmentShader: /* glsl */ `uniform vec3 uAccent,uGlow; uniform float uLevel,uFade; varying float vF; varying vec3 vB;
      void main(){ float glint=pow(1.-vF,2.)*.9+pow(vF,24.)*1.2; gl_FragColor=vec4(mix(uAccent,uGlow,glint*.4)*(.06+glint*.7),1.)*uLevel*uFade; }`,
  }), NSH);
  const shardData = [];
  for (let i = 0; i < NSH; i++) {
    const a = rnd() * Math.PI * 2, el = (rnd() - 0.5) * 1.2;
    shardData.push({
      p0: new THREE.Vector3((rnd() - 0.5) * U * 1.6, (rnd() - 0.5) * U * 0.7, (rnd() - 0.5) * 0.8),
      v: new THREE.Vector3(Math.cos(a) * (2 + rnd() * 7), Math.sin(a) * (1 + rnd() * 5) + el, 1 + rnd() * 4.5),
      r: new THREE.Vector3(rnd() * 6, rnd() * 6, rnd() * 6), w: new THREE.Vector3(rnd() * 8 - 4, rnd() * 8 - 4, rnd() * 8 - 4),
      s: U * (0.05 + rnd() ** 2 * 0.22),
    });
  }
  shards.frustumCulled = false;
  scene.add(shards);

  // ---- lightning (electric / thunder)
  const bolts = [];
  {
    const boltMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    for (let b = 0; b < 5; b++) {
      let pts = [new THREE.Vector3((rnd() - 0.5) * halfW * 1.6, halfH * 1.3, -6 - rnd() * 6), new THREE.Vector3((rnd() - 0.5) * halfW * 1.4, -halfH * 1.3, -6 - rnd() * 6)];
      let disp = halfH * 0.5;
      for (let it = 0; it < 7; it++) {
        const out = [];
        for (let i = 0; i < pts.length - 1; i++) {
          const a = pts[i], c = pts[i + 1];
          const m = a.clone().lerp(c, 0.5);
          m.x += (rnd() - 0.5) * disp; m.z += (rnd() - 0.5) * disp * 0.3;
          out.push(a, m);
        }
        out.push(pts[pts.length - 1]);
        pts = out; disp *= 0.55;
      }
      const g = new THREE.BufferGeometry().setFromPoints(pts);
      const group = new THREE.Group();
      for (let k = 0; k < 3; k++) {
        const l = new THREE.Line(g, boltMat.clone());
        l.position.x = (k - 1) * 0.02; group.add(l);
      }
      bolts.push(group); scene.add(group);
    }
  }

  // ---- chart (growth / money / numbers): a rising curve that draws itself, bars below
  const chart = new THREE.Group();
  const CH_N = 90;
  const chartU = { ...sharedU, uLevel: { value: 0 }, uProg: { value: 0 } };
  {
    const cw = halfW * 1.7, chh = halfH * 0.62;
    const pts = [];
    let y = 0;
    for (let i = 0; i < CH_N; i++) {
      const x = i / (CH_N - 1);
      y += (rnd() - 0.32) * 0.05; // upward-trending walk
      const v = Math.max(0, 0.08 + x * x * 0.75 + y * 0.6 + Math.sin(x * 9) * 0.03);
      pts.push(new THREE.Vector3((x - 0.5) * cw, v * chh - chh * 0.5, 0));
    }
    const lineGeo = new THREE.BufferGeometry().setFromPoints(pts);
    const prog = new Float32Array(CH_N); for (let i = 0; i < CH_N; i++) prog[i] = i / (CH_N - 1);
    lineGeo.setAttribute("aProg", new THREE.BufferAttribute(prog, 1));
    const lineMat = additive(chartU, `attribute float aProg; varying float vP; void main(){ vP=aProg; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      `uniform float uLevel,uProg,uFade; uniform vec3 uAccent,uGlow; varying float vP;
       void main(){ if(vP>uProg) discard; float head=smoothstep(uProg-.08,uProg,vP); gl_FragColor=vec4(mix(uAccent,uGlow,head)*(1.2+head*1.5),1.)*uLevel*uFade; }`);
    for (let k = 0; k < 3; k++) { const l = new THREE.Line(lineGeo, lineMat); l.position.y = k * 0.018; chart.add(l); }
    // area fill under the curve
    const area = [];
    const ap = [];
    for (let i = 0; i < CH_N - 1; i++) {
      const a0 = pts[i], a1 = pts[i + 1], b0 = -chh * 0.5;
      area.push(a0.x, a0.y, 0, a1.x, a1.y, 0, a0.x, b0, 0, a1.x, a1.y, 0, a1.x, b0, 0, a0.x, b0, 0);
      const p0 = prog[i], p1 = prog[i + 1];
      ap.push(p0, p1, p0, p1, p1, p0);
    }
    const areaGeo = new THREE.BufferGeometry();
    areaGeo.setAttribute("position", new THREE.Float32BufferAttribute(area, 3));
    areaGeo.setAttribute("aProg", new THREE.Float32BufferAttribute(ap, 1));
    chart.add(new THREE.Mesh(areaGeo, additive(chartU, `attribute float aProg; varying float vP; varying float vY; void main(){ vP=aProg; vY=position.y; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      `uniform float uLevel,uProg,uFade; uniform vec3 uAccent; varying float vP; varying float vY;
       void main(){ if(vP>uProg) discard; gl_FragColor=vec4(uAccent*.16,1.)*uLevel*uFade*smoothstep(${(-halfH * 0.31).toFixed(2)},${(halfH * 0.31).toFixed(2)},vY+${(halfH * 0.2).toFixed(2)}); }`, { side: THREE.DoubleSide })));
    // baseline grid
    const gl = [];
    for (let k = 0; k <= 4; k++) { const yy = -chh * 0.5 + (k / 4) * chh; gl.push(-cw / 2, yy, 0, cw / 2, yy, 0); }
    const gg = new THREE.BufferGeometry(); gg.setAttribute("position", new THREE.Float32BufferAttribute(gl, 3));
    chart.add(new THREE.LineSegments(gg, additive(chartU, `void main(){ gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
      `uniform float uLevel,uFade; uniform vec3 uGlow; void main(){ gl_FragColor=vec4(uGlow*.12,1.)*uLevel*uFade; }`)));
    chart.position.set(0, VIDEO ? VY : -halfH * 0.18, -5); chart.scale.multiplyScalar(VS);
    chart.rotation.x = -0.12;
  }
  scene.add(chart);

  // ---- network (tech / people): nodes on a slowly turning shell, nearest-neighbour links
  const net = new THREE.Group();
  const netU = { ...sharedU, uLevel: { value: 0 } };
  {
    const NN = 140, nodes = [];
    for (let i = 0; i < NN; i++) {
      const th = rnd() * Math.PI * 2, ph = Math.acos(2 * rnd() - 1), rr = U * (1.35 + rnd() * 0.5);
      nodes.push(new THREE.Vector3(Math.sin(ph) * Math.cos(th) * rr * 1.5, Math.cos(ph) * rr * 0.85, Math.sin(ph) * Math.sin(th) * rr * 0.6));
    }
    const pg = new THREE.BufferGeometry().setFromPoints(nodes);
    const seedA = new Float32Array(NN); for (let i = 0; i < NN; i++) seedA[i] = rnd();
    pg.setAttribute("aS", new THREE.BufferAttribute(seedA, 1));
    net.add(new THREE.Points(pg, additive(netU, `attribute float aS; uniform float uTime; varying float vA;
      void main(){ vec4 mv=modelViewMatrix*vec4(position,1.); gl_Position=projectionMatrix*mv;
        float pulse=pow(.5+.5*sin(uTime*2.2+aS*40.),6.);
        gl_PointSize=(3.+pulse*7.)*${(H / 1080).toFixed(4)}*10./max(-mv.z*.1,.6); vA=.55+pulse; }`,
      `uniform float uLevel,uFade; uniform vec3 uAccent,uGlow; varying float vA;
       void main(){ float d=length(gl_PointCoord-.5); float a=smoothstep(.5,.1,d); gl_FragColor=vec4(mix(uAccent,uGlow,.5),1.)*a*vA*uLevel*uFade; }`)));
    const seg = [];
    nodes.forEach((a, i) => {
      const near = nodes.map((b, j) => [a.distanceToSquared(b), j]).filter(([, j]) => j !== i).sort((x, y) => x[0] - y[0]).slice(0, 3);
      for (const [, j] of near) if (j > i) seg.push(a.x, a.y, a.z, nodes[j].x, nodes[j].y, nodes[j].z);
    });
    const sg = new THREE.BufferGeometry(); sg.setAttribute("position", new THREE.Float32BufferAttribute(seg, 3));
    net.add(new THREE.LineSegments(sg, additive(netU, `varying float vZ; void main(){ vec4 mv=modelViewMatrix*vec4(position,1.); vZ=-mv.z; gl_Position=projectionMatrix*mv; }`,
      `uniform float uLevel,uFade; uniform vec3 uAccent; varying float vZ; void main(){ gl_FragColor=vec4(uAccent*.45,1.)*uLevel*uFade*smoothstep(26.,8.,vZ); }`)));
    net.position.z = -5; net.position.y = VY;
  }
  scene.add(net);

  // ---- studio objects (geometry world): matte primitives with soft shadows, around the type
  const studioObjs = [];
  let keyLight = null;
  if (STUDIO) {
    scene.add(new THREE.HemisphereLight(0xffffff, 0xb9bccc, 1.5));
    keyLight = new THREE.DirectionalLight(0xffffff, 2.3);
    keyLight.position.set(-halfW * 0.8, halfH * 1.6, 9);
    keyLight.target.position.set(0, 0, -5);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(2048, 2048);
    const sc = keyLight.shadow.camera;
    sc.left = -halfW * 2.2; sc.right = halfW * 2.2; sc.top = halfH * 2.2; sc.bottom = -halfH * 2.2; sc.near = 1; sc.far = 40;
    keyLight.shadow.radius = 8; keyLight.shadow.bias = -0.0006;
    scene.add(keyLight, keyLight.target);
    const fill = new THREE.DirectionalLight(0xffffff, 0.55);
    fill.position.set(halfW, -halfH * 0.4, 6);
    scene.add(fill);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(halfW * 10, halfH * 10), new THREE.ShadowMaterial({ opacity: 0.16 }));
    back.position.z = -9; back.receiveShadow = true;
    scene.add(back);
    const geos = [
      new THREE.SphereGeometry(1, 64, 40), new THREE.TorusGeometry(0.72, 0.3, 40, 120), new THREE.CapsuleGeometry(0.5, 0.9, 12, 40),
      new THREE.ConeGeometry(0.85, 1.5, 64), new THREE.CylinderGeometry(0.75, 0.75, 0.55, 64), new THREE.IcosahedronGeometry(0.95, 0),
      new THREE.OctahedronGeometry(0.95, 0), new THREE.TorusGeometry(0.8, 0.12, 24, 120),
    ];
    const N = 15;
    for (let i = 0; i < N; i++) {
      const mat = new THREE.MeshStandardMaterial({ roughness: 0.52, metalness: 0.04 });
      const m = new THREE.Mesh(geos[i % geos.length], mat);
      m.castShadow = true; m.receiveShadow = true;
      const a = (i / N) * Math.PI * 2 + (rnd() - 0.5) * 0.35;
      m.userData = {
        a, z: -1.2 - rnd() * 3.6, s: U * (0.1 + rnd() * 0.13), slot: i % 4,
        rx: rnd() * 6, ry: rnd() * 6, wx: (rnd() - 0.5) * 0.6, wy: 0.15 + rnd() * 0.35, bob: rnd() * 6, sp: 0.6 + rnd() * 0.8,
      };
      studioObjs.push(m);
      scene.add(m);
    }
  }

  // ---------------------------------------------------- post
  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: 4 }));
  composer.setPixelRatio(1);
  composer.setSize(W, H);
  const bgPass = new RenderPass(bgScene, bgCam);
  const mainPass = new RenderPass(scene, camera);
  mainPass.clear = false; mainPass.clearDepth = true;
  const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.6, 0.6, 0.32);
  const finalPass = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null }, uCA: { value: 0.0015 }, uAsp: { value: aspect }, uGlitch: { value: 0 }, uTime: { value: 0 },
      uInk: { value: INK ? 1 : 0 }, uPaper: { value: new THREE.Color() }, uPaper2: { value: new THREE.Color() }, uRes: { value: new THREE.Vector2(W, H) },
      uFadeP: { value: 1 },
    },
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse; uniform float uCA,uAsp,uGlitch,uTime,uInk,uFadeP; uniform vec3 uPaper,uPaper2; uniform vec2 uRes; varying vec2 vUv;
      float h(float n){ return fract(sin(n)*43758.5453); }
      ${NOISE_GLSL}
      vec3 paper(vec2 uv){
        vec2 q=uv*vec2(uRes.x/uRes.y,1.);
        float mottle=fbm(q*3.2)*.5+fbm(q*11.)*.25;
        float fibre=vnoise(q*vec2(420.,160.))*.5+vnoise(q*vec2(160.,520.))*.5;
        vec3 c=mix(uPaper2,uPaper,.55+mottle*.6);
        c*=1.-(fibre-.5)*.035;
        c*=1.-.07*smoothstep(.45,1.2,length((uv-.5)*vec2(1.2,1.)));
        return c;
      }
      void main(){
        vec2 uv=vUv;
        float band=floor(uv.y*28.+floor(uTime*18.)*3.);
        float g=step(1.-uGlitch*.35,h(band+floor(uTime*18.)));
        uv.x+=g*(h(band*1.7)-.5)*.06*uGlitch;
        vec2 dir=(uv-.5)*vec2(uAsp,1.); float k=uCA*(1.+dot(dir,dir)*2.)+uGlitch*.006;
        vec3 c=vec3(texture2D(tDiffuse,uv+dir*k).r, texture2D(tDiffuse,uv).g, texture2D(tDiffuse,uv-dir*k).b);
        if(uInk>.5){
          // light becomes ink: the scene darkens the paper where it glows
          // the paper is always there; fades only take the ink away
          c=paper(vUv)*(1.-clamp(c*1.6,0.,1.)*.93*uFadeP);
        }
        gl_FragColor=vec4(c,1.);
      }`,
  });
  bgPass.enabled = !INK; // editorial: the paper is drawn in the final pass
  // ...so the scene pass must start from a clean (black = no ink) buffer every frame,
  // otherwise ink accumulates frame after frame in a sequential render
  if (INK) { mainPass.clear = true; mainPass.clearColor = new THREE.Color(0, 0, 0); mainPass.clearAlpha = 1; }
  composer.addPass(bgPass);
  composer.addPass(mainPass);
  composer.addPass(bloom);
  composer.addPass(finalPass);
  composer.addPass(new OutputPass());

  // ---------------------------------------------------- per-frame state
  const tmpC = new THREE.Color();
  const pal = { c0: new THREE.Color(), c1: new THREE.Color(), c2: new THREE.Color(), c3: new THREE.Color() };
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v3 = new THREE.Vector3(), sc = new THREE.Vector3();

  function renderAt(time) {
    const t = Math.max(0, Math.min(plan.duration, time));
    const L = S.levels(t);
    S.palette(t, pal);
    // social: the first frame is the thumbnail, so no fade-in from black
    const fadeIn = plan.preset === "social" ? 1 : smooth(0, 0.9, t);
    const fade = fadeIn * (1 - smooth(plan.duration - 0.6, plan.duration, t));
    if (INK) {
      // paper from the ground colours; every motif colour becomes its ink complement,
      // so that paper * (1 - colour) lands on the palette's accent ink
      finalPass.uniforms.uPaper.value.copy(pal.c0); finalPass.uniforms.uPaper2.value.copy(pal.c1);
      finalPass.uniforms.uFadeP.value = fade;
      for (const k of ["c1", "c2", "c3"]) {
        const c = pal[k], p0 = pal.c0;
        c.setRGB(clamp01(1 - c.r / Math.max(p0.r, 0.05)), clamp01(1 - c.g / Math.max(p0.g, 0.05)), clamp01(1 - c.b / Math.max(p0.b, 0.05)));
      }
    }

    for (const k of ["uTime"]) { bgU[k].value = t; sharedU[k].value = t; }
    sharedU.uFade.value = fade;
    sharedU.uAccent.value.copy(pal.c2); sharedU.uGlow.value.copy(pal.c3); sharedU.uMid.value.copy(pal.c1);
    bgU.uC0.value.copy(pal.c0); bgU.uC1.value.copy(pal.c1); bgU.uC2.value.copy(pal.c2); bgU.uC3.value.copy(pal.c3);
    bgU.uFog.value = L.fog; bgU.uCloud.value = Math.max(L.clouds, L.ascend * 0.5);
    bgU.uSun.value = L.sun * 0.7; bgU.uFlash.value = L.flash; bgU.uHorizon.value = Math.max(L.grid, L.waves * 0.8);
    // the studio backdrop never goes black; over footage there is no backdrop at all (the canvas is screened onto the video)
    // (aurora keeps half its colour veils over footage – screened, they read as coloured light)
    bgU.uPulse.value = L.pulse; bgU.uFade.value = VIDEO ? (AURORA ? fade * 0.5 : NOIR ? fade * 0.5 : 0) : STUDIO ? 1 : fade;
    bgU.uCamY.value = S.phase("ascend", t); bgU.uWarp.value = L.warp;

    // particle motion field (integrated phases keep motion continuous when speeds change)
    motionU.uRainPh.value = S.phase("rain", t); motionU.uRisePh.value = S.phase("rise", t);
    motionU.uWarpPh.value = S.phase("warp", t); motionU.uSwirlPh.value = S.phase("swirl", t);
    motionU.uRain.value = L.rain; motionU.uRise.value = Math.max(L.ascend, L.embers * 0.7);
    // neon: always a little headwind – light streaks pass the camera
    motionU.uWarp.value = NEON ? Math.max(L.warp, 0.16) : L.warp; motionU.uEmber.value = L.embers; motionU.uStars.value = AURORA ? L.stars * 0.3 : Math.max(L.stars, 0.25);
    motionU.uFog.value = L.fog; motionU.uPulse.value = L.pulse; motionU.uShock.value = L.shock;

    // rings
    const rl = L.rings;
    rings.visible = rl > 0.002;
    if (rings.visible) {
      const sw = S.phase("swirl", t);
      rings.scale.setScalar((1.05 + 0.3 * smooth(0, 1, rl)) * VS);
      rings.children.forEach((c, i) => {
        if (i < 4) { c.rotation.set(1.15 + Math.sin(t * 0.3 + i) * 0.25 + i * 0.32, sw * (0.35 + i * 0.22) * (i % 2 ? -1 : 1), i * 0.6); }
        else if (i === 4) { c.rotation.set(0, 0, -sw * 0.15); }
      });
      ringMats.forEach((m, i) => { tmpC.copy(i % 2 ? pal.c2 : pal.c3); m.color.copy(tmpC).multiplyScalar(i === 4 ? 0.45 : 0.5); m.opacity = rl * fade * (i === 4 ? 0.6 : 0.75); });
      sats.forEach((s, i) => {
        const ring = rings.children[i];
        const a = sw * (1.1 + i * 0.5) + i * 2;
        const r = ringDefs[i][0] * U * 0.95;
        v3.set(Math.cos(a) * r, Math.sin(a) * r, 0).applyEuler(ring.rotation);
        s.position.copy(v3); s.material.color.copy(pal.c3).multiplyScalar(2); s.material.opacity = rl * fade;
      });
    }

    // planet
    const pl = L.planet;
    planet.visible = pl > 0.002;
    if (planet.visible) {
      planet.userData.u.uLevel.value = pl;
      planet.position.set(0, -R * 1.62 + smooth(0, 1, pl) * R * 0.62 - S.phase("ascend", t) * 0.15, -4);
      planet.rotation.y = t * 0.12;
    }

    // waves
    waveU.uLevel.value = L.waves; waveU.uPh.value = t + S.phase("rain", t) * 0.2;
    waveU.mesh.visible = L.waves > 0.002;

    // grid
    // neon: the grid floor is the world itself, always there and always rolling; the skyline only for "city"
    gridU.uLevel.value = NEON ? Math.max(L.grid, VIDEO ? 0.38 : 0.62) : L.grid; gridU.uPh.value = S.phase("warp", t) + t * (NEON ? 1.1 : 0.4);
    gridU.towers.visible = L.grid > 0.002;
    gridU.floor.visible = NEON || L.grid > 0.002;

    // bokeh: lights brighten on light / warmth / heartbeat moments and rise with "ascend"
    if (BOKEH) {
      bokehU.uLevel.value = fade;
      bokehU.uRisePh.value = S.phase("rise", t);
      bokehU.uGlowUp.value = Math.min(1, L.sun + L.heartbeat * 0.8 + L.pulse * 0.3 + L.embers * 0.5);
    }

    // sun
    sunU.uLevel.value = L.sun * 0.75;
    sun.visible = L.sun > 0.002;
    sun.position.y = VIDEO ? halfH * (-1.1 + 0.55 * smooth(0, 1, L.sun)) : halfH * (-0.5 + 1.25 * smooth(0, 1, L.sun));
    bgU.uSunY.value = (sun.position.y * (CAM_Z / (CAM_Z + 14))) / halfH * 0.5;

    // pulses
    const ps = S.pulses(t, MAXP);
    for (let i = 0; i < MAXP; i++) {
      const p = ps[i];
      pulseU.uP.value[i].set(p ? p.t : -99, p ? p.amp : 0, p ? p.kind : 0, 0);
    }

    // shards
    let shardLevel = 0;
    let bestBreak = null;
    for (const b of breakEvents) if (t >= b.t - 0.05 && t < b.t + 3.2) bestBreak = b;
    shards.visible = !!bestBreak;
    if (bestBreak) {
      const age = Math.max(0, t - bestBreak.t);
      shardLevel = (1 - smooth(1.4, 3.1, age)) * smooth(-0.05, 0.03, t - bestBreak.t);
      shardU.uLevel.value = shardLevel * bestBreak.strength;
      const k = 1 - Math.exp(-age * 2.2); // decelerating travel
      for (let i = 0; i < NSH; i++) {
        const d = shardData[i];
        v3.copy(d.v).multiplyScalar(k * 1.1).add(d.p0); v3.y -= age * age * 0.9;
        e.set(d.r.x + d.w.x * age, d.r.y + d.w.y * age, d.r.z + d.w.z * age);
        q.setFromEuler(e); sc.setScalar(d.s);
        m4.compose(v3, q, sc); shards.setMatrixAt(i, m4);
      }
      shards.instanceMatrix.needsUpdate = true;
    }

    // chart: draws itself over ~1.8 s from the start of its run, then holds
    chartU.uLevel.value = L.chart;
    chart.visible = L.chart > 0.002;
    if (chart.visible) chartU.uProg.value = smooth(0, 1.8, S.since("chart", t));

    // network
    netU.uLevel.value = L.network;
    net.visible = L.network > 0.002;
    if (net.visible) { net.rotation.y = t * 0.12; net.rotation.x = Math.sin(t * 0.1) * 0.15; net.scale.setScalar((0.85 + 0.15 * smooth(0, 1, L.network)) * VS); }

    // lightning: deterministic flicker windows
    const lt = L.lightning;
    bolts.forEach((g, i) => {
      const slot = Math.floor(t * 15 + i * 3.3);
      const hsh = Math.abs(Math.sin(slot * 12.9898 + i * 78.233) * 43758.5453) % 1;
      const on = lt > 0.05 && hsh > 1 - lt * 0.28;
      g.visible = on;
      if (on) g.children.forEach((l) => { l.material.color.copy(i % 2 ? pal.c3 : pal.c2).multiplyScalar(2.2); l.material.opacity = lt * fade; });
    });

    // camera: drift + ascend + kicks + shake
    const asc = S.phase("ascend", t);
    const shake = L.shock * 0.06 + L.lightning * 0.02;
    camera.position.set(
      Math.sin(t * 0.13) * 0.55 + Math.sin(t * 37.1) * shake,
      Math.sin(t * 0.09 + 1) * 0.35 + Math.cos(t * 31.7) * shake,
      CAM_Z - L.kick * 0.2 * CAM_MOVE - L.warp * 1.2,
    );
    camera.lookAt(0, 0, -4);
    camera.rotation.z += Math.sin(t * 0.07) * 0.012 + L.spin * Math.sin(t * 0.6) * 0.02;
    camera.fov = baseVFov * (1 + L.warp * 0.18 - L.kick * 0.03 * CAM_MOVE);
    camera.updateProjectionMatrix();
    // the world moves down while we "rise" (keeps text centred)
    scene.position.y = -asc * 0.0; // particles handle ascend; keep layout stable

    bloom.strength = 0.55 + L.pulse * 0.15 + L.sun * 0.25 + L.shock * 0.25 + L.lightning * 0.2;
    bloom.radius = 0.5 + L.sun * 0.15;
    if (INK) { bloom.strength = 0.22 + L.pulse * 0.08; bloom.radius = 0.35; } // ink bleed, not glow
    else if (AURORA) bloom.strength *= 0.8;
    bloom.enabled = !STUDIO;

    if (STUDIO) {
      // the studio speaks through its objects: orbit (time), drift up/down (rise/fall),
      // push out (impact), grow (growth/numbers), beat (love), key light (light/idea)
      const sw = S.phase("swirl", t), lift = S.phase("rise", t) * 0.7 - S.phase("rain", t) * 0.5;
      // a wide ring around the frame edge, so the type in the middle stays clear
      const rx = halfW * 1.38, ry = halfH * 1.12, push = 1 + L.shock * 0.18;
      const wrapY = (v, h) => ((((v + h) % (2 * h)) + 2 * h) % (2 * h)) - h;
      const slotCol = [pal.c2, pal.c3, pal.c1, tmpC.copy(pal.c2).multiplyScalar(0.28)];
      studioObjs.forEach((m) => {
        const d = m.userData;
        const a = d.a + sw * 0.3;
        const y0 = Math.sin(a) * ry * push + Math.sin(t * 0.55 * d.sp + d.bob) * 0.16;
        m.position.set(Math.cos(a) * rx * push, wrapY(y0 + lift * d.sp, halfH * 1.6), d.z);
        const beat = L.heartbeat * Math.max(0, Math.sin(t * 7.5)) * 0.08;
        m.scale.setScalar(d.s * (1 + L.chart * 0.28 + L.pulse * 0.05 + beat) * (0.85 + 0.15 * fade));
        m.rotation.set(d.rx + t * d.wx + L.shock * 0.6, d.ry + t * d.wy * (1 + L.rings * 2.5), 0);
        m.material.color.copy(slotCol[d.slot]);
      });
      keyLight.intensity = 2.3 * (1 + L.sun * 0.45 + L.flash * 0.3);
      for (const o of [particles, streaks, rings, planet, sun, pulsePlane, shards, chart, net, waveU.mesh, gridU.floor, gridU.towers, ...bolts]) o.visible = false;
    }
    finalPass.uniforms.uTime.value = t;
    finalPass.uniforms.uGlitch.value = Math.min(1, L.glitch);
    finalPass.uniforms.uCA.value = 0.0012 + L.shock * 0.004 + L.warp * 0.003;

    renderer.clear();
    composer.render();
  }

  return { renderAt, signals: S };
}
