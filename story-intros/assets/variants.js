/* Effect-dependent pacing trial. Slide/Fan hand off earlier; Echo stays3.20s.
   Authored rest code, later scene timings, music and native layers are untouched.
   Async GSAP timelines must be wrapped: never return a thenable directly. */
window.buildSeriesIntro = async function(rest, config){
  await document.fonts.load('140px Anton');
  await document.fonts.ready;
  const mode=config.mode;
  if(!['stack-fan','slide-lock','echo-collapse'].includes(mode))throw new Error('Unrecognized intro variation');
  const words=[...document.querySelectorAll('#word-ring .intro-word')];
  const finals=[...document.querySelectorAll('#series-landing .final-word')];
  const count=words.length,mid=(count-1)/2,accelerated=mode!=='echo-collapse';
  const total=config.introDuration||(mode==='echo-collapse'?3.20:mode==='slide-lock'?2.30:2.50);
  const settle=accelerated?.40:.50;
  const timing={settleStart:total-settle,settle,crossfadeStart:total-.10,crossfade:.10,total,restStart:1.60,headlineStart:total+(accelerated?.18:.25),headlineDuration:.55};
  words.forEach(w=>w.style.fontSize='140px');
  const at140=words.map(w=>w.querySelector('.cap-word').getBoundingClientRect().width);
  const lineSpace=count<=6?190:1140/count;
  let stampFont;
  if(mode==='stack-fan')stampFont=Math.floor(Math.min(112,140*540/Math.max(...at140)));
  if(mode==='slide-lock'){
    const pairs=[];for(let i=0;i<count;i+=2)pairs.push(at140[i]+(at140[i+1]||0));
    stampFont=Math.floor(Math.min(116,140*720/Math.max(...pairs)));
  }
  if(mode==='echo-collapse')stampFont=Math.floor(Math.min(140,lineSpace/1.35,140*640/Math.max(...at140)));
  words.forEach(w=>{
    w.style.fontSize=stampFont+'px';
    w.querySelector('.case-word').style.letterSpacing=(-.5*stampFont/31)+'px';
  });
  const widths=words.map(w=>w.querySelector('.cap-word').getBoundingClientRect().width);
  const landing=document.querySelector('#series-landing');
  const landingScaleX=landing.getBoundingClientRect().width/parseFloat(getComputedStyle(landing).width);
  const targets=finals.map(el=>{const r=el.getBoundingClientRect();return{x:r.x+r.width/2-540,y:r.y+r.height/2-960}});
  const headline=document.querySelector(config.headline);
  if(headline)rest.killTweensOf(headline);
  const master=gsap.timeline({paused:true});
  master.add(rest,timing.restStart);rest.paused(false);
  master.set('#film-body',{opacity:0},0);
  master.set('#series-landing',{opacity:0},0);
  if(headline)master.fromTo(headline,{y:55,opacity:0},{y:0,opacity:1,duration:timing.headlineDuration,ease:'power4.out',immediateRender:true},timing.headlineStart);
  master.set('#film-body',{opacity:1},timing.settleStart);
  master.to('#intro-surface',{opacity:0,duration:timing.settle,ease:'sine.inOut'},timing.settleStart);
  // Set at once, not on the timeline: HyperFrames' renderer keeps only one of two sets at 0 on the same word.
  words.forEach((w,i)=>gsap.set(w,{xPercent:-50,yPercent:-50,width:widths[i],fontSize:stampFont,x:0,y:0,rotation:0,scale:1,opacity:0,transformOrigin:'50% 50%'}));
  let poses=[],echoKey=null,hookScale=null,formationEnd=null;

  if(mode==='stack-fan'){
    // Save time in the obscured deck, not by sacrificing the full-phrase hold.
    const span=Math.min(850,170*(count-1));
    words.forEach((w,i)=>{
      master.set(w,{x:(i-mid)*5,y:-80+(i-mid)*5,rotation:(i-mid)*2.1,scale:1.10},0);
      const at=count>1?i*.36/(count-1):0;
      master.to(w,{opacity:1,duration:.055,ease:'none'},at);
      master.to(w,{scale:1,duration:.13,ease:'power3.out'},at);
      const pose={x:(i-mid)*28,y:790-960+(count>1?(i/(count-1)-.5)*span:0),rotation:count>1?-14+28*i/(count-1):0};poses.push(pose);
      master.to(w,{...pose,duration:.50,ease:'power3.inOut'},.48+i*.010);
      master.to(w.querySelector('.fan-back'),{opacity:0,scale:.45,duration:.20,ease:'power2.in'},timing.settleStart);
    });
    formationEnd=.48+(count-1)*.010+.50;
  }
  if(mode==='slide-lock'){
    const rows=Math.ceil(count/2),rowGap=Math.min(270,840/Math.max(1,rows-1));
    words.forEach((w,i)=>{
      const row=Math.floor(i/2),a=row*2,b=a+1,hasPair=b<count;
      const total=widths[a]+(hasPair?38+widths[b]:0);
      const x=i%2===0?-total/2+widths[a]/2:total/2-widths[b]/2;
      const y=880-960+(row-(rows-1)/2)*rowGap;
      master.set(w,{x:x+(i%2===0?-860:860),y,opacity:0},0);
      master.to(w,{x,opacity:1,duration:.36,ease:'power4.out'},i*.065);
      const lockX=i%2===0?150+widths[i]/2-540:930-widths[i]/2-540;
      const pose={x:lockX,y,rotation:0};poses.push(pose);
      master.to(w,{x:lockX,duration:.30,ease:'expo.inOut'},.76+row*.035);
    });
    formationEnd=.76+(rows-1)*.035+.30;
  }
  if(mode==='echo-collapse'){
    echoKey=words.findIndex(w=>w.querySelector('.cap-word').textContent===config.echoKey);
    if(echoKey<0)throw new Error('Echo keyword does not occur in source copy');
    hookScale=Math.min((200/stampFont)*1.10,780/widths[echoKey]);
    const from={x:0,y:-450,scale:hookScale};
    const to={x:280+widths[echoKey]/2-540,y:870-960+(echoKey-mid)*lineSpace,scale:1};
    const lead=words[echoKey];
    master.set(lead,{...from,opacity:1},0);
    master.to(lead,{...to,duration:.72,ease:'power3.out'},0);
    [...document.querySelectorAll('#word-ring .et-ghost')].forEach((g,j)=>{
      const delay=(j+1)*.09,alpha=[.46,.30,.17][j];
      master.set(g,{xPercent:-50,yPercent:-50,fontSize:stampFont,width:widths[echoKey],...from,opacity:0},0);
      master.set(g,{opacity:alpha},delay);
      master.to(g,{...to,duration:.72,ease:'power3.out'},delay);
      master.to(g,{opacity:0,duration:.18,ease:'sine.in'},delay+.54);
    });
    let k=0;
    words.forEach((w,i)=>{
      const pose={x:280+widths[i]/2-540,y:870-960+(i-mid)*lineSpace,rotation:0};poses.push(pose);
      if(i===echoKey)return;
      const at=.62+k++*.10;
      master.set(w,{...pose,scale:1.12},0);
      master.to(w,{opacity:1,duration:.07,ease:'none'},at);
      master.to(w,{scale:1,duration:.18,ease:'power3.out'},at);
    });
  }

  words.forEach((w,i)=>{
    master.to(w,{...targets[i],scaleX:landingScaleX*31/stampFont,scaleY:31/stampFont,rotation:0,duration:timing.settle,ease:'sine.inOut'},timing.settleStart);
    master.to(w.querySelector('.cap-word'),{opacity:0,duration:timing.crossfade,ease:'sine.inOut'},timing.crossfadeStart);
    master.to(w.querySelector('.case-word'),{opacity:1,duration:timing.crossfade,ease:'sine.inOut'},timing.crossfadeStart);
  });
  master.set('#word-intro-content',{opacity:0},timing.total);
  master.set('#series-landing',{opacity:1},timing.total);
  master.to({},{duration:.01},16.59);
  window.__introMetrics={mode,copy:config.copy,count,stampFont,lineSpace,widths,poses,echoKey,hookScale,landingScaleX,targets,timing,formationEnd,fullPhraseHold:formationEnd===null?null:timing.settleStart-formationEnd};
  window.__introReady=true;
  return {timeline:master};
};
