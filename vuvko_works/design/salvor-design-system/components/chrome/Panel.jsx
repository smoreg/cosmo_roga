const TONE = {amber:"var(--sv-amber)",good:"var(--sv-good)",warn:"var(--sv-warn)",bad:"var(--sv-bad)",neutral:"var(--sv-rim)"};

/* Five housings, one component. Each variant answers a different tell from the
   "why it reads as a dashboard" audit — a panel that is mounted, painted,
   implied, bolted, or printed. They are not skins: each changes what material
   the interface claims to be made of. */
export function Panel({title,stencil,tone="amber",variant="plate",mount="right",notch=16,hatch=true,width,fill=false,children,style}){
  const c=TONE[tone]||TONE.amber;
  const V=variant;
  const [hot,setHot]=React.useState(false);

  /* On hover the housing draws its own border out from the middle of each edge,
     in held frames rather than a transition. The title does NOT descramble:
     resolving text is for panels that appear, and this one was already here. */
  const hover={onMouseEnter:()=>setHot(true),onMouseLeave:()=>setHot(false)};

  const line=(o)=>({position:"absolute",background:c,zIndex:12,pointerEvents:"none",transformOrigin:"center",...o});
  const border=hot?(
    <React.Fragment>
      <div style={line({left:0,right:0,top:0,height:2,animation:"sv-draw-x var(--sv-frame) var(--sv-step) 1 both"})}></div>
      <div style={line({left:0,right:0,bottom:0,height:2,animation:"sv-draw-x var(--sv-frame) var(--sv-step) 1 both"})}></div>
      <div style={line({top:0,bottom:0,left:0,width:2,animation:"sv-draw-y var(--sv-frame) var(--sv-step) 1 both"})}></div>
      <div style={line({top:0,bottom:0,right:0,width:2,animation:"sv-draw-y var(--sv-frame) var(--sv-step) 1 both"})}></div>
    </React.Fragment>
  ):null;

  const head=(inner)=>(title||stencil)?inner:null;

  /* ── plate · a housing bolted to a screen edge ─────────────────────────── */
  if(V==="plate"){
    const cut=`polygon(0 0, calc(100% - ${notch}px) 0, 100% ${notch}px, 100% 100%, 0 100%)`;
    const cutIn=`polygon(0 0, calc(100% - ${notch-1}px) 0, 100% ${notch-1}px, 100% 100%, 0 100%)`;
    const edges={right:{right:0,top:0,bottom:0,width:2},left:{left:0,top:0,bottom:0,width:2},top:{left:0,right:0,top:0,height:2},bottom:{left:0,right:0,bottom:0,height:2},none:null};
    const edge=edges[mount];
    return (
      <div {...hover} style={{position:"relative",width,clipPath:cut,background:"linear-gradient(180deg,var(--sv-plate-lit) 0%,var(--sv-plate) 100%)",boxShadow:"var(--sv-cast)",fontFamily:"var(--sv-font-mono)",color:"var(--sv-fg)",...style}}>
        <div style={{position:"absolute",inset:1.5,clipPath:cutIn,background:hatch?"var(--sv-hatch)":"var(--sv-deck)"}}></div>
        {border}
        {edge?<div style={{position:"absolute",...edge,background:c,opacity:.85}}></div>:null}
        <div style={{position:"relative"}}>
          {head(
            <div style={{display:"flex",alignItems:"center",gap:10,padding:"8px 14px",background:`linear-gradient(180deg, color-mix(in oklab, ${c} 22%, transparent) 0%, transparent 100%)`,borderBottom:`1px solid color-mix(in oklab, ${c} 45%, transparent)`}}>
              {title?<div style={{font:"var(--sv-title)",letterSpacing:"var(--sv-title-track)",textTransform:"uppercase",color:"var(--sv-ink)",textShadow:"0 1px 0 rgba(0,0,0,.6)"}}>{title}</div>:null}
              {stencil?<div style={{marginLeft:"auto",font:"var(--sv-stencil)",letterSpacing:"var(--sv-stencil-track)",textTransform:"uppercase",color:c}}>{stencil}</div>:null}
            </div>
          )}
          <div style={{padding:"12px 14px 14px"}}>{children}</div>
        </div>
      </div>
    );
  }

  /* ── stencil · no housing. The label is painted on the hull itself ─────── */
  if(V==="stencil"){
    const tick=(a,b)=>({position:"absolute",[a]:0,[b]:0,width:10,height:10,borderTop:a==="top"?`1px solid ${c}`:"none",borderBottom:a==="bottom"?`1px solid ${c}`:"none",borderLeft:b==="left"?`1px solid ${c}`:"none",borderRight:b==="right"?`1px solid ${c}`:"none",opacity:.7});
    return (
      <div {...hover} style={{position:"relative",width,padding:"2px",fontFamily:"var(--sv-font-mono)",color:"var(--sv-fg)",...style}}>
        {border}
        <div style={tick("top","left")}></div><div style={tick("top","right")}></div>
        <div style={tick("bottom","left")}></div><div style={tick("bottom","right")}></div>
        <div style={{padding:"12px 16px 14px"}}>
          {head(
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:12}}>
              {title?<div style={{font:"var(--sv-display)",fontSize:27,letterSpacing:".12em",textTransform:"uppercase",color:"var(--sv-ink)",whiteSpace:"nowrap"}}>{title}</div>:null}
              <div style={{flex:1,height:3,background:`repeating-linear-gradient(90deg, ${c} 0 7px, transparent 7px 11px)`,opacity:.8}}></div>
              {stencil?<div style={{font:"var(--sv-stencil)",letterSpacing:"var(--sv-stencil-track)",textTransform:"uppercase",color:c,whiteSpace:"nowrap"}}>{stencil}</div>:null}
            </div>
          )}
          {children}
        </div>
      </div>
    );
  }

  /* ── bracket · the frame is implied, never drawn ───────────────────────── */
  if(V==="bracket"){
    const br=(v,h)=>({position:"absolute",[v]:0,[h]:0,width:20,height:20,[v==="top"?"borderTop":"borderBottom"]:`2px solid ${c}`,[h==="left"?"borderLeft":"borderRight"]:`2px solid ${c}`});
    return (
      <div {...hover} style={{position:"relative",width,background:"radial-gradient(ellipse 120% 100% at 50% 0%, color-mix(in oklab, var(--sv-deck) 88%, var(--sv-plate)) 0%, var(--sv-deep) 86%)",fontFamily:"var(--sv-font-mono)",color:"var(--sv-fg)",...style}}>
        {border}
        <div style={br("top","left")}></div><div style={br("top","right")}></div>
        <div style={br("bottom","left")}></div><div style={br("bottom","right")}></div>
        <div style={{padding:"14px 20px 16px"}}>
          {head(
            <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:5,marginBottom:13}}>
              {title?<div style={{font:"var(--sv-title)",letterSpacing:".2em",textTransform:"uppercase",color:"var(--sv-ink)",textAlign:"center"}}>{title}</div>:null}
              {stencil?<div style={{font:"var(--sv-stencil)",letterSpacing:"var(--sv-stencil-track)",textTransform:"uppercase",color:c}}>{stencil}</div>:null}
              <div style={{width:40,height:1,background:c,opacity:.6}}></div>
            </div>
          )}
          {children}
        </div>
      </div>
    );
  }

  /* ── riveted · real material, top-lit, bolted, with a recessed well ───── */
  if(V==="riveted"){
    const rivet=(top)=>({position:"absolute",left:5,top,width:7,height:7,borderRadius:"50%",background:"radial-gradient(circle at 35% 30%, var(--sv-rim) 0%, var(--sv-plate) 62%, var(--sv-deep) 100%)"});
    return (
      <div {...hover} style={{position:"relative",width,background:"linear-gradient(180deg,var(--sv-plate-hi) 0%,var(--sv-plate) 42%,var(--sv-deck) 100%)",boxShadow:"inset 0 1px 0 rgba(255,255,255,.18), inset 0 -1px 0 rgba(0,0,0,.5), var(--sv-cast)",fontFamily:"var(--sv-font-mono)",color:"var(--sv-fg)",...style}}>
        {border}
        <div style={{position:"absolute",left:0,top:0,bottom:0,width:18,background:"linear-gradient(90deg, rgba(255,255,255,.06) 0%, transparent 100%)",borderRight:"1px solid rgba(0,0,0,.45)"}}>
          <div style={rivet(12)}></div><div style={rivet("50%")}></div><div style={{...rivet(0),top:"auto",bottom:12}}></div>
        </div>
        <div style={{marginLeft:18}}>
          {head(
            <div style={{display:"flex",alignItems:"center",gap:10,padding:"8px 14px",background:"linear-gradient(180deg, var(--sv-deep) 0%, var(--sv-deck) 100%)",boxShadow:"inset 0 2px 4px rgba(0,0,0,.6), 0 1px 0 rgba(255,255,255,.08)"}}>
              {title?<div style={{font:"var(--sv-title)",letterSpacing:"var(--sv-title-track)",textTransform:"uppercase",color:"var(--sv-ink)",textShadow:"0 -1px 0 rgba(0,0,0,.9), 0 1px 0 rgba(255,255,255,.1)"}}>{title}</div>:null}
              {stencil?<div style={{marginLeft:"auto",font:"var(--sv-stencil)",letterSpacing:"var(--sv-stencil-track)",textTransform:"uppercase",color:c}}>{stencil}</div>:null}
            </div>
          )}
          <div style={{margin:"10px 12px 12px",padding:"12px 13px",background:"var(--sv-deep)",boxShadow:"inset 0 2px 5px rgba(0,0,0,.7), inset 0 -1px 0 rgba(255,255,255,.05)"}}>{children}</div>
        </div>
      </div>
    );
  }

  /* ── readout · the machine's own printout, addressed to the crew ───────── */
  const cut=`polygon(0 0, 100% 0, 100% 100%, ${notch}px 100%, 0 calc(100% - ${notch}px))`;
  return (
    <div {...hover} style={{position:"relative",width,clipPath:cut,background:"var(--sv-deep)",boxShadow:"var(--sv-cast)",fontFamily:"var(--sv-font-mono)",color:"var(--sv-fg)",...(fill?{display:"flex",flexDirection:"column"}:null),...style}}>
      {border}
      {head(
        <div style={{display:"flex",alignItems:"center",gap:9,padding:"3px 12px",background:c}}>
          {title?<div style={{font:"var(--sv-title)",letterSpacing:"var(--sv-title-track)",textTransform:"uppercase",color:"var(--sv-knock)"}}>{title}</div>:null}
          {stencil?<div style={{marginLeft:"auto",font:"var(--sv-stencil)",letterSpacing:"var(--sv-stencil-track)",textTransform:"uppercase",color:"var(--sv-knock)",opacity:.78}}>{stencil}</div>:null}
          <div style={{width:8,height:15,background:"var(--sv-knock)"}}></div>
        </div>
      )}
      <div style={{position:"relative",padding:"12px 14px 15px",...(fill?{flex:1,minHeight:0,display:"flex",flexDirection:"column"}:null)}}>
        <div style={{position:"absolute",inset:0,background:"var(--sv-scan)",pointerEvents:"none"}}></div>
        <div style={{position:"relative",...(fill?{flex:1,minHeight:0,display:"flex",flexDirection:"column"}:null)}}>{children}</div>
      </div>
    </div>
  );
}

