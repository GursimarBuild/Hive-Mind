/* HIVE MIND — plain JS + canvas, no build step.
   File map (search for the banner comments):
     TUNABLES ........ speeds, egg timer, raid sizes, attacks
     BEES / ENEMIES .. type tables and art
     SOUND ........... music, sound-effect slices, synth score
     WORLD ........... resize, setup, HUD, messages
     RAIDS ........... days, spawning, the builders
     BEES AT WORK .... hatching, orders, farming, stinging, fanning
     DRAWING ......... everything painted on the canvas
     TRAINING ........ tutorial 1 (ants), tutorial 2 (gas bees), new-threat cards
     ENDING .......... the hive falls, the years jump forward, How to Help
     INPUT ........... mouse, keyboard
     OPENING ......... title screen and opening cutscene */
const canvas=document.querySelector('#game'),ctx=canvas.getContext('2d'),$=s=>document.querySelector(s);
let w,h,dpr,last=0,ambientTime=0,gameElapsed=0,hiveHitFlash=0,playing=false,ended=false,paused=false,selection=[],pings=[],floaters=[],drag=null,hoverBee=null,hoverEnemy=null,raidEnd=0,health=100,wave=0,spawnLeft=0,spawnClock=0,nextWave=2,bees=[],enemies=[],particles=[],flowerGroves=[],scoutMarkers=[],fogFullyRevealed=false,eggs=[],eggCounter=0,eggTimer=0,eggAge=0,hatchBusy=false,hatchBusyAt=0,worldId=0,exploredAreas=[],outerRing=1,tutorial=null,puffs=[],interlude=null,mouse=null,beeSeq=0,collapse=null;
/* Session flags: whether the player asked for training, which threat cards they have seen, and whether the gas lesson is done. */
let wantTraining=true,trained=false,lessonDone=false,introSeen={};

/* ================= TUNABLES ================= */
const BEE_SPEED=1.6;                 // one knob for how fast every bee flies (1 = the alpha speed)
const MAP_ZOOM=.78;                  // how close the camera is: below 1 pulls back so the meadow is bigger than the screen at 1:1
const EGG_TIME=26,EGG_MIN=8;         // seconds per egg, and the fastest an egg can ever come
const EGG_FOOD_BONUS=.75,EGG_MAX=4;  // seconds each food takes off the timer; the timer pauses at this many eggs
const RAID_BASE=4,RAID_GROWTH=1.5;   // raiders on day 1, and how much bigger each day's raid is
const RAID_WARNING=10,FIRST_RAID_IN=22,NEXT_RAID_IN=15;  // seconds of calm before the first raid, and before each later one
const STING={reach:30,time:.36};     // soldier attack: how close it must be, and how long one lunge takes
const GAS_FAN={range:82,dps:27,push:16}; // gas bee attack: fan reach, cloud damage per second, how fast the cloud is blown back
const HUMAN_DAY=5;                   // the first day a builder paves a grove
/* The day each threat is introduced, and the mix of raiders on each day (weights). After the last entry the game is endless. */
const DAY_INTRO={2:'hornet',3:'cloud',4:'bear',5:'human'};
const RAID_MIX=[null,{ant:1},{ant:.55,hornet:.45},{ant:.4,hornet:.25,cloud:.35},{ant:.35,hornet:.2,cloud:.2,bear:.25},{ant:.3,hornet:.25,cloud:.22,bear:.23}];

/* ================= BEES / ENEMIES =================+++++++ */
/* Each bee's ring colour matches its hat: soldier = green helmet, gas bee = orange hard hat, farmer = blue flower hat.
   key = the hotkey that hatches it, selectKey = the hotkey that selects every bee of that type. */
const BEE_TYPES={
soldier:{hp:50,speed:72,aggro:150,cool:.75,dmg:14,color:'#1f9d55',scale:1.1,bob:3,bobRate:3.2,name:'SOLDIER',role:'stings ants, hornets and bears',key:'1',selectKey:'Q'},
gas:{hp:30,speed:74,aggro:190,color:'#f08a1c',scale:1,bob:4.5,bobRate:2.1,name:'GAS BEE',role:'fans pesticide away',key:'2',selectKey:'W'},
farmer:{hp:22,speed:115,color:'#2f9fd0',scale:.88,bob:2,bobRate:8,name:'FARMER',role:'scouts and carries food',key:'3',selectKey:'E'}};
/* Every enemy wears the ring colour of the bee that beats it (counter). beeDmg / reach / every = its attack on bees. */
const ENEMY_INFO={
ant:{name:'ANT',counter:'soldier',tip:'soldiers sting it',hp:22,speed:30,damage:7,size:34},
hornet:{name:'HORNET',counter:'soldier',tip:'soldiers sting it',hp:50,speed:44,damage:7,beeDmg:6,reach:30,every:1,size:62},
cloud:{name:'PESTICIDE',counter:'gas',tip:'only gas bees clear it',hp:40,speed:13,damage:12,size:84},
bear:{name:'BEAR',counter:'soldier',tip:'needs several soldiers',hp:80,speed:15,damage:14,beeDmg:6,reach:50,every:1.3,size:105},  // drawn 1.7x as big as a hornet
human:{name:'BUILDER',counter:null,tip:'no bee can stop it',hp:1,speed:44,damage:0,size:104}};
const NO_COUNTER='#8d8a80';
function art(file){let i=new Image();i.src='assets/'+file;return i}
const ready=i=>!!(i&&i.complete&&i.naturalWidth);
const beeArt={soldier:art('bee-soldier-sprite.png'),farmer:art('bee-farmer-sprite.png'),gas:art('bee-gas-sprite.png')};
/* Optional art: if a file is missing the game draws a placeholder instead, so new drawings can simply be dropped into assets/.
   Attack frames must be exported on the same canvas size and position as the matching bee-*-sprite.png. */
const attackArt={soldier:[1,2,3].map(n=>art(`bee-soldier-attack-${n}.png`)),gas:[1,2].map(n=>art(`bee-gas-fan-${n}.png`))};
/* ant = two walking frames, drawn facing up. hornet = [attack frame (stretched, mandibles out), flying frame]. */
const enemyArt={ant:[art('enemy-ant-1.png'),art('enemy-ant-2.png')],hornet:[art('enemy-hornet-1.webp'),art('enemy-hornet-2.webp')],human:art('enemy-human.webp')};
const introBeeArt=[1,2,3,4,5,6].map(n=>art(`intro-bee-${n}.webp`));  // the new-enemy cutscene: pull back from a bee, then the threat appears behind it
const gardenArt=art('hive-mind-background.webp'),bearArt=art('bear-enemy.gif'),pesticideArt=art('pesticide-cloud.png'),fogArt=art('hive-mind-fog.webp'),hiveArt=art('player-hive.png'),flowerArt=art('hive-mind-flower.webp'),foliageArt=art('hive-mind-foliage.webp');fogArt.onload=()=>{if(w)paintFogTexture()};gardenArt.onload=foliageArt.onload=()=>{if(w)paintLayers()};

/* ================= SOUND ================= */
/* To add a sound: drop the mp3 into assets/audio/, then set src (file name without .mp3), start / end (seconds inside the file), vol and gap (shortest time between two plays).
   SFX_COPIES is the most copies of one file that may play at once, so a big raid cannot stack into noise.
   ant, hornet and worker are hooks for sounds still to come: until assets/audio/ant-sfx.mp3, hornet-sfx.mp3 and worker-sfx.mp3 exist, a quiet synth stand-in plays instead. */
