// Preparation-only tests. No browser screenshots, HyperFrames render, or real exports.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {prepare,validateJob} from './package.mjs';
import {readBrand,resolve,vendorFonts} from './lib/brand.mjs';
import {exists,run,serve,chromePath,render} from './lib/render.mjs';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
const design=`---
name: Test Brand
colors:
  primary: "#5429CA"
  secondary: "{colors.accent}"
  accent: "#260A68"
  on-primary: "#FFFFFF"
typography:
  headline-display:
    fontFamily: "{type.family}"
    fontWeight: 800
    lineHeight: 1.05
  body-md:
    fontFamily: "{type.family}"
    fontWeight: 400
  label-md:
    fontFamily: "{type.family}"
    fontWeight: 600
type:
  family: system-ui
logo:
  primary: logo.svg
---
# Test Brand
`;
async function fixture(t) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'thumbnail-and-intro-test-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const brand=path.join(dir,'brand');await fs.mkdir(brand);
  await fs.writeFile(path.join(brand,'DESIGN.md'),design);
  await fs.writeFile(path.join(brand,'logo.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40"><path fill="#5429CA" d="M0 0h120v40H0z"/></svg>');
  await fs.writeFile(path.join(dir,'image.png'),png);
  const job={brand:'brand',image:'image.png',headline:'Instagram Stories automatisch planen'};
  const jobFile=path.join(dir,'job.json');await fs.writeFile(jobFile,JSON.stringify(job));
  return {dir,brand,job,jobFile};
}
test('references, missing references and cycles',()=>{
  assert.equal(resolve({a:'{b}',b:'#AABBCC'},'{a}'),'#AABBCC');
  assert.throws(()=>resolve({a:'{b}',b:'{a}'},'{a}'),/Circular/);
  assert.throws(()=>resolve({},'{x}'),/Unresolved/);
});
test('prepare uses job-relative paths, emits local assets, manifest and parsable timeline',async t=>{
  const f=await fixture(t),out=path.join(f.dir,'landscape');
  const m=await prepare(f.jobFile,out);
  assert.equal(m.width,1920);assert.equal(m.thumbnail.width,1280);assert.equal(m.duration,4);
  assert.equal(m.inputs.image,path.join(f.dir,'image.png'));assert.equal(m.brand.colors.secondary,'#260A68');
  assert.equal(m.audit.rendered,false);assert(m.audit.warnings.some(w=>w.includes('system-ui')));
  assert.deepEqual(await fs.readFile(path.join(out,'composition/assets/topic.png')),png);
  const html=await fs.readFile(path.join(out,'composition/index.html'),'utf8');
  assert(html.includes('window.__timelines.main=tl'));assert(!html.includes('fonts.googleapis.com'));assert(html.includes('data-width="1920"'));
  const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
  for(const script of scripts)new vm.Script(script[1]);
  await assert.rejects(prepare(f.jobFile,out),/already exists/);
  assert.equal(await exists(path.join(out,'thumbnail.png')),false);
  assert.equal(await exists(path.join(out,'intro.mp4')),false);
});
test('portrait explicit duration/focus/cover, escaped content',async t=>{
  const f=await fixture(t);
  await fs.writeFile(f.jobFile,JSON.stringify({...f.job,layout:'portrait',duration:5,focus:{x:.2,y:.8},imageFit:'cover',headline:'Planen <b> statt posten',subtitle:'<script>Not executable</script>'}));
  const m=await prepare(f.jobFile,path.join(f.dir,'portrait'));
  assert.equal(m.width,1080);assert.equal(m.height,1920);assert.equal(m.thumbnail.height,1920);assert.equal(m.duration,5);
  const html=await fs.readFile(path.join(f.dir,'portrait/composition/index.html'),'utf8');
  assert(html.includes('&lt;script&gt;'));assert(html.includes('object-fit:cover'));assert(html.includes('object-position:20% 80%'));
});
test('required fields, input existence, bounds reject clearly',async t=>{
  const f=await fixture(t);
  for(const [patch,regex] of [[{headline:'Two words'},/3–8/],[{brand:''},/brand/],[{image:undefined},/image is required/],[{image:'missing.png'},/not found/],[{duration:2},/duration/],[{duration:6},/duration/],[{focus:{x:1.1,y:.5}},/focus/],[{layout:'square'},/layout/],[{imageFit:'stretch'},/imageFit/],[{frameTime:0},/requires a video/]]){
    await assert.rejects(validateJob({...f.job,...patch},f.dir),regex);
  }
});
test('missing primary, missing typography and unprovided font never silently fall back',async t=>{
  const f=await fixture(t),file=path.join(f.brand,'DESIGN.md');
  await fs.writeFile(file,design.replace('  primary: "#5429CA"\n',''));
  await assert.rejects(readBrand(f.brand),/colors.primary/);
  await fs.writeFile(file,'---\ncolors:\n  primary: "#5429CA"\n---\n');
  await assert.rejects(readBrand(f.brand),/typography/);
  await fs.writeFile(file,design.replace('family: system-ui','family: Never Installed Font'));
  const brand=await readBrand(f.brand),assets=path.join(f.dir,'assets');await fs.mkdir(assets);
  await assert.rejects(vendorFonts(brand,f.brand,assets),/No font source/);
});
test('local font exact weight copied and declared, missing weight rejected',async t=>{
  const f=await fixture(t);
  const font='/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
  if(!await exists(font)){t.skip('No local test font installed');return;}
  await fs.copyFile(font,path.join(f.brand,'bold.ttf'));
  const brand=await readBrand(f.brand);brand.fonts={headline:{family:'Fixture Sans',weight:700,token:'headline-display'}};
  brand.fontSources={'Fixture Sans':[{file:'bold.ttf',weight:700}]};
  const assets=path.join(f.dir,'assets');await fs.mkdir(assets);
  const v=await vendorFonts(brand,f.brand,assets);assert(v.css.includes('font-weight:700'));assert.equal(v.assets[0].source,path.join(f.brand,'bold.ttf'));
  brand.fonts.headline.weight=400;
  await assert.rejects(vendorFonts(brand,f.brand,assets),/Exact weight required/);
});
test('Google font CSS/download vendored locally at exact family and weight (mock HTTP)',async t=>{
  const f=await fixture(t),brand=await readBrand(f.brand),assets=path.join(f.dir,'assets');await fs.mkdir(assets);
  brand.fonts={headline:{family:'Fixture Google',weight:700,token:'headline-display'}};brand.fontSources={'Fixture Google':'google'};
  const original=globalThis.fetch;
  globalThis.fetch=async url=>String(url).startsWith('https://fonts.googleapis.com/')?new Response("@font-face {font-family: 'Fixture Google'; font-style: normal; font-weight: 700; src: url(https://fonts.gstatic.com/s/fixture/font.woff2) format('woff2'); unicode-range: U+0000-00FF;}"):new Response(new Uint8Array([1,2,3]));
  try{
    const v=await vendorFonts(brand,f.brand,assets);assert(v.css.includes("url('./assets/font-0-0.woff2')"));assert(!v.css.includes('https://'));assert.equal(v.assets[0].weight,700);assert.deepEqual(await fs.readFile(path.join(assets,'font-0-0.woff2')),Buffer.from([1,2,3]));
    globalThis.fetch=async()=>new Response('unavailable',{status:503});
    await assert.rejects(vendorFonts(brand,f.brand,assets),/Cannot vendor Google font.*503/);
  }finally{globalThis.fetch=original;}
});
test('neutral contrast choices are audited and logo absence is explicit',async t=>{
  const f=await fixture(t);
  await fs.writeFile(path.join(f.brand,'DESIGN.md'),design.replace('  primary: logo.svg','  primary: null').replace('  on-primary: "#FFFFFF"\n',''));
  const b=await readBrand(f.brand);assert.equal(b.logo,null);assert(b.warnings.some(w=>w.includes('logo omitted')));assert(b.warnings.some(w=>w.includes('readable foreground')));
});
test('static server rejects symlink escape and missing assets',async t=>{
  const f=await fixture(t),root=path.join(f.dir,'public');await fs.mkdir(root);
  await fs.writeFile(path.join(root,'index.html'),'hello');await fs.symlink(path.join(f.brand,'DESIGN.md'),path.join(root,'escape.txt'));
  const server=await serve(root);try{assert.equal(await (await fetch(server.url)).text(),'hello');assert.equal((await fetch(server.url+'/escape.txt')).status,404);assert.equal((await fetch(server.url+'/%2e%2e%2fbrand%2fDESIGN.md')).status,404);}finally{await server.close();}
});
test('video auto portrait layout and extraction timestamp; original untouched',async t=>{
  const f=await fixture(t),video=path.join(f.dir,'source.mp4');
  try{await run('ffmpeg',['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=blue:s=90x160:r=10:d=1','-c:v','libx264','-pix_fmt','yuv420p',video]);}catch(e){t.skip(`ffmpeg not available: ${e.message}`);return;}
  const original=await fs.readFile(video);
  await fs.writeFile(f.jobFile,JSON.stringify({brand:'brand',video:'source.mp4',headline:f.job.headline,frameTime:.4}));
  const m=await prepare(f.jobFile,path.join(f.dir,'from-video'));assert.equal(m.layout,'portrait');assert.equal(m.frameTime,.4);assert.equal(m.image,'assets/video-frame.png');
  assert.deepEqual(await fs.readFile(video),original);
  await fs.writeFile(f.jobFile,JSON.stringify({brand:'brand',video:'source.mp4',headline:f.job.headline,frameTime:2}));
  await assert.rejects(prepare(f.jobFile,path.join(f.dir,'bad-frame')),/outside video duration/);
});
test('unsafe external SVG rejected before output is created',async t=>{
  const f=await fixture(t);
  await fs.writeFile(path.join(f.brand,'logo.svg'),'<svg><image href="https://example.com/image.png"/></svg>');
  const out=path.join(f.dir,'unsafe');await assert.rejects(prepare(f.jobFile,out),/self-contained/);assert.equal(await exists(out),false);
});
test('render refuses existing export before launching any browser or CLI',async t=>{
  const f=await fixture(t),out=path.join(f.dir,'prepared');await prepare(f.jobFile,out);await fs.writeFile(path.join(out,'intro.mp4'),'existing sentinel');
  await assert.rejects(render(out),/Refusing to overwrite/);assert.equal(await fs.readFile(path.join(out,'intro.mp4'),'utf8'),'existing sentinel');
});
test('local Chrome resolution exists, without launching it',async()=>{
  const p=await chromePath();assert((await fs.stat(p)).isFile());
});