/* Printed label. A tag is a stamp: ink knocked out of a solid fill, one corner
   clipped like the panels. Quiet tags print on a wash instead of the accent. */
export function Tag({tone="neutral",solid=false,children,style}){
  const c=TONE[tone]||TONE.neutral;
  return (
    <span style={{display:"inline-block",padding:"4px 8px",font:"var(--sv-stencil)",letterSpacing:"var(--sv-stencil-track)",textTransform:"uppercase",clipPath:"polygon(0 0,100% 0,100% 100%,6px 100%,0 calc(100% - 6px))",background:solid?c:`color-mix(in oklab, ${c} 24%, var(--sv-knock))`,color:solid?"var(--sv-knock)":c,...style}}>{children}</span>
  );
}

/* A menu is a housing that arrives over the board: the same printed language,
   one column of rows, and — when it is a page rather than the root menu — a
   way back. Nothing here is a dialog; it is a plate bolted over the view. */
export function MenuSheet({title,stencil,rows=[],onBack,onClose,width=340,leaving=false,drawer=false,children,style}){
  const ref=React.useRef(null);
  React.useEffect(()=>{
    if(leaving) return;
    const FX=typeof window!=="undefined"?(window.FX||window.DerelictFX):null;
    if(!FX||!ref.current) return;
    /* `reveal` rather than `scrambleReveal`, and `linesOf` rather than a
       selector: a cancelled reveal must put its words back, and mid-reveal the
       DOM says these lines have no text. Both learned the hard way — see
       INTEGRATION.md, "A cancelled reveal". */
    return FX.reveal(FX.linesOf(ref.current),FX.PRESETS.sheet||FX.PRESETS.panel);
  },[leaving]);
  const slide=drawer?{animation:(leaving?"sv-slide-out":"sv-slide-in")+" var(--sv-frame) var(--sv-step) 1 both"}:null;
  return (
    <div ref={ref} style={{position:"relative",...slide,...(drawer?{height:"100%"}:null)}}>
    {onClose?<div onClick={onClose} title="close"
      style={{position:"absolute",right:0,top:0,width:30,height:30,zIndex:20,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",font:"var(--sv-stencil)",fontSize:17,letterSpacing:0,lineHeight:1,color:"var(--sv-knock)"}}>×</div>:null}
    <Panel variant="printed" title={title} mount="none" width={width} fill={drawer} style={drawer?{height:"100%",...style}:style}>
      {children}
      {rows.length?(
        <div style={{display:"flex",flexDirection:"column",gap:2}}>
          {rows.map((r,i)=>(
            <div key={i} onClick={r.onPick} style={{display:"flex",alignItems:"center",gap:10,padding:"7px 9px",cursor:"pointer",background:"transparent"}}
              onMouseEnter={(e)=>{e.currentTarget.style.background="color-mix(in oklab, var(--sv-amber) 16%, transparent)";}}
              onMouseLeave={(e)=>{e.currentTarget.style.background="transparent";}}>
              <span style={{width:13,flex:"none",font:"var(--sv-stencil)",fontSize:14,letterSpacing:0,color:"var(--sv-amber)"}}>{r.key||"·"}</span>
              <span style={{font:"var(--sv-body)",color:"var(--sv-ink)"}}>{r.label}</span>
              {r.note?<span style={{marginLeft:"auto",font:"var(--sv-stencil)",fontSize:14,letterSpacing:".1em",textTransform:"uppercase",color:"var(--sv-soft)"}}>{r.note}</span>:null}
            </div>
          ))}
        </div>
      ):null}
      {onBack?(
        <div style={{display:"flex",marginTop:"auto",paddingTop:12,borderTop:"1px solid var(--sv-line)"}}>
          <span onClick={onBack} style={{font:"var(--sv-stencil)",fontSize:14,letterSpacing:".14em",textTransform:"uppercase",background:"var(--sv-amber)",color:"var(--sv-knock)",padding:"3px 9px",cursor:"pointer"}}>back</span>
        </div>
      ):null}
    </Panel>
    </div>
  );
}

/* The left rail: printed keys on a flat strip. The active one is knocked out. */
export function Rail({items=[],active,onSelect,width=46,style}){
  return (
    <div style={{width,background:"var(--sv-knock)",borderRight:"1px solid var(--sv-line)",display:"flex",flexDirection:"column",alignItems:"center",padding:"10px 0",gap:6,...style}}>
      {items.map((it,i)=>{
        const on=active===(it.id!=null?it.id:i);
        return (
          <div key={i} title={it.title} onClick={()=>onSelect&&onSelect(it.id!=null?it.id:i)} style={{width:32,height:32,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",clipPath:"polygon(0 0,100% 0,100% 100%,6px 100%,0 calc(100% - 6px))",background:on?"var(--sv-amber)":"var(--sv-deck)",color:on?"var(--sv-knock)":"var(--sv-soft)",font:"var(--sv-stencil)"}}>{it.glyph}</div>
        );
      })}
    </div>
  );
}
