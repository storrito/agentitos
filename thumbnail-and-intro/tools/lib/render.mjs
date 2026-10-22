import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {spawn} from 'node:child_process';
import puppeteer from 'puppeteer-core';
import {regular} from './brand.mjs';

export async function exists(p){return !!(await fs.lstat(p).catch(()=>null));}
export async function run(file,args,opts={}) {
  return new Promise((resolve,reject)=>{
    const child=spawn(file,args,{shell:false,...opts});let out='',err='';
    child.stdout?.on('data',d=>out+=d); child.stderr?.on('data',d=>err+=d);
    child.once('error',e=>reject(new Error(`Cannot run ${file}: ${e.message}`)));
    child.once('close',code=>code===0?resolve(out):reject(new Error(`${file} exited ${code}: ${(err||out).slice(-6000)}`)));
  });
}
async function which(name){for(const dir of (process.env.PATH||'').split(path.delimiter)){const p=path.join(dir,name);try{await fs.access(p,1);return p;}catch{}}return null;}
export async function chromePath() {
  for (const key of ['CHROME','CHROME_PATH','PUPPETEER_EXECUTABLE_PATH','PRODUCER_HEADLESS_SHELL_PATH']) {
    if(process.env[key]){const p=path.isAbsolute(process.env[key])?process.env[key]:await which(process.env[key]);if(!p)throw new Error(`${key} executable not found: ${process.env[key]}`);await regular(p);return p;}
  }
  const root=path.join(os.homedir(),'.cache/puppeteer/chrome-headless-shell');
  for(const version of (await fs.readdir(root).catch(()=>[])).sort((a,b)=>b.localeCompare(a,undefined,{numeric:true}))) {
    const p=path.join(root,version,'chrome-headless-shell-linux64/chrome-headless-shell');if(await exists(p))return p;
  }
  for(const name of ['google-chrome','google-chrome-stable','chromium','chromium-browser']){const p=await which(name);if(p)return p;}
  throw new Error('No Chrome found. Set CHROME or PRODUCER_HEADLESS_SHELL_PATH to a local Chrome executable. Nothing is installed automatically.');
}
const types={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf','.otf':'font/otf'};
export async function serve(dir) {
  const root=await fs.realpath(dir);
  const server=http.createServer(async(req,res)=>{
    try{
      let name=decodeURIComponent(new URL(req.url,'http://local').pathname);
      if(name==='/')name='/index.html';
      const target=path.resolve(root,'.'+name);
      const inside=p=>p===root||p.startsWith(root+path.sep);
      if(!inside(target))throw new Error('Forbidden path');
      const real=await fs.realpath(target);if(!inside(real))throw new Error('Forbidden symlink');
      const stat=await fs.stat(real);if(!stat.isFile())throw new Error('Not a file');
      res.writeHead(200,{'Content-Type':types[path.extname(real).toLowerCase()]||'application/octet-stream','Cache-Control':'no-store'});
      res.end(await fs.readFile(real));
    }catch{res.writeHead(404);res.end('Not found');}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {url:`http://127.0.0.1:${server.address().port}`,close:()=>new Promise(r=>server.close(r))};
}
export async function render(dir) {
  dir=path.resolve(dir);const manifest=JSON.parse(await fs.readFile(path.join(dir,'manifest.json'),'utf8'));
  if(manifest.tool!=='agentitos-thumbnail-and-intro'||manifest.schemaVersion!==1)throw new Error('Not a thumbnail-and-intro output directory.');
  const thumbnail=path.join(dir,'thumbnail.png'),video=path.join(dir,'intro.mp4');
  for(const file of [thumbnail,video])if(await exists(file))throw new Error(`Refusing to overwrite existing export: ${file}`);
  // Exclusive lock prevents two renders from racing. Stale locks are never removed automatically.
  const lockPath=path.join(dir,'.render.lock');const lock=await fs.open(lockPath,'wx').catch(()=>{throw new Error(`Render lock exists: ${lockPath}. Remove only after verifying no render is active.`);});
  let browser,server,temp;
  try{
    const compositionDir=path.join(dir,'composition');
    for(const asset of manifest.assets){const p=path.resolve(compositionDir,asset.path);if(!p.startsWith(compositionDir+path.sep))throw new Error('Asset path outside composition');await regular(p);if(!(await fs.stat(p)).size)throw new Error(`Empty asset: ${p}`);}
    const chrome=await chromePath();
    const hf=process.env.HYPERFRAMES_BIN?path.resolve(process.env.HYPERFRAMES_BIN):await which('hyperframes');
    if(!hf)throw new Error('Local hyperframes CLI not found on PATH. Install/provide it separately, or set HYPERFRAMES_BIN.');
    server=await serve(compositionDir);
    browser=await puppeteer.launch({executablePath:chrome,headless:true,args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage']});
    const page=await browser.newPage(), failures=[];
    await page.setViewport({width:manifest.width,height:manifest.height,deviceScaleFactor:1});
    page.on('requestfailed',req=>failures.push(`${req.url()}: ${req.failure()?.errorText}`));
    page.on('response',res=>{if(res.status()>=400)failures.push(`HTTP ${res.status()} ${res.url()}`);});
    page.on('pageerror',e=>failures.push(e.message));
    await page.setRequestInterception(true);
    page.on('request',req=>{const u=req.url();if(u.startsWith(server.url+'/')||u==='https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js'||u.startsWith('data:'))req.continue();else{failures.push(`Unexpected nonlocal asset: ${u}`);req.abort();}});
    await page.goto(server.url,{waitUntil:'networkidle0',timeout:60000});
    await page.waitForFunction('!!window.__packagingReady',{timeout:30000});
    await page.evaluate(()=>Promise.race([window.__packagingReady,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Asset/font readiness timed out')),30000))]));
    await page.evaluate(t=>window.__timelines.main.pause(t),manifest.duration);
    let checks=await page.evaluate(()=>window.__packagingCheck());
    if(failures.length||checks.length)throw new Error(`Pre-render checks failed:\n${[...failures,...checks].join('\n')}`);
    temp=await fs.mkdtemp(path.join(dir,'.render-'));
    // Scale via a wrapper, not viewport reflow: thumbnail is exactly the terminal frame counterpart.
    const scale=manifest.thumbnail.width/manifest.width;
    await page.setViewport({width:manifest.thumbnail.width,height:manifest.thumbnail.height,deviceScaleFactor:1});
    await page.evaluate(scale=>{document.querySelector('#main').style.transformOrigin='top left';document.querySelector('#main').style.transform='scale('+scale+')';document.documentElement.style.width=innerWidth+'px';document.documentElement.style.height=innerHeight+'px';document.body.style.width=innerWidth+'px';document.body.style.height=innerHeight+'px';},scale);
    await page.screenshot({path:path.join(temp,'thumbnail.png'),type:'png',captureBeyondViewport:false});
    await browser.close();browser=null;await server.close();server=null;
    await run(hf,['render',compositionDir,'--output',path.join(temp,'intro.mp4'),'--fps','30','--workers','1','--no-best-effort'],{stdio:'inherit',env:{...process.env,PRODUCER_HEADLESS_SHELL_PATH:chrome,HYPERFRAMES_BROWSER_PATH:chrome,HYPERFRAMES_NO_TELEMETRY:'1',HYPERFRAMES_SKIP_SKILLS:'1',PUPPETEER_SKIP_DOWNLOAD:'1'}});
    await regular(path.join(temp,'intro.mp4'));
    // COPYFILE_EXCL protects existing exports even if they appeared during rendering.
    await fs.copyFile(path.join(temp,'intro.mp4'),video,1);
    await fs.copyFile(path.join(temp,'thumbnail.png'),thumbnail,1);
    manifest.audit={...manifest.audit,rendered:true,renderedAt:new Date().toISOString(),checks:'Local assets, image decoding, exact font availability, terminal layout overflow and timeline duration checked in Chrome before HyperFrames encoding.',chrome,hyperframes:hf,exports:{video:'intro.mp4',thumbnail:'thumbnail.png'}};
    await fs.writeFile(path.join(dir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
    console.log(JSON.stringify({video,thumbnail,chrome},null,2));
  } finally {
    await browser?.close().catch(()=>{});await server?.close().catch(()=>{});
    if(temp)await fs.rm(temp,{recursive:true,force:true});
    await lock.close();await fs.unlink(lockPath);
  }
}
