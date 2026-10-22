// Original small DESIGN.md reader; no brand-kit implementation is copied.
import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import crypto from 'node:crypto';

export function resolve(tokens, value, seen = []) {
  if (typeof value === 'string' && /^\{[^}]+\}$/.test(value.trim())) {
    const key = value.trim().slice(1, -1);
    if (seen.includes(key)) throw new Error(`Circular brand reference: ${[...seen, key].join(' -> ')}`);
    const target = key.split('.').reduce((o, k) => o?.[k], tokens);
    if (target === undefined) throw new Error(`Unresolved brand reference: {${key}}`);
    return resolve(tokens, target, [...seen, key]);
  }
  if (Array.isArray(value)) return value.map(v => resolve(tokens, v, seen));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k, resolve(tokens,v,seen)]));
  return value;
}
function rgb(value) {
  if (value === 'white') value = '#ffffff';
  if (value === 'black') value = '#000000';
  if (typeof value !== 'string' || !/^#(?:[a-f\d]{3}|[a-f\d]{6})$/i.test(value)) throw new Error(`Unsupported brand color ${JSON.stringify(value)}; use opaque #RGB or #RRGGBB.`);
  const h = value.slice(1); return (h.length === 3 ? [...h].map(c=>c+c).join('') : h).match(/../g).map(x=>parseInt(x,16));
}
function color(value) { return '#'+rgb(value).map(v=>v.toString(16).padStart(2,'0')).join('').toUpperCase(); }
function lum(value) { const a=rgb(value).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4;});return a[0]*.2126+a[1]*.7152+a[2]*.0722; }
function contrast(a,b) { const x=lum(a),y=lum(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05); }
export async function regular(file) {
  if (!(await fs.stat(file).catch(()=>null))?.isFile()) throw new Error(`Input file not found: ${file}`);
  return file;
}
export async function readBrand(dir) {
  const design = await regular(path.join(dir,'DESIGN.md'));
  const text=await fs.readFile(design,'utf8');
  const match=/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) throw new Error('DESIGN.md requires YAML frontmatter.');
  const tokens=YAML.parse(match[1]);
  if (!tokens || typeof tokens!=='object') throw new Error('Invalid DESIGN.md YAML object.');
  if (!tokens.colors?.primary) throw new Error('Required brand token absent: colors.primary. No default brand color is allowed.');
  if (!tokens.typography || !Object.keys(tokens.typography).length) throw new Error('Required brand typography is absent.');
  const warnings=[];
  const colors=Object.fromEntries(Object.entries(tokens.colors).map(([k,v])=>[k,color(resolve(tokens,v))]));
  const pick=(names)=>names.find(n=>tokens.typography[n]);
  const head=pick(['headline-display','headline-lg']);
  if (!head) throw new Error('Typography requires headline-display or headline-lg.');
  const font=(name)=>{
    const t=resolve(tokens,tokens.typography[name]);
    const family=String(t?.fontFamily||'').trim().replace(/^['"]|['"]$/g,'');
    if (!family || /[,;\n<>{}\\]/.test(family)) throw new Error(`typography.${name}.fontFamily must resolve to one explicit family (or system-ui).`);
    const weight=Number(t.fontWeight);
    if (!Number.isFinite(weight) || weight<1 || weight>1000) throw new Error(`typography.${name}.fontWeight is required (1..1000).`);
    const spacing=String(t.letterSpacing??'0');
    if (!/^-?\d*\.?\d+(?:em|px|rem)?$/.test(spacing)) throw new Error(`Invalid letterSpacing in ${name}`);
    const lh=t.lineHeight==null?null:Number(t.lineHeight);
    if (lh!==null && (!Number.isFinite(lh)||lh<.8||lh>2)) throw new Error(`lineHeight in ${name} must be a unitless ratio (.8..2), or omitted.`);
    return {token:name,family,weight,letterSpacing:/[a-z]/.test(spacing)?spacing:`${spacing}em`,lineHeight:lh,uppercase:(tokens.uppercase||[]).includes(name)};
  };
  const fonts={headline:font(head),body:font(pick(['body-md'])||head),label:font(pick(['label-md','body-md'])||head)};
  if (!tokens.typography['body-md']) warnings.push(`body-md absent: subtitle reuses typography.${head}; no substitute family or weight invented.`);
  if (!tokens.typography['label-md']) warnings.push('label-md absent: label reuses body-md or headline token.');
  const end=colors.secondary||colors.tertiary||colors.primary;
  if (end===colors.primary) warnings.push('No secondary/tertiary gradient color: monochromatic primary gradient, not an invented brand hue.');
  const candidates=[colors['on-primary'],colors.text,colors.ink,'#FFFFFF','#000000'].filter(Boolean);
  let ink=candidates.find(c=>Math.min(contrast(c,colors.primary),contrast(c,end))>=4.5);
  let scrim=null;
  if (!ink) {
    ink='#FFFFFF';
    // Use only the neutral darkening actually required, not a fixed heavy overlay.
    const under=(c,a)=>'#'+rgb(c).map(v=>Math.round(v*(1-a)).toString(16).padStart(2,'0')).join('');
    let alpha=0;
    const start=rgb(colors.primary), finish=rgb(end);
    const stops=Array.from({length:21},(_,i)=>'#'+start.map((v,k)=>Math.round(v+(finish[k]-v)*i/20).toString(16).padStart(2,'0')).join(''));
    while(alpha<.9 && stops.some(c=>contrast(ink,under(c,alpha))<4.5))alpha=Math.round((alpha+.02)*100)/100;
    scrim=`rgba(0,0,0,${alpha})`;
    warnings.push(`Neutral black contrast scrim (opacity ${alpha}) applied over brand gradient; white foreground.`);
  }
  if (!Object.values(colors).includes(ink)) warnings.push(`Neutral ${ink==='#FFFFFF'?'white':'black'} used for readable foreground; not a brand token.`);
  warnings.push('Neutral white used for original-logo chip and contained screenshot mat; neutral black used only for shadows.');
  let logo=resolve(tokens,tokens.logo?.primary);
  if (logo && typeof logo!=='string') throw new Error('logo.primary must be a local path.');
  logo=logo?await regular(path.resolve(dir,logo)):null;
  if (!logo) warnings.push('No logo.primary in DESIGN.md: logo omitted, never invented.');
  return {design,designSha256:crypto.createHash('sha256').update(text).digest('hex'),name:tokens.name||null,colors,gradient:[colors.primary,end],ink,scrim,fonts,fontSources:resolve(tokens,tokens.fonts||{}),logo,warnings};
}

async function download(url) {
  const res=await fetch(url,{signal:AbortSignal.timeout(30000)});
  if (!res.ok) throw new Error(`Font request failed: HTTP ${res.status} ${url}`);
  return res;
}
export async function vendorFonts(brand,dir,assetDir) {
  const declarations=[], assets=[], unique=new Map();
  for (const f of Object.values(brand.fonts)) unique.set(`${f.family}:${f.weight}`,f);
  for (const f of unique.values()) {
    if (f.family==='system-ui') { brand.warnings.push(`Explicit system-ui at ${f.token}: host-dependent system font intentionally allowed.`); continue; }
    const source=brand.fontSources[f.family];
    if (!source) throw new Error(`No font source for ${f.family}: add fonts: { "${f.family}": google | [{file, weight}] } to DESIGN.md. No system fallback allowed.`);
    const stem=`font-${assets.length}`;
    if (source==='google') {
      const url=`https://fonts.googleapis.com/css2?family=${encodeURIComponent(f.family).replace(/%20/g,'+')}:wght@${f.weight}&display=block`;
      let css;
      try { css=await (await download(url)).text(); } catch(e) { throw new Error(`Cannot vendor Google font ${f.family} ${f.weight}: ${e.message}`); }
      const blocks=css.match(/@font-face\s*\{[^}]+\}/g)||[];
      if (!blocks.length) throw new Error(`Google returned no font-face for ${f.family} ${f.weight}.`);
      let i=0;
      for (const block of blocks) {
        const returnedFamily=/font-family\s*:\s*(['"]?)(.*?)\1\s*;/.exec(block)?.[2];
        const returnedWeight=/font-weight\s*:\s*(\d+)(?:\s+(\d+))?\s*;/.exec(block);
        if (returnedFamily!==f.family || !returnedWeight || f.weight<Number(returnedWeight[1]) || f.weight>Number(returnedWeight[2]||returnedWeight[1])) throw new Error(`Google CSS did not match requested family/weight: ${f.family} ${f.weight}`);
        const urls=[...block.matchAll(/url\((?:['"])?(https:\/\/[^)'"\s]+)(?:['"])?\)/g)];
        if (!urls.length) throw new Error(`Google font has no downloadable URL: ${f.family}`);
        let local=block;
        for (const m of urls) {
          const u=new URL(m[1]);
          if (u.hostname!=='fonts.gstatic.com') throw new Error(`Unexpected Google font host: ${u.hostname}`);
          const ext=path.extname(u.pathname)||'.woff2';
          const name=`${stem}-${i++}${ext}`;
          const bytes=Buffer.from(await (await download(u.href)).arrayBuffer());
          if (!bytes.length) throw new Error(`Empty font download: ${u.href}`);
          await fs.writeFile(path.join(assetDir,name),bytes,{flag:'wx'});
          local=local.replace(m[0],`url('./assets/${name}')`);
          assets.push({path:`assets/${name}`,source:u.href,family:f.family,weight:f.weight});
        }
        // Keep Google's unicode-range and exact family/style/weight; remove display swap.
        declarations.push(local.replace(/font-display\s*:[^;]+;/g,'font-display: block;'));
      }
    } else {
      if (!Array.isArray(source)) throw new Error(`fonts.${f.family} must be google or [{file,weight}].`);
      const s=source.find(s=>s && Number(s.weight)===f.weight);
      if (!s?.file) throw new Error(`No local font file for ${f.family} weight ${f.weight}. Exact weight required.`);
      const file=await regular(path.resolve(dir,s.file));
      const ext=path.extname(file).toLowerCase();
      if (!['.woff2','.woff','.ttf','.otf'].includes(ext)) throw new Error(`Unsupported local font extension: ${file}`);
      const name=stem+ext;
      await fs.copyFile(file,path.join(assetDir,name),1);
      declarations.push(`@font-face{font-family:${JSON.stringify(f.family)};font-style:normal;font-weight:${f.weight};font-display:block;src:url('./assets/${name}')}`);
      assets.push({path:`assets/${name}`,source:file,family:f.family,weight:f.weight});
      for (const license of ['OFL.txt','LICENSE.txt','LICENSE']) {
        const licensePath=path.join(path.dirname(file),license);
        if ((await fs.stat(licensePath).catch(()=>null))?.isFile()) {
          const target=`${stem}-${license}`;await fs.copyFile(licensePath,path.join(assetDir,target),1);
          assets.push({path:`assets/${target}`,source:licensePath});
        }
      }
    }
  }
  if (Object.values(brand.fontSources).includes('google')) brand.warnings.push('Google fonts vendored from Google Fonts CSS; font license compliance remains with the kit owner (retain upstream OFL/license when distributing).');
  return {css:declarations.join('\n'),assets};
}