const SFX={shot:{src:'damage-sfx',start:0,end:.22,vol:.28,gap:.09},gas:{src:'damage-sfx',start:1.32,end:2.04,vol:.5,gap:.45},bear:{src:'damage-sfx',start:3.12,end:3.72,vol:.6,gap:.3},hive:{src:'hive-damaged',start:0,end:1.13,vol:.75,gap:.35},clear:{src:'level-complete',start:0,end:2.72,vol:.65,gap:1.5},
ant:{src:'ant-sfx',start:0,end:.5,vol:.5,gap:.25,standIn:'ant'},hornet:{src:'hornet-sfx',start:0,end:.7,vol:.5,gap:.3,standIn:'hornet'},worker:{src:'worker-sfx',start:0,end:2.5,vol:.55,gap:1.5,standIn:'worker'}},SFX_COPIES={'damage-sfx':6,'ant-sfx':3,'hornet-sfx':3,'worker-sfx':1},SFX_DEFAULT_COPIES=2,sfxMissing={},MUSIC_VOLUME=.38,music=new Audio('assets/audio/meadow-theme.mp3'),sfxPools={},sfxLast={};let muted=false;try{muted=localStorage.getItem('hiveMuted')==='1'}catch(e){}music.loop=true;music.preload='auto';music.volume=MUSIC_VOLUME;music.preservesPitch=music.mozPreservesPitch=music.webkitPreservesPitch=false;for(const src of new Set(Object.values(SFX).map(s=>s.src)))sfxPools[src]=Array.from({length:SFX_COPIES[src]||SFX_DEFAULT_COPIES},()=>{let a=new Audio(`assets/audio/${src}.mp3`);a.preload='auto';a.onerror=()=>{sfxMissing[src]=true};return a});function sfx(name){if(muted)return;let s=SFX[name],now=performance.now()/1000;if(sfxMissing[s.src]){if(s.standIn)beeSfx(s.standIn);return}if(now-(sfxLast[name]||0)<s.gap)return;let el=sfxPools[s.src].find(a=>a.paused);if(!el)return;sfxLast[name]=now;clearTimeout(el.stopTimer);el.volume=Math.min(1,s.vol*(.85+Math.random()*.3));el.currentTime=s.start;el.play().catch(()=>{});el.stopTimer=setTimeout(()=>el.pause(),(s.end-s.start)*1000+40)}function playMusic(volume=MUSIC_VOLUME){audioCtx();cue(null,1.5);music.playbackRate=1;if(music.paused)music.volume=0;meadowTo(volume,1.4)}function setMuted(on){muted=on;try{localStorage.setItem('hiveMuted',on?'1':'0')}catch(e){}$('#soundToggle').classList.toggle('muted',on);$('#soundToggle').setAttribute('aria-label',on?'Turn sound on':'Mute sound');if(SCORE.master)SCORE.master.gain.value=on?0:.6;if(on){music.pause();Object.values(sfxPools).flat().forEach(a=>a.pause())}else if(playing||cinema||$('#result').classList.contains('show'))music.play().catch(()=>{})}
/* Synth score: cinematic cues for the cutscenes, plus warning, raid and night cues in game, built with Web Audio so the music can follow the action. */
const SCORE={ctx:null,master:null,verb:null,noise:null,cue:null,next:0,beat:0,level:1,timer:0},NOTE=n=>440*Math.pow(2,(n-69)/12);
function audioCtx(){if(SCORE.ctx){if(SCORE.ctx.state==='suspended')SCORE.ctx.resume().catch(()=>{});return SCORE.ctx}let AC=window.AudioContext||window.webkitAudioContext;if(!AC)return null;let c;try{c=new AC()}catch(e){return null}SCORE.ctx=c;let m=SCORE.master=c.createGain();m.gain.value=muted?0:.6;let comp=c.createDynamicsCompressor();comp.threshold.value=-14;comp.ratio.value=3;m.connect(comp);comp.connect(c.destination);let len=Math.floor(c.sampleRate*3.4),ir=c.createBuffer(2,len,c.sampleRate);for(let ch=0;ch<2;ch++){let d=ir.getChannelData(ch);for(let i=0;i<len;i++)d[i]=(Math.random()*2-1)*Math.pow(1-i/len,2.8)}let v=SCORE.verb=c.createConvolver();v.buffer=ir;v.connect(m);let nb=SCORE.noise=c.createBuffer(1,c.sampleRate*2,c.sampleRate),nd=nb.getChannelData(0);for(let i=0;i<nd.length;i++)nd[i]=Math.random()*2-1;SCORE.timer=setInterval(scoreTick,30);if(c.state==='suspended')c.resume().catch(()=>{});return c}
function env(g,t,vol,a,dur){g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(vol,t+a);g.gain.setTargetAtTime(0,t+a,Math.max(.02,dur/4))}
function osc(out,{type='sine',f,t,dur,vol=.2,a=.01,cut=0,q=.8,to=0,det=0,send=.3,hold=0}){let c=SCORE.ctx,o=c.createOscillator(),g=c.createGain(),node=o;o.type=type;o.frequency.setValueAtTime(f,t);if(to)o.frequency.exponentialRampToValueAtTime(to,t+dur);o.detune.value=det;if(cut){let fl=c.createBiquadFilter();fl.type='lowpass';fl.frequency.value=cut;fl.Q.value=q;o.connect(fl);node=fl}node.connect(g);if(hold){g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(vol,t+a);g.gain.setValueAtTime(vol,t+Math.max(a,dur-hold));g.gain.linearRampToValueAtTime(0,t+dur)}else env(g,t,vol,a,dur);g.connect(out);if(send){let s=c.createGain();s.gain.value=send;g.connect(s);s.connect(SCORE.verb)}o.start(t);o.stop(t+dur+.1);o.onended=()=>{g.disconnect()};return o}
function noiseHit(out,{t,dur=.4,vol=.2,type='lowpass',f=800,to=0,q=.7,a=.005,send=.2}){let c=SCORE.ctx,s=c.createBufferSource(),fl=c.createBiquadFilter(),g=c.createGain();s.buffer=SCORE.noise;s.loop=true;fl.type=type;fl.frequency.setValueAtTime(f,t);if(to)fl.frequency.exponentialRampToValueAtTime(to,t+dur);fl.Q.value=q;s.connect(fl);fl.connect(g);if(a>dur/3){g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(vol,t+a);g.gain.linearRampToValueAtTime(0,t+dur)}else env(g,t,vol,a,dur);g.connect(out);if(send){let x=c.createGain();x.gain.value=send;g.connect(x);x.connect(SCORE.verb)}s.start(t,Math.random());s.stop(t+dur+.1);s.onended=()=>g.disconnect()}
/* Instruments. */
const pad=(o,notes,t,dur,vol=.05,cut=900)=>notes.forEach(n=>{osc(o,{type:'sawtooth',f:NOTE(n),t,dur,vol,a:dur*.35,hold:dur*.4,cut,det:-7,send:.5});osc(o,{type:'sawtooth',f:NOTE(n),t,dur,vol,a:dur*.35,hold:dur*.4,cut,det:7,send:.5})});
const keys=(o,n,t,vol=.12,dur=2.4)=>{osc(o,{type:'triangle',f:NOTE(n),t,dur,vol,a:.006,send:.45});osc(o,{type:'sine',f:NOTE(n+12),t,dur:dur*.5,vol:vol*.3,a:.004,send:.45})};
const drum=(o,t,vol=.5,f=95)=>{osc(o,{f,to:f*.45,t,dur:.42,vol,a:.004,send:.25});noiseHit(o,{t,dur:.09,vol:vol*.18,type:'bandpass',f:1400,q:1})};
const beatThump=(o,t,vol=.4)=>{drum(o,t,vol,62);drum(o,t+.2,vol*.7,58)};
const trem=(o,notes,t,dur,vol=.035,rate=7.5)=>{let c=SCORE.ctx,g=c.createGain(),l=c.createOscillator(),d=c.createGain();g.gain.value=.55;l.frequency.value=rate;d.gain.value=.45;l.connect(d);d.connect(g.gain);g.connect(o);l.start(t);l.stop(t+dur+.1);l.onended=()=>g.disconnect();notes.forEach(n=>osc(g,{type:'sawtooth',f:NOTE(n),t,dur,vol,a:.08,hold:.15,cut:1700,send:.4}))};
const chirp=(o,t)=>{let f=2400+Math.random()*900,n=2+(Math.random()*2|0);for(let k=0;k<n;k++)osc(o,{f,to:f*1.3,t:t+k*.11,dur:.07,vol:.018,a:.005,send:.5})};
const bass=(o,n,t,dur=.4,vol=.14)=>osc(o,{type:'sawtooth',f:NOTE(n),t,dur,vol,a:.01,cut:380,q:3,send:.1});
/* Cues: chords are [bass, ...voicing] in MIDI notes; beat() runs once per beat. */
const CH={Am:[45,57,60,64],F:[41,57,60,65],C:[48,55,60,64],G:[43,55,59,62],E:[40,56,59,64],Dm:[50,57,62,65],Fmaj7:[41,57,60,64],Bb:[46,58,62,65]};
const CUES={
bloom:{bpm:76,vol:1.7,beat(i,t,o){let p=['Fmaj7','C','Am','G'],ch=CH[p[(i>>2)%4]],sec=60/76;if(i%4===0){pad(o,ch.slice(1),t,sec*4.2,.032,1100);bass(o,ch[0],t,sec*3.5,.06)}keys(o,ch[1+i%3]+12,t,.07);if(i%2)keys(o,ch[1+(i+1)%3]+24,t+sec*.5,.035)}},
order:{bpm:60,vol:1,beat(i,t,o){let p=['Am','Am','F','E'],ch=CH[p[(i>>2)%4]];if(i%4===0){pad(o,[ch[1]-12,ch[1],ch[2]],t,4.3,.04,600);bass(o,ch[0]-12,t,3.8,.1)}beatThump(o,t,.32+.04*(i%4===0));if(i%4===2)keys(o,[69,67,65,64][(i>>2)%4],t,.06,3)}},
felling:{bpm:100,vol:1,beat(i,t,o){let p=['Am','F','Dm','E'],ch=CH[p[(i>>2)%4]],e=60/100/2;if(i%4===0)trem(o,ch.slice(1),t,60/100*4,.03);for(let k=0;k<2;k++)bass(o,ch[0]-12+(k&&i%2?7:0),t+k*e,.22,.12);drum(o,t,i%4===0?.62:i%2?.3:.42,i%4===0?88:110);if(i%4===3)drum(o,t+e,.35,120)}},
fall:{bpm:112,vol:1,beat(i,t,o){let p=['E','E','F','E'],ch=CH[p[(i>>2)%4]],e=60/112/2;if(i%4===0){trem(o,ch.slice(1).map(n=>n+12),t,60/112*4,.03,9);pad(o,[ch[0]],t,60/112*4,.05,500)}for(let k=0;k<2;k++)bass(o,ch[0]-12,t+k*e,.18,.13);drum(o,t,.6,i%2?100:80);drum(o,t+e,.28,130);if(i%8===7)noiseHit(o,{t,dur:60/112,vol:.07,type:'bandpass',f:400,to:5000,a:60/112*.8})}},
escape:{bpm:64,vol:1.6,beat(i,t,o){let p=['F','C','Am','G'],ch=CH[p[(i>>2)%4]],m=[72,null,71,69,67,null,64,null,69,null,67,65,67,null,null,null][i%16];if(i%4===0){pad(o,ch.slice(1),t,4.2,.034,850);bass(o,ch[0],t,3.6,.06)}if(m)keys(o,m,t,.1,3)}},
lament:{bpm:54,vol:1.7,beat(i,t,o,L){let p=['Am','F','C','E'],ch=CH[p[(i>>2)%4]],m=[76,null,74,72,71,null,null,null,72,null,71,69,68,null,null,null][i%16];if(i%4===0){pad(o,ch.slice(1),t,4.6,.03+.012*L,400+900*L);bass(o,ch[0]-12,t,4,.05+.04*L)}if(m&&(L>.25||i%8===0))keys(o,m,t,.05+.06*L,3.4);if(L<.5&&i%4===2)beatThump(o,t,.18)}},
garden:{bpm:66,vol:2.2,beat(i,t,o){let p=['C','Am','Fmaj7','G'],ch=CH[p[(i>>2)%4]],sec=60/66,m=[76,79,null,74,72,null,74,null,76,null,72,69,67,null,null,null][i%16];if(i%4===0){pad(o,ch.slice(1),t,sec*4.3,.026,900);bass(o,ch[0],t,sec*3.6,.045)}if(i%2===0)keys(o,ch[1+(i>>1)%3]+12,t,.04,2.6);if(m&&(i>>4)%2)keys(o,m,t+sec*.5,.06,3);if(i%16===6||i%16===13)chirp(o,t+sec*.3)}},};
function scoreTick(){let c=SCORE.ctx,q=SCORE.cue;if(!c||!q||c.state!=='running')return;if(SCORE.next<c.currentTime)SCORE.next=c.currentTime+.03;while(SCORE.next<c.currentTime+.2){try{q.def.beat(SCORE.beat,SCORE.next,q.bus,SCORE.level)}catch(e){}SCORE.beat++;SCORE.next+=60/q.def.bpm}}
function cue(name,fade=1.2){let c=audioCtx();if(!c)return;let old=SCORE.cue,now=c.currentTime;if(old&&old.name===name)return;if(old){let g=old.bus.gain;g.cancelScheduledValues(now);g.setValueAtTime(g.value,now);g.linearRampToValueAtTime(0,now+fade);setTimeout(()=>old.bus.disconnect(),fade*1000+5000)}SCORE.cue=null;let def=CUES[name];if(!def)return;let bus=c.createGain();bus.gain.setValueAtTime(0,now);bus.gain.linearRampToValueAtTime(def.vol,now+Math.min(fade,.5));bus.connect(SCORE.master);SCORE.cue={name,def,bus};SCORE.beat=0;SCORE.next=now+.05}
function scoreLevel(v){SCORE.level=clamp01(v);let q=SCORE.cue;if(q&&q.name==='lament')q.bus.gain.setTargetAtTime(q.def.vol*(.35+.65*SCORE.level),SCORE.ctx.currentTime,.4)}
/* One-shot cinematic hits: chainsaw, crack, crash, swell, raid horn and lesson chime. */
function scoreHit(kind){let c=audioCtx();if(!c||muted)return;let o=SCORE.master,t=c.currentTime+.02;if(kind==='saw'){let s=osc(o,{type:'sawtooth',f:92,t,dur:1.6,vol:.11,a:.05,hold:.3,cut:2200,q:4,send:.1}),l=c.createOscillator(),d=c.createGain();l.frequency.value=31;d.gain.value=14;l.connect(d);d.connect(s.frequency);l.start(t);l.stop(t+1.7);noiseHit(o,{t,dur:1.5,vol:.1,type:'bandpass',f:2400,q:2,a:.05,send:.05});drum(o,t,.5,70)}else if(kind==='crack'){noiseHit(o,{t,dur:.35,vol:.4,type:'highpass',f:1800,send:.5});noiseHit(o,{t:t+.12,dur:.5,vol:.25,type:'bandpass',f:900,q:1.5,send:.5});drum(o,t,.4,140)}else if(kind==='crash'){osc(o,{f:120,to:32,t,dur:1.8,vol:.75,a:.005,send:.4});noiseHit(o,{t,dur:2.2,vol:.4,f:700,to:120,send:.6});drum(o,t+.05,.6,60)}else if(kind==='swell'){noiseHit(o,{t,dur:1.4,vol:.12,type:'bandpass',f:300,to:4500,a:1.2,send:.6});[60,64,67,72].forEach((n,k)=>osc(o,{type:'triangle',f:NOTE(n+12),t:t+.9+k*.06,dur:3,vol:.07,a:.02,send:.7}))}else if(kind==='horn'){[45,52,57].forEach(n=>osc(o,{type:'sawtooth',f:NOTE(n),t,dur:1.9,vol:.06,a:.25,hold:.6,cut:900,send:.5}));drum(o,t,.6,70)}else if(kind==='fall'){osc(o,{f:90,to:30,t,dur:2.4,vol:.6,a:.005,send:.5});pad(o,[45,48,52],t,4,.035,500)}else if(kind==='chime'){[76,79,84].forEach((n,k)=>keys(o,n,t+k*.14,.1,2.6))}}
/* Bee attack sounds: a soldier's sting, a gas bee's spray, and a pop when an enemy is beaten. */
const beeLast={},BEE_GAP={sting:.09,spray:.2,defeat:.12,clear:.15,ant:.25,hornet:.3,worker:1.5};function beeSfx(kind){let c=SCORE.ctx;if(!c||muted||c.state!=='running')return;let now=c.currentTime;if(now-(beeLast[kind]||-9)<BEE_GAP[kind])return;beeLast[kind]=now;let o=SCORE.master,t=now+.01,j=.9+Math.random()*.2;if(kind==='sting'){osc(o,{type:'sawtooth',f:620*j,to:1250*j,t,dur:.07,vol:.11,a:.004,cut:3200,q:2,send:.05});osc(o,{f:210*j,to:95,t:t+.05,dur:.12,vol:.26,a:.003,send:.05})}else if(kind==='spray'){noiseHit(o,{t,dur:.38,vol:.18,type:'bandpass',f:3600*j,to:1300,q:.9,a:.03,send:.15});osc(o,{f:140*j,to:80,t,dur:.18,vol:.13,a:.01,send:.05})}else if(kind==='defeat'){osc(o,{type:'triangle',f:300*j,to:70,t,dur:.35,vol:.3,a:.004,send:.2});noiseHit(o,{t,dur:.3,vol:.22,f:900,to:200,send:.2});[72,79].forEach((n,k)=>osc(o,{type:'triangle',f:NOTE(n),t:t+.08+k*.07,dur:.5,vol:.07,a:.004,send:.4}))}else if(kind==='clear'){noiseHit(o,{t,dur:.55,vol:.2,type:'highpass',f:900,to:6000,a:.1,send:.4});[76,83,88].forEach((n,k)=>osc(o,{type:'sine',f:NOTE(n),t:t+.1+k*.06,dur:.6,vol:.07,a:.004,send:.5}))}
/* Stand-ins for the ant, hornet and builder sounds until the real clips are added. */
else if(kind==='ant'){for(let i=0;i<3;i++)noiseHit(o,{t:t+i*.05,dur:.04,vol:.1,type:'highpass',f:3000*j,send:.05})}else if(kind==='hornet'){osc(o,{type:'sawtooth',f:190*j,to:150,t,dur:.3,vol:.1,a:.02,cut:1400,q:3,send:.1});osc(o,{type:'square',f:95*j,t,dur:.3,vol:.05,a:.02,cut:900,send:.05})}else if(kind==='worker'){osc(o,{type:'sawtooth',f:52,to:44,t,dur:1.6,vol:.12,a:.15,hold:.4,cut:320,q:2,send:.1});noiseHit(o,{t,dur:1.5,vol:.07,f:500,a:.2,send:.1})}}
/* The meadow theme fades rather than cutting in and out. */
let meadowFade=0;function meadowTo(vol,secs=1){clearInterval(meadowFade);vol=Math.max(0,Math.min(1,vol));if(vol>0&&!muted&&music.paused)music.play().catch(()=>{});let from=music.volume,t0=performance.now();meadowFade=setInterval(()=>{let k=Math.min(1,(performance.now()-t0)/(secs*1000));music.volume=Math.max(0,Math.min(1,from+(vol-from)*k));if(k>=1){clearInterval(meadowFade);if(vol<=0)music.pause()}},40)}
/* Crayon-on-paper helpers so markers and highlights match the hand-drawn art. */
const fogCanvas=document.createElement('canvas'),fogCtx=fogCanvas.getContext('2d'),fogTexture=document.createElement('canvas'),fogTexCtx=fogTexture.getContext('2d'),INK='#2b2414';const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y),lerp=(a,b,t)=>a+(b-a)*t,boil=()=>Math.floor(ambientTime*6);function rng(seed){return()=>{seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}function hatch(c,x,y,rx,ry,color,alpha,r,gap=5,angle=-.7,width=3){c.save();c.translate(x,y);c.scale(1,ry/rx);c.rotate(angle);c.strokeStyle=color;c.lineCap='round';for(let k=-rx+gap/2;k<rx;k+=gap){let half=Math.sqrt(1-(k/rx)**2)*rx*(.78+r()*.25);c.globalAlpha=alpha*(.5+r()*.5);c.lineWidth=width*(.6+r()*.7);c.beginPath();c.moveTo(-half+(r()-.5)*5,k+(r()-.5)*1.5);c.lineTo(half+(r()-.5)*5,k+(r()-.5)*1.5);c.stroke()}c.restore()}function scribble(c,x,y,rx,ry,color,width,r,passes=2,alpha=1){c.save();c.strokeStyle=color;c.lineCap=c.lineJoin='round';for(let p=0;p<passes;p++){c.globalAlpha=alpha*(p?.55:.9);c.lineWidth=width*(p?.6:1);c.beginPath();let start=r()*6.283,n=26;for(let i=0;i<=n+2;i++){let a=start+i/n*6.283,j=1+(r()-.5)*.09,px=x+Math.cos(a)*rx*j,py=y+Math.sin(a)*ry*j;i?c.lineTo(px,py):c.moveTo(px,py)}c.stroke()}c.restore()}function handText(text,x,y,size=15,fill=INK){ctx.save();ctx.font=`${size}px 'Patrick Hand',system-ui`;ctx.textAlign='center';ctx.lineJoin='round';ctx.lineWidth=3.5;ctx.strokeStyle='#fffaea';ctx.strokeText(text,x,y);ctx.fillStyle=fill;ctx.fillText(text,x,y);ctx.restore()}
/* Big art and filtered sprites are pre-rendered once so each frame only blits small canvases. */
const meadowLayer=document.createElement('canvas'),treeLayer=document.createElement('canvas'),sprites={},BEE_FILTERS={hurt:'drop-shadow(0 4px 4px rgba(20,30,14,.95))',sel:'saturate(1.35) contrast(1.35) drop-shadow(0 0 2px #fff) drop-shadow(0 0 7px #ffe36b) drop-shadow(0 0 7px #ffe36b)',norm:'saturate(1.35) contrast(1.35) drop-shadow(0 4px 4px rgba(20,30,14,.95))'},BEE_PAD=14;function sprite(key,width,height,paint){if(!sprites[key]){let c=document.createElement('canvas');c.width=width;c.height=height;paint(c.getContext('2d'));sprites[key]=c}return sprites[key]}/* Taking a hit: anything that is hurt flashes under a 90% red overlay that follows its outline. */
const HIT_RED='rgba(235,32,24,.9)',HIT_FLASH=.14;  // the overlay colour, and seconds it shows per hit
function redTint(img,sx,sy,sw,sh){let c=document.createElement('canvas'),g=c.getContext('2d');c.width=sw;c.height=sh;g.drawImage(img,sx,sy,sw,sh,0,0,sw,sh);g.globalCompositeOperation='source-atop';g.fillStyle=HIT_RED;g.fillRect(0,0,sw,sh);return c}
function beeSprite(type,state,img=beeArt[type],key=type+state){return sprite(key,(54*.84+BEE_PAD*2)*2,(54*1.06+BEE_PAD*2)*2,g=>{let src=img,sx=175,sy=25;if(state==='hurt'){src=redTint(img,sx,sy,390,510);sx=sy=0}g.filter=BEE_FILTERS[state];g.drawImage(src,sx,sy,390,510,BEE_PAD*2,BEE_PAD*2,54*.84*2,54*1.06*2)})}function hiveSprite(old){return sprite(old?'hiveOld':'hive',300,300,g=>{g.filter=old?'sepia(.55) saturate(.8)':'none';g.drawImage(hiveArt,380,250,1400,1450,0,0,300,300)})}const flowerSprite=()=>sprite('flower',120,152,g=>g.drawImage(flowerArt,260,230,800,1010,0,0,120,152)),mistSprite=()=>sprite('mist',320,180,g=>g.drawImage(fogArt,0,0,320,180)),fogBlurSprite=()=>sprite('fogBlur',480,270,g=>{g.filter='blur(4px)';g.drawImage(fogArt,0,0,480,270)});function paintLayers(){for(const[c,img]of[[meadowLayer,gardenArt],[treeLayer,foliageArt]]){c.width=w*dpr;c.height=h*dpr;let g=c.getContext('2d');g.setTransform(dpr,0,0,dpr,0,0);if(!img.complete||!img.naturalWidth)continue;if(img===gardenArt){let scale=Math.max(w/img.naturalWidth,h/img.naturalHeight),sw=w/scale,sh=h/scale;g.drawImage(img,(img.naturalWidth-sw)/2,(img.naturalHeight-sh)/2,sw,sh,0,0,w,h);g.fillStyle='#284c2512';g.fillRect(0,0,w,h)}else{let half=img.naturalWidth/2,ih=img.naturalHeight,s=Math.min(h/ih,w/1100);g.drawImage(img,0,0,half,ih,0,0,half*s,h);g.drawImage(img,half,0,half,ih,w-half*s,0,half*s,h)}}}function paintFogTexture(){fogTexture.width=w*dpr;fogTexture.height=h*dpr;let c=fogTexCtx,r=rng(23);c.setTransform(dpr,0,0,dpr,0,0);c.fillStyle='rgba(150,156,150,.95)';c.fillRect(0,0,w,h);if(!fogArt.complete||!fogArt.naturalWidth)return;for(let i=0;i<Math.max(18,Math.round(w*h/30000));i++){let fw=280+r()*460,fh=fw*1080/1920;c.globalAlpha=.3+r()*.45;c.drawImage(fogArt,r()*(w+fw)-fw,r()*(h+fh)-fh,fw,fh)}c.globalAlpha=1}

/* ================= WORLD ================= */
function resize(){
  let r=canvas.getBoundingClientRect(),ow=w,oh=h;
  /* The field is measured in world units: the screen shows w x h of them, MAP_ZOOM screen pixels each. */
  dpr=Math.min(devicePixelRatio||1,2);w=r.width/MAP_ZOOM;h=r.height/MAP_ZOOM;let px=dpr*MAP_ZOOM;
  canvas.width=r.width*dpr;canvas.height=r.height*dpr;ctx.setTransform(px,0,0,px,0,0);
  fogCanvas.width=r.width*dpr;fogCanvas.height=r.height*dpr;fogCtx.setTransform(px,0,0,px,0,0);
  spotCanvas.width=r.width*dpr;spotCanvas.height=r.height*dpr;
  paintFogTexture();paintLayers();
  /* Everything on the field keeps its place when the window changes size. */
  if(ow&&oh&&(ow!==w||oh!==h)){
    let sx=w/ow,sy=h/oh,scale=p=>{if(p){p.x*=sx;p.y*=sy}};
    for(const b of bees){scale(b);scale(b.target);scale(b.post)}
    for(const e of enemies){scale(e);scale(e.exit)}
    for(const a of exploredAreas){scale(a);a.r=scoutRadius()}
  }
  placeScoutMarkers();placeTutorialGrove();
}
function makeBee(type,x,y,mode){let hp=BEE_TYPES[type].hp;return{id:++beeSeq,x,y,type,cool:0,phase:Math.random()*6,deploy:1,health:hp,maxHealth:hp,dead:false,fall:0,hitFlash:0,mode,target:null,post:null,foe:null,atk:0,hit:false,fan:0,puffClock:0,grove:null,pinned:false,carry:0}}
function resetWorld(){
  worldId++;hatchBusy=false;paused=false;collapse=null;
  $('#hatchFx').classList.remove('active','cracking');$('#hatchFx').hidden=true;closeIntroNow();$('#quip').classList.remove('show');
  health=100;hiveHitFlash=0;gameElapsed=0;wave=0;spawnLeft=0;spawnClock=0;nextWave=6;raidEnd=0;
  bees=[];enemies=[];particles=[];puffs=[];interlude=null;
  eggs=[];eggTimer=EGG_TIME;eggAge=0;exploredAreas=[];scoutMarkers=[];flowerGroves=[];fogFullyRevealed=false;
  selection=[];pings=[];floaters=[];drag=null;ended=false;outerRing=1;quipLast=-99;quipSeen={};
}
/* A run starts with one farmer and two eggs. */
function setup(){
  resetWorld();eggs=[++eggCounter,++eggCounter];makeScoutMarkers();makeFlowerGroves();
  bees.push(makeBee('farmer',w*.5,h*.5,'idle'));drawEggs();hud();
  startInterlude(true);
}
function currentDay(){return Math.max(1,spawnLeft||nextWave<=0?wave:wave+1)}
const raiders=()=>enemies.filter(e=>!e.dead&&e.type!=='human');
function setText(sel,text){let el=$(sel);if(el&&el.textContent!==text)el.textContent=text}
/* The top of the screen says only the day. Under it a raid bar fills like a fuse: the calm before the raid up to the flag
   (CALM_PART of the bar, match left on .raid-flag in the CSS), then the raid itself as the raiders are beaten. It turns red once the raid is on. */
const CALM_PART=.35;let barShown=-1;
function hud(){
  $('#healthBar').style.width=Math.max(0,health)+'%';$('#healthBar').parentNode.classList.toggle('low',health<30);
  setText('#healthText',Math.max(0,Math.ceil(health))+' / 100');
  let raid=!!(spawnLeft||(nextWave<=0&&raiders().length)),night=!!interlude&&!interlude.dawnOnly&&interlude.t<NIGHT_END,training=tutorial?.kind==='ants',
      day=interlude?(night?interlude.day:interlude.day+1):currentDay(),box=$('.hud.top>.wave'),text=training?'TRAINING':`DAY ${day}`,p;
  if(training)p=0;
  else if(interlude)p=night?1:0;
  else if(wave&&nextWave<=0)p=CALM_PART+(1-CALM_PART)*clamp01(1-(spawnLeft+raiders().length)/raidSize(wave));
  else p=CALM_PART*clamp01(1-nextWave/(wave?NEXT_RAID_IN:FIRST_RAID_IN));
  if($('#waveText').textContent!==text){$('#waveText').textContent=text;restart(box,'pop')}
  box.classList.toggle('warn',!tutorial&&!interlude&&(raid||nextWave<=RAID_WARNING));box.classList.toggle('raid',!interlude&&raid);box.classList.toggle('training',training);
  let pct=Math.round(p*1000)/10;if(pct!==barShown){barShown=pct;$('#raidFill').style.width=pct+'%';$('#raidHead').style.left=pct+'%'}
  /* The thin bar under the eggs fills as the next egg grows. */
  $('#eggBar').style.width=Math.round((eggs.length>=EGG_MAX?1:clamp01(1-Math.max(eggTimer,EGG_MIN-eggAge)/EGG_TIME))*100)+'%';
  let eggNext=$('.egg-next');if(eggNext.hidden!==!!tutorial)eggNext.hidden=!!tutorial;
}
/* Quips: one-line comments on what just happened to the hive and why it matters. At most one every 9 seconds, and each kind at most once every 45. */
const QUIPS={
paved:'A grove is gone under asphalt. Fewer flowers means fewer eggs.',
cloudHive:'Pesticide reached the brood. Even a small dose weakens a whole colony.',
cloudBee:'Pesticide makes bees sick and lost. Only a Gas Bee can fan it away.',
farmerLost:'A Farmer is gone. Every lost forager means less food for the young.',
soldierLost:'A Soldier fell defending the hive.',
native:'Native wildflowers! Bees and these flowers grew up together: double food.',
hornet:'Hornets wait near hives and pick off bees one at a time.',
bearHive:'Bears tear hives open for honey and brood.',
antHive:'Ants slip inside and carry off honey and eggs.',
noGroves:'No flowers left. Without food the queen can barely lay.'};
let quipLast=-99,quipSeen={};
function quip(key){
  if(tutorial||gameElapsed-quipLast<9||gameElapsed-(quipSeen[key]??-99)<45)return;
  quipLast=quipSeen[key]=gameElapsed;let el=$('#quip');el.textContent=QUIPS[key];el.classList.remove('show');void el.offsetWidth;el.classList.add('show');
}
function hitHive(dmg){
  health-=dmg;hiveHitFlash=.42;sfx('hive');
  floaters.push({x:w*.5,y:h*.5-hiveSize()*.55,text:`-${dmg}`,life:1.1,color:'#c43b2b',size:26});
  let box=$('#healthBox');box.classList.remove('hit');void box.offsetWidth;box.classList.add('hit');box.addEventListener('animationend',()=>box.classList.remove('hit'),{once:true});
}

/* ================= RAIDS ================= */
const raidSize=day=>Math.ceil(RAID_BASE*Math.pow(RAID_GROWTH,day-1));
const raidMix=day=>RAID_MIX[Math.min(day,RAID_MIX.length-1)];
function startWave(){
  wave++;raidEnd=0;spawnLeft=raidSize(wave);spawnClock=.15;nextWave=0;scoreHit('horn');
  if(wave>=HUMAN_DAY)sendBuilder();
}
function makeEnemy(type,x,y,day=wave){
  let I=ENEMY_INFO[type],extra=Math.max(0,day-1),maxHp=I.hp*Math.pow(1.1,extra);
  return{type,x,y,hp:maxHp,maxHp,speed:I.speed+Math.min(8,day*.6),damage:Math.ceil(I.damage*Math.pow(1.08,extra)),dead:false,attackCool:0,stun:0,hitFlash:0,fanned:0,face:1,seed:Math.random()*10};
}
/* Pick a raider type from the day's weights. */
function rollType(day){let mix=raidMix(day),r=Math.random(),last;for(const t in mix){last=t;if((r-=mix[t])<=0)return t}return last}
function spawn(){
  let pad=34,x,y,boxes=hudBoxes(60,60,60);
  for(let k=0;k<30;k++){
    let edge=Math.floor(Math.random()*4);
    if(edge===0){x=Math.random()*w;y=-pad}else if(edge===1){x=w+pad;y=Math.random()*h}else if(edge===2){x=Math.random()*w;y=h+pad}else{x=-pad;y=Math.random()*h}
    let d=Math.hypot(w*.5-x,h*.5-y)||1,ok=true;
    for(let s=0;s<=220&&ok;s+=20)if(underHud(x+(w*.5-x)/d*s,y+(h*.5-y)/d*s,boxes))ok=false;
    if(ok)break;
  }
  enemies.push(makeEnemy(rollType(wave),x,y));
}
/* The builder: from HUMAN_DAY on, one machine drives in each day, paves over a flower grove and leaves. Nothing can stop it. */
function sendBuilder(){
  let open=flowerGroves.filter(g=>!g.gone&&!g.doomed),known=open.filter(g=>g.discovered),pool=known.length?known:open;
  if(!pool.length)return;
  let g=pool[Math.floor(Math.random()*pool.length)],fromLeft=g.u<.5,e=makeEnemy('human',fromLeft?-80:w+80,g.v*h);
  e.grove=g;e.state='in';e.t=0;e.exit={x:e.x,y:e.y};e.face=fromLeft?1:-1;e.heading=Math.atan2(g.v*h-8-e.y,g.u*w-e.x);g.doomed=true;enemies.push(e);sfx('worker');
}
/* heading = the direction the machine is driving (radians). Its bucket always points that way; it turns smoothly when it reverses out. */
function updateBuilder(e,dt){
  let g=e.grove,p={x:g.u*w,y:g.v*h-8},px=e.x,py=e.y;
  if(e.state==='in'){if(step(e,p,e.speed,dt)<10){e.state='pave';e.t=0;g.paving=true;sfx('worker')}}
  else if(e.state==='pave'){
    e.t+=dt;g.paved=Math.min(1,e.t/3.5);
    let fx=e.x+Math.cos(e.heading)*44,fy=e.y+Math.sin(e.heading)*44;  // dust flies off the bucket
    if(Math.random()<dt*14)particles.push({x:fx+(Math.random()-.5)*50,y:fy+(Math.random()-.5)*30,vx:(Math.random()-.5)*60,vy:-20-Math.random()*30,life:.45,color:'#8f8a80'});
    if(e.t>=3.5){g.gone=true;g.paving=false;e.state='out';e.face*=-1;quip(flowerGroves.some(f=>!f.gone)?'paved':'noGroves')}
  }else if(step(e,e.exit,e.speed*1.5,dt)<12)e.dead=true;
  let mx=e.x-px,my=e.y-py;
  if(mx*mx+my*my>1e-6){let want=Math.atan2(my,mx),turn=((want-e.heading)%(Math.PI*2)+Math.PI*3)%(Math.PI*2)-Math.PI;e.heading+=turn*Math.min(1,dt*5)}
}
/* Flower groves sit beside scout markers, so a grove can only ever turn up where a bee has scouted. Two of them are native wildflowers. */
function makeFlowerGroves(){
  flowerGroves=[];
  let spots=scoutMarkers.slice().sort(()=>Math.random()-.5).slice(0,8),clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  spots.forEach((m,i)=>{let a=Math.random()*6.283,d=18+Math.random()*26;flowerGroves.push({u:clamp((m.x+Math.cos(a)*d)/w,.07,.93),v:clamp((m.y+Math.sin(a)*d*.7)/h,.12,.9),i,seed:Math.random()*1000,reveal:0,discovered:false,paved:0,paving:false,gone:false,native:i<2})});
}
const grovePos=g=>({x:g.u*w,y:g.v*h}),scoutRadius=()=>Math.min(w,h)*.27;
function hiveLight(){return{rx:Math.min(w*.23,260),ry:Math.min(h*.22,220)}}
function isExplored(x,y){let L=hiveLight();return fogFullyRevealed||((x-w*.5)/L.rx)**2+((y-h*.5)/L.ry)**2<.6||exploredAreas.some(a=>Math.hypot(a.x-x,a.y-y)<a.r*.75)}
/* Scouting: when a bee reaches the spot it was sent to, the fog there lifts for good and any grove inside that circle is found. */
function scoutDiscovery(b){
  let R=scoutRadius();exploredAreas.push({x:b.x,y:b.y,r:R});
  scoutMarkers=scoutMarkers.filter(m=>Math.hypot(m.x-b.x,m.y-b.y)>60);
  let found=flowerGroves.filter(g=>!g.discovered&&Math.hypot(g.u*w-b.x,g.v*h-b.y)<R*.85);
  if(!scoutMarkers.length&&tutorial?.kind!=='ants'){fogFullyRevealed=ambientTime||1;found=flowerGroves.filter(g=>!g.discovered)}
  found.forEach(g=>g.discovered=true);
  if(found.some(g=>g.native&&!g.gone))quip('native');
}
function nearestGrove(b){let best=null,bd=1e9;for(const g of flowerGroves){if(!g.discovered||g.gone||g.paving)continue;let d=Math.hypot(g.u*w-b.x,g.v*h-b.y);if(d<bd){bd=d;best=g}}return best}
/* Canvas-space rectangles of the HUD panels, grown by the given padding, so nothing on the field hides or appears behind them. */function hudBoxes(px,top,bottom){let c=canvas.getBoundingClientRect();return[...document.querySelectorAll('.hud.top>div,.egg-panel,.coach.show,.game-fullscreen,.game-sound,.game-help')].filter(el=>el.offsetParent).map(el=>{let r=el.getBoundingClientRect();return{l:(r.left-c.left-px)/MAP_ZOOM,r:(r.right-c.left+px)/MAP_ZOOM,t:(r.top-c.top-top)/MAP_ZOOM,b:(r.bottom-c.top+bottom)/MAP_ZOOM}})}function underHud(x,y,boxes){return boxes.some(b=>x>b.l&&x<b.r&&y>b.t&&y<b.b)}
function makeScoutMarkers(){scoutMarkers=[];let wide=w>=h,xs=wide?[.1,.3,.5,.7,.9]:[.16,.5,.84],ys=wide?[.2,.5,.8]:[.12,.31,.5,.69,.88];for(const v of ys)for(const u of xs){if(u===.5&&v===.5)continue;scoutMarkers.push({u,v,x:u*w,y:v*h,active:false,assignedBee:null,phase:Math.random()*6})}placeScoutMarkers()}function placeScoutMarkers(){let boxes=hudBoxes(28,46,22),placed=[],hiveR=Math.min(150,Math.max(108,w*.14))*.6+24,clear=(x,y)=>x>26&&x<w-26&&y>22&&y<h-46&&Math.hypot(x-w*.5,y-h*.5)>hiveR&&!boxes.some(b=>x>b.l&&x<b.r&&y>b.t&&y<b.b)&&placed.every(p=>Math.hypot(p.x-x,p.y-y)>64);for(const m of scoutMarkers){let bx=m.u*w,by=m.v*h;m.x=bx;m.y=by;search:for(let r=0;r<=Math.max(w,h);r+=8)for(let k=0;k<(r?16:1);k++){let a=k/16*Math.PI*2,x=bx+Math.cos(a)*r,y=by+Math.sin(a)*r;if(clear(x,y)){m.x=x;m.y=y;break search}}placed.push(m)}}function hiveSize(){return Math.min(150,Math.max(108,w*.14))}function ringRadius(i){return hiveSize()*.45+40+52*i}function ringCap(i){return 8+4*i}function inRings(x,y){return Math.hypot(x-w*.5,y-h*.5)<ringRadius(outerRing)+22}function step(b,t,speed,dt){let dx=t.x-b.x,dy=t.y-b.y,d=Math.hypot(dx,dy)||1;if(d>speed*dt){b.x+=dx/d*speed*dt;b.y+=dy/d*speed*dt}return d}/* Guards stand in rings around the hive, alternating gas, soldier, gas, soldier. A ring fills before the next one starts. */
function assignRings(){let guards=bees.filter(b=>!b.dead&&b.type!=='farmer'&&b.mode==='guard').sort((a,c)=>a.id-c.id),gas=guards.filter(b=>b.type==='gas'),sol=guards.filter(b=>b.type==='soldier'),order=[];while(gas.length||sol.length){if(gas.length)order.push(gas.shift());if(sol.length)order.push(sol.shift())}let ring=0,start=0;outerRing=1;order.forEach((b,i)=>{while(i>=start+ringCap(ring)){start+=ringCap(ring);ring++}b.ring=ring;b.slot=i-start;b.ringCount=Math.min(ringCap(ring),order.length-start);outerRing=Math.max(outerRing,ring)})}function slotPos(b){let n=b.ringCount||1,ring=b.ring||0,a=-Math.PI/2+((b.slot||0)+(ring%2)*.5)/n*Math.PI*2,r=ringRadius(ring);return{x:w*.5+Math.cos(a)*r,y:h*.5+Math.sin(a)*r}}function drawScoutMarkers(){for(const m of scoutMarkers){let pulse=1+.1*Math.sin(ambientTime*3+m.phase),r=rng(Math.floor(m.phase*1000)+boil()),alpha=m.active?.6:1;ctx.save();ctx.globalAlpha=.3*alpha;ctx.fillStyle=INK;ctx.beginPath();ctx.arc(m.x,m.y+2,21,0,Math.PI*2);ctx.fill();ctx.globalAlpha=alpha;ctx.fillStyle='#ffc72e';ctx.beginPath();ctx.arc(m.x,m.y,9,0,Math.PI*2);ctx.fill();hatch(ctx,m.x,m.y,10,10,'#e08a16',.8*alpha,r,2.4,-.7,2.2);scribble(ctx,m.x,m.y,10,10,INK,1.6,r,1,alpha);scribble(ctx,m.x,m.y,17*pulse,17*pulse,'#ffc72e',2.6,r,2,alpha*.95);ctx.restore()}}

/* ================= BEES AT WORK ================= */
/* Hatching. An egg can always be hatched: the only lock is a training step that asks for one particular bee. */
function hatchLocked(type){let only=tutorial&&tutorial.steps[Math.max(0,tutorial.max)].only;return eggs.length===0||hatchBusy||!!(only&&type!==only)}
function nudgeHatch(){document.querySelectorAll('[data-hatch]').forEach(b=>{if(!b.disabled){b.classList.remove('nudge');void b.offsetWidth;b.classList.add('nudge')}})}
function drawEggs(){
  let list=$('#egg-list');if(!list)return;list.replaceChildren();
  eggs.forEach(()=>{let egg=document.createElement('span');egg.className='egg ready';egg.title='Choose a bee below to hatch this egg';egg.setAttribute('aria-label','Egg ready to hatch');egg.onclick=nudgeHatch;list.appendChild(egg)});
  document.querySelectorAll('[data-hatch]').forEach(button=>button.disabled=hatchLocked(button.dataset.hatch));
}
/* The egg flies from the nursery to the hive, cracks, and the bee appears. Everything runs on plain timers, and the
   "busy" flag is always released, so a hatch can never leave the nursery stuck. */
function hatchEgg(type){
  if(hatchLocked(type)||tutorialHeld())return;
  let world=worldId,fx=$('#hatchFx'),shell=$('.game-shell').getBoundingClientRect(),src=($('#egg-list .egg')||$('#egg-list')).getBoundingClientRect(),tx=w*.5,ty=h*.5-hiveSize()*.43,fromX=src.left-shell.left+src.width/2-24,fromY=src.top-shell.top+src.height/2-24;
  hatchBusy=true;hatchBusyAt=performance.now();eggs.shift();drawEggs();
  fx.hidden=false;fx.className='hatch-fx active';fx.style.left=`${fromX}px`;fx.style.top=`${fromY}px`;
  try{fx.getAnimations().forEach(a=>a.cancel());fx.animate([{left:`${fromX}px`,top:`${fromY}px`,transform:'scale(.72) rotate(-18deg)'},{left:`${tx*MAP_ZOOM-24}px`,top:`${ty*MAP_ZOOM-24}px`,transform:'scale(1.2) rotate(370deg)'}],{duration:760,easing:'cubic-bezier(.2,.72,.16,1)',fill:'forwards'})}catch(e){}
  setTimeout(()=>{if(world===worldId){fx.classList.add('cracking');burst(tx,ty,'#ffd84b',13)}},760);
  setTimeout(()=>{
    if(world!==worldId)return;
    try{
      fx.hidden=true;fx.classList.remove('active','cracking');
      let b=makeBee(type,tx+(Math.random()-.5)*22,ty+13,type==='farmer'?'idle':'guard');b.deploy=0;bees.push(b);if(tutorial)tutorial[type]=b;
    }finally{hatchBusy=false;drawEggs();hud()}
  },1080);
}
function layEgg(){eggs.push(++eggCounter);drawEggs()}
/* Orders. */
function releaseBee(b){b.grove=null;b.pinned=false;b.escort=null;b.foe=null;b.atk=0;b.fan=0}
function moveBee(b,x,y){releaseBee(b);b.target={x,y};b.post=null;b.mode='move'}
function escortFarmer(b,farmer){releaseBee(b);b.target=null;b.post=null;b.escort=farmer;b.orbit=Math.random()*6;b.mode='escort'}
function glide(b,p,dt,rate=2.2){let k=Math.min(1,dt*rate);b.x+=(p.x-b.x)*k;b.y+=(p.y-b.y)*k}
function burst(x,y,color,n){for(let i=0;i<n;i++)particles.push({x,y,vx:(Math.random()-.5)*90,vy:(Math.random()-.5)*90,life:.45,color})}
const BURST={ant:'#5a3a24',hornet:'#f08a1c',cloud:'#f3b6b0',bear:'#9b795f',human:'#8f8a80'};
function hurtEnemy(e,dmg){
  if(e.dead||e.type==='human')return;
  e.hp-=dmg;e.hitFlash=HIT_FLASH;
  if(e.hp<=0){e.dead=true;beeSfx(e.type==='cloud'?'clear':'defeat');burst(e.x,e.y,BURST[e.type],12)}
}
function damageBee(b,dmg,by){
  b.health-=dmg;b.hitFlash=HIT_FLASH;burst(b.x,b.y,by==='cloud'?'#f3b6b0':'#d56d57',6);
  if(by==='bear')sfx('bear');else if(by==='hornet')sfx('hornet');else quip('cloudBee');
  if(b.health>0)return;
  b.dead=true;b.fall=0;burst(b.x,b.y,'#cb4b40',12);
  quip(b.type==='farmer'?(by==='hornet'?'hornet':'farmerLost'):'soldierLost');
}

function update(dt){
  if(!playing||ended||paused)return;
  particles=particles.filter(p=>(p.life-=dt)>0);puffs=puffs.filter(p=>(p.life-=dt)>0);pings=pings.filter(p=>(p.life-=dt)>0);floaters=floaters.filter(f=>(f.life-=dt)>0);
  if(hatchBusy&&performance.now()-hatchBusyAt>4000){hatchBusy=false;drawEggs()}
  if(interlude){for(const b of bees)b.phase+=dt;updateInterlude(dt);hud();return}
  hiveHitFlash=Math.max(0,hiveHitFlash-dt);
  for(const g of flowerGroves)if(g.discovered)g.reveal=Math.min(1,g.reveal+dt*.8);
  if(!tutorial){
    /* Eggs: 36 s each. Food shortens the wait, but never below 10 s, and the timer pauses while 4 eggs are waiting. */
    if(eggs.length<EGG_MAX){eggTimer-=dt;eggAge+=dt;if(eggTimer<=0&&eggAge>=EGG_MIN){layEgg();eggTimer=EGG_TIME;eggAge=0}}
    /* The day: a calm countdown, the raid, then nightfall once every raider (and the builder) is gone. */
    if(spawnLeft){spawnClock-=dt;if(spawnClock<=0){spawn();spawnLeft--;spawnClock=Math.max(.3,1.1-wave*.08)}}
    else if(nextWave>0){
      let was=nextWave;nextWave-=dt;
      if(was>RAID_WARNING&&nextWave<=RAID_WARNING)scoreHit('horn');  // the raid bar's flag starts waving at the same moment
      if(nextWave<=0)startWave();
    }else if(!enemies.length&&(raidEnd+=dt)>1.8){raidEnd=0;startInterlude(false);hud();return}
  }
  assignRings();
  for(const b of bees)updateBee(b,dt);
  for(const e of enemies)updateEnemy(e,dt);
  for(const b of bees)if(b.dead)releaseBee(b);
  bees=bees.filter(b=>!b.dead||b.fall<2.2);selection=selection.filter(b=>!b.dead);enemies=enemies.filter(e=>!e.dead);
  if(health<=0){if(tutorial&&tutorial.kind==='ants')tutorialFail();else finish()}
  hud();
}
function updateBee(b,dt){
  let T=BEE_TYPES[b.type],speed=T.speed*BEE_SPEED;
  b.phase+=dt;b.deploy=Math.min(1,(b.deploy??0)+dt*2.5);
  b.hitFlash=Math.max(0,b.hitFlash-dt);
  if(b.dead){b.fall+=dt;return}
  b.cool-=dt;b.fan=Math.max(0,b.fan-dt);
  if(b.mode==='move'){if(!b.target||step(b,b.target,speed,dt)<12)arrive(b)}
  else if(b.type==='farmer')farmerWork(b,speed,dt);
  else defend(b,T,speed,dt);
}
/* A bee that reaches the spot it was sent to scouts it (if it was still foggy) and then stays there: it never drifts back by itself. */
function arrive(b){
  let t=b.target||{x:b.x,y:b.y};b.target=null;
  if(!isExplored(t.x,t.y)||scoutMarkers.some(m=>Math.hypot(m.x-b.x,m.y-b.y)<60))scoutDiscovery(b);
  b.post={x:t.x,y:t.y};b.mode=b.type==='farmer'?'idle':'hold';
}
/* Farmers: idle -> outbound (to the nearest found grove) -> gather -> return (to the hive) -> idle. With no grove to
   visit they wait where they are, and set off by themselves as soon as one is found. */
function farmerWork(b,speed,dt){
  let hive={x:w*.5,y:h*.5};
  if(b.grove&&(b.grove.gone||b.grove.paving)){b.grove=null;b.pinned=false;if(b.mode!=='return')b.mode='idle'}
  if(b.mode!=='outbound'&&b.mode!=='gather'&&b.mode!=='return')b.mode='idle';
  if(b.mode==='idle'){
    let g=b.grove||nearestGrove(b);
    if(g){b.grove=g;b.post=null;b.mode='outbound'}
    else{
      let a=b.phase*.6+b.id*1.7,c=b.post||hive,R=b.post?12:hiveSize()*.42;
      glide(b,{x:c.x+Math.cos(a)*R,y:c.y+Math.sin(a)*R*.7},dt);
    }
  }
  if(b.mode==='outbound'){if(step(b,grovePos(b.grove),speed,dt)<14){b.mode='gather';b.gather=2.5}}
  else if(b.mode==='gather'){
    let p=grovePos(b.grove),a=b.phase*1.3+b.id*2.1;b.gather-=dt;
    glide(b,{x:p.x+Math.cos(a)*18,y:p.y+Math.sin(a)*11},dt,3);
    if(b.gather<=0){b.carry=b.grove.native?2:1;b.mode='return'}
  }else if(b.mode==='return'){if(step(b,hive,speed*1.05,dt)<20)deliver(b)}
}
/* Each food delivered takes 0.75 s off the egg timer. A farmer the player has not pinned to a grove picks the nearest one again each trip. */
function deliver(b){
  let n=b.carry||1;b.carry=0;burst(b.x,b.y,'#ffd43e',8);if(tutorial)tutorial.food+=n;eggTimer-=n*EGG_FOOD_BONUS;
  floaters.push({x:b.x,y:b.y-24,text:`+${n} food`,life:.9,color:'#a8761c',size:16});
  if(!b.pinned)b.grove=null;b.mode='idle';
}
/* Soldiers and gas bees defend a spot: their place in the patrol ring, the post they were sent to, or the farmer they escort.
   They leave it only to deal with an enemy they can beat that comes within reach, and return to it afterwards. */
function defend(b,T,speed,dt){
  let hive={x:w*.5,y:h*.5},home,centre,reach;
  if(b.mode==='escort'&&(!b.escort||b.escort.dead)){b.escort=null;b.mode='guard'}
  if(b.mode==='escort'){let f=b.escort,a=b.phase*1.4+b.orbit;home={x:f.x+Math.cos(a)*30,y:f.y+Math.sin(a)*22};centre=f;reach=T.aggro}
  else if(b.mode==='hold'){home=b.post||(b.post={x:b.x,y:b.y});centre=home;reach=T.aggro}
  else{b.mode='guard';home=slotPos(b);centre=hive;reach=ringRadius(outerRing)+85}
  let foe=b.foe&&!b.foe.dead&&dist(b.foe,centre)<reach?b.foe:null;
  if(!foe){let bd=1e9;for(const e of enemies){if(e.dead||ENEMY_INFO[e.type].counter!==b.type||dist(e,centre)>=reach)continue;let d=dist(e,b);if(d<bd){bd=d;foe=e}}}
  b.foe=foe;
  if(!foe){b.atk=0;let d=dist(b,home);step(b,home,b.mode==='escort'?speed:d>30?speed:Math.max(8,d*2.5),dt);return}
  let d=dist(b,foe)||1;
  if(b.type==='soldier'){
    /* Sting: fly in close, lunge, hit at the middle of the lunge, back off, repeat. */
    if(b.atk>0){b.atk-=dt;if(!b.hit&&b.atk<=STING.time*.5){b.hit=true;if(d<STING.reach*2.2)sting(b,foe,T)}}
    else if(d>STING.reach)step(b,foe,speed*1.15,dt);
    else if(b.cool<=0){b.atk=STING.time;b.hit=false;b.cool=T.cool}
  }else{
    /* Fan: hover beside the cloud and beat it back. Every cloud inside the fan shrinks, drifts away and fades. */
    if(d>GAS_FAN.range){step(b,foe,speed,dt);return}
    b.fan=.25;b.puffClock-=dt;
    if(b.puffClock<=0){b.puffClock=.42;beeSfx('spray');sfx('gas');puffs.push({kind:'gust',x:b.x,y:b.y,tx:foe.x,ty:foe.y,life:.5,seed:Math.random()*999|0})}
    for(const c of enemies){
      if(c.dead||c.type!=='cloud')continue;let cd=dist(c,b)||1;if(cd>GAS_FAN.range+12)continue;
      c.fanned=.3;c.x+=(c.x-b.x)/cd*GAS_FAN.push*dt;c.y+=(c.y-b.y)/cd*GAS_FAN.push*dt;hurtEnemy(c,GAS_FAN.dps*dt);
    }
  }
}
function sting(b,foe,T){
  hurtEnemy(foe,T.dmg);foe.stun=.3;beeSfx('sting');
  puffs.push({kind:'hit',x:foe.x,y:foe.y,life:.28,seed:Math.random()*999|0});
  floaters.push({x:foe.x+(Math.random()-.5)*14,y:foe.y-18,text:`-${T.dmg}`,life:.6,color:'#b3261b',size:15});
}
function updateEnemy(e,dt){
  if(e.dead)return;
  e.hitFlash=Math.max(0,e.hitFlash-dt);e.fanned=Math.max(0,e.fanned-dt);e.lunge=Math.max(0,(e.lunge||0)-dt);e.attackCool-=dt;
  if(e.type==='human')return updateBuilder(e,dt);
  if(e.stun>0){e.stun-=dt;return}
  let I=ENEMY_INFO[e.type],hive={x:w*.5,y:h*.5},goal=hive,prey=null,near=(test,range)=>{let best=null,bd=range;for(const b of bees){if(b.dead||!test(b))continue;let d=dist(b,e);if(d<bd){bd=d;best=b}}return best};
  if(e.type==='cloud'){
    /* Pesticide poisons any bee it touches, except gas bees: their gear protects them. */
    let victim=near(b=>b.type!=='gas',62);
    if(victim&&e.attackCool<=0){damageBee(victim,7,'cloud');e.attackCool=1}
  }
  else if(e.type==='hornet')prey=near(b=>b.type==='farmer',240)||near(()=>true,90);
  else if(e.type==='bear')prey=near(()=>true,60);
  if(prey){
    if(dist(e,prey)<I.reach){if(e.attackCool<=0){damageBee(prey,I.beeDmg,e.type);e.attackCool=I.every;e.lunge=.4}return}  // lunge = how long the attack pose shows
    goal=prey;
  }
  if(goal===hive&&dist(e,hive)<40){
    e.dead=true;burst(e.x,e.y,BURST[e.type],14);hitHive(e.damage);
    if(e.type==='ant'){sfx('ant');quip('antHive')}else if(e.type==='cloud')quip('cloudHive');else if(e.type==='bear')quip('bearHive');else sfx('hornet');
    return;
  }
  let ox=e.x;step(e,goal,e.speed*(e.fanned>0?.3:1),dt);if(Math.abs(e.x-ox)>.01)e.face=e.x>ox?1:-1;
}

/* Selecting and commanding: click a bee (or drag a box, or press Q/W/E), then click where it should go. */
function pickBee(x,y){let best=null,bd=32;for(const b of bees){if(b.dead||(b.deploy??1)<.5)continue;let d=Math.hypot(b.x-x,b.y-y);if(d<bd){bd=d;best=b}}return best}
function ping(x,y,color){pings.push({x,y,color,life:.7,seed:Math.random()*999|0})}
function boxSelect(d){
  let l=Math.min(d.x0,d.x1)-10,r=Math.max(d.x0,d.x1)+10,t=Math.min(d.y0,d.y1)-10,btm=Math.max(d.y0,d.y1)+10,got=bees.filter(b=>!b.dead&&b.x>=l&&b.x<=r&&b.y>=t&&b.y<=btm);
  if(got.some(b=>b.type!=='farmer'))got=got.filter(b=>b.type!=='farmer');
  if(!got.length){if(!d.shift)selection=[];return}
  selection=d.shift?[...new Set([...selection,...got])]:got;
}
function selectType(type,add){
  let pick=bees.filter(b=>!b.dead&&(type==='all'?b.type!=='farmer':b.type===type));
  if(pick.length)selection=add?[...new Set([...selection,...pick])]:pick;
}
function tapAt(x,y,shift){
  let clicked=pickBee(x,y),combat=selection.filter(b=>b.type!=='farmer');
  if(clicked){
    if(shift){selection=selection.includes(clicked)?selection.filter(b=>b!==clicked):[...selection,clicked];return}
    if(combat.length&&clicked.type==='farmer'&&!selection.includes(clicked)){command(x,y,clicked);return}
    selection=selection.includes(clicked)&&selection.length===1?[]:[clicked];return;
  }
  if(selection.length)command(x,y,null);
}
/* What a click at (x, y) would mean for the selected bees. Used for both the order itself and the label beside the cursor. */
const ORDER_LABEL={patrol:'PATROL THE HIVE',farm:'BACK TO FARMING',grove:'FARM HERE',scout:'SCOUT',hold:'HOLD HERE',move:'FLY HERE',escort:'ESCORT'};
function orderAt(x,y,sel){
  let combat=sel.filter(b=>b.type!=='farmer'),farmers=sel.filter(b=>b.type==='farmer'),
      marker=scoutMarkers.find(m=>Math.hypot(m.x-x,m.y-y)<34)||null,
      onHive=!marker&&Math.hypot(x-w*.5,y-h*.5)<hiveSize()*.5,
      grove=!marker&&!onHive&&farmers.length?flowerGroves.find(g=>g.discovered&&!g.gone&&!g.paving&&Math.hypot(g.u*w-x,g.v*h-y)<50)||null:null,
      kind=onHive?(combat.length?'patrol':'farm'):grove&&!combat.length?'grove':marker||!isExplored(x,y)?'scout':combat.length?'hold':'move';
  return{combat,farmers,marker,grove,kind,x:marker?marker.x:x,y:marker?marker.y:y};
}
function command(x,y,farmer){
  let sel=selection.filter(b=>!b.dead);if(!sel.length)return;
  let o=orderAt(x,y,sel),gate=tutorial&&tutorial.steps[tutorial.max].scoutOnly;
  if(farmer){
    if(!o.combat.length)return;
    o.combat.forEach(b=>escortFarmer(b,farmer));ping(farmer.x,farmer.y,'#ffc72e');selection=[];return;
  }
  if(gate&&!o.marker)return;
  sel.forEach((b,i)=>{
    if(o.kind==='patrol'||o.kind==='farm'){releaseBee(b);b.target=null;b.post=null;b.mode=b.type==='farmer'?'idle':'guard'}
    else if(o.grove&&b.type==='farmer'){releaseBee(b);b.target=null;b.post=null;b.grove=o.grove;b.pinned=true;b.mode='outbound'}
    else moveBee(b,o.x+(i?Math.cos(i*2.4)*(24+i*5):0),o.y+(i?Math.sin(i*2.4)*(18+i*4):0));
  });
  ping(o.x,o.y,o.kind==='scout'?'#fff3b0':'#ffc72e');selection=[];
}

/* ================= DRAWING ================= */
function drawGarden(){ctx.fillStyle='#91ad83';ctx.fillRect(0,0,w,h);ctx.drawImage(meadowLayer,0,0,w,h)}
function draw(){
  let live=playing&&!ended&&!interlude&&!paused;
  hoverBee=live&&mouse&&!drag?pickBee(mouse.x,mouse.y):null;
  hoverEnemy=live&&mouse&&!hoverBee?enemies.find(e=>!e.dead&&Math.hypot(e.x-mouse.x,e.y-mouse.y)<Math.max(26,ENEMY_INFO[e.type].size*.5))||null:null;
  drawGarden();drawFlowers();enemies.forEach(enemy);puffs.forEach(drawPuff);
  particles.forEach(p=>{p.x+=p.vx/60;p.y+=p.vy/60;ctx.globalAlpha=p.life/.45;ctx.fillStyle=p.color;ctx.fillRect(p.x,p.y,3,3);ctx.globalAlpha=1});
  drawEdgeFog();hive();bees.forEach(drawBee);drawExplorationFog();ctx.drawImage(treeLayer,0,0,w,h);
  drawRoutes();drawScoutMarkers();drawTutorial();drawInterlude();drawHitFlash();drawPings();drawFloaters();drawAim();drawHover();drawDrag();
}
/* Attack effects: a crayon star where a sting lands, and a puff of air that travels from a fanning gas bee to the cloud. */
function drawPuff(p){
  if(p.kind==='hit'){
    let k=1-p.life/.28,r=rng(p.seed);ctx.save();ctx.translate(p.x,p.y);ctx.lineCap='round';ctx.globalAlpha=1-k*k;ctx.beginPath();
    for(let i=0;i<7;i++){let a=i/7*6.283+r()*.5,r0=6+k*9,r1=15+k*20+r()*6;ctx.moveTo(Math.cos(a)*r0,Math.sin(a)*r0);ctx.lineTo(Math.cos(a)*r1,Math.sin(a)*r1)}
    ctx.strokeStyle=INK;ctx.lineWidth=5;ctx.stroke();ctx.strokeStyle='#ffe36b';ctx.lineWidth=2.4;ctx.stroke();ctx.restore();
  }else{let k=1-p.life/.5;scribble(ctx,lerp(p.x,p.tx,k),lerp(p.y,p.ty,k),8+k*16,6+k*11,'#fff7df',2.6,rng(p.seed+boil()),1,(1-k)*.85)}
}
/* Fan lines: arcs of air pushed from the gas bee toward the cloud it is clearing. */
function drawFan(b){
  let f=b.foe;if(!f)return;
  ctx.save();ctx.translate(b.x,b.y);ctx.rotate(Math.atan2(f.y-b.y,f.x-b.x));ctx.lineCap='round';
  for(let i=0;i<3;i++){let k=(ambientTime*2.4+i/3)%1,R=18+k*(GAS_FAN.range-12);ctx.globalAlpha=(1-k)*.9;ctx.beginPath();ctx.arc(0,0,R,-.5,.5);ctx.strokeStyle=INK;ctx.lineWidth=5;ctx.stroke();ctx.strokeStyle='#fff7df';ctx.lineWidth=2.6;ctx.stroke()}
  ctx.restore();
}
function drawExplorationFog(){
  /* Once every scout point is reached, fogFullyRevealed holds the time it happened and the last of the fog fades away. */
  let gone=fogFullyRevealed?Math.min(1,(ambientTime-fogFullyRevealed)/1.8):0;if(gone>=1)return;
  fogCtx.clearRect(0,0,w,h);fogCtx.save();fogCtx.drawImage(fogTexture,0,0,w,h);fogCtx.globalCompositeOperation='destination-out';
  function light(x,y,rx,ry,core=.68){if(!Number.isFinite(x+y+rx+ry))return;let g=fogCtx.createRadialGradient(x,y,0,x,y,Math.max(rx,ry));g.addColorStop(0,'rgba(0,0,0,1)');g.addColorStop(core,'rgba(0,0,0,.94)');g.addColorStop(1,'rgba(0,0,0,0)');fogCtx.fillStyle=g;fogCtx.beginPath();fogCtx.ellipse(x,y,rx,ry,0,0,Math.PI*2);fogCtx.fill()}
  let L=hiveLight();light(w*.5,h*.5,L.rx,L.ry);
  for(const a of exploredAreas)light(a.x,a.y,a.r*1.12,a.r*1.12,.85);
  for(const b of bees)if(!b.dead)light(b.x,b.y,120,100);
  for(const e of enemies)if(e.type==='human')light(e.x,e.y,110,100);
  fogCtx.restore();ctx.globalAlpha=1-gone;ctx.drawImage(fogCanvas,0,0,w,h);ctx.globalAlpha=1;
}
/* Groves are only drawn once a bee has scouted them. Native wildflowers are purple, denser and labelled; a paved grove turns to asphalt. */
const nativeFlowerSprite=()=>sprite('flowerNative',120,152,g=>{g.filter='hue-rotate(250deg) saturate(1.5)';g.drawImage(flowerSprite(),0,0)});
function drawFlowers(){
  let scale=Math.max(.7,Math.min(1,w/1200));
  for(const f of flowerGroves){
    if(!f.discovered)continue;
    let reveal=f.reveal,live=1-f.paved,r=rng(Math.floor(f.seed*1000)),rx=52*scale*(f.native?1.15:1),ry=34*scale*(f.native?1.15:1);
    ctx.save();ctx.translate(f.u*w,f.v*h);
    if(f.paved>0){
      ctx.globalAlpha=f.paved*reveal;ctx.fillStyle='#5b5955';ctx.beginPath();ctx.ellipse(0,4,rx*1.25*f.paved,ry*1.25*f.paved,0,0,6.283);ctx.fill();
      hatch(ctx,0,4,rx*1.2*f.paved,ry*1.2*f.paved,'#3b3a37',.7*f.paved,rng(f.i*13+5),5,-.3,3.5);
      if(f.gone){ctx.globalAlpha=.9*reveal;ctx.setLineDash([10,9]);ctx.strokeStyle='#e9d98a';ctx.lineWidth=2.5;ctx.beginPath();ctx.moveTo(-rx*.85,4);ctx.lineTo(rx*.85,4);ctx.stroke();ctx.setLineDash([]);
        scribble(ctx,0,4,rx*1.25,ry*1.25,INK,2,rng(f.i*7+boil()),1,.7*reveal);ctx.globalAlpha=reveal;handText('PAVED OVER',0,ry+28,13,'#5a5850')}
    }
    if(live>0){
      let a=reveal*live;
      hatch(ctx,0,4,rx,ry,f.native?'#c9a6e6':'#a9c873',.5*a,r,4.5,-.6,4);
      let glow=(.6+.25*Math.sin(ambientTime*2.2+f.seed))*a,ring=rng(f.i*31+boil());
      if(f.native){scribble(ctx,0,4,rx*1.22,ry*1.3,'#8e44c9',3.4,ring,2,glow);scribble(ctx,0,4,rx*1.4,ry*1.5,'#d9b3f5',2,ring,1,glow*.8)}
      else scribble(ctx,0,4,rx*1.2,ry*1.28,'#ffc72e',2.4,ring,2,glow);
      if(ready(flowerArt)){
        let blooms=[],img=f.native?nativeFlowerSprite():flowerSprite();
        for(let i=0;i<(f.native?8:5);i++)blooms.push({x:(r()-.5)*rx*1.5,y:(r()-.5)*ry*1.3+12,s:.75+r()*.45,flip:r()<.5,tilt:(r()-.5)*.35});
        blooms.sort((p,q)=>p.y-q.y);ctx.globalAlpha=a;
        for(const b of blooms){let dh=64*scale*b.s*(.75+.25*reveal)*(.4+.6*live),dw=dh*120/152;ctx.save();ctx.translate(b.x,b.y);ctx.rotate(b.tilt+Math.sin(ambientTime*1.3+b.x)*.05+f.paved*(b.flip?1:-1));if(b.flip)ctx.scale(-1,1);ctx.drawImage(img,-dw*.46,-dh*.94,dw,dh);ctx.restore()}
      }
      if(f.native&&live>.5){ctx.globalAlpha=a;handText('NATIVE WILDFLOWERS · 2× FOOD',0,ry+30,14,'#6a2a8a')}
    }
    ctx.restore();
  }
}
/* Bees. A selected bee glows, wears a bright double ring and gets a bouncing arrow. A stinging soldier lunges at its target,
   a fanning gas bee beats its wings; if attack frames exist in assets/ they are shown instead of the resting sprite. */
function pickFrame(list,k){let ok=[];list.forEach((img,i)=>{if(ready(img))ok.push({img,i})});return ok.length?ok[Math.min(ok.length-1,Math.floor(k*ok.length))]:null}
function drawBee(b){
  if(!ready(beeArt[b.type]))return;
  let T=BEE_TYPES[b.type],ease=1-Math.pow(1-(b.deploy??1),3),s=ease*T.scale,sel=selection.includes(b),bob=b.dead?Math.sin(b.fall*13)*2:Math.sin(b.phase*T.bobRate)*T.bob,sway=b.dead?0:Math.sin(b.phase*2)*.045,fall=Math.min(1,b.fall/.7),ox=0,oy=0,frame=null;
  if(!b.dead&&b.atk>0&&b.foe){let k=Math.sin(Math.PI*(1-b.atk/STING.time)),d=dist(b,b.foe)||1;ox=(b.foe.x-b.x)/d*k*16;oy=(b.foe.y-b.y)/d*k*16;sway+=k*.4*(b.foe.x<b.x?-1:1);frame=pickFrame(attackArt.soldier,1-b.atk/STING.time)}
  if(!b.dead&&b.fan>0){sway+=Math.sin(ambientTime*38)*.13;bob+=Math.sin(ambientTime*31)*1.5;frame=pickFrame(attackArt.gas,(ambientTime*8)%1);drawFan(b)}
  if(!b.dead&&ease>.2)beeMark(b,s,T,sel);
  let state=b.hitFlash>0?'hurt':sel&&!b.dead?'sel':'norm',img=frame?beeSprite(b.type,state,frame.img,`${b.type}${state}f${frame.i}`):beeSprite(b.type,state);
  ctx.save();ctx.translate(b.x+ox,b.y+oy+bob+fall*13);ctx.rotate(sway+fall*1.35);ctx.globalAlpha=b.dead?Math.max(0,1-b.fall/2.2):1;
  ctx.drawImage(img,(-54*.42-BEE_PAD)*s,(-54*.53-BEE_PAD)*s,(54*.84+BEE_PAD*2)*s,(54*1.06+BEE_PAD*2)*s);ctx.restore();
  if(b.dead)return;
  let top=b.y-32*T.scale,ratio=Math.max(0,b.health/b.maxHealth);
  ctx.fillStyle='#15371b';ctx.fillRect(b.x-12,top,24,3);ctx.fillStyle=ratio<.35?'#d94e43':'#6da844';ctx.fillRect(b.x-12,top,24*ratio,3);
  if(ease>.6)ctx.drawImage(badgeSprite(b.type),b.x+12,top-8,16,16);
  if(sel){let ay=top-16+Math.sin(ambientTime*6)*3;ctx.save();ctx.lineJoin='round';ctx.beginPath();ctx.moveTo(b.x-8,ay-9);ctx.lineTo(b.x+8,ay-9);ctx.lineTo(b.x,ay);ctx.closePath();ctx.fillStyle='#fff3b0';ctx.strokeStyle=INK;ctx.lineWidth=2.5;ctx.stroke();ctx.fill();ctx.restore()}
}
function beeMark(b,s,T,sel){
  let r=rng(b.id*31+boil()),gy=b.y+24*T.scale,hov=b===hoverBee;
  hatch(ctx,b.x,gy,15*s,5*s,T.color,.6,r,2.6,-.4,2);scribble(ctx,b.x,gy,19*s,7*s,T.color,3,r,2,1);
  if(sel){
    let R=31*s*(1+.07*Math.sin(ambientTime*7));
    ctx.save();ctx.globalAlpha=.3;ctx.fillStyle='#fff3b0';ctx.beginPath();ctx.arc(b.x,b.y,R,0,6.283);ctx.fill();ctx.restore();
    scribble(ctx,b.x,b.y,R,R,INK,6.5,r,1,.7);scribble(ctx,b.x,b.y,R,R,'#fff3b0',3.8,r,2,1);
  }else{ctx.save();ctx.setLineDash(b.type==='gas'?[7,5]:b.type==='farmer'?[2,5]:[]);scribble(ctx,b.x,b.y,26*s,26*s,T.color,hov?3.4:2.4,r,1,hov?1:.75);ctx.restore()}
}
/* Enemies. Every enemy stands on a ring in the colour of the bee that beats it and carries that bee's badge. */
const cloudSprite=()=>sprite('cloud',376,283,g=>{
  /* The cloud drawing runs off the top and sides of its image, so those edges are feathered out instead of ending in a hard line. */
  g.fillStyle='#fff';g.fillRect(0,0,376,283);g.drawImage(pesticideArt,0,0,pesticideArt.naturalWidth,565,0,0,376,283);
  g.globalCompositeOperation='destination-in';
  let v=g.createLinearGradient(0,0,0,283);v.addColorStop(0,'rgba(0,0,0,0)');v.addColorStop(.22,'#000');v.addColorStop(1,'#000');g.fillStyle=v;g.fillRect(0,0,376,283);
  let s=g.createLinearGradient(0,0,376,0);s.addColorStop(0,'rgba(0,0,0,0)');s.addColorStop(.12,'#000');s.addColorStop(.9,'#000');s.addColorStop(1,'rgba(0,0,0,0)');g.fillStyle=s;g.fillRect(0,0,376,283);
});
/* Placeholder ant, drawn facing right, used only if assets/enemy-ant-1.png is missing. */
function drawAnt(c,size){
  let t=ambientTime*14;c.lineCap='round';c.strokeStyle='#22140b';c.lineWidth=Math.max(1.5,size*.07);
  for(let i=-1;i<=1;i++)for(const side of[-1,1]){let sw=Math.sin(t+i*2)*size*.08;c.beginPath();c.moveTo(i*size*.12,0);c.lineTo(i*size*.2+sw*side,side*size*.36);c.stroke()}
  c.beginPath();c.moveTo(size*.36,-size*.05);c.lineTo(size*.54,-size*.22);c.moveTo(size*.36,size*.05);c.lineTo(size*.54,size*.22);c.stroke();
  c.fillStyle='#5a3418';for(const[x,rx,ry]of[[-size*.28,.2,.15],[0,.12,.1],[size*.27,.15,.13]]){c.beginPath();c.ellipse(x,0,size*rx,size*ry,0,0,6.283);c.fill();c.stroke()}
}
/* Draws one enemy centred on the origin of context c. Shared by the meadow and the new-threat cards. */
function drawEnemyArt(c,type,box,o={}){
  c.save();
  if(type==='ant'){
    /* Two drawn frames swap back and forth as it walks. seed staggers the step so a column of ants does not march in lockstep. */
    let a=enemyArt.ant[Math.floor(ambientTime*8+(o.seed||0))%2];if(!ready(a))a=enemyArt.ant[0];
    if(ready(a)){c.rotate((o.ang||0)+Math.PI/2);let s=box*1.3/Math.max(a.naturalWidth,a.naturalHeight);c.drawImage(a,-a.naturalWidth*s/2,-a.naturalHeight*s/2,a.naturalWidth*s,a.naturalHeight*s)}
    else{c.rotate(o.ang||0);drawAnt(c,box)}
  }else if(type==='hornet'){
    /* One frame for flying; the stretched frame, mandibles forward, only while it bites a bee. */
    let a=enemyArt.hornet[o.attack?0:1];if(!ready(a))a=enemyArt.hornet[o.attack?1:0];
    if(ready(a)){let s=box/(a.naturalWidth*.5);c.scale(o.face===1?-1:1,1);c.drawImage(a,-a.naturalWidth*.45*s,-a.naturalHeight*.45*s,a.naturalWidth*s,a.naturalHeight*s)}
    else{c.fillStyle='#f08a1c';c.strokeStyle=INK;c.lineWidth=3;c.beginPath();c.ellipse(0,0,box*.4,box*.22,0,0,6.283);c.fill();c.stroke()}
  }else if(type==='cloud'){
    if(ready(pesticideArt)){let sx=box/670,sy=box*.8/390;c.globalCompositeOperation='multiply';c.drawImage(cloudSprite(),-box/2-45*sx,-box*.4-175*sy,pesticideArt.naturalWidth*sx,565*sy)}
    else{c.fillStyle='#e9a3a0';c.beginPath();c.ellipse(0,0,box*.4,box*.28,0,0,6.283);c.fill()}
  }else if(type==='bear'){
    if(ready(bearArt)){c.shadowColor='#392a1880';c.shadowBlur=8;c.drawImage(bearArt,-box*.89,-box*.73,box*1.78,box*1.46)}  // the bear fills only the middle of its file, so the file is drawn larger than box
    else{c.fillStyle='#76604e';c.beginPath();c.ellipse(0,0,box*.35,box*.28,0,0,6.283);c.fill()}
  }else if(type==='human'){
    let a=enemyArt.human;
    c.rotate((o.heading??Math.PI/2)-Math.PI/2);  // the drawing is top-down with the bucket at the bottom (+y)
    if(ready(a)){let s=box/(a.naturalHeight*.83);c.shadowColor='#1b1a1880';c.shadowBlur=10;c.drawImage(a,-a.naturalWidth*.5*s,-a.naturalHeight*.5*s,a.naturalWidth*s,a.naturalHeight*s)}
    else{c.fillStyle='#b79a3e';c.strokeStyle=INK;c.lineWidth=3;c.fillRect(-box*.3,-box*.4,box*.6,box*.8);c.strokeRect(-box*.3,-box*.4,box*.6,box*.8)}
  }
  c.restore();
}
/* An enemy that was just hit: drawn into a scratch canvas at screen resolution, covered with the red overlay, then copied in. */
const flashCanvas=document.createElement('canvas'),flashCtx=flashCanvas.getContext('2d');
function drawFlashed(c,type,box,o){
  let k=dpr*MAP_ZOOM,S=Math.ceil(box*2.6),P=Math.ceil(S*k),g=flashCtx;
  if(flashCanvas.width<P)flashCanvas.width=flashCanvas.height=P;
  g.setTransform(1,0,0,1,0,0);g.globalCompositeOperation='source-over';g.clearRect(0,0,P,P);
  g.setTransform(k,0,0,k,P/2,P/2);drawEnemyArt(g,type,box,o);
  g.setTransform(1,0,0,1,0,0);g.globalCompositeOperation='source-atop';g.fillStyle=HIT_RED;g.fillRect(0,0,P,P);g.globalCompositeOperation='source-over';
  c.drawImage(flashCanvas,0,0,P,P,-S/2,-S/2,S,S);
}
function enemy(e){
  let I=ENEMY_INFO[e.type],box=I.size*Math.max(.78,Math.min(1.1,w/1150)),col=I.counter?BEE_TYPES[I.counter].color:NO_COUNTER,er=rng((e.seed*999|0)+boil()),
      k=e.type==='cloud'?Math.max(0,e.hp/e.maxHp):1,bob=e.type==='ant'?0:e.type==='human'?(e.state==='pave'?Math.sin(ambientTime*30)*1.5:Math.sin(ambientTime*9)*1):Math.sin(ambientTime*5+e.seed*3)*2,
      gy=e.y+box*(e.type==='ant'?.42:.34),lw=e===hoverEnemy?4.4:3.2;
  scribble(ctx,e.x,gy,box*.46,box*.16,INK,lw+2.6,er,1,.4);scribble(ctx,e.x,gy,box*.46,box*.16,col,lw,er,2,.95);
  ctx.save();ctx.translate(e.x+(e.fanned>0?Math.sin(ambientTime*42)*2.5:0),e.y+bob);
  if(e.type==='cloud'){let pulse=(1+.11*Math.sin(ambientTime*2.8+e.seed))*(.5+.5*k);ctx.scale(pulse,pulse);ctx.globalAlpha=.5+.45*k}
  let flash=e.hitFlash>0&&e.type!=='cloud';  // a cloud is hurt every frame it is fanned, so it shrinks and fades instead of flashing
  if(flash)ctx.scale(1.12,.9);
  (flash?drawFlashed:drawEnemyArt)(ctx,e.type,box,{face:e.face,ang:Math.atan2(h*.5-e.y,w*.5-e.x),heading:e.heading,seed:e.seed,attack:e.lunge>0});
  ctx.restore();
  let top=e.y-box*(e.type==='ant'?.5:.6);
  if(e.type==='human'){
    if(e.state==='pave'){ctx.fillStyle='#243322';ctx.fillRect(e.x-24,top-2,48,5);ctx.fillStyle='#e9d98a';ctx.fillRect(e.x-24,top-2,48*Math.min(1,e.t/3.5),5)}
    return;
  }
  ctx.fillStyle='#243322';ctx.fillRect(e.x-17,top,34,4);ctx.fillStyle='#d65347';ctx.fillRect(e.x-17,top,34*Math.max(0,e.hp/e.maxHp),4);
  ctx.drawImage(badgeSprite(I.counter),e.x+19,top-6,16,16);
}
/* While bees are selected: a dotted crayon line runs from each one to the mouse, an X replaces the cursor, and a label says what a click will do. */
function drawAim(){
  let sel=selection.filter(b=>!b.dead),m=mouse,hb=hoverBee,escortHover=!!(hb&&hb.type==='farmer'&&!sel.includes(hb)&&sel.some(b=>b.type!=='farmer')),show=!!(sel.length&&m&&playing&&!ended&&!interlude&&!paused&&!drag&&(!hb||escortHover));
  canvas.classList.toggle('aiming',show);canvas.classList.toggle('hovering',!!(hb||hoverEnemy)&&!show);
  if(!show)return;
  let o=orderAt(m.x,m.y,sel),label=ORDER_LABEL[escortHover?'escort':o.kind]+(sel.length>1?` ×${sel.length}`:''),r=rng(boil()*7+3),x=9;
  if(o.kind==='patrol'){let R=ringRadius(outerRing)+22;ctx.save();ctx.setLineDash([3,9]);scribble(ctx,w*.5,h*.5,R,R,'#fff3b0',2.4,rng(boil()+5),1,.95);ctx.restore()}
  ctx.save();ctx.lineCap=ctx.lineJoin='round';ctx.setLineDash([1,10]);ctx.lineDashOffset=-ambientTime*26;
  for(const b of sel){let d=Math.hypot(m.x-b.x,m.y-b.y);if(d<24)continue;let ux=(m.x-b.x)/d,uy=(m.y-b.y)/d;ctx.beginPath();ctx.moveTo(b.x+ux*20,b.y+uy*20);ctx.lineTo(m.x-ux*14,m.y-uy*14);ctx.strokeStyle=INK;ctx.globalAlpha=.6;ctx.lineWidth=6;ctx.stroke();ctx.globalAlpha=1;ctx.strokeStyle='#fff3b0';ctx.lineWidth=3.4;ctx.stroke()}
  ctx.setLineDash([]);ctx.restore();
  if(escortHover)scribble(ctx,hb.x,hb.y,26,26,'#ffc72e',3,rng(hb.id*7+boil()),2,1);
  if(o.marker)scribble(ctx,o.marker.x,o.marker.y,25,25,'#fff3b0',3,rng(boil()+11),2,1);
  if(o.grove)scribble(ctx,o.grove.u*w,o.grove.v*h+4,66,46,'#fff3b0',3,rng(boil()+13),2,1);
  ctx.save();ctx.lineCap='round';ctx.beginPath();ctx.moveTo(m.x-x+(r()-.5)*2,m.y-x);ctx.lineTo(m.x+x,m.y+x+(r()-.5)*2);ctx.moveTo(m.x+x+(r()-.5)*2,m.y-x);ctx.lineTo(m.x-x,m.y+x+(r()-.5)*2);ctx.strokeStyle=INK;ctx.lineWidth=6.5;ctx.stroke();ctx.strokeStyle='#d94e43';ctx.lineWidth=3.6;ctx.stroke();ctx.restore();
  handText(label,m.x,m.y+28,15);
}
/* Standing orders stay visible: a travelling bee shows a dotted line to where it is going, and a bee holding a post shows a small mark on it. */
function drawRoutes(){
  if(interlude)return;
  ctx.save();ctx.lineCap='round';
  for(const b of bees){
    if(b.dead)continue;
    let t=null,farm=b.type==='farmer',focus=selection.includes(b)||b===hoverBee,col=BEE_TYPES[b.type].color;
    if(b.mode==='move'&&b.target)t=b.target;else if(b.mode==='escort'&&b.escort&&!b.escort.dead)t=b.escort;else if(farm&&b.mode==='outbound'&&b.grove)t=grovePos(b.grove);else if(farm&&b.mode==='return')t={x:w*.5,y:h*.5};
    if(b.mode==='hold'&&b.post){ctx.setLineDash([]);scribble(ctx,b.post.x,b.post.y+24,7,3.5,col,2.4,rng(b.id+boil()),1,.9)}
    if(!t||Math.hypot(t.x-b.x,t.y-b.y)<20)continue;
    let travelling=b.mode==='move';
    ctx.setLineDash([2,9]);ctx.lineDashOffset=-ambientTime*18;ctx.beginPath();ctx.moveTo(b.x,b.y);ctx.lineTo(t.x,t.y);
    if(travelling||focus){ctx.globalAlpha=.5;ctx.strokeStyle=INK;ctx.lineWidth=5.5;ctx.stroke()}
    ctx.globalAlpha=focus||travelling?1:farm?.4:.75;ctx.strokeStyle=travelling?'#fff3b0':col;ctx.lineWidth=focus||travelling?3.4:2.6;ctx.stroke();
    if(travelling){ctx.setLineDash([]);scribble(ctx,t.x,t.y,9,9,INK,4.5,rng(b.id+boil()),1,.5);scribble(ctx,t.x,t.y,9,9,col,2.8,rng(b.id+boil()),1,1)}
  }
  ctx.restore();
}
function drawHover(){
  if(!mouse||canvas.classList.contains('aiming')||drag)return;
  let b=hoverBee,e=hoverEnemy;
  if(b){let T=BEE_TYPES[b.type];handText(`${T.name} · ${T.role}`,b.x,b.y+48*T.scale,15)}
  else if(e){let I=ENEMY_INFO[e.type];handText(`${I.name} · ${I.tip}`,e.x,e.y+I.size*.5+22,15,'#3a2a14')}
}
function drawEdgeFog(){if(!fogArt.complete||!fogArt.naturalWidth)return;const t=ambientTime,soft=fogBlurSprite(),layer=(x,y,sw,sh,phase,alpha,rotation=0)=>{ctx.save();ctx.globalAlpha=alpha;ctx.translate(x,y);ctx.rotate(rotation);ctx.drawImage(soft,-sw/2,-sh/2,sw,sh);ctx.restore()};
// Broad, slow banks sit against the canopy, with smaller wisps passing in front.
for(let i=0;i<8;i++){const side=i%4,band=Math.floor(i/4),phase=i*2.17+band*.8;let x,y,sw,sh;if(side===0||side===2){x=w*(side===0?.04:.96)+Math.sin(t*.12+phase)*w*.045;y=h*(.12+(.76*i/3))+Math.cos(t*.18+phase)*h*.035;sw=w*(.26+band*.13);sh=h*(.18+band*.08)}else{x=w*(.12+(.76*(side-1)/2))+Math.sin(t*.15+phase)*w*.035;y=h*(side===1?.035:.965)+Math.cos(t*.13+phase)*h*.035;sw=w*(.28+band*.12);sh=h*(.24+band*.1)}const driftX=Math.sin(t*(.08+band*.025)+phase)*w*.045,driftY=Math.cos(t*(.1+band*.02)+phase)*h*.025,breath=.72+.28*Math.sin(t*.42+phase);layer(x+driftX,y+driftY,sw*(1+.12*Math.sin(t*.16+phase)),sh*(1+.1*Math.cos(t*.14+phase)),Math.sin(t*.09+phase)*.16,(band===0?.12:.19)*breath,Math.sin(t*.11+phase)*.08)}
// Veils of translucent haze feather the tree edge into the clearing.
for(let i=0;i<6;i++){const phase=i*1.91,edge=i%4,u=(i*.173+.08)%1;let x=edge===0?u*w:edge===1?w:u*w,y=edge===2?u*h:edge===3?h:u*h;const size=Math.min(w,h)*(.2+.08*Math.sin(t*.17+phase));layer(x+Math.sin(t*.19+phase)*24,y+Math.cos(t*.16+phase)*20,size*(edge<2?1.55:1.15),size*(edge<2?1.05:1.5),Math.sin(t*.1+phase)*.2,.075+.04*Math.sin(t*.55+phase),Math.sin(t*.1+phase)*.12)}}
/* Each bee type gets its own ground mark, aura line and badge: soldier = solid orange + shield, gas = dashed teal + cloud, farmer = dotted yellow + flower. */
function badgeSprite(type){return sprite('badge'+type,40,40,g=>{g.translate(20,20);g.fillStyle=BEE_TYPES[type].color;g.beginPath();g.arc(0,0,16,0,Math.PI*2);g.fill();g.lineWidth=3;g.strokeStyle=INK;g.stroke();g.fillStyle='#fffaea';g.lineWidth=1.8;g.lineJoin='round';g.beginPath();if(type==='soldier'){g.moveTo(-7,-8);g.lineTo(7,-8);g.lineTo(7,0);g.quadraticCurveTo(7,7,0,10);g.quadraticCurveTo(-7,7,-7,0);g.closePath()}else if(type==='gas'){for(const[x,y,r]of[[-5,3,5],[5,3,5],[0,-3,6]]){g.moveTo(x+r,y);g.arc(x,y,r,0,Math.PI*2)}}else{for(let i=0;i<5;i++){let a=i/5*Math.PI*2-Math.PI/2,x=Math.cos(a)*5.5,y=Math.sin(a)*5.5;g.moveTo(x+4,y);g.arc(x,y,4,0,Math.PI*2)}}g.fill();g.stroke();if(type==='farmer'){g.fillStyle='#f08a1c';g.beginPath();g.arc(0,0,3.2,0,Math.PI*2);g.fill()}})}
function hive(){let x=w*.5,y=h*.5,size=Math.min(150,Math.max(108,w*.14));hatch(ctx,x,y+size*.36,size*.55,size*.16,'#5d4a22',.25,rng(5),3.5,-.4,3.5);if(hiveArt.complete&&hiveArt.naturalWidth){ctx.save();if(hiveHitFlash>0){ctx.filter='sepia(1) saturate(8) hue-rotate(315deg)';ctx.globalAlpha=.72+.28*Math.sin(ambientTime*35);ctx.shadowColor='#ef382dcc';ctx.shadowBlur=20;ctx.drawImage(hiveArt,380,250,1400,1450,x-size/2,y-size/2,size,size)}else{ctx.drawImage(hiveSprite(false),x-size/2,y-size/2,size,size);hiveDamage(x,y,size)}ctx.restore()}hiveHealthRing(x,y,size)}
/* The hive shows its own condition: it darkens and cracks as it is hit, and a crayon health ring runs around it. */
function hiveDamage(x,y,size){let dmg=1-Math.max(0,health)/100;if(dmg<.2||tutorial)return;ctx.save();ctx.globalAlpha=Math.min(.75,dmg*.9);ctx.drawImage(hiveSprite(true),x-size/2,y-size/2,size,size);ctx.globalAlpha=.85;ctx.strokeStyle=INK;ctx.lineCap=ctx.lineJoin='round';let r=rng(42),n=Math.floor(dmg*9);for(let i=0;i<n;i++){let px=x+(r()-.5)*size*.45,py=y+(r()-.6)*size*.4;ctx.lineWidth=1.5+r()*1.3;ctx.beginPath();ctx.moveTo(px,py);for(let k=0;k<4;k++){px+=(r()-.5)*15;py+=4+r()*9;ctx.lineTo(px,py)}ctx.stroke()}ctx.restore()}
function hiveHealthRing(x,y,size){if(interlude&&!interlude.dawnOnly)return;let R=size*.56,k=Math.max(0,health)/100,low=k<.3,flash=hiveHitFlash>0,col=flash?'#ff3b2b':k>.6?'#ffc72e':k>.3?'#f08a1c':'#d94e43',lw=7+(low?Math.sin(ambientTime*8)*1.5+1.5:0)+(flash?3:0);ctx.save();ctx.lineCap='round';ctx.globalAlpha=.5;ctx.strokeStyle=INK;ctx.lineWidth=lw+5;ctx.beginPath();ctx.arc(x,y,R,0,Math.PI*2);ctx.stroke();ctx.globalAlpha=.9;ctx.strokeStyle='#fffaea';ctx.lineWidth=lw;ctx.stroke();if(k>0){ctx.globalAlpha=1;ctx.strokeStyle=col;ctx.beginPath();ctx.arc(x,y,R,-Math.PI/2,-Math.PI/2+Math.PI*2*k);ctx.stroke()}ctx.restore()}
/* Days: each raid is one day. Clearing it plays a short dusk → night → dawn scene over the meadow; the queen lays an egg overnight. */
const DUSK=2.6,NIGHT_END=5.2,DAWN_END=7.8,smooth=x=>x*x*(3-2*x);function startInterlude(dawnOnly){selection=[];interlude={t:dawnOnly?NIGHT_END:0,day:wave,dawnOnly,egg:dawnOnly,eggGiven:false,fire:Array.from({length:26},()=>({u:.06+Math.random()*.88,v:.12+Math.random()*.78,p:Math.random()*6}))};if(!dawnOnly)sfx('clear')}function giveNightEgg(){let s=interlude;if(!s||s.egg)return;s.egg=true;s.eggGiven=eggs.length<EGG_MAX;if(s.eggGiven){eggs.push(++eggCounter);drawEggs()}}function updateInterlude(dt){let s=interlude;s.t+=dt;if(s.t>=DUSK)giveNightEgg();if(s.t>=DAWN_END)endInterlude()}const moonSprite=()=>sprite('moon',80,80,g=>{let r=rng(9);g.fillStyle='#fff3c4';g.beginPath();g.arc(40,40,24,0,Math.PI*2);g.fill();hatch(g,40,40,24,24,'#e9d48a',.7,r,3,-.7,2);scribble(g,40,40,24,24,INK,1.8,r,1,.9);g.globalCompositeOperation='destination-out';g.beginPath();g.arc(53,31,22,0,Math.PI*2);g.fill()});function crayonSun(x,y,alpha){if(alpha<=.01)return;let r=rng(77+boil());ctx.save();ctx.globalAlpha=alpha;ctx.fillStyle='#ffc72e';ctx.beginPath();ctx.arc(x,y,24,0,Math.PI*2);ctx.fill();hatch(ctx,x,y,25,25,'#f08a1c',.8*alpha,r,3,-.7,2.4);scribble(ctx,x,y,26,26,INK,2,r,1,alpha);ctx.globalAlpha=alpha;ctx.strokeStyle='#f0a01c';ctx.lineWidth=3;ctx.lineCap='round';for(let i=0;i<10;i++){let a=i/10*Math.PI*2+ambientTime*.2,l=42+r()*5;ctx.beginPath();ctx.moveTo(x+Math.cos(a)*33,y+Math.sin(a)*33);ctx.lineTo(x+Math.cos(a)*l,y+Math.sin(a)*l);ctx.stroke()}ctx.restore()}function drawInterlude(){let s=interlude;if(!s)return;let t=s.t,pd=clamp01(t/DUSK),pw=clamp01((t-NIGHT_END)/(DAWN_END-NIGHT_END)),dark=t<DUSK?smooth(pd):t<NIGHT_END?1:1-smooth(pw),warm=t<DUSK?Math.sin(Math.PI*pd):t>=NIGHT_END?Math.sin(Math.PI*pw):0;ctx.save();if(warm>0){ctx.globalAlpha=warm*.26;ctx.fillStyle='#ff9a3c';ctx.fillRect(0,0,w,h)}ctx.globalCompositeOperation='multiply';ctx.globalAlpha=dark*.8;ctx.fillStyle='#38407a';ctx.fillRect(0,0,w,h);ctx.globalCompositeOperation='lighter';let g=ctx.createRadialGradient(w*.5,h*.5,0,w*.5,h*.5,ringRadius(0)*1.4);g.addColorStop(0,'rgba(255,190,70,.5)');g.addColorStop(1,'rgba(255,190,70,0)');ctx.globalAlpha=dark;ctx.fillStyle=g;ctx.fillRect(0,0,w,h);ctx.fillStyle='#ffe27a';for(const f of s.fire){let a=dark*(.4+.6*Math.sin(ambientTime*2.4+f.p*3));if(a<=0)continue;let x=f.u*w+Math.sin(ambientTime*.6+f.p)*18,y=f.v*h+Math.cos(ambientTime*.5+f.p)*12;ctx.globalAlpha=a*.35;ctx.beginPath();ctx.arc(x,y,7,0,Math.PI*2);ctx.fill();ctx.globalAlpha=a;ctx.beginPath();ctx.arc(x,y,2,0,Math.PI*2);ctx.fill()}ctx.restore();if(t<DUSK)crayonSun(lerp(w*.6,w*.7,pd),lerp(h*.2,h*.56,pd),smooth(Math.min(1,pd*3))*(1-smooth(clamp01((pd-.4)/.6))));let pm=clamp01((t-DUSK+.4)/(NIGHT_END-DUSK+.8));if(pm>0&&pm<1){ctx.save();ctx.globalAlpha=Math.sqrt(Math.sin(Math.PI*pm));ctx.drawImage(moonSprite(),lerp(w*.32,w*.64,pm)-40,h*.2-Math.sin(Math.PI*pm)*h*.06-40,80,80);ctx.restore()}if(t>=NIGHT_END)crayonSun(lerp(w*.3,w*.38,pw),lerp(h*.56,h*.2,pw),Math.sin(Math.PI*pw));let z=t<DUSK?smooth(clamp01(pd*2-1)):t<NIGHT_END?1:1-smooth(clamp01(pw*2));if(z>.02){ctx.save();ctx.globalAlpha=z;for(const b of bees){if(b.dead)continue;let k=(ambientTime*.7+b.id*.37)%1;handText(k<.5?'z':'Z',b.x+12+k*8,b.y-30-k*16,12+k*6)}ctx.restore()}}
function drawPings(){for(const p of pings){let k=1-p.life/.7,R=10+k*30;ctx.save();ctx.globalAlpha=1-k;scribble(ctx,p.x,p.y,R,R*.75,INK,5,rng(p.seed),1,.5);scribble(ctx,p.x,p.y,R,R*.75,p.color,3,rng(p.seed),2,1);ctx.restore()}}
function drawFloaters(){for(const f of floaters){ctx.save();ctx.globalAlpha=Math.min(1,f.life*2);handText(f.text,f.x,f.y-(1.1-f.life)*34,f.size||18,f.color);ctx.restore()}}
function drawHitFlash(){if(hiveHitFlash<=0)return;let g=ctx.createRadialGradient(w/2,h/2,Math.min(w,h)*.3,w/2,h/2,Math.max(w,h)*.72);g.addColorStop(0,'rgba(217,58,43,0)');g.addColorStop(1,`rgba(217,58,43,${Math.min(.55,hiveHitFlash*1.3)})`);ctx.fillStyle=g;ctx.fillRect(0,0,w,h)}
function drawDrag(){if(!drag||!drag.moved)return;let x=Math.min(drag.x0,drag.x1),y=Math.min(drag.y0,drag.y1),bw=Math.abs(drag.x1-drag.x0),bh=Math.abs(drag.y1-drag.y0);ctx.save();ctx.setLineDash([6,6]);ctx.lineDashOffset=-ambientTime*20;ctx.strokeStyle=INK;ctx.globalAlpha=.6;ctx.lineWidth=5;ctx.strokeRect(x,y,bw,bh);ctx.globalAlpha=1;ctx.strokeStyle='#fff3b0';ctx.lineWidth=2.6;ctx.strokeRect(x,y,bw,bh);ctx.fillStyle='rgba(255,243,176,.12)';ctx.fillRect(x,y,bw,bh);ctx.restore()}

/* Dawn: the night is over. A new threat may be introduced before the day's countdown starts. */
function endInterlude(){
  let s=interlude;if(!s)return;
  giveNightEgg();interlude=null;
  nextWave=s.dawnOnly?FIRST_RAID_IN:NEXT_RAID_IN;
  hud();dawn(wave+1);
}
function dawn(day){
  let type=DAY_INTRO[day]||(day===1&&!trained?'ant':null);
  if(type)showIntro(type,()=>{if(type==='cloud'&&!lessonDone)startLesson()});
}

/* ================= TRAINING ================= */
/* New-enemy cutscenes. The first time each enemy appears the meadow music stops and the game fades to black. A flip-book draws
   closer and closer to a bee in the flowers (intro-bee-6 down to intro-bee-1) until a shadow falls over her; that drawing fades to
   black, and on the black the enemy pops up on a circle of paper with its name, one line on how it attacks, and the bee that beats it.
   name / text / how are the words on that screen; box is how big the enemy is drawn there. */
const INTROS={
ant:{name:'Ant',text:'Ants march straight for the hive.',how:'soldiers sting them',box:150},
hornet:{name:'Hornet',text:'Hornets hunt your farmers.',how:'soldiers sting them',box:190},
cloud:{name:'Pesticide',text:'It poisons every bee it touches.',how:'only gas bees can clear it',box:240},
bear:{name:'Bear',text:'Slow, tough and after your honey.',how:'send many soldiers at once',box:190},
human:{name:'Builder',text:'It paves over your flower groves.',how:'no bee can stop it',box:220}};
const INTRO_FLIP=.3,INTRO_HOLD=2.6,INTRO_DARK=.35,INTRO_REVEAL=INTRO_HOLD+INTRO_DARK;  // seconds per flip-book drawing; when the last drawing starts fading to black; how long that fade takes
let intro=null;
const introCard=$('#introCard'),introCtx=$('#introCanvas').getContext('2d');
function showIntro(type,then){
  if(introSeen[type]){then&&then();return}
  introSeen[type]=1;paused=true;selection=[];
  let I=ENEMY_INFO[type],X=INTROS[type],chip=$('#introCounter'),me=intro={type,then,start:Infinity,revealed:false,closing:false};
  $('#introTitle').textContent=X.name;$('#introText').textContent=X.text;
  chip.innerHTML=(I.counter?`<i class="bee-icon ${I.counter}"></i>`:'<i class="no-bee">✕</i>')+`<span>${X.how}</span>`;
  chip.style.setProperty('--c',I.counter?BEE_TYPES[I.counter].color:NO_COUNTER);
  introCard.classList.remove('reveal');meadowTo(0,.6);
  fadeTo(1,600).then(()=>{if(intro!==me)return;introCard.hidden=false;me.start=ambientTime+.5;scoreHit('horn');fadeTo(0,600)});
}
/* A click during the drawings skips ahead to the reveal; a click on the reveal fades back to the meadow and the music returns. */
function closeIntro(){
  let me=intro;if(!me||me.closing||introCard.hidden)return;
  if(!me.revealed){me.start=Math.min(me.start,ambientTime-INTRO_HOLD);return}
  me.closing=true;
  fadeTo(1,500).then(()=>{if(intro!==me)return;closeIntroNow();meadowTo(MUSIC_VOLUME,1.6);if(me.then)me.then();fadeTo(0,700)});
}
function closeIntroNow(){introCard.hidden=true;introCard.classList.remove('reveal');if(intro)paused=false;intro=null}
function drawIntro(){
  let me=intro;if(!me||introCard.hidden)return;
  let c=introCtx,W=960,H=540,t=ambientTime-me.start,
      cover=im=>{if(!ready(im))return;let s=Math.max(W/im.naturalWidth,H/im.naturalHeight);c.drawImage(im,(W-im.naturalWidth*s)/2,(H-im.naturalHeight*s)/2,im.naturalWidth*s,im.naturalHeight*s)};
  c.setTransform(1,0,0,1,0,0);c.globalAlpha=1;c.globalCompositeOperation='source-over';
  if(t<INTRO_REVEAL){
    c.fillStyle='#fbfaf6';c.fillRect(0,0,W,H);
    cover(introBeeArt[5-Math.min(5,Math.floor(Math.max(0,t)/INTRO_FLIP))]);
    c.globalAlpha=clamp01((t-INTRO_HOLD)/INTRO_DARK);c.fillStyle='#000';c.fillRect(0,0,W,H);c.globalAlpha=1;
    return;
  }
  if(!me.revealed){me.revealed=true;introCard.classList.add('reveal')}
  let type=me.type,X=INTROS[type],counter=ENEMY_INFO[type].counter,col=counter?BEE_TYPES[counter].color:NO_COUNTER,R=135,
      k=clamp01((t-INTRO_REVEAL-.5)/.55),pop=k<=0?0:1+2.70158*Math.pow(k-1,3)+1.70158*Math.pow(k-1,2),r=rng(boil()+3);  // pops in with a small overshoot, in time with the name
  c.fillStyle='#000';c.fillRect(0,0,W,H);
  if(pop<=0)return;
  c.save();c.translate(W/2,H/2);c.scale(pop,pop);
  /* A circle of paper for the enemy to stand on: the drawings are pencil on white and would vanish on black. */
  c.fillStyle='#fbfaf6';c.beginPath();c.arc(0,0,R,0,Math.PI*2);c.fill();
  scribble(c,0,0,R+3,R+3,'#fffaea',5,r,2,.9);
  let box=X.box,gy=Math.min(R-28,box*.5);
  scribble(c,0,gy,box*.42,box*.11,col,4,r,2,1);  // its ring, in the colour of the bee that beats it, as on the meadow
  c.translate(0,Math.sin(ambientTime*3)*4);
  drawEnemyArt(c,type,box,{face:-1,ang:-Math.PI/2,heading:Math.PI/2});  // upright, facing the player
  c.restore();
}

/* Tutorial 1 (ants) and tutorial 2 (gas bees) share one coach: one short line per step, and a spotlight that closes in on what matters.
   The field is first shown untouched for TUTORIAL_HOLD seconds so the player can take it in.
   only = the one bee that may be hatched during the step, scoutOnly = orders must go to the scout marker,
   dom = an HTML element to spotlight, focus = things on the field to spotlight, nodim = no spotlight (the player needs the whole field),
   keep = runs every frame while the step is current, done = the step waits until this is true. */
const TUTORIAL_HOLD=1;
const hiveFocus=()=>({x:w*.5,y:h*.5,r:hiveSize()*.62}),beeFocus=b=>b&&!b.dead?{x:b.x,y:b.y,r:26}:null,typeFocus=type=>bees.filter(b=>!b.dead&&b.type===type).map(b=>({x:b.x,y:b.y,r:24})),foeFocus=()=>enemies.filter(e=>!e.dead).map(e=>({x:e.x,y:e.y,r:ENEMY_INFO[e.type].size*.45}));
const tutorialHeld=()=>!!tutorial&&ambientTime<tutorial.readyAt;
/* Puts an enemy on the field at a given angle from the hive, just inside the fog line so the player can see it coming. */
function tutorialEnemy(type,angle,far=0,speed=22,damage=20){
  let d=Math.min(ringRadius(1)+150,Math.min(w,h)*.5-40)+far,x=Math.max(40,Math.min(w-40,w*.5+Math.cos(angle)*d)),y=Math.max(70,Math.min(h-40,h*.5+Math.sin(angle)*d)),e=makeEnemy(type,x,y,1);
  e.speed=speed;e.damage=damage;exploredAreas.push({x,y,r:Math.min(w,h)*.2});enemies.push(e);return e;
}
const TRAINING_STEPS=[
{text:'This is your hive. Keep it standing.',dom:'#healthBox',focus:hiveFocus},
{text:'Click your farmer.',focus:t=>beeFocus(t.farmer),done:t=>selection.includes(t.farmer)||t.farmer.mode==='move'||t.grove.discovered},
{text:'Now click the glowing marker.',scoutOnly:true,focus:t=>t.farmer.mode==='move'?beeFocus(t.farmer):selection.length?{x:t.marker.x,y:t.marker.y,r:22}:beeFocus(t.farmer),done:t=>t.grove.discovered},
{text:'She brings food home. Food means eggs.',focus:t=>[beeFocus(t.farmer),{x:t.grove.u*w,y:t.grove.v*h,r:50}],done:t=>t.food>0},
{text:'Hatch a soldier.',enter:()=>layEgg(),only:'soldier',dom:'[data-hatch="soldier"]',keep:t=>{if(!eggs.length&&!hatchBusy&&!t.soldier)layEgg()},done:t=>t.soldier},
{text:'Ants! Click your soldier, then the ants.',enter:t=>{t.ants=[tutorialEnemy('ant',-.3),tutorialEnemy('ant',-.05,40)]},focus:()=>[...typeFocus('soldier'),...foeFocus()],done:()=>!enemies.some(e=>!e.dead)},
{text:'A raid! Hatch a bee and hold the hive.',enter:()=>{layEgg();for(const[a,far]of[[2.2,60],[2.5,110],[3.5,90],[.9,120],[1.2,170],[-1.4,150]])tutorialEnemy('ant',a,far,30,20)},dom:'.hatch-types',nodim:true,focus:foeFocus,done:()=>!enemies.some(e=>!e.dead)},
{text:'You’re ready.',enter:()=>sfx('clear'),button:'BEGIN →',finish:true}];
const GAS_LESSON_STEPS=[
{text:'Pesticide. Soldiers can’t stop it.',enter:t=>{t.demo=tutorialEnemy('cloud',-2.2,0,9,6)},focus:t=>t.demo&&!t.demo.dead?{x:t.demo.x,y:t.demo.y,r:40}:null},
{text:'Hatch a gas bee.',only:'gas',dom:'[data-hatch="gas"]',keep:t=>{if(!eggs.length&&!hatchBusy&&!bees.some(b=>!b.dead&&b.type==='gas'))layEgg()},done:()=>bees.some(b=>!b.dead&&b.type==='gas')},
{text:'Click your gas bee, then the cloud.',focus:()=>[...typeFocus('gas'),...foeFocus()],keep:t=>{if(!enemies.some(e=>!e.dead&&e.type==='cloud')&&!t.cleared){if(t.demo&&t.demo.hp<=0)t.cleared=true;else t.demo=tutorialEnemy('cloud',-2.2,0,9,6)}},done:t=>t.cleared},
{text:'Keep a gas bee near the hive.',enter:()=>scoreHit('chime'),button:'GOT IT →',finish:true}];
function setupTutorial(){
  resetWorld();nextWave=0;makeScoutMarkers();
  let m=scoutMarkers.reduce((a,c)=>Math.hypot(c.u-.84,c.v-.5)<Math.hypot(a.u-.84,a.v-.5)?c:a),farmer=makeBee('farmer',w*.5,h*.62,'idle');
  scoutMarkers=[m];flowerGroves=[{u:m.x/w,v:m.y/h,i:0,seed:Math.random()*1000,reveal:0,discovered:false,paved:0,paving:false,gone:false,native:false}];bees.push(farmer);
  /* readyAt: 1.5 s for the fade in from the opening, then the hold. */
  tutorial={kind:'ants',steps:TRAINING_STEPS,step:0,max:-1,marker:m,grove:flowerGroves[0],soldier:null,gas:null,farmer,food:0,focusEl:null,failed:false,readyAt:ambientTime+1.5+TUTORIAL_HOLD,spotAt:0,holes:[]};
  hud();drawEggs();$('.game-shell').classList.add('tutorial');setTutorialStep(0);
}
function placeTutorialGrove(){let t=tutorial;if(!t||t.kind!=='ants'||t.grove.discovered||!scoutMarkers.includes(t.marker))return;t.grove.u=t.marker.x/w;t.grove.v=t.marker.y/h}
/* Tutorial 2 runs inside the real game on the morning pesticide first appears. The day's countdown waits until it is finished. */
function startLesson(){
  selection=[];
  tutorial={kind:'gas',steps:GAS_LESSON_STEPS,step:0,max:-1,demo:null,cleared:false,soldier:null,gas:null,farmer:null,food:0,focusEl:null,failed:false,readyAt:ambientTime+.7+TUTORIAL_HOLD,spotAt:0,holes:[]};
  $('.game-shell').classList.add('tutorial');setTutorialStep(0);
}
function finishLesson(){lessonDone=true;clearTutorial();nextWave=NEXT_RAID_IN;hud()}
/* The training can be lost: if the hive falls, the coach offers another try. */
function tutorialFail(){
  let t=tutorial;t.failed=true;playing=false;selection=[];health=0;hud();sfx('hive');
  $('#coachText').textContent='The hive fell. Keep a soldier between the ants and the hive.';
  $('#coachNext').hidden=false;$('#coachNext').textContent='TRY AGAIN ↻';
}
function setTutorialStep(i){
  let t=tutorial,s=t.steps[i];t.step=i;if(i>t.max){t.max=i;s.enter?.(t)}
  t.spotAt=Math.max(ambientTime,t.readyAt);drawEggs();
  $('#coachText').textContent=s.text;restart($('#coach'),'enter');refreshCoach();
}
function refreshCoach(){let t=tutorial,s=t.steps[t.step],next=$('#coachNext'),waiting=!!s.done&&!s.done(t),label=s.button||'NEXT →';if(next.hidden!==waiting)next.hidden=waiting;if(next.textContent!==label)next.textContent=label}
function syncTutorial(){
  if(!tutorial||!playing)return;
  let t=tutorial,s=t.steps[t.step],held=tutorialHeld(),el=held?null:s.dom?$(s.dom):null;
  $('#coach').classList.toggle('show',!held);
  if(el!==t.focusEl){t.focusEl?.classList.remove('tut-focus');el?.classList.add('tut-focus');t.focusEl=el}
  if(held)return;
  s.keep?.(t);
  if(s.done?.(t))setTutorialStep(t.step+1);else refreshCoach();
}
function clearTutorial(){tutorial?.focusEl?.classList.remove('tut-focus');tutorial=null;$('.game-shell').classList.remove('tutorial');$('#coach').classList.remove('show','enter');drawEggs();placeScoutMarkers()}
/* A crayon ring around each thing on the field the step is about. */
function drawTutorial(){
  if(!tutorial||tutorial.failed||tutorialHeld())return;
  for(const f of[tutorial.steps[tutorial.step].focus?.(tutorial)].flat().filter(Boolean)){let r=rng(Math.floor(f.x*7+f.y)+boil());scribble(ctx,f.x,f.y,f.r+5,f.r+5,INK,5,r,1,.5);scribble(ctx,f.x,f.y,f.r+4,f.r+4,'#ffc72e',3.4,r,2,1)}
}
/* The spotlight: everything goes 90% black except what the step is about, and the holes close in from the edges of the screen like an
   iris so the eye follows them. Each hole is a rounded box (hw, hh = half its inner size, r = corner radius): field targets are circles,
   HTML targets take the shape of the element. Holes glide when the target moves on within a step. */
const spotCanvas=$('#spotlight'),spotCtx=spotCanvas.getContext('2d');let spotDrawn=false;
function drawSpotlight(dt){
  let t=tutorial,s=t&&t.steps[t.step],c=spotCtx,W=spotCanvas.width/dpr,H=spotCanvas.height/dpr,want=[];
  if(t&&!t.failed&&playing&&!s.nodim&&!tutorialHeld()){
    for(const f of[s.focus?.(t)].flat().filter(Boolean))want.push({x:f.x*MAP_ZOOM,y:f.y*MAP_ZOOM,hw:0,hh:0,r:(f.r+18)*MAP_ZOOM});
    let el=s.dom&&$(s.dom);
    if(el&&el.offsetParent){let a=el.getBoundingClientRect(),g=spotCanvas.getBoundingClientRect();want.push({x:a.left-g.left+a.width/2,y:a.top-g.top+a.height/2,hw:Math.max(0,a.width/2-4),hh:Math.max(0,a.height/2-4),r:12})}
  }
  c.setTransform(dpr,0,0,dpr,0,0);
  if(!want.length){if(spotDrawn){c.clearRect(0,0,W,H);spotDrawn=false}if(t)t.holes=[];return}
  if(t.holes.length!==want.length)t.holes=want.map(o=>({...o}));
  else{let k=Math.min(1,dt*10);t.holes.forEach((o,i)=>{for(const p of['x','y','hw','hh','r'])o[p]+=(want[i][p]-o[p])*k})}
  let p=clamp01((ambientTime-t.spotAt)/.8),grow=Math.pow(1-p,3)*Math.hypot(W,H);
  c.clearRect(0,0,W,H);c.globalCompositeOperation='source-over';c.fillStyle=`rgba(6,5,3,${.9*Math.min(1,p*3)})`;c.fillRect(0,0,W,H);
  c.globalCompositeOperation='destination-out';c.fillStyle='#000';c.shadowColor='#000';c.shadowBlur=16;
  for(const o of t.holes){let r=o.r+grow;c.beginPath();if(c.roundRect)c.roundRect(o.x-o.hw-r,o.y-o.hh-r,2*(o.hw+r),2*(o.hh+r),r);else c.arc(o.x,o.y,Math.max(o.hw,o.hh)+r,0,Math.PI*2);c.fill()}
  c.shadowBlur=0;c.globalCompositeOperation='source-over';spotDrawn=true;
}

function startTraining(){audioCtx();cue('garden',2.5);meadowTo(0,1.5);$('.game-shell').classList.remove('fallen');setupTutorial();playing=true;$('#overlay').classList.add('hidden');$('#result').classList.remove('show')}
function finishTraining(){trained=true;introSeen.ant=1;throughBlack(startMain)}
function startMain(){playMusic();clearTutorial();$('.game-shell').classList.remove('fallen');setup();playing=true;$('#overlay').classList.add('hidden');$('#result').classList.remove('show')}

/* ================= ENDING ================= */
/* Losing is part of the story: the hive falls, the swarm scatters while the picture fades to black, and the ending plays from the dark. */
function finish(){
  if(ended)return;
  ended=true;playing=false;if(tutorial)clearTutorial();selection=[];collapse=true;lastEnding={years:Math.max(1,wave),day:currentDay()};
  meadowTo(0,2);cue('lament',2.5);scoreHit('fall');$('#quip').classList.remove('show');$('.game-shell').classList.add('fallen');
  for(const b of bees){let a=Math.atan2(b.y-h*.5,b.x-w*.5)+(Math.random()-.5)*1.2,v=50+Math.random()*90;b.vx=Math.cos(a)*v;b.vy=Math.sin(a)*v-25}
  fadeTo(1,2400).then(()=>{collapse=null;startStory()});
}
function scatterBees(dt){for(const b of bees){b.x+=b.vx*dt;b.y+=b.vy*dt;b.phase+=dt}}
/* The ending plays in the same picture-book player as the opening (see OPENING below): first how long the colony lived, alone on black,
   then four drawings of what follows when the bees are gone. To change a picture, replace the file in assets/; to change a caption, edit line. */
const clamp01=v=>Math.max(0,Math.min(1,v));
let lastEnding=null;
function endingScenes(years){return[
{card:`The hive only lived ${years} year${years===1?'':'s'}.`,cue:'lament'},
{line:'Bees lose their home.',image:'ending-1-trees.webp',look:'paper'},
{line:'Flowers stop growing.',image:'ending-2-plant.webp',look:'paper'},
{line:'Animals starve.',image:'ending-3-fox.webp',look:'paper'},
{line:'Everything on Earth slowly dies.',image:'ending-4-world.webp',look:'paper'}]}
endingScenes(1).forEach(s=>{if(s.image)art(s.image)});  // preload
/* The sad music keeps playing through the How to Help page; it only stops when a new game starts. */
async function startStory(){
  let e=lastEnding||(lastEnding={years:Math.max(1,wave),day:currentDay()});
  meadowTo(0,1.5);cue('lament',2.5);scoreLevel(.35);
  await fadeTo(1,900);
  $('#result').classList.remove('show');
  playCinema(endingScenes(e.years),showHelpPage);
  await wait(400);fadeTo(0,1400);
}
function showHelpPage(){
  let e=lastEnding||{years:1,day:1};
  $('#resultTag').textContent=`THE HIVE FELL ON DAY ${e.day} · ${e.years} YEAR${e.years===1?'':'S'} OF LIFE`;
  $('#result').classList.add('show');$('#result').scrollTop=0;
}

/* ================= INPUT ================= */
function tick(t){
  let dt=Math.min(.05,(t-last)/1000||0);last=t;ambientTime+=dt;
  if(playing&&!ended&&!paused)gameElapsed+=dt;
  draw();if(collapse)scatterBees(dt);
  update(dt);syncTutorial();drawSpotlight(dt);drawIntro();
  requestAnimationFrame(tick);
}
document.querySelectorAll('[data-hatch]').forEach(b=>b.onclick=()=>hatchEgg(b.dataset.hatch));
$('#soundToggle').onclick=()=>setMuted(!muted);introCard.onclick=closeIntro;
const canvasPoint=e=>{let r=canvas.getBoundingClientRect();return{x:(e.clientX-r.left)/MAP_ZOOM,y:(e.clientY-r.top)/MAP_ZOOM}},canOrder=()=>playing&&!ended&&!interlude&&!paused&&!tutorialHeld();
canvas.addEventListener('pointermove',e=>{mouse=canvasPoint(e);if(drag){drag.x1=mouse.x;drag.y1=mouse.y;if(Math.hypot(drag.x1-drag.x0,drag.y1-drag.y0)>8)drag.moved=true}});
canvas.addEventListener('pointerleave',e=>{if(e.pointerType==='mouse'&&!drag)mouse=null});
canvas.addEventListener('pointerdown',e=>{if(e.button!==0||!canOrder())return;let p=canvasPoint(e);mouse=p;drag={x0:p.x,y0:p.y,x1:p.x,y1:p.y,moved:false,shift:e.shiftKey};try{canvas.setPointerCapture(e.pointerId)}catch(err){}});
canvas.addEventListener('pointerup',()=>{if(!drag)return;let d=drag;drag=null;if(!canOrder())return;if(d.moved)boxSelect(d);else tapAt(d.x0,d.y0,d.shift)});
canvas.addEventListener('pointercancel',()=>{drag=null});
/* Keys. In play: 1/2/3 hatch a soldier, gas bee or farmer; Q/W/E select every bee of that type (A = all defenders, Shift adds); Esc deselects.
   In cutscenes: Space, Enter or Right arrow = continue, Esc = skip. Space also skips the night. */
document.addEventListener('keydown',e=>{
  if(e.ctrlKey||e.metaKey||e.altKey||/INPUT|TEXTAREA|SELECT/.test(e.target.tagName))return;
  let k=e.key.toLowerCase(),next=k==='arrowright'||k===' '||k==='enter',esc=k==='escape';
  if(cinema){if(next){e.preventDefault();advanceCinema()}else if(esc)endCinema();return}
  if(intro){if(next||esc){e.preventDefault();closeIntro()}return}
  if(!playing||ended||tutorialHeld())return;
  if(interlude){if(next||esc){e.preventDefault();endInterlude()}return}
  let hatch={'1':'soldier','2':'gas','3':'farmer'}[k],pick={q:'soldier',w:'gas',e:'farmer',a:'all'}[k];
  if(hatch){e.preventDefault();hatchEgg(hatch)}
  else if(pick){e.preventDefault();selectType(pick,e.shiftKey)}
  else if(esc)selection=[];
});

/* ================= OPENING ================= */
/* Title screen -> fade to black -> opening cutscene -> fade to black -> training (unless skipped) -> day 1.
   Every cutscene (the opening and the ending) plays in one picture-book player: one still drawing at a time, each dissolving into the
   next only when the player clicks, with a blinking "click to continue" once the picture has settled. Nothing zooms or pans.
   Scene fields: image, or frames = a flip-book that plays once and holds on its last drawing; card = words alone on black instead of a picture;
   line = the caption in the bottom bar; look = how the drawing sits: 'baked' (it has its own black bars), 'bars' (fitted between the bars),
   'paper' (a pencil drawing on white); cue = music; sounds = [[ms, scoreHit kind], ...] played while the scene is up. */
const openingScenes=[
{line:'Help.',image:'cutscene-open-1-swarm.webp',look:'baked',cue:'bloom'},
{line:'We need help.',image:'cutscene-open-2-order.webp',look:'baked',cue:'order'},
{frames:['cutscene-open-3-felling.webp','cutscene-open-4-felling.webp','cutscene-open-5-felling.webp','cutscene-open-6-felling.webp'],holdFirst:1700,frameMs:330,look:'bars',cue:'felling',sounds:[[300,'saw'],[1700,'crack'],[2360,'crash']]},
{image:'cutscene-open-7-flee.webp',look:'baked',cue:'escape'},
{image:'cutscene-open-8-tree.webp',look:'baked',cue:'escape'},
{image:'cutscene-stump.png',look:'baked',cue:'escape'}];
openingScenes.forEach(s=>[s.image,...(s.frames||[])].forEach(f=>{if(f)art(f)}));  // preload so nothing flickers
const DISSOLVE=1200;  // ms for one drawing to dissolve into the next (match the .cinema-image transition in the CSS)
const cinemaEl=$('#opening-cinema'),cinemaLayers=[...document.querySelectorAll('#cinemaArt .cinema-image')],wait=ms=>new Promise(r=>setTimeout(r,ms));
let cinema=null,fadeLevel=0,starting=false;
function restart(el,cls){el.classList.remove(cls);void el.offsetWidth;el.classList.add(cls)}
/* One black layer over the whole game handles every fade: fadeTo(1) goes to black, fadeTo(0) comes back. While it is dark it swallows clicks. */
function fadeTo(dark,ms=900){
  let el=$('#fade');if(dark===fadeLevel)return Promise.resolve();
  fadeLevel=dark;el.style.transition=`opacity ${ms}ms ease`;el.style.opacity=dark;if(dark)el.classList.add('on');
  return wait(ms).then(()=>{if(!fadeLevel)el.classList.remove('on')});
}
async function throughBlack(fn){await fadeTo(1,700);fn();await wait(250);fadeTo(0,1000)}
function cinemaLater(fn,ms){cinema.timers.push(setTimeout(fn,ms))}
function stopCinemaTimers(){if(cinema){cinema.timers.forEach(clearTimeout);cinema.timers=[]}}
/* playCinema(scenes, done): the caller fades to black first and back in after; done() runs on black once the last scene is clicked. */
function playCinema(scenes,done){
  stopCinemaTimers();
  cinema={scenes,i:-1,done,ready:false,leaving:false,layer:0,timers:[]};
  cinemaEl.hidden=false;cinemaLayers.forEach(l=>{l.className='cinema-image';l.removeAttribute('src')});
  $('#cinemaCard').hidden=true;$('#cinemaCard').classList.remove('out','enter');
  showScene(0);
}
function showScene(i){
  let c=cinema,s=c.scenes[i],card=$('#cinemaCard'),prompt=$('#cinemaPrompt');
  stopCinemaTimers();c.i=i;c.ready=false;prompt.classList.remove('show');
  if(s.cue)cue(s.cue,i?1.2:2.2);
  $('#cinemaLine').textContent=s.line||'';restart($('.cinema-title'),'enter');
  if(s.card){card.textContent=s.card;card.hidden=false;card.classList.remove('out');restart(card,'enter')}
  else if(!card.hidden){card.classList.remove('enter');card.classList.add('out')}
  /* Two picture layers take turns: the new drawing fades in on one while the old one fades out on the other. */
  let next=cinemaLayers[c.layer=1-c.layer],prev=cinemaLayers[1-c.layer];
  next.className=`cinema-image ${s.look||'bars'}`;
  if(s.card)next.removeAttribute('src');else next.src='assets/'+(s.image||s.frames[0]);
  void next.offsetWidth;next.classList.add('show');prev.classList.remove('show');
  if(s.frames)s.frames.forEach((f,k)=>{if(k)cinemaLater(()=>{next.src='assets/'+f},s.holdFirst+(k-1)*s.frameMs)});
  for(const[ms,kind]of s.sounds||[])cinemaLater(()=>scoreHit(kind),ms);
  let settle=s.frames?s.holdFirst+(s.frames.length-2)*s.frameMs+500:DISSOLVE;
  cinemaLater(()=>{c.ready=true},settle);
  cinemaLater(()=>prompt.classList.add('show'),settle+600);
}
function advanceCinema(){let c=cinema;if(!c||!c.ready||c.leaving)return;if(c.i<c.scenes.length-1)showScene(c.i+1);else endCinema()}
/* The last click (or Skip / Esc) fades to black, hands over to what comes next, and fades back in. */
async function endCinema(){
  let c=cinema;if(!c||c.leaving)return;
  c.leaving=true;stopCinemaTimers();$('#cinemaPrompt').classList.remove('show');
  await fadeTo(1,1000);
  if(cinema!==c)return;
  cinema=null;cinemaEl.hidden=true;
  if(c.done)c.done();
  await wait(350);fadeTo(0,1100);
}
async function beginOpening(){
  if(cinema||starting)return;starting=true;
  audioCtx();meadowTo(0,1.5);
  playing=false;collapse=null;closeIntroNow();paused=false;if(tutorial)clearTutorial();
  await fadeTo(1,1100);
  $('#overlay').classList.add('hidden');$('#result').classList.remove('show');
  playCinema(openingScenes,()=>wantTraining?startTraining():startMain());starting=false;
  await wait(500);fadeTo(0,1500);
}
function begin(training){wantTraining=training;beginOpening()}
$('#play').onclick=()=>begin(true);$('#skip').onclick=()=>begin(false);
cinemaEl.onclick=advanceCinema;$('#cinemaSkip').onclick=e=>{e.stopPropagation();endCinema()};
$('#coachSkip').onclick=()=>{if(!tutorial)return;if(tutorial.kind==='gas')finishLesson();else throughBlack(startMain)};
$('#coachNext').onclick=()=>{let t=tutorial;if(!t)return;if(t.failed)throughBlack(startTraining);else if(!t.steps[t.step].finish)setTutorialStep(t.step+1);else if(t.kind==='gas')finishLesson();else finishTraining()};
async function toggleGameFullscreen(){try{if(document.fullscreenElement)await document.exitFullscreen();else await $('.game-shell').requestFullscreen()}catch(e){}}
$('#gameFullscreen').onclick=toggleGameFullscreen;
document.addEventListener('fullscreenchange',()=>$('#gameFullscreen').setAttribute('aria-label',document.fullscreenElement?'Exit fullscreen':'Enter fullscreen'));
$('#rewatch').onclick=startStory;$('#again').onclick=()=>throughBlack(startMain);
$('#help').onclick=()=>alert('You are the Queen. Eggs are your only currency: every bee costs one egg.\n\nSOLDIER (green helmet, key 1) stings ants, hornets and bears up close.\nGAS BEE (orange hard hat, key 2) is the only bee that can fan pesticide clouds away.\nFARMER (flower hat, key 3) scouts the fog and carries food home. Food makes eggs come sooner; native wildflowers give double.\nEvery enemy stands on a ring in the colour of the bee that beats it.\n\nClick a bee, then click a spot to send it. It stays where you put it. Click the hive to call it back to the patrol ring. Click the bee again, or press Esc, to deselect. Drag a box to select several bees; Q, W and E select every soldier, gas bee or farmer.\n\nEach day ends with a raid, and each raid is bigger than the last. The hive never heals. When it falls, every day you survived counts as a year of life for the meadow.');
addEventListener('resize',resize);setMuted(muted);resize();requestAnimationFrame(tick);
