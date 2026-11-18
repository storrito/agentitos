/* Shared approved opening treatment, bundled locally in each independent draft. */
window.buildSeriesIntro = async function (rest, config) {
  await document.fonts.load('140px Anton');
  await document.fonts.ready;
  const words = [...document.querySelectorAll('#word-ring .intro-word')];
  const finals = [...document.querySelectorAll('#series-landing .final-word')];
  const timing = {stamp:.0, stampEnd:1.15, form:.60, orbitStart:1.75, orbit:.95, settleStart:2.70, settle:.50, uncurl:.40, crossfadeStart:3.10, crossfade:.10, total:3.20, restStart:1.60};
  words.forEach(word => {
    const cap = word.querySelector('.cap-word'), text = cap.textContent;
    cap.textContent = '';
    [...text].forEach(char => { const letter=document.createElement('span'); letter.className='cap-letter'; letter.setAttribute('data-layout-allow-occlusion',''); letter.textContent=char; cap.appendChild(letter); });
    word.style.fontSize='110px';
  });
  function measure(font) {
    words.forEach(word=>word.style.fontSize=font+'px');
    const n=document.createElement('span');
    Object.assign(n.style,{position:'absolute',visibility:'hidden',font:font+'px Anton',letterSpacing:'-.5px',whiteSpace:'nowrap'});
    n.textContent='N';document.body.appendChild(n);const gap=n.getBoundingClientRect().width;n.remove();
    const layouts=words.map(word=>{const cap=word.querySelector('.cap-word'),bounds=cap.getBoundingClientRect();return [...cap.children].map(glyph=>{const b=glyph.getBoundingClientRect();return {glyph,char:glyph.textContent,width:b.width,naturalX:b.left-bounds.left+b.width/2};});});
    const naturalWidths=layouts.map(letters=>letters.reduce((sum,l)=>sum+l.width,0));
    return {gap,layouts,naturalWidths};
  }
  const initial=measure(110), initialTrack=9;
  const initialRadius=(initial.naturalWidths.reduce((a,b)=>a+b,0)+(words.reduce((a,w)=>a+w.querySelector('.cap-word').children.length-1,0))*initialTrack+words.length*initial.gap)/(2*Math.PI);
  const ringFont=Math.round(Math.min(140,110*332.703461349664/initialRadius));
  const {gap,layouts,naturalWidths}=measure(ringFont), ringLetterGap=9*ringFont/110;
  const widths=layouts.map((letters,i)=>naturalWidths[i]+(letters.length-1)*ringLetterGap);
  const radius=(widths.reduce((a,b)=>a+b,0)+words.length*gap)/(2*Math.PI);
  const lineSpace=words.length<=6?190:1140/words.length;
  const stampFont=Math.floor(Math.min(140,lineSpace/1.35,660*ringFont/(Math.max(...naturalWidths)*1.35)));
  const stampLeft=280, stampCentreY=870;
  let distance=-widths[0]/2;
  const wordPoses=[];
  const letterPoses=layouts.map((letters,i)=>{
    const start=distance, angle=-Math.PI/2-(start+widths[i]/2)/radius;
    let rotation=(angle*180/Math.PI-90)%360;if(rotation < -180)rotation+=360;if(rotation>180)rotation-=360;
    wordPoses.push({x:radius*Math.cos(angle),y:radius*Math.sin(angle),rotation});
    const poses=letters.map((letter,j)=>{
      const theta=-Math.PI/2-(distance+letter.width/2)/radius;
      const offset=distance+letter.width/2-start-widths[i]/2;
      const pose={char:letter.char,wordIndex:i,width:letter.width,angle:theta,cx:radius*Math.cos(theta),cy:radius*Math.sin(theta),localX:radius*Math.sin(offset/radius)-(letter.naturalX-naturalWidths[i]/2),localY:radius*(Math.cos(offset/radius)-1),localRotation:-offset/radius*180/Math.PI};
      distance+=letter.width+(j<letters.length-1?ringLetterGap:0);return pose;
    });distance+=gap;return poses;
  });
  // Remove only the original first headline entrance; give it the same short
  // post-landing reveal as approved No.1. All other scene motions stay intact.
  const headline=document.querySelector(config.headline);
  if(headline)rest.killTweensOf(headline);
  const master=gsap.timeline({paused:true});master.add(rest,timing.restStart);rest.paused(false);
  master.set('#film-body',{opacity:0},0);
  master.set('#series-landing',{opacity:0},0);
  if(headline)master.fromTo(headline,{y:55,opacity:0},{y:0,opacity:1,duration:.55,ease:'power4.out',immediateRender:true},3.45);
  master.set('#film-body',{opacity:1},2.70);
  master.to('#intro-surface',{opacity:0,duration:.50,ease:'sine.inOut'},2.70);
  words.forEach((word,i)=>{
    const step=words.length>1?.70/(words.length-1):0;
    master.set(word,{xPercent:0,yPercent:-50,x:stampLeft-540,y:stampCentreY-960+(i-(words.length-1)/2)*lineSpace,fontSize:stampFont,opacity:0,scale:1.35,rotation:0,transformOrigin:'0% 50%'},0);
    master.to(word,{opacity:1,duration:.08,ease:'sine.inOut'},i*step);
    master.to(word,{scale:1,duration:.18,ease:'power2.out'},i*step);
    master.set(word,{xPercent:-50,x:stampLeft-540+naturalWidths[i]*stampFont/ringFont/2,transformOrigin:'50% 50%'},1.15);
    master.to(word,{...wordPoses[i],fontSize:ringFont,duration:.60,ease:'sine.inOut'},1.15);
    layouts[i].forEach((letter,j)=>master.to(letter.glyph,{x:letterPoses[i][j].localX,y:letterPoses[i][j].localY,rotation:letterPoses[i][j].localRotation,duration:.60,ease:'sine.inOut'},1.15));
  });
  master.fromTo('#word-ring',{rotation:0},{rotation:360,duration:.95,ease:'sine.inOut'},1.75);
  const targets=finals.map(el=>{const r=el.getBoundingClientRect();return{x:r.x+r.width/2-540,y:r.y+r.height/2-960};});
  const landing=document.querySelector('#series-landing'), scaleX=landing.getBoundingClientRect().width/parseFloat(getComputedStyle(landing).width);
  words.forEach((word,i)=>{
    master.to(word,{...targets[i],xPercent:-50,rotation:0,fontSize:31,scaleX,width:finals[i].getBoundingClientRect().width/scaleX,duration:.50,ease:'sine.inOut'},2.70);
    master.to(layouts[i].map(l=>l.glyph),{x:0,y:0,rotation:0,duration:.40,ease:'sine.inOut'},2.70);
    master.to(word.querySelector('.cap-word'),{opacity:0,duration:.10,ease:'sine.inOut'},3.10);
    master.to(word.querySelector('.case-word'),{opacity:1,duration:.10,ease:'sine.inOut'},3.10);
  });
  master.set('#word-intro-content',{opacity:0},3.20);
  master.set('#series-landing',{opacity:1},3.20);
  master.to({},{duration:.01},16.59);
  window.__ringMetrics={mode:'individual inward-facing curved letters',textDirection:'counterclockwise',orbitDirection:'clockwise',ringFont,stampFont,stampLeft,lineSpace,ringLetterGap,gap,radius,naturalWidths,widths,wordPoses,letterPoses,targets,timing,config};
  window.__introReady=true;
  return {timeline:master};
};
