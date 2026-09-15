/* A compartment, in the printed language. Four states, and the state is how
   much the drone knows about the cell — so the amount of information on the
   face IS the encoding, backed up by colour and by the band's pattern:

     undetected  nothing. a shape in the dark, no label, no contents
     detected    the name only, on a striped band — we have a label, not a look
     monitored   the name and everything in it, on a solid band
     current     the drone is inside. same again, amber, drone crowning the hex

   There is no action list. Every object on the board is its own affordance:
   hover it for what it is and what you could do to it, click it to do the
   obvious thing. You cannot attack a crate, so a crate never offers attack —
   the verb comes from the object and where the drone is standing, which means
   the interface never has to enumerate verbs you were not going to use. */
const STATE={
  undetected:{line:"var(--sv-rule)",     fill:"var(--sv-knock)", band:null,  knows:"nothing"},
  detected:  {line:"var(--sv-bulkhead)", fill:"var(--sv-void)",
              band:"repeating-linear-gradient(90deg, var(--sv-soft) 0 5px, #7d8891 5px 10px)", knows:"name"},
  monitored: {line:"var(--sv-zone)",     fill:"var(--sv-deck)",  band:"var(--sv-zone)", knows:"all"},
  current:   {line:"var(--sv-amber)",    fill:"color-mix(in oklab, var(--sv-amber) 16%, var(--sv-deck))",
              band:"var(--sv-amber)", knows:"all", strong:true}
};

/* Room properties, on a separate channel from knowledge: a dashed ring inside
   the hex whose rhythm — not just its colour — says which. */
const PROP={
  hazard: {c:"var(--sv-bad)",  dash:[6,4],  fill:"var(--sv-red-wash)",   name:"hazard"},
  vacuum: {c:"var(--sv-zone)", dash:[15,7],                              name:"no atmo"},
  dark:   {c:"var(--sv-soft)", dash:[3,10],                              name:"unpowered"},
  alarmed:{c:"var(--sv-warn)", dash:[4,3],  fill:"var(--sv-amber-wash)", name:"alarmed"}
};

/* Contents are shapes, not letters, and each knows its own verbs. `near` is
   what the drone can do from the next compartment; `at` needs it standing here. */
const KIND={
  scout:   {shape:"polygon(50% 0,100% 100%,0 100%)",                 hostile:true, name:"scout",       at:"attack", near:"watch", note:"melee · 3/3"},
  feral:   {shape:"polygon(50% 0,100% 50%,50% 100%,0 50%)",          hostile:true, name:"feral drone", at:"attack", near:"watch", note:"melee · 3/3"},
  sentry:  {shape:"polygon(50% 0,100% 35%,82% 100%,18% 100%,0 35%)", hostile:true, name:"sentry",      at:"attack", near:"watch", note:"fixed · 5/5"},
  crate:   {shape:null,                                                            name:"cargo crate", at:"take",   near:null,    note:"8 cr"},
  terminal:{shape:"polygon(0 0,100% 0,100% 72%,62% 72%,62% 100%,38% 100%,38% 72%,0 72%)", name:"terminal", at:"read", near:null, note:"1 turn"},
  machine: {shape:"circle(50%)",                                                   name:"machine",     at:"strip",  near:null,    note:"2 turns"},

  /* Four actors the game has and the board had no word for. All of them sit in
     the lower row — they act, so they are not loot — but only two of them are
     trying to kill you, which is why `tone` is separate from `hostile` now.
     `hostile` decides which row a thing sits in and what verbs it answers to;
     `tone` decides what colour it is drawn in. Amber is the drone and red is a
     threat, so neither is free for a racer or a spawner. */
  rival:   {shape:"polygon(50% 0,100% 28%,100% 72%,50% 100%,0 72%,0 28%)",
            hostile:true, tone:"var(--sv-rim)",     name:"rival drone", at:"rob",    near:"watch", note:"racer · never hunts you"},
  ghost:   {shape:"polygon(50% 0,86% 22%,86% 78%,50% 100%,14% 78%,14% 22%)",
            hostile:true, tone:"var(--sv-zone)",    name:"ghost",       at:"attack", near:"watch", note:"the rack you lost"},
  bloom:   {shape:"polygon(50% 0,93% 25%,93% 75%,50% 100%,7% 75%,7% 25%)",
            hostile:true, tone:"var(--sv-warn)",    name:"hatchery",    at:"attack", near:null,    note:"static · hatching"},
  jammer:  {shape:"polygon(50% 12%,88% 50%,50% 88%,12% 50%,50% 12%)",
            hostile:true, tone:"var(--sv-amber-deep)", name:"jammer",  at:"attack", near:"watch", note:"your rack does nothing"}
};

/* What a thing is drawn in. A kind may name its own; otherwise threat is red
   and everything else is the interactive colour. */
function toneOf(k){ return k.tone||(k.hostile?"var(--sv-bad)":"var(--sv-amber)"); }

function knowsOf(state){ return (STATE[state]||STATE.monitored).knows; }

/**
 * The knowledge model, exposed so nothing has to re-derive it — a readout must
 * never out-know the board. Capitalised because that is what the design system
 * puts on its namespace.
 *
 *   Knowledge.of(state)    "nothing" | "name" | "all"
 *   Knowledge.name(room)   the room's name, or null if it is not yours to know
 */
export const Knowledge={
  of:knowsOf,
  name(room){
    if(!room) return null;
    return knowsOf(room.state)==="nothing"?null:(room.name||null);
  }
};

