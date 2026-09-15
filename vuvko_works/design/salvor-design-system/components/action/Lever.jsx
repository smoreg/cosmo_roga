const TONE={amber:"var(--sv-amber)",good:"var(--sv-good)",warn:"var(--sv-warn)",bad:"var(--sv-bad)",neutral:"var(--sv-rim)"};

/* The commit action as a printed slab: ink knocked out of solid accent, the
   same clipped corner the panels carry, the keystroke in brackets under it. */
export function Lever({label,hint,tone="amber",ready=false,disabled=false,width=186,height=62,onClick,style}){
  const c=disabled?"var(--sv-plate-lit)":(TONE[tone]||TONE.amber);
  return (
    <div onClick={disabled?undefined:onClick} style={{position:"relative",width,height,clipPath:"var(--sv-cut-bl)",background:c,cursor:disabled?"not-allowed":"pointer",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:2,animation:ready?"sv-flick var(--sv-frame-3) var(--sv-step) infinite":"none",...style}}>
      <div style={{position:"absolute",inset:0,background:"var(--sv-scan)",pointerEvents:"none"}}></div>
      <div style={{position:"relative",font:"var(--sv-display)",fontSize:27,letterSpacing:"var(--sv-display-track)",textTransform:"uppercase",color:disabled?"var(--sv-soft)":"var(--sv-knock)"}}>{label}</div>
      {hint?<div style={{position:"relative",font:"var(--sv-stencil)",letterSpacing:"var(--sv-stencil-track)",textTransform:"uppercase",color:disabled?"var(--sv-soft)":"var(--sv-knock)",opacity:.75}}>[{hint}]</div>:null}
    </div>
  );
}

/* The action list is the whole interface: numbered rows, keyed, ten at a time,
   and the cursor row is the one a keypress would take. Ten is not a layout
   choice — it is how many number keys there are, which is the same reason
   Cogmind's inventory is ten slots rather than six. */
export function ActionList({actions=[],cursor=0,title="Actions",limit=10,onPick,style}){
  const [hover,setHover]=React.useState(-1);
  const shown=actions.slice(0,limit), hidden=actions.length-shown.length;
  const keyOf=(a,i)=>a.key!=null?a.key:(i===9?0:i+1);
  /* Cogmind brackets the row under the cursor rather than filling it. Bars on
     both sides, stepped in over one frame — no fade, no slide. */
  const bar=(side)=>({position:"absolute",[side]:0,top:0,bottom:0,width:3,background:"var(--sv-amber)",transformOrigin:"center",animation:"sv-bracket var(--sv-frame) var(--sv-step) 1 both"});
  return (
    <div style={{fontFamily:"var(--sv-font-mono)",...style}}>
      {title?<div style={{display:"flex",alignItems:"center",gap:10,paddingBottom:7,borderBottom:"1px solid var(--sv-line)"}}>
        <div style={{font:"var(--sv-stencil)",letterSpacing:"var(--sv-stencil-track)",textTransform:"uppercase",color:"var(--sv-amber)"}}>{title}</div>
        <div style={{marginLeft:"auto",font:"var(--sv-stencil)",letterSpacing:".14em",textTransform:"uppercase",color:"var(--sv-soft)"}}>{actions.length} open</div>
      </div>:null}
      <div style={{display:"flex",flexDirection:"column",gap:2,marginTop:9}} onMouseLeave={()=>setHover(-1)}>
        {shown.map((a,i)=>{
          const on=i===cursor, hot=i===hover&&!a.disabled;
          return (
            <div key={i} onClick={a.disabled?undefined:()=>onPick&&onPick(i)} onMouseEnter={()=>setHover(i)}
              style={{position:"relative",display:"flex",alignItems:"center",gap:10,padding:"3px 12px",cursor:a.disabled?"not-allowed":"pointer",background:on?"var(--sv-amber)":hot?"color-mix(in oklab, var(--sv-amber) 14%, transparent)":"transparent"}}>
              {hot&&!on?<div style={bar("left")}></div>:null}
              {hot&&!on?<div style={bar("right")}></div>:null}
              <div style={{width:26,flex:"none",display:"flex",alignItems:"center",gap:3,font:"var(--sv-stencil)",fontSize:14,letterSpacing:0,color:on?"var(--sv-knock)":hot?"var(--sv-amber-hi)":"var(--sv-soft)"}}>
                <span style={{width:9}}>{on?"▸":""}</span>{keyOf(a,i)}
              </div>
              <div style={{flex:1,font:"var(--sv-body)",color:on?"var(--sv-knock)":a.disabled?"var(--sv-soft)":hot?"var(--sv-ink)":"var(--sv-fg)"}}>{a.label}</div>
              {a.note?<div style={{flex:"none",font:"var(--sv-stencil)",fontSize:14,letterSpacing:".1em",textTransform:"uppercase",color:on?"var(--sv-knock)":a.tone==="bad"?"color-mix(in oklab, var(--sv-bad) 30%, var(--sv-ink))":"var(--sv-soft)",opacity:on?.78:1}}>{a.note}</div>:null}
            </div>
          );
        })}
        {hidden>0?<div style={{padding:"4px 12px 0 48px",font:"var(--sv-body)",color:"var(--sv-soft)"}}>… {hidden} more here</div>:null}
      </div>
    </div>
  );
}

