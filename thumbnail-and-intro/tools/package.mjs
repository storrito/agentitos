#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readBrand,vendorFonts,regular} from './lib/brand.mjs';
import {composition} from './lib/composition.mjs';
import {exists,run,render} from './lib/render.mjs';

export const HELP=`Video packaging — brand-driven thumbnail + matching topic intro (no publishing).

  node tools/package.mjs prepare <job.json> <new-output-dir>
  node tools/package.mjs render <output-dir>

Job: {brand, headline, video?, image?, subtitle?, focus?:{x,y},
      layout?:"landscape"|"portrait", duration?:3..5, frameTime?:seconds,
      imageFit?:"contain"|"cover"}
brand: directory containing DESIGN.md with colors.primary, typography headline-display
or headline-lg, and fonts sources. headline: 3–8 words. image required without video.
Input paths are relative to job.json, NOT cwd. Output dir is relative to cwd.
prepare refuses any existing output directory; creates HTML, local assets and manifest.
render checks assets/fonts/layout, then writes intro.mp4 and thumbnail.png without overwrite.
Defaults: duration=4; fit=contain; focus={x:.5,y:.5}; layout=video orientation or landscape.
Landscape: 1920×1080 intro, 1280×720 thumbnail. Portrait: both 1080×1920.
Requires Node >=22.12; npm install --ignore-scripts in this tool folder; ffmpeg/ffprobe for video.
Render requires a preinstalled hyperframes CLI and Chrome. Set HYPERFRAMES_BIN for CLI.
Chrome: CHROME / CHROME_PATH / PUPPETEER_EXECUTABLE_PATH /
PRODUCER_HEADLESS_SHELL_PATH, then ~/.cache/puppeteer/chrome-headless-shell, then PATH.
No external font assets at runtime; GSAP uses a pinned CDN (network required).
Preparation failures leave an explicit incomplete directory for inspection; choose a NEW
output path on retry. Nothing alters source videos or existing results.
`;