const RATIO=1.1547; // pointy-top: point-to-point height over flat-to-flat width
const HEX="var(--sv-hex)";
const PTS="50,1.5 98.5,29.7 98.5,85.8 50,113.9 1.5,85.8 1.5,29.7";

/* A hollow hexagonal outline. fill:none means it draws only the line, so it
   can sit over a cell without hiding anything in it. */
function HexRing({stroke,width=2.6,dash=null,style}){
  return (
    <svg viewBox="0 0 100 115.47" style={{position:"absolute",inset:0,width:"100%",height:"100%",overflow:"visible",pointerEvents:"none",...style}}>
      <polygon points={PTS} fill="none" stroke={stroke} strokeWidth={width} strokeDasharray={dash||undefined} vectorEffect="non-scaling-stroke"></polygon>
    </svg>
  );
}

/* A cell can hold nine hostiles and still be 118px wide, so chips are grouped
   by kind and counted rather than drawn one per body. Nine scouts is one
   triangle reading 9 — which is also the more useful sentence.

   Grouping is what bounds the row: there are three hostile kinds and three
   object kinds, so a row is at most three chips whatever the body count. */
function group(list){
  const out=[], by={};
  list.forEach(c=>{
    const k=c.kind;
    if(by[k]){
      by[k].n++;
      by[k].threat=Math.max(by[k].threat||0,c.threat||0);
      /* A chip that stands for several bodies cannot borrow one body's name —
         "scout 1 ×3" names a thing that does not exist. Fall back to the kind. */
      by[k].name=undefined;
      return;
    }
    by[k]={kind:k,n:1,threat:c.threat||0,name:c.name}; out.push(by[k]);
  });
  return out;
}

/* Every panel that only exists while you are hovering something. It draws its
   own border out from the middle of each edge and resolves its text out of
   noise, both on mount — so appearing is the animation, and there is no state
   to track. Mark any leaf text with `data-sc` to have it descramble. */
export function Popover({tone="var(--sv-amber)",children,style}){
  const ref=React.useRef(null);
  React.useEffect(()=>{
    const FX=typeof window!=="undefined"?(window.FX||window.DerelictFX):null;
    if(!FX||!ref.current) return;
    const h=FX.scrambleReveal(ref.current.querySelectorAll("[data-sc]"),FX.PRESETS.hover);
    return ()=>h.cancel();
  },[]);
  const line=(o)=>({position:"absolute",background:tone,zIndex:3,pointerEvents:"none",transformOrigin:"center",animation:"sv-draw-"+(o.height?"x":"y")+" var(--sv-frame) var(--sv-step) 1 both",...o});
  return (
    <div ref={ref} style={{position:"relative",background:"var(--sv-knock)",...style}}>
      <div style={line({left:0,right:0,top:0,height:2})}></div>
      <div style={line({left:0,right:0,bottom:0,height:2})}></div>
      <div style={line({top:0,bottom:0,left:0,width:2})}></div>
      <div style={line({top:0,bottom:0,right:0,width:2})}></div>
      {children}
    </div>
  );
}

/* The compressed readout. Everything a hover is allowed to say: what it is,
   how many, how dangerous, and the one verb a click would spend. */
export function Readout({item,here=true,style}){
  const k=KIND[item.kind]||KIND.machine;
  const verb=here?k.at:k.near;
  const tone=toneOf(k);
  return (
    <Popover tone={tone} style={{display:"flex",alignItems:"center",gap:10,padding:"6px 10px",whiteSpace:"nowrap",...style}}>
      <span data-sc style={{font:"var(--sv-stencil)",fontSize:14,letterSpacing:".12em",textTransform:"uppercase",color:k.hostile?"color-mix(in oklab, "+toneOf(k)+" 26%, var(--sv-ink))":"var(--sv-ink)"}}>
        {(item.name||k.name)+(item.n>1?" ×"+item.n:"")}
      </span>
      {k.hostile?(
        <span style={{display:"flex",gap:3}}>
          {[0,1,2].map(i=><span key={i} style={{width:7,height:12,background:i<(item.threat||1)?toneOf(k):"var(--sv-plate-lit)"}}></span>)}
        </span>
      ):<span data-sc style={{font:"var(--sv-body)",color:"var(--sv-soft)"}}>{k.note}</span>}
      {verb?<span data-sc style={{font:"var(--sv-stencil)",fontSize:14,letterSpacing:".14em",textTransform:"uppercase",background:tone,color:"var(--sv-knock)",padding:"2px 6px"}}>{verb}</span>
           :<span data-sc style={{font:"var(--sv-stencil)",fontSize:14,letterSpacing:".14em",textTransform:"uppercase",color:"var(--sv-soft)"}}>go there first</span>}
    </Popover>
  );
}

function Chip({item,size,here,onEnter,onLeave,onAct}){
  const k=KIND[item.kind]||KIND.machine;
  const c=toneOf(k);
  const can=here?k.at:k.near;
  return (
    <div onMouseEnter={onEnter} onMouseLeave={onLeave}
      onClick={can&&onAct?(e)=>{e.stopPropagation();onAct(can,item);}:undefined}
      style={{display:"flex",alignItems:"center",gap:3,cursor:can&&onAct?"pointer":"help"}}>
      <div style={{width:size,height:size,flex:"none",background:c,clipPath:k.shape||undefined}}></div>
      {item.n>1?<div style={{font:"var(--sv-stencil)",fontSize:14,letterSpacing:0,lineHeight:1,color:k.hostile?"color-mix(in oklab, "+toneOf(k)+" 26%, var(--sv-ink))":"var(--sv-amber-hi)"}}>{item.n}</div>:null}
    </div>
  );
}