/* The log reads as a ticker bolted to the bottom of the screen. Expanding it
   overlays the record upward over whatever is above — it never takes layout
   space, so the map does not resize under you when you open the log. */
export function LogStrip({entries=[],expanded=false,onToggle,height=30,style}){
  const last=entries[0]||{tag:"",text:""};
  const ink=(t)=>t==="bad"?"color-mix(in oklab, var(--sv-bad) 30%, var(--sv-ink))":t==="warn"?"var(--sv-warn)":"var(--sv-fg)";
  const recordRef=React.useRef(null);
  /* The record was already written, so it resolves all at once rather than
     line by line — a log you have to wait through is a log you stop opening. */
  React.useEffect(()=>{
    if(!expanded) return;
    const FX=typeof window!=="undefined"?(window.FX||window.DerelictFX):null;
    if(!FX||!recordRef.current) return;
    const h=FX.scrambleReveal(recordRef.current.querySelectorAll("[data-sc]"),FX.PRESETS.all||{stagger:0,ticks:3,tickMs:95});
    return ()=>h.cancel();
  },[expanded]);
  return (
    <div style={{position:"relative",background:"var(--sv-plate)",borderTop:"1px solid var(--sv-line)",fontFamily:"var(--sv-font-mono)",...style}}>
      {expanded?(
        <div ref={recordRef} style={{position:"absolute",left:0,right:0,bottom:"100%",maxHeight:260,overflow:"auto",padding:"10px 14px",display:"flex",flexDirection:"column",gap:7,background:"var(--sv-knock)",borderTop:"1px solid var(--sv-line)",zIndex:30}}>
          <div style={{position:"absolute",inset:0,background:"var(--sv-scan)",pointerEvents:"none"}}></div>
          {entries.map((e,i)=>(
            <div key={i} style={{display:"flex",gap:10,alignItems:"baseline"}}>
              <div data-sc style={{width:70,flex:"none",font:"var(--sv-stencil)",fontSize:14,letterSpacing:".12em",textTransform:"uppercase",color:i===0?"var(--sv-amber)":"var(--sv-soft)"}}>{e.tag}</div>
              <div data-sc style={{font:"var(--sv-body)",color:i===0?"var(--sv-ink)":ink(e.tone)}}>{e.text}</div>
            </div>
          ))}
        </div>
      ):null}
      <div onClick={onToggle} style={{height,display:"flex",alignItems:"center",cursor:onToggle?"pointer":"default"}}>
        <div style={{alignSelf:"stretch",display:"flex",alignItems:"center",padding:"0 12px",background:"var(--sv-amber)",clipPath:"polygon(0 0,100% 0,100% 100%,6px 100%,0 calc(100% - 6px))",font:"var(--sv-stencil)",fontSize:14,letterSpacing:"var(--sv-stencil-track)",textTransform:"uppercase",color:"var(--sv-knock)"}}>log</div>
        <div style={{flex:1,minWidth:0,display:"flex",alignItems:"center",gap:12,padding:"0 14px"}}>
          <div style={{flex:"none",font:"var(--sv-stencil)",fontSize:14,letterSpacing:".12em",textTransform:"uppercase",color:"var(--sv-amber)"}}>{last.tag}</div>
          <div style={{font:"var(--sv-body)",color:"var(--sv-fg)",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{last.text}</div>
          <div style={{marginLeft:"auto",flex:"none",font:"var(--sv-stencil)",fontSize:14,letterSpacing:".12em",textTransform:"uppercase",color:"var(--sv-soft)"}}>{expanded?"close":entries.length+" kept"}</div>
        </div>
      </div>
    </div>
  );
}
