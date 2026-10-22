const html=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const json=s=>JSON.stringify(s).replace(/</g,'\\u003c');
export function composition(m,fontCSS) {
  const p=m.layout==='portrait', b=m.brand, [w,h]=[m.width,m.height];
  const font=f=>`font-family:${f.family==='system-ui'?'system-ui':JSON.stringify(f.family)};font-weight:${f.weight};font-style:normal;font-synthesis:none;letter-spacing:${f.letterSpacing};line-height:${f.lineHeight||1.04};text-transform:${f.uppercase?'uppercase':'none'};`;
  return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>${html(m.headline)}</title>
<style>
${fontCSS}
*{box-sizing:border-box}html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden;background:${b.colors.primary}}body{color:${b.ink}}#main{position:relative;width:${w}px;height:${h}px;overflow:hidden;background:linear-gradient(120deg,${b.gradient[0]} 0%,${b.gradient[1]} 100%)}
.scrim{position:absolute;inset:0;background:${b.scrim||'transparent'}}
.logo{position:absolute;left:${p?72:100}px;top:${p?70:70}px;width:${p?240:240}px;height:106px;background:#fff;border-radius:18px;display:flex;align-items:center;justify-content:center;padding:18px;z-index:3}.logo img{width:100%;height:100%;object-fit:contain}
.copy{position:absolute;left:${p?72:100}px;top:${p?240:260}px;width:${p?936:820}px;height:${p?690:680}px;z-index:2;display:flex;flex-direction:column;justify-content:center;gap:32px}
h1{${font(b.fonts.headline)}font-size:${p?150:154}px;margin:0;padding-bottom:.16em;width:100%;overflow-wrap:normal;text-wrap:balance;max-height:${p?490:530}px}
.subtitle{${font(b.fonts.body)}font-size:${p?43:42}px;margin:0;line-height:${b.fonts.body.lineHeight||1.25};max-height:${p?170:130}px}
.visual{position:absolute;left:${p?72:1100}px;top:${p?1015:190}px;width:${p?936:740}px;height:${p?785:750}px;border-radius:34px;overflow:hidden;background:#fff;box-shadow:0 28px 70px rgba(0,0,0,.22);z-index:1}
.visual img{display:block;width:100%;height:100%;object-fit:${m.imageFit};object-position:${m.focus.x*100}% ${m.focus.y*100}%}
.arrow{position:absolute;left:${p?790:930}px;top:${p?880:470}px;width:${p?200:220}px;height:${p?190:175}px;z-index:4;overflow:visible;pointer-events:none;${p?'transform:rotate(75deg);':''}}
</style><script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script></head>
<body><main id="main" data-composition-id="main" data-start="0" data-duration="${m.duration}" data-width="${w}" data-height="${h}" data-fps="30">
<div class="scrim"></div>
${m.logo?`<div class="logo" data-check><img src="${html(m.logo)}" alt="${html(b.name||'Markenlogo')}"></div>`:''}
<div class="copy" data-check><h1>${html(m.headline)}</h1>${m.subtitle?`<p class="subtitle">${html(m.subtitle)}</p>`:''}</div>
<div class="visual" data-check><img src="${html(m.image)}" alt="Themenbild zum Video"></div>
<svg class="arrow" viewBox="0 0 220 175" aria-hidden="true"><path d="M12 145 Q85 20 195 74 M153 32 L200 74 L146 100" stroke="${b.ink}" stroke-width="13" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
</main><script>
window.__packagingErrors=[];
window.__packagingReady=(async()=>{
  if(!window.gsap)throw new Error('GSAP could not load; CDN access is required.');
  await Promise.all([...document.images].map(async img=>{await img.decode();if(!img.naturalWidth)throw new Error('Invalid image '+img.src);}));
  const fonts=${json(Object.values(b.fonts))};
  for(const f of fonts){
    const query=f.weight+' 48px '+JSON.stringify(f.family);
    const loaded=await document.fonts.load(query,${json(m.headline+' '+(m.subtitle||''))});
    if(f.family!=='system-ui'&&(!loaded.length||loaded.some(face=>face.status!=='loaded')))throw new Error('Font did not load at required weight: '+f.family+' '+f.weight);
  }
  await document.fonts.ready;
  const fit=(el,min)=>{if(!el)return;let size=parseFloat(getComputedStyle(el).fontSize);while((el.scrollHeight>el.clientHeight+1||el.scrollWidth>el.clientWidth+1)&&size>min){el.style.fontSize=(--size)+'px';}if(el.scrollHeight>el.clientHeight+1||el.scrollWidth>el.clientWidth+1)throw new Error('Text overflow: shorten '+el.tagName+' or use shorter words.');};
  fit(document.querySelector('h1'),${p?96:98});fit(document.querySelector('.subtitle'),32);
  window.__timelines=window.__timelines||{};
  const tl=gsap.timeline({paused:true});
  tl.from('.copy',{opacity:0,y:70,duration:.65,ease:'power3.out'},.08)
    .from('.visual',{opacity:0,scale:.86,x:${p?0:130},y:${p?130:0},duration:.8,ease:'power3.out'},.2)
    .from('.arrow',{opacity:0,scale:.7,duration:.4,ease:'back.out(1.5)'},.85);
  ${m.logo?"tl.from('.logo',{opacity:0,y:-18,duration:.4},.05);":''}
  // Explicit hold to the requested duration; the thumbnail equals the last video frame.
  tl.to({}, {duration:${m.duration}-1.3},1.3);tl.pause(0);
  window.__timelines.main=tl;
  window.__packagingCheck=()=>{
    const errors=[];const root=document.querySelector('#main').getBoundingClientRect();
    for(const el of document.querySelectorAll('[data-check],h1,.subtitle')){
      const r=el.getBoundingClientRect();
      if(r.left<root.left-1||r.top<root.top-1||r.right>root.right+1||r.bottom>root.bottom+1)errors.push('Out of canvas: '+el.className);
      if(el.scrollHeight>el.clientHeight+1||el.scrollWidth>el.clientWidth+1)errors.push('Overflow: '+el.className);
    }
    const copy=document.querySelector('.copy').getBoundingClientRect(), visual=document.querySelector('.visual').getBoundingClientRect();
    if(copy.right>visual.left+1&&copy.left<visual.right-1&&copy.bottom>visual.top+1&&copy.top<visual.bottom-1)errors.push('Copy overlaps thematic image');
    if(Math.abs(tl.duration()-${m.duration})>.001)errors.push('Timeline duration mismatch');
    return errors;
  };
  return true;
})();window.__packagingReady.catch(e=>{window.__packagingErrors.push(e.message);console.error(e);});
</script></body></html>`;
}
