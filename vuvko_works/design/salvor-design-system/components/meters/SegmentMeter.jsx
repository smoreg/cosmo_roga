const TONE={amber:"var(--sv-amber)",good:"var(--sv-good)",warn:"var(--sv-warn)",bad:"var(--sv-bad)",neutral:"var(--sv-rim)"};

/* Segments, not a bar — a module's stability is a row of ▮ cells, and a cell
   is lit or it is out. Nothing partial, so nothing to interpolate. */
export function SegmentMeter({label,value=0,max=8,burned=0,tone="good",shape="block",height=12,showValue=true,style}){
  const c=TONE[tone]||TONE.good;
  const cells=[];
  for(let i=0;i<max;i++){
    const isBurned=i>=max-burned;
    const on=i<value&&!isBurned;
    cells.push(
      <div key={i} style={{flex:1,minWidth:2,height,background:isBurned?"var(--sv-burned)":on?c:"var(--sv-plate)",clipPath:shape==="slant"?"polygon(14% 0,100% 0,86% 100%,0 100%)":undefined}}></div>
    );
  }
  return (
    <div style={{display:"flex",alignItems:"center",gap:9,...style}}>
      {label?<div style={{width:78,flex:"none",font:"var(--sv-stencil)",fontSize:14,letterSpacing:".14em",textTransform:"uppercase",color:"var(--sv-soft)"}}>{label}</div>:null}
      <div style={{flex:1,display:"flex",gap:shape==="slant"?3:2}}>{cells}</div>
      {showValue?<div style={{font:"var(--sv-value)",color:"var(--sv-ink)",whiteSpace:"nowrap"}}>{value}<span style={{color:"var(--sv-soft)"}}>/{max}</span></div>:null}
    </div>
  );
}

/* Stability written the way the machine prints it: one struck mark per step of
   capacity, lit while the module holds it, dim where it has been lost. Left
   aligned and never stretched, so two modules of different size are directly
   comparable and no number has to restate the count. */
export function SlashMeter({label,value=0,max=8,tone="good",style}){
  const c=TONE[tone]||TONE.good;
  return (
    <div style={{display:"flex",alignItems:"center",gap:10,...style}}>
      {label?<div style={{width:78,flex:"none",font:"var(--sv-stencil)",fontSize:14,letterSpacing:".14em",textTransform:"uppercase",color:"var(--sv-soft)"}}>{label}</div>:null}
      <div style={{flex:1,minWidth:0,display:"flex",gap:1,font:"var(--sv-value)",fontSize:17,lineHeight:1,letterSpacing:0,whiteSpace:"nowrap",overflow:"hidden"}}>
        {Array.from({length:max}).map((_,i)=>(
          <span key={i} style={{color:i<value?c:"var(--sv-plate-lit)"}}>/</span>
        ))}
      </div>
    </div>
  );
}

/* The core's stability, read as pips: ●●○. The last one is the run. */
export function CorePips({value=1,max=3,size=15,style}){
  const tone=value<=1?"var(--sv-bad)":value<max?"var(--sv-warn)":"var(--sv-good)";
  return (
    <div style={{display:"flex",alignItems:"center",gap:6,...style}}>
      {Array.from({length:max}).map((_,i)=>(
        <div key={i} style={{width:size,height:size,background:i<value?tone:"transparent",border:`2px solid ${i<value?tone:"var(--sv-plate-lit)"}`,boxSizing:"border-box",animation:i===value-1&&value<=1?"sv-flick var(--sv-frame-3) var(--sv-step) infinite":"none"}}></div>
      ))}
    </div>
  );
}

/* The drone: its core, then six numbered slots. A module is a named system
   with a stability bar; when it burns out the slot is empty for the rest of
   the sortie. This is where damage lands — there is no hull bar anywhere. */
export function CoreRack({core=1,coreMax=3,slots=[],title="Core",style}){
  return (
    <div style={{...style}}>
      <div style={{display:"flex",alignItems:"center",gap:12,paddingBottom:11,borderBottom:"1px solid var(--sv-line)"}}>
        <div style={{font:"var(--sv-stencil)",letterSpacing:"var(--sv-stencil-track)",textTransform:"uppercase",color:core<=1?"color-mix(in oklab, var(--sv-bad) 30%, var(--sv-ink))":"var(--sv-ink)"}}>{title}</div>
        <CorePips value={core} max={coreMax}/>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:8,marginTop:11}}>
        {slots.map((s,i)=>{
          /* A burned slot and an empty slot are the same thing to look at: the
             bay is there and nothing is in it. Naming what used to be in it is
             a fact for the log, not a permanent label on the rack. */
          const dead=s.burned||s.empty;
          return dead?(
            <div key={i} style={{display:"flex",alignItems:"center",height:19,padding:"0 9px",border:"1px dotted var(--sv-rule)",boxSizing:"border-box"}}>
              <div style={{font:"var(--sv-stencil)",fontSize:14,letterSpacing:".14em",textTransform:"uppercase",color:"var(--sv-faint)"}}>empty</div>
            </div>
          ):(
            <SlashMeter key={i} label={s.name} value={s.value} max={s.max}
              tone={s.tone||(s.value<=s.max*0.34?"bad":s.value<s.max*0.7?"warn":"good")}/>
          );
        })}
      </div>
    </div>
  );
}

/* Alert. Five steps, and only the fifth sweeps: a printed gauge, not a bezel. */
export function AlertDial({value=0,max=5,label="Alert",size=76,tone="bad",style}){
  const c=TONE[tone]||TONE.bad;
  const seg=360/max, deg=Math.max(0,Math.min(max,value))*seg;
  return (
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:7,...style}}>
      <div style={{position:"relative",width:size,height:size,borderRadius:"50%",background:"var(--sv-knock)",border:`1px solid ${value?c:"var(--sv-plate-lit)"}`,boxSizing:"border-box",overflow:"hidden"}}>
        <div style={{position:"absolute",inset:4,borderRadius:"50%",background:`conic-gradient(${c} 0deg ${deg}deg, color-mix(in oklab, ${c} 14%, var(--sv-knock)) ${deg}deg 360deg)`}}></div>
        <div style={{position:"absolute",inset:4,borderRadius:"50%",background:`repeating-conic-gradient(from -2deg, transparent 0 ${seg-4}deg, var(--sv-knock) ${seg-4}deg ${seg}deg)`}}></div>
        <div style={{position:"absolute",inset:Math.round(size*.17),borderRadius:"50%",background:"var(--sv-knock)",display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div style={{font:"var(--sv-display)",fontSize:Math.round(size*.45),color:value?c:"var(--sv-soft)",animation:value>=max?"sv-flick var(--sv-frame-3) var(--sv-step) infinite":"none"}}>{value}</div>
        </div>
        <div style={{position:"absolute",inset:0,background:"var(--sv-scan)",pointerEvents:"none"}}></div>
      </div>
      {label?<div style={{font:"var(--sv-stencil)",letterSpacing:"var(--sv-stencil-track)",textTransform:"uppercase",color:"var(--sv-soft)"}}>{label}</div>:null}
    </div>
  );
}