export async function validateJob(job,base) {
  if (!job||Array.isArray(job)||typeof job!=='object')throw new Error('Job must be a JSON object.');
  if(typeof job.brand!=='string'||!job.brand.trim())throw new Error('job.brand directory is required.');
  if(typeof job.headline!=='string'||!job.headline.trim())throw new Error('job.headline is required.');
  const headline=job.headline.trim().replace(/\s+/g,' '),count=headline.split(' ').length;
  if(count<3||count>8)throw new Error('headline must have 3–8 words (whitespace-separated).');
  if(headline.length>200)throw new Error('headline is too long (max 200 characters); use readable short words.');
  if(job.subtitle!=null && (typeof job.subtitle!=='string'||job.subtitle.length>180))throw new Error('subtitle must be a string up to 180 characters.');
  if(job.layout!==undefined&&!['landscape','portrait'].includes(job.layout))throw new Error('layout must be landscape or portrait.');
  if(job.imageFit!==undefined&&!['contain','cover'].includes(job.imageFit))throw new Error('imageFit must be contain or cover.');
  const duration=job.duration??4;
  if(typeof duration!=='number'||!Number.isFinite(duration)||duration<3||duration>5)throw new Error('duration must be a number from 3 to 5 seconds.');
  if(job.frameTime!==undefined&&(typeof job.frameTime!=='number'||!Number.isFinite(job.frameTime)||job.frameTime<0))throw new Error('frameTime must be finite seconds >= 0.');
  const focus=job.focus??{x:.5,y:.5};
  if(!focus||typeof focus!=='object'||!['x','y'].every(k=>typeof focus[k]==='number'&&Number.isFinite(focus[k])&&focus[k]>=0&&focus[k]<=1))throw new Error('focus must be {x,y} with both values 0..1.');
  const brand=path.resolve(base,job.brand);
  if(!(await fs.stat(brand).catch(()=>null))?.isDirectory())throw new Error(`Brand directory not found: ${brand}`);
  const local=async(key)=>{
    if(job[key]===undefined)return null;
    if(typeof job[key]!=='string'||!job[key].trim())throw new Error(`${key} must be a local file path.`);
    if(/^https?:\/\//.test(job[key]))throw new Error(`${key} must be local, not a URL.`);
    return regular(path.resolve(base,job[key]));
  };
  const video=await local('video'),image=await local('image');
  if(!video&&!image)throw new Error('image is required when video is absent.');
  if(job.frameTime!==undefined&&!video)throw new Error('frameTime requires a video.');
  return {brand,video,image,headline,subtitle:job.subtitle?.trim()||null,layout:job.layout,duration,frameTime:job.frameTime,focus:{x:focus.x,y:focus.y},imageFit:job.imageFit||'contain'};
}
async function probe(video) {
  let data;try{data=JSON.parse(await run('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=width,height,duration:stream_tags=rotate:stream_side_data=rotation:format=duration','-of','json',video]));}catch(e){throw new Error(`Cannot probe video (local ffprobe required): ${e.message}`);}
  const stream=data.streams?.[0];if(!stream?.width||!stream?.height)throw new Error('Input has no usable video stream.');
  const rotation=Number(stream.side_data_list?.find(s=>s.rotation!==undefined)?.rotation||stream.tags?.rotate||0);
  const rotated=Math.abs(rotation)%180===90;
  const duration=Number(stream.duration||data.format?.duration);
  if(!Number.isFinite(duration)||duration<=0)throw new Error('Video duration could not be determined.');
  return {width:rotated?stream.height:stream.width,height:rotated?stream.width:stream.height,rotation,duration};
}
async function safeImage(file) {
  const ext=path.extname(file).toLowerCase();
  if(!['.png','.jpg','.jpeg','.webp','.svg'].includes(ext))throw new Error(`Unsupported image/logo extension: ${file}; use PNG/JPG/WebP or self-contained SVG.`);
  if(ext==='.svg'){
    const text=await fs.readFile(file,'utf8');
    const unsafe=!/<svg[\s>]/i.test(text)||/<(?:script|foreignObject|image|text)\b|\bon[a-z]+\s*=|<!ENTITY|@import/i.test(text);
    const references=[...text.matchAll(/(?:href\s*=\s*['"]([^'"]+)['"]|url\(\s*['"]?([^)'"\s]+)['"]?\s*\))/gi)].map(m=>m[1]||m[2]);
    if(unsafe||references.some(ref=>!ref.startsWith('#')))throw new Error(`SVG must be self-contained vector outlines (no scripts, external assets, text fonts or embedded raster): ${file}`);
  }
  return ext;
}
export async function prepare(jobFile,out) {
  jobFile=path.resolve(jobFile);out=path.resolve(out);
  if(await exists(out))throw new Error(`Output already exists; choose a NEW directory: ${out}`);
  const job=await validateJob(JSON.parse(await fs.readFile(await regular(jobFile),'utf8')),path.dirname(jobFile));
  const brand=await readBrand(job.brand);
  const info=job.video?await probe(job.video):null;
  if(job.frameTime!==undefined&&job.frameTime>=info.duration)throw new Error(`frameTime ${job.frameTime} is outside video duration ${info.duration}.`);
  const layout=job.layout||(info&&info.height>info.width?'portrait':'landscape');
  if(job.image)await safeImage(job.image);if(brand.logo)await safeImage(brand.logo);
  // Atomic mkdir, no recursive flag: an existing directory is never reused.
  await fs.mkdir(path.dirname(out),{recursive:true});await fs.mkdir(out);
  const assetDir=path.join(out,'composition/assets');await fs.mkdir(assetDir,{recursive:true});
  await fs.writeFile(path.join(out,'PREPARE_INCOMPLETE.txt'),'Preparation started; manifest.json is written only after all inputs/assets succeed.\n',{flag:'wx'});
  const fonts=await vendorFonts(brand,job.brand,assetDir);
  const assets=[...fonts.assets];
  let image,frameTime=null;
  if(job.image){const ext=path.extname(job.image).toLowerCase();image=`assets/topic${ext}`;await fs.copyFile(job.image,path.join(out,'composition',image),1);assets.push({path:image,source:job.image,role:'topic-image'});if(job.frameTime!==undefined)brand.warnings.push('frameTime ignored: explicit image takes precedence over extracting a video frame.');}
  else{
    frameTime=job.frameTime??Math.min(1,info.duration/3);
    image='assets/video-frame.png';
    try{await run('ffmpeg',['-hide_banner','-loglevel','error','-nostdin','-n','-ss',String(frameTime),'-i',job.video,'-map','0:v:0','-frames:v','1','-update','1',path.join(assetDir,'video-frame.png')]);await regular(path.join(assetDir,'video-frame.png'));}catch(e){throw new Error(`Frame extraction failed (local ffmpeg required): ${e.message}`);}
    assets.push({path:image,source:job.video,role:'video-frame',timestampSeconds:frameTime,timestampKind:'requested seek time (ffmpeg nearest decoded frame)'});
  }
  let logo=null;
  if(brand.logo){logo=`assets/logo${path.extname(brand.logo).toLowerCase()}`;await fs.copyFile(brand.logo,path.join(out,'composition',logo),1);assets.push({path:logo,source:brand.logo,role:'original-logo-unmodified'});}
  const p=layout==='portrait';
  const manifest={schemaVersion:1,tool:'agentitos-thumbnail-and-intro',createdAt:new Date().toISOString(),jobFile,inputs:{brand:job.brand,video:job.video,image:job.image},headline:job.headline,subtitle:job.subtitle,layout,layoutSource:job.layout?'job.layout':info?'ffprobe displayed orientation':'no-video landscape default',width:p?1080:1920,height:p?1920:1080,thumbnail:{width:p?1080:1280,height:p?1920:720,state:'terminal timeline frame'},duration:job.duration,fps:30,imageFit:job.imageFit,focus:job.focus,image,logo,videoProbe:info,frameTime,frameTimestampKind:frameTime===null?null:'requested seek time; ffmpeg selects nearest decoded frame',brand,assets,runtime:{gsap:'https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js',fonts:'local-only'},audit:{warnings:brand.warnings,rendered:false,checks:'Input and token validation only. Browser asset/font/layout checks run during render, before encoding.'}};
  await fs.writeFile(path.join(out,'composition/index.html'),composition(manifest,fonts.css),{flag:'wx'});
  await fs.writeFile(path.join(out,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
  await fs.unlink(path.join(out,'PREPARE_INCOMPLETE.txt'));
  console.log(JSON.stringify({output:out,manifest:path.join(out,'manifest.json'),composition:path.join(out,'composition/index.html'),warnings:brand.warnings,rendered:false},null,2));
  return manifest;
}
export async function main(args) {
  if(!args.length||['help','--help','-h'].includes(args[0])){console.log(HELP);return;}
  if(args[0]==='prepare'&&args.length===3){await prepare(args[1],args[2]);return;}
  if(args[0]==='render'&&args.length===2){await render(args[1]);return;}
  throw new Error('Usage: node tools/package.mjs prepare <job.json> <new-output-dir> | render <output-dir>. Use --help.');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main(process.argv.slice(2)).catch(e=>{console.error(`thumbnail-and-intro: ${e.message}`);process.exitCode=1;});
