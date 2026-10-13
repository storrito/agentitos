// Background footage (plan.video): the video fills the frame, a band darkens where the type
// goes (and hides burned-in captions / logos below it), and the world's canvas is screened on
// top, so only the world's light (stars, embers, rings) shows. The footage breathes: a slow
// push-in, small punches on hero lockups. Shared by build.mjs (render) and qa.mjs (stills).
//
// Returns { css, html, js }: html goes before the world canvas, js runs with a GSAP timeline `tl`.
//   media: "video" (render; HyperFrames extracts the frames) | "img" (QA swaps decoded stills)

const pct = (v) => `${(v * 100).toFixed(1)}%`;

export function footageLayer(plan, { media = "video", canvas = "#world-canvas" } = {}) {
  const V = plan.video, D = plan.duration;
  const [a, b] = V.shade, d = V.dim ?? 0.9;
  const vEnd = Math.min(D, V.duration);
  const stop = (f, o) => `rgba(0,0,0,${(o * d).toFixed(3)}) ${pct(a + (b - a) * f)}`;
  // eased ramp (no visible edge), plus a light veil at the very top for the HUD
  const shade = `linear-gradient(to bottom, rgba(0,0,0,.42) 0%, rgba(0,0,0,0) 15%, rgba(0,0,0,0) ${pct(a)}, ${stop(0.25, 0.1)}, ${stop(0.5, 0.36)}, ${stop(0.75, 0.74)}, ${stop(1, 1)}, rgba(0,0,0,${d}) 100%)`;
  // the world's light stays faint over the face and comes up where the band is dark
  const fadeMask = `linear-gradient(to bottom, rgba(0,0,0,.1) 0%, rgba(0,0,0,.12) ${pct(a)}, #000 ${pct(b)})`;
  const heroes = plan.phrases.filter((p) => p.layout === "hero").map((p) => +p.tIn.toFixed(3));
  const tag = media === "video"
    ? `<video id="bg-video" class="clip" src="${V.src}" muted playsinline data-start="0" data-duration="${vEnd.toFixed(3)}" data-track-index="0"></video>`
    : `<img id="bg-video" alt="" />`;
  return {
    css: `
        #bg-push, #bg-punch { position: absolute; inset: 0; transform-origin: 50% 28%; }
        #bg-video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: 50% 30%; }
        #bg-shade { position: absolute; inset: 0; background: ${shade}; }
        ${canvas} { mix-blend-mode: screen; -webkit-mask-image: ${fadeMask}; mask-image: ${fadeMask}; }`,
    html: `
        <div id="bg-push"><div id="bg-punch">
          ${tag}
        </div></div>
        <div id="bg-shade"></div>`,
    js: `
          var heroes = ${JSON.stringify(heroes)};
          tl.fromTo("#bg-push", { scale: 1 }, { scale: 1.06, duration: ${D}, ease: "none" }, 0);
          heroes.forEach(function (t) {
            tl.to("#bg-punch", { scale: 1.025, duration: 0.22, ease: "power2.out" }, t);
            tl.to("#bg-punch", { scale: 1, duration: 1.1, ease: "power2.inOut" }, t + 0.22);
          });
          tl.to("#bg-push", { opacity: 0, duration: 0.5, ease: "power1.in" }, ${Math.max(0, vEnd - 0.5).toFixed(3)});`,
  };
}