export function HexTile({name,id,contents=[],props=[],state="monitored",size=118,step=null,fresh=null,onClick,onMouseEnter,onMouseLeave,onAct,hot=false,style}){
  const s=STATE[state]||STATE.monitored;
  const [tip,setTip]=React.useState(null);
  const [seq,setSeq]=React.useState(0);
  const show=(c)=>{ setTip(c); setSeq(n=>n+1); };
  const labelRef=React.useRef(null);

  /* A hovered thing that dies unmounts its own chip, so no pointer ever leaves
     it and the readout stands there naming something that is no longer aboard.
     Killing a hostile used to leave its card floating beside an empty hex. */
  React.useEffect(()=>{
    if(!tip) return;
    const still=group(contents).some(c=>c.kind===tip.kind);
    if(!still) setTip(null);
  },[contents,tip]);

  /* The three things a compartment does when it stops being a rumour: the cell
     opens out of its own waist, the name band draws from the middle to both
     ends, and the name resolves out of scramble. Pass `fresh` as a number that
     changes each time it happens — the layer is keyed on it, because a CSS
     animation replays when the element is new and not when a property goes
     back to a value it already had. */
  React.useEffect(()=>{
    if(fresh==null||!labelRef.current) return;
    const FX=typeof window!=="undefined"?(window.FX||window.DerelictFX):null;
    if(!FX||!FX.reveal) return;
    return FX.reveal([labelRef.current],FX.PRESETS.name);
  },[fresh]);
  const h=Math.round(size*RATIO);
  const here=state==="current";
  const shows=s.knows==="all";
  const named=knowsOf(state)!=="nothing"&&name;
  const rings=(shows?props:[]).slice(0,1).map(p=>PROP[p]).filter(Boolean);
  const wash=rings.map(r=>r.fill).filter(Boolean)[0];
  const fill=wash||s.fill;
  const loot=shows?group(contents.filter(c=>!(KIND[c.kind]||{}).hostile)):[];
  const foes=shows?group(contents.filter(c=>(KIND[c.kind]||{}).hostile)):[];
  /* The band is the hex's full inset width, so the budget is the assembled
     line against the band — not each word. */
  const chars=Math.floor((size-8)/8.4);
  const fit=named?(String(name).length>chars?String(name).slice(0,chars):String(name)):"";
  const base=s.strong||hot?2.5:1.5;

  return (
    <div onClick={onClick} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}
      /* Board stacking, fixed: doors 1-3 < tiles 4-5 < raised tile 40 <
         drone 50 < popovers 60. The crown straddles its room's top edge, so a
         raised tile must stay under it. */
      style={{position:"relative",width:size,height:h,pointerEvents:"none",...style,zIndex:tip?40:(style||{}).zIndex}}>

      {/* The shaped hit area. Everything visual is painted by siblings; this
          layer exists only so the hexagon — not its bounding box — is what
          responds to the pointer. */}
      <div style={{position:"absolute",inset:0,clipPath:HEX,pointerEvents:"auto",cursor:onClick?"pointer":"default",zIndex:5}}></div>

      {/* Everything painted, wrapped so a reveal can open it out of its own
          waist. Nothing here takes a pointer the layers inside it did not. */}
      <div key={fresh==null?"still":fresh} style={{position:"absolute",inset:0,animation:fresh==null?undefined:"sv-hex-grow var(--sv-frame) var(--sv-step) 1 both"}}>
      <div style={{position:"absolute",inset:0,clipPath:HEX,background:s.line,opacity:state==="undetected"?.55:1}}></div>
      {hot?<div style={{position:"absolute",inset:0,animation:"sv-hex-grow var(--sv-frame) var(--sv-step) 1 both",pointerEvents:"none",zIndex:3}}>
        <HexRing stroke="var(--sv-rim)" width={3}/>
      </div>:null}
      {step?(
        <div style={{position:"absolute",inset:0,animation:"sv-step-in var(--sv-frame) var(--sv-step) "+((step.n-1)*112)+"ms 1 both",pointerEvents:"none",zIndex:3}}>
          <HexRing stroke="var(--sv-amber)" width={step.last?3.4:2.6} dash={step.last?null:"7 6"}/>
        </div>
      ):null}
      <div style={{position:"absolute",inset:base,clipPath:HEX,background:fill}}></div>
      <div style={{position:"absolute",inset:base,clipPath:HEX,background:"var(--sv-scan)"}}></div>

      {rings.map((r,i)=>{
        const at=base+6+i*7;
        return <React.Fragment key={i}>
          <div style={{position:"absolute",inset:at,clipPath:HEX,background:`repeating-linear-gradient(90deg, ${r.c} 0 ${r.dash[0]}px, transparent ${r.dash[0]}px ${r.dash[0]+r.dash[1]}px)`}}></div>
          <div style={{position:"absolute",inset:at+3,clipPath:HEX,background:fill}}></div>
          <div style={{position:"absolute",inset:at+3,clipPath:HEX,background:"var(--sv-scan)"}}></div>
        </React.Fragment>;
      })}

      <div style={{position:"absolute",inset:base,clipPath:HEX,pointerEvents:"auto",zIndex:6,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
        <div style={{height:20,display:"flex",alignItems:"center",gap:5}}>
          {loot.map((c,i)=><Chip key={i} item={c} size={15} here={here} onAct={onAct}
            onEnter={()=>show(c)} onLeave={()=>setTip(null)}/>)}
        </div>
        {s.band?(
          /* Out from the middle, the way every other border in this system is
             drawn. A band that wiped in from one end would be the only thing
             on the board with a reading direction. */
          <div style={{alignSelf:"stretch",background:s.band,padding:"3px 0",textAlign:"center",transformOrigin:"center",animation:fresh==null?undefined:"sv-draw-x var(--sv-frame) var(--sv-step) 1 both"}}>
            <span ref={labelRef} style={{display:"inline-block",font:"var(--sv-stencil)",fontSize:14,letterSpacing:0,textTransform:"uppercase",color:"var(--sv-knock)",whiteSpace:"nowrap"}}>{fit}</span>
          </div>
        ):<div style={{height:20}}></div>}
        <div style={{height:22,display:"flex",alignItems:"center",gap:5}}>
          {foes.map((c,i)=><Chip key={i} item={c} size={17} here={here} onAct={onAct}
            onEnter={()=>show(c)} onLeave={()=>setTip(null)}/>)}
        </div>
      </div>
      </div>

      {tip?<Readout key={seq} item={tip} here={here}
        style={{position:"absolute",left:size+10,top:"50%",transform:"translateY(-50%)",zIndex:60,pointerEvents:"none"}}/>:null}
    </div>
  );
}

/* A body in transit. Same silhouette as its chip, so the thing that arrives is
   recognisably the thing that left. */
export const MoverMark=React.forwardRef(function MoverMark({kind="scout",size=19,style},ref){
  const k=KIND[kind]||KIND.machine;
  return (
    <div ref={ref} data-face="▪" style={{position:"relative",width:size,height:size,...style}}>
      <div data-fx-face style={{width:"100%",height:"100%",background:k.hostile?"var(--sv-bad)":"var(--sv-amber)",clipPath:k.shape||undefined,display:"flex",alignItems:"center",justifyContent:"center",font:"var(--sv-stencil)",fontSize:14,letterSpacing:0,lineHeight:1,color:"var(--sv-knock)"}}></div>
    </div>
  );
});

/* The drone it WOULD be, at the end of a previewed route. Hollow rather than
   solid so it never reads as where the drone actually is, and struck through
   when the route cannot be walked. */
export function DroneGhost({size=40,blocked=false,style}){
  const c=blocked?"var(--sv-bad)":"var(--sv-amber)";
  return (
    <div style={{position:"relative",width:size,height:Math.round(size*RATIO),...style}}>
      <svg viewBox="0 0 100 115.47" style={{position:"absolute",inset:0,width:"100%",height:"100%",overflow:"visible"}}>
        <polygon points={PTS} fill="var(--sv-knock)" fillOpacity=".72" stroke={c} strokeWidth="3" strokeDasharray={blocked?null:"8 6"} vectorEffect="non-scaling-stroke"></polygon>
        {blocked?<React.Fragment>
          <line x1="22" y1="28" x2="78" y2="88" stroke={c} strokeWidth="3.4" vectorEffect="non-scaling-stroke"></line>
          <line x1="78" y1="28" x2="22" y2="88" stroke={c} strokeWidth="3.4" vectorEffect="non-scaling-stroke"></line>
        </React.Fragment>:null}
      </svg>
      {!blocked?<div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",font:"var(--sv-stencil)",fontSize:14,letterSpacing:0,color:c}}>◆</div>:null}
    </div>
  );
}

/* The drone crowns the hex it is in, so it never competes with the cell's own
   contents for the middle. */
export const DroneMark=React.forwardRef(function DroneMark({size=40,style},ref){
  return (
    <div ref={ref} style={{position:"relative",width:size,height:Math.round(size*RATIO),...style}}>
      <div style={{position:"absolute",inset:0,clipPath:HEX,background:"var(--sv-amber)"}}></div>
      <div data-fx-face style={{position:"absolute",inset:3,clipPath:HEX,background:"var(--sv-knock)",display:"flex",alignItems:"center",justifyContent:"center",font:"var(--sv-stencil)",fontSize:14,letterSpacing:0,color:"var(--sv-amber)"}}>◆</div>
    </div>
  );
})

/* Which door states the drone can simply walk through. Everything else is a
   thing to be done first, not a route. */
const PASSABLE={open:1,airlock:1};

/* A door is the one board object with more than one sensible verb, so it is
   the one that offers a choice — on hover, and only on hover. */
const DOOR={
  open:   {c:"var(--sv-zone)",     bars:0, verbs:[["close","free"],["weld shut","cutter · 2 turns"]]},
  closed: {c:"var(--sv-bulkhead)", bars:1, verbs:[["open","free"],["force","loud"],["weld shut","cutter · 2 turns"]]},
  locked: {c:"var(--sv-amber)",    bars:2, verbs:[["unlock","needs a key"],["force","loud · 1 turn"],["cut open","cutter · 2 turns"]]},
  sealed: {c:"var(--sv-burned)",   bars:3, verbs:[["cut open","cutter · 3 turns"]]},
  airlock:{c:"var(--sv-airlock)",  bars:0, lock:true, verbs:[["cycle","1 turn"],["leave the hull","ends the sortie"]]},

  /* A fifth state, and the odd one: a bulkhead the rival breached is neither
     open nor locked. It is a hole, it stays one for the rest of the run, and
     following it through is the cheapest door in the game. Drawn with the rungs
     struck out rather than absent, so it reads as a door that *was* shut. */
  broken: {c:"var(--sv-rim)",      bars:2, broke:true, verbs:[["walk through","free · it stays open"]]}
};

/* Owns the geometry, the camera and the board's interactions: pointy-top hexes
   on offset rows, corridors centre to centre beneath them, right-drag pan. */
export function HexMap({rooms=[],links=[],drone,size=118,spread=1.3,doorStyle="rungs",hint=true,plan=null,moves=null,onSelect,onHoverRoom,onAct,onDoorAct,onMovesDone,renderHover,style}){
  const [pan,setPan]=React.useState({x:0,y:0});
  const [hover,setHover]=React.useState(null);
  const [door,setDoor]=React.useState(null);
  const [barred,setBarred]=React.useState(null);
  const [moving,setMoving]=React.useState(null);
  const droneRef=React.useRef(null);
  const moveFx=React.useRef(null);
  const movers=React.useRef({});
  const moveKey=(moves||[]).map(m=>(m.id||"")+m.from+">"+m.to).join("|");
  React.useEffect(()=>()=>{ if(moveFx.current) moveFx.current.cancel(); },[]);

  /* Play every reported relocation at once — a watch passes for all of them
     together, so they should not queue up one after another. */
  React.useEffect(()=>{
    if(!moves||!moves.length) return;
    const FX=window.FX||window.DerelictFX;
    if(!FX){ if(onMovesDone) onMovesDone(); return; }
    let left=moves.length, cancelled=false;
    const hs=moves.map((m,i)=>{
      const el=movers.current[m.id||i];
      const to=byId[m.to];
      if(!el||!to){ left--; return null; }
      const c=centre(to);
      return FX.teleport(el,{left:c.x-9,top:c.y-9},{
        faceEl:el.querySelector("[data-fx-face]"),
        label:"",
        onDone:()=>{ if(!cancelled&&--left<=0&&onMovesDone) onMovesDone(); }
      });
    }).filter(Boolean);
    if(!left&&onMovesDone) onMovesDone();
    return ()=>{ cancelled=true; hs.forEach(x=>x&&x.cancel()); };
  },[moveKey]);
  const [dseq,setDseq]=React.useState(0);
  const hoverTimer=React.useRef(null);
  const holdHover=()=>{ if(hoverTimer.current){ clearTimeout(hoverTimer.current); hoverTimer.current=null; } };
  const dropHover=()=>{ holdHover(); hoverTimer.current=setTimeout(()=>{ setHover(null); setBarred(null); if(onHoverRoom)onHoverRoom(null); },450); };
  const doorTimer=React.useRef(null);
  const holdDoor=()=>{ if(doorTimer.current){ clearTimeout(doorTimer.current); doorTimer.current=null; } };
  const openDoor=(i)=>{ holdDoor(); setDoor(i); setDseq(n=>n+1); };
  /* A menu offset clear of its door leaves a gap the pointer must cross, and
     leaving the door was closing the menu before the pointer arrived. Two
     frames of grace: long enough to cross, short enough never to feel stuck. */
  const dropDoor=()=>{ holdDoor(); doorTimer.current=setTimeout(()=>setDoor(null),450); };
  React.useEffect(()=>()=>{ holdDoor(); holdHover(); },[]);
  const drag=React.useRef(null);

  const W=size*spread, H=size*RATIO*spread, ROW=H*0.75;
  const centre=(r)=>({x:(r.q+(r.r%2?0.5:0))*W+W/2, y:r.r*ROW+H/2});
  const byId={}; rooms.forEach(r=>{byId[r.id]=r;});
  const maxQ=Math.max(0,...rooms.map(r=>r.q)), maxR=Math.max(0,...rooms.map(r=>r.r));
  const bw=(maxQ+1.5)*W+W/2, bh=maxR*ROW+H;
  const hexH=Math.round(size*RATIO);
  const here=drone?byId[drone]:null;

  /* The walk from the drone to a room, and whether it can actually be walked.
     Only an open door or a cycled airlock is a route — a closed, locked or
     sealed one has to be dealt with first — so the preview is planned twice:
     over passable doors, and, when that fails, over every door, so it can say
     which door is in the way rather than just refusing. */
  const walk=React.useMemo(()=>{
    if(plan) return {path:plan,blocked:null};
    if(!hover||!drone||hover===drone) return null;
    const search=(passableOnly)=>{
      const adj={};
      links.forEach(l=>{
        if(passableOnly&&!PASSABLE[l.state||"closed"]) return;
        (adj[l.a]=adj[l.a]||[]).push(l.b);
        (adj[l.b]=adj[l.b]||[]).push(l.a);
      });
      const prev={}, seen={[drone]:1}, q=[drone];
      while(q.length){
        const at=q.shift();
        if(at===hover) break;
        (adj[at]||[]).forEach(n=>{ if(seen[n])return; seen[n]=1; prev[n]=at; q.push(n); });
      }
      if(!seen[hover]) return null;
      const out=[]; let at=hover;
      while(at!==drone){ out.unshift(at); at=prev[at]; if(!at) return null; }
      return out;
    };
    const clear=search(true);
    if(clear) return {path:clear,blocked:null};
    const any=search(false);
    if(!any) return null;
    /* The first shut door along the way is the one to point at. */
    const full=[drone,...any];
    let blocked=null;
    for(let i=0;i<full.length-1&&blocked===null;i++){
      const n=links.findIndex(l=>(l.a===full[i]&&l.b===full[i+1])||(l.b===full[i]&&l.a===full[i+1]));
      if(n>=0&&!PASSABLE[links[n].state||"closed"]) blocked=n;
    }
    return {path:any,blocked};
  },[plan,hover,drone,links]);

  const route=walk?walk.path:null;
  const blockedDoor=walk?walk.blocked:null;

  /* Where a board point lands once the pan is applied. */
  const at=(x,y)=>({left:"calc(50% + "+(pan.x+x-bw/2)+"px)",top:"calc(50% + "+(pan.y+y-bh/2)+"px)"});

  /* Move the drone along a cleared route, one teleport per compartment: it
     dissolves out of each room and reassembles in the next, so a three-room
     move reads as three hops and the path is still legible. The pip is placed
     imperatively while it plays so React is not fighting the animation; the
     parent commits the new position when it lands. */
  const hop=(el,ids,i,onEnd)=>{
    const FX=window.FX||window.DerelictFX;
    const c=centre(byId[ids[i]]);
    return FX.teleport(el,{left:c.x-20,top:c.y-hexH/2-24},{
      faceEl:el.querySelector("[data-fx-face]"),
      label:el.dataset.face||"◆",
      onDone:()=>{
        if(i+1<ids.length){ moveFx.current=hop(el,ids,i+1,onEnd); return; }
        onEnd();
      }
    });
  };

  const move=(path)=>{
    const FX=typeof window!=="undefined"?(window.FX||window.DerelictFX):null;
    const el=droneRef.current;
    const dest=path[path.length-1];
    if(!FX||!el){ if(onSelect) onSelect(dest); return; }
    if(moveFx.current) moveFx.current.cancel();
    setMoving(path);
    moveFx.current=hop(el,path,0,()=>{
      setMoving(null);
      if(onSelect) onSelect(dest);
    });
  };

  /* What clicking a given room would do. The single source for the verb shown
     and the action taken. */
  const intentFor=(id)=>{
    if(id===drone) return "here";
    if(hover!==id) return null;
    if(blockedDoor!=null) return "blocked";
    if(route&&route.length) return "move";
    return "none";
  };

  const step=(id)=>route?route.indexOf(id):-1;
  const onRoute=(a,b)=>{
    if(!route) return -1;
    const walk=[drone,...route];
    for(let i=0;i<walk.length-1;i++){
      if((walk[i]===a&&walk[i+1]===b)||(walk[i]===b&&walk[i+1]===a)) return i;
    }
    return -1;
  };

  const onDown=(e)=>{ if(e.button!==2)return; drag.current={x:e.clientX,y:e.clientY,px:pan.x,py:pan.y}; e.currentTarget.setPointerCapture(e.pointerId); };
  const onMove=(e)=>{ const d=drag.current; if(!d)return; setPan({x:d.px+(e.clientX-d.x),y:d.py+(e.clientY-d.y)}); };
  const onUp=(e)=>{ drag.current=null; try{e.currentTarget.releasePointerCapture(e.pointerId);}catch(err){} };

  return (
    <div onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
      onContextMenu={(e)=>e.preventDefault()} onDoubleClick={()=>setPan({x:0,y:0})}
      style={{position:"relative",width:"100%",height:"100%",overflow:"hidden",touchAction:"none",...style}}>

      <div style={{position:"absolute",left:"50%",top:"50%",width:bw,height:bh,transform:`translate(-50%,-50%) translate(${pan.x}px,${pan.y}px)`}}>
        {links.map((l,i)=>{
          const a=byId[l.a], b=byId[l.b]; if(!a||!b) return null;
          const p=centre(a), q=centre(b);
          const len=Math.hypot(q.x-p.x,q.y-p.y), ang=Math.atan2(q.y-p.y,q.x-p.x)*180/Math.PI;
          const d=DOOR[l.state]||DOOR.closed;
          const mid={x:(p.x+q.x)/2,y:(p.y+q.y)/2};
          const ux=(q.x-p.x)/len, uy=(q.y-p.y)/len;
          const reach=l.a===drone||l.b===drone;
          return (
            <React.Fragment key={i}>
              <div onMouseEnter={()=>openDoor(i)} onMouseLeave={dropDoor}
                style={{position:"absolute",left:p.x,top:p.y-9,width:len,height:18,transform:`rotate(${ang}deg)`,transformOrigin:"0 50%",zIndex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:4,cursor:"help"}}>
                <div style={{position:"absolute",left:0,right:0,top:"50%",height:11,transform:"translateY(-50%)",background:"var(--sv-deck)"}}></div>
                <div style={{position:"absolute",left:0,right:0,top:"50%",height:2,transform:"translateY(-50%)",background:d.c,opacity:d.bars?.7:.9}}></div>
                {(()=>{const n=onRoute(l.a,l.b); if(n<0) return null;
                  const shut=blockedDoor===i, c=shut?"var(--sv-bad)":"var(--sv-amber)";
                  return (
                  <div style={{position:"absolute",left:0,right:0,top:"50%",height:12,transform:"translateY(-50%)",animation:"sv-step-in var(--sv-frame) var(--sv-step) "+(n*112)+"ms 1 both"}}>
                    <div style={{position:"absolute",left:0,right:0,top:0,height:2,background:c}}></div>
                    <div style={{position:"absolute",left:0,right:0,bottom:0,height:2,background:c}}></div>
                  </div>
                );})()}
                {Array.from({length:d.bars}).map((_,n)=>(
                  /* Broken keeps its rungs and cuts them through the middle: a
                     door that was shut and is not any more reads as history,
                     which is what it is — somebody opened it and it stayed. */
                  <div key={n} style={{position:"relative",width:3,height:17,background:d.c,
                    clipPath:d.broke?"polygon(0 0,100% 0,100% 34%,0 34%,0 66%,100% 66%,100% 100%,0 100%)":undefined}}></div>
                ))}
                {d.lock?<div style={{position:"relative",width:11,height:11,background:d.c,clipPath:"polygon(25% 0,75% 0,100% 50%,75% 100%,25% 100%,0 50%)"}}></div>:null}
              </div>

              {blockedDoor===i||barred===i?(
                <div style={{position:"absolute",left:mid.x,top:mid.y,transform:"translate(-50%,-50%) rotate(45deg)",width:25,height:25,border:"2.5px solid var(--sv-bad)",boxSizing:"border-box",zIndex:9,pointerEvents:"none",animation:"sv-flick var(--sv-frame-2) var(--sv-step) infinite"}}></div>
              ):null}

              {doorStyle==="stencil"&&l.label&&door!==i?(
                <div style={{position:"absolute",left:mid.x-uy*15,top:mid.y+ux*15,transform:"translate(-50%,-50%)",zIndex:3,font:"var(--sv-stencil)",fontSize:14,letterSpacing:".14em",color:d.c,pointerEvents:"none",whiteSpace:"nowrap"}}>{l.label}</div>
              ):null}

            </React.Fragment>
          );
        })}

        {rooms.map((r)=>{
          const c=centre(r);
          const n=step(r.id);
          return <HexTile key={r.id} {...r} size={size} hot={hover===r.id}
            step={n<0?null:{n:n+1,last:n===route.length-1}}
            onMouseEnter={()=>{ if(moving)return; holdHover(); setHover(r.id); if(onHoverRoom)onHoverRoom(r.id);}}
            onMouseLeave={()=>{ if(moving)return; dropHover(); }}
            onAct={onAct?(verb,item)=>onAct(r,verb,item):undefined}
            onClick={()=>{
              const intent=intentFor(r.id);
              if(intent==="blocked"){ setBarred(blockedDoor); return; }
              setBarred(null);
              if(intent==="move"){ move(route); return; }
              if(onSelect) onSelect(r.id);
            }}
            style={{position:"absolute",left:c.x-size/2,top:c.y-hexH/2,zIndex:r.state==="current"?5:4}}/>;
        })}
      </div>

      {/* The drone, outside the panned wrapper so pinned chrome cannot cover
          it. Positioned with left/top rather than a transform so board pixels
          stay board pixels for the movement animation. */}
      <div style={{position:"absolute",left:"calc(50% + "+(pan.x-bw/2)+"px)",top:"calc(50% + "+(pan.y-bh/2)+"px)",width:bw,height:bh,zIndex:65,pointerEvents:"none"}}>
        {route&&route.length&&!moving?(()=>{
          const end=byId[route[route.length-1]]; if(!end) return null;
          const c=centre(end);
          const blocked=blockedDoor!=null;
          return <DroneGhost key="ghost" blocked={blocked}
            style={{position:"absolute",left:c.x-20,top:blocked?c.y-Math.round(20*RATIO):c.y-hexH/2-24,animation:"sv-step-in var(--sv-frame) var(--sv-step) "+(route.length*112)+"ms 1 both"}}/>;
        })():null}

        {here?(()=>{const c=centre(here);return <DroneMark key="drone" ref={droneRef}
          style={{position:"absolute",left:c.x-20,top:c.y-hexH/2-24}}/>;})():null}

        {(moves||[]).map((m,i)=>{
          const from=byId[m.from]; if(!from) return null;
          const c=centre(from);
          return <MoverMark key={m.id||i} kind={m.kind}
            ref={(el)=>{ movers.current[m.id||i]=el; }}
            style={{position:"absolute",left:c.x-9,top:c.y-9}}/>;
        })}
      </div>

      {/* Live readouts, outside the panned wrapper so pinned chrome cannot
          cover them. Positioned in board space, offset by the pan. */}
      {renderHover&&hover&&byId[hover]?(()=>{
        const r=byId[hover], c=centre(r), p=at(c.x+size/2+12,c.y-hexH/2);
        const flip=pan.x+c.x+size/2+12+250>bw;
        const intent=intentFor(r.id);
        return <div onMouseEnter={holdHover} onMouseLeave={dropHover}
          onClick={()=>{
            if(intent==="blocked"){ setBarred(blockedDoor); return; }
            if(intent==="move"){ move(route); return; }
            if(onSelect) onSelect(r.id);
          }}
          style={{position:"absolute",...(flip?at(c.x-size/2-12,c.y-hexH/2):p),transform:flip?"translateX(-100%)":"none",zIndex:70,minWidth:220,cursor:intent==="move"?"pointer":"default"}}>
          {renderHover(r,{intent,path:route,blocked:blockedDoor!=null?links[blockedDoor]:null,steps:route?route.length:0})}
        </div>;
      })():null}

      {door!=null&&links[door]?(()=>{
        const l=links[door], a=byId[l.a], b=byId[l.b];
        if(!a||!b) return null;
        const p=centre(a), q=centre(b), d=DOOR[l.state]||DOOR.closed;
        const reach=l.a===drone||l.b===drone;
        /* Offset along the corridor's own perpendicular, so the menu clears the
           door it describes whichever way that corridor runs. */
        const len=Math.hypot(q.x-p.x,q.y-p.y)||1;
        const nx=-(q.y-p.y)/len, ny=(q.x-p.x)/len;
        const gap=26, mx=(p.x+q.x)/2, my=(p.y+q.y)/2;
        const sideways=Math.abs(nx)>=Math.abs(ny);
        const dx=sideways?(nx>=0?gap:-gap):0, dy=sideways?0:(ny>=0?gap:-gap);
        const anchor=sideways
          ? (nx>=0?"translate(0,-50%)":"translate(-100%,-50%)")
          : (ny>=0?"translate(-50%,0)":"translate(-50%,-100%)");
        return (
          <Popover key={dseq} tone={d.c}
            style={{position:"absolute",...at(mx+dx,my+dy),transform:anchor,zIndex:70,minWidth:200}}>
            <div onMouseEnter={holdDoor} onMouseLeave={dropDoor}>
              <div style={{display:"flex",alignItems:"center",gap:9,padding:"4px 9px",background:d.c}}>
                <span data-sc style={{font:"var(--sv-stencil)",fontSize:14,letterSpacing:".14em",textTransform:"uppercase",color:"var(--sv-knock)"}}>{l.label||"door"}</span>
                <span data-sc style={{marginLeft:"auto",font:"var(--sv-stencil)",fontSize:14,letterSpacing:".14em",textTransform:"uppercase",color:"var(--sv-knock)",opacity:.8}}>{l.state}</span>
              </div>
              <div style={{background:"var(--sv-scan)"}}>
                {d.verbs.map(([v,cost],n)=>(
                  <div key={n} onClick={reach&&onDoorAct?(e)=>{e.stopPropagation();onDoorAct(l,v);}:undefined}
                    style={{display:"flex",alignItems:"center",gap:10,padding:"4px 9px",cursor:reach?"pointer":"not-allowed",opacity:reach?1:.55}}
                    onMouseEnter={(e)=>{if(reach)e.currentTarget.style.background="color-mix(in oklab, var(--sv-amber) 16%, transparent)";}}
                    onMouseLeave={(e)=>{e.currentTarget.style.background="transparent";}}>
                    <span data-sc style={{font:"var(--sv-body)",color:"var(--sv-ink)"}}>{v}</span>
                    <span data-sc style={{marginLeft:"auto",font:"var(--sv-stencil)",fontSize:14,letterSpacing:".1em",textTransform:"uppercase",color:"var(--sv-soft)"}}>{cost}</span>
                  </div>
                ))}
                {!reach?<div data-sc style={{padding:"4px 9px",font:"var(--sv-stencil)",fontSize:14,letterSpacing:".12em",textTransform:"uppercase",color:"var(--sv-soft)",borderTop:"1px solid var(--sv-line)"}}>not from here</div>:null}
              </div>
            </div>
          </Popover>
        );
      })():null}

      {hint?<div style={{position:"absolute",right:12,bottom:10,font:"var(--sv-stencil)",fontSize:14,letterSpacing:".14em",textTransform:"uppercase",color:"var(--sv-soft)",pointerEvents:"none"}}>right-drag to pan · hover a room for the route</div>:null}
    </div>
  );
}

/* The same shape the board uses, for panels that list what is in a room. */
export function ContentIcon({kind,size=15,style}){
  const k=KIND[kind]||KIND.machine;
  return <div style={{width:size,height:size,flex:"none",background:k.hostile?"var(--sv-bad)":"var(--sv-amber)",clipPath:k.shape||undefined,...style}}></div>;
}

/* One row of a compartment's manifest: the same object as on the board, with
   the same verb on the same click. The panel and the cell are two views of one
   set of things, which is why neither needs a list of actions. */
export function ObjectRow({item,here=true,onAct,style}){
  const k=KIND[item.kind]||KIND.machine;
  const [hot,setHot]=React.useState(false);
  const verb=here?k.at:k.near;
  return (
    <div onMouseEnter={()=>setHot(true)} onMouseLeave={()=>setHot(false)}
      onClick={verb&&onAct?()=>onAct(verb,item):undefined}
      style={{position:"relative",display:"flex",alignItems:"center",gap:9,padding:"4px 8px",cursor:verb&&onAct?"pointer":"help",background:hot?"color-mix(in oklab, var(--sv-amber) 12%, transparent)":"transparent",...style}}>
      <ContentIcon kind={item.kind} size={15}/>
      <div style={{font:"var(--sv-body)",color:"var(--sv-ink)"}}>{(item.name||k.name)+(item.n>1?" ×"+item.n:"")}</div>
      {hot?(
        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:9}}>
          <span style={{font:"var(--sv-stencil)",fontSize:14,letterSpacing:".1em",textTransform:"uppercase",color:"var(--sv-soft)"}}>{k.note}</span>
          {verb?<span style={{font:"var(--sv-stencil)",fontSize:14,letterSpacing:".14em",textTransform:"uppercase",background:k.hostile?"var(--sv-bad)":"var(--sv-amber)",color:"var(--sv-knock)",padding:"2px 6px"}}>{verb}</span>
               :<span style={{font:"var(--sv-stencil)",fontSize:14,letterSpacing:".14em",textTransform:"uppercase",color:"var(--sv-soft)"}}>go there first</span>}
        </div>
      ):k.hostile?(
        <div style={{marginLeft:"auto",display:"flex",gap:3}}>
          {[0,1,2].map(n=><span key={n} style={{width:7,height:12,background:n<(item.threat||1)?"var(--sv-bad)":"var(--sv-plate-lit)"}}></span>)}
        </div>
      ):null}
    </div>
  );
}
