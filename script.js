// ABYSS LINE / Project 87 v12 — OPN integration
// ABYSS LINE / Project 87 BGM Driver v2
(function(){
'use strict';
// ============================================================
//  OPN-STYLE SOUND DRIVER  v4  Project 87 timing edition
//  （YM2203×2 + MSM5205×1 = FM6 + SSG6 + ADPCM(リズム)1ch）
//  実機のダライアス(1986)がまさにこの構成。Chip Aは従来のFM1-3/SSG1-3、
//  Chip Bはそれを補強するダブリング・パッド・オフビートベース・追加の飾り。
//  各チャンネルは実機と同じく同時に1音だけ、という規律は崩していない。
// ============================================================
var AC=null,master=null,comp=null,outFilter=null,running=false,timer=null;
var mute={fm:false,ssg:false,rhy:false,fmB:false,ssgB:false},mode='stage';
var FM_VOICES={},SSG_VOICES={},RHY_VOICE=null,liveSources=new Set();
function trackSource(s){liveSources.add(s);s.onended=function(){liveSources.delete(s);s.disconnect();};}
var noiseBuf=null;
function initAudio(existingAC,destination){
  if(AC)return;
  var A=window.AudioContext||window.webkitAudioContext;
  if(!existingAC&&!A)return;
  AC=existingAC||new A();
  master=AC.createGain();master.gain.value=0.32;
  comp=AC.createDynamicsCompressor();comp.threshold.value=-14;comp.ratio.value=4;comp.attack.value=0.003;comp.release.value=0.15;
  // 出力段のローパス：実機は最終的にアナログアンプ/スピーカーを通っていたので、
  // 矩形波の角が完全に立ったまま耳に届くことはなかった。その"最後の一段"を足す。
  outFilter=AC.createBiquadFilter();outFilter.type='lowpass';outFilter.frequency.value=7500;outFilter.Q.value=0.7;
  master.connect(comp);comp.connect(outFilter);outFilter.connect(destination||AC.destination);
  var n=AC.sampleRate*0.6,b=AC.createBuffer(1,n,AC.sampleRate),d=b.getChannelData(0),i;
  for(i=0;i<n;i++)d[i]=Math.random()*2-1;
  noiseBuf=b;
}
function hz(note){return 13.75*Math.pow(2,(note-9)/12);} // note = MIDI note number

// ---------- FM: 3 named voices, 2-operator (modulator -> carrier freq) ----------
var FM_PATCH={
  lead:  {ratio:3.5, idx0:0.9,  idx1:0.32, att:0.006, dec:0.16, vol:0.24}, // idx1を0.15→0.32：サステインで痩せない
  counter:{ratio:2.0, idx0:1.1, idx1:0.2,  att:0.004, dec:0.22, vol:0.14},
  bass:  {ratio:1.0, idx0:2.5,  idx1:0.5,  att:0.004, dec:0.20, vol:0.30},
  // サビ専用・古代祐三氏スタイル：モジュレータの自己フィードバックで倍音にラフさを持たせ、
  // 速めのビブラートを乗せる音色。※現在サビでは未使用（学さんの指示で'lead'に統一）。予備として残す。
  koshiro:{ratio:2.0, idx0:2.6, idx1:0.55, att:0.004,dec:0.05, sus:0.68, rel:0.10, vol:0.26,
            fb:0.32, vib:true, vibRate:6.4, vibDepth:0.011},
  // Chip B・FM5用：小節の頭で一度だけ鳴らす持続パッド。地味だが土台を厚くする。
  pad:   {ratio:1.0, idx0:0.6, idx1:0.25, att:0.06, dec:0.15, sus:0.55, rel:0.25, vol:0.10}
};
function keyOffVoice(v,t){
  if(!v)return;var i,p;
  for(i=0;i<v.gains.length;i++){p=v.gains[i].gain;try{if(p.cancelAndHoldAtTime)p.cancelAndHoldAtTime(t);else p.cancelScheduledValues(t);p.exponentialRampToValueAtTime(0.0004,t+0.012);}catch(err){}}
  for(i=0;i<v.sources.length;i++)try{v.sources[i].stop(t+0.018);}catch(err2){}
}
function allNotesOff(t){liveSources.forEach(function(s){try{s.stop(t);}catch(e){}});liveSources.clear();var k;for(k in FM_VOICES)keyOffVoice(FM_VOICES[k],t);for(k in SSG_VOICES)keyOffVoice(SSG_VOICES[k],t);keyOffVoice(RHY_VOICE,t);FM_VOICES={};SSG_VOICES={};RHY_VOICE=null;}
function playFM(ch,patchName,note,t,dur,detuneCents,velMul){
  keyOffVoice(FM_VOICES[ch],t);
  var p=FM_PATCH[patchName],f=hz(note),vmul=velMul||1;
  var car=AC.createOscillator(),mod=AC.createOscillator(),mg=AC.createGain(),cg=AC.createGain();
  car.type='sine';mod.type='sine';
  car.frequency.setValueAtTime(f,t);
  if(detuneCents)car.detune.value=detuneCents;
  mod.frequency.setValueAtTime(f*p.ratio,t);
  mod.connect(mg);mg.connect(car.frequency);car.connect(cg);cg.connect(master);
  var extraNodes=[],voiceSources=[mod,car];
  if(p.fb){
    // モジュレータの自己フィードバック：出力を自分のfrequencyへ戻し、倍音にラフさを足す
    var fbGain=AC.createGain();fbGain.gain.setValueAtTime(f*p.fb,t);
    mod.connect(fbGain);fbGain.connect(mod.frequency);extraNodes.push(fbGain);
  }
  if(p.vib){
    var lfo=AC.createOscillator(),lfoGain=AC.createGain();
    lfo.frequency.setValueAtTime(p.vibRate,t);
    lfoGain.gain.setValueAtTime(f*p.vibDepth,t);
    lfo.connect(lfoGain);lfoGain.connect(car.frequency);
    extraNodes.push(lfo,lfoGain);voiceSources.push(lfo);
  }
  var stopAt;
  if(p.sus!==undefined){
    // ADSR：アタック→サステインレベルまで減衰→書いた長さぶん保持→リリース。
    var holdAt=Math.max(t+p.att+p.dec,t+dur);
    mg.gain.setValueAtTime(f*p.idx0,t);
    mg.gain.exponentialRampToValueAtTime(Math.max(1,f*p.idx1),t+p.att+p.dec);
    mg.gain.setValueAtTime(Math.max(1,f*p.idx1),holdAt);
    mg.gain.exponentialRampToValueAtTime(Math.max(1,f*p.idx1*0.5),holdAt+p.rel);
    cg.gain.setValueAtTime(0.0008,t);
    cg.gain.linearRampToValueAtTime(p.vol*vmul,t+p.att);
    cg.gain.exponentialRampToValueAtTime(Math.max(0.0004,p.vol*p.sus*vmul),t+p.att+p.dec);
    cg.gain.setValueAtTime(Math.max(0.0004,p.vol*p.sus*vmul),holdAt);
    cg.gain.exponentialRampToValueAtTime(0.0004,holdAt+p.rel);
    stopAt=holdAt+p.rel+0.02;
  } else {
    // 従来通りのAD（弾いて減衰）：lead / counter / bass はここを通る。
    mg.gain.setValueAtTime(f*p.idx0,t);
    mg.gain.exponentialRampToValueAtTime(Math.max(1,f*p.idx1),t+dur);
    cg.gain.setValueAtTime(0.0008,t);
    cg.gain.linearRampToValueAtTime(p.vol*vmul,t+p.att);
    cg.gain.exponentialRampToValueAtTime(0.0004,t+dur+p.dec);
    stopAt=t+dur+p.dec+0.02;
  }
  voiceSources.forEach(trackSource);mod.start(t);car.start(t);mod.stop(stopAt);car.stop(stopAt);
  var k;for(k=0;k<extraNodes.length;k++){if(extraNodes[k].start)extraNodes[k].start(t);if(extraNodes[k].stop)extraNodes[k].stop(stopAt);}
  FM_VOICES[ch]={gains:[cg],sources:voiceSources};
}

// ---------- SSG (PSG): 3 generic square-wave voices ----------
function playSSG(ch,note,t,dur,vol,detuneCents){
  keyOffVoice(SSG_VOICES[ch],t);
  var o=AC.createOscillator(),g=AC.createGain();
  o.type='square';o.frequency.setValueAtTime(hz(note),t);
  if(detuneCents)o.detune.value=detuneCents;
  g.gain.setValueAtTime(vol,t);
  g.gain.setValueAtTime(vol,t+Math.min(0.015,dur*0.4));
  g.gain.exponentialRampToValueAtTime(0.0006,t+dur);
  o.connect(g);g.connect(master);trackSource(o);o.start(t);o.stop(t+dur+0.02);
  SSG_VOICES[ch]={gains:[g],sources:[o]};
}

// ---------- rhythm: 1 channel worth of BD/SD/HH (MSM5205相当) ----------
function drum(kind,t){
  keyOffVoice(RHY_VOICE,t);
  if(kind==='K'){
    var o=AC.createOscillator(),g=AC.createGain();
    o.frequency.setValueAtTime(150,t);o.frequency.exponentialRampToValueAtTime(32,t+0.1);
    g.gain.setValueAtTime(0.55,t);g.gain.exponentialRampToValueAtTime(0.0008,t+0.14);
    o.connect(g);g.connect(master);trackSource(o);o.start(t);o.stop(t+0.16);
    RHY_VOICE={gains:[g],sources:[o]};
  } else if(kind==='S'){
    var s=AC.createBufferSource(),f=AC.createBiquadFilter(),g2=AC.createGain();
    s.buffer=noiseBuf;f.type='bandpass';f.frequency.value=1800;f.Q.value=0.9;
    g2.gain.setValueAtTime(0.4,t);g2.gain.exponentialRampToValueAtTime(0.0006,t+0.12);
    s.connect(f);f.connect(g2);g2.connect(master);trackSource(s);s.start(t);s.stop(t+0.14);
    var o2=AC.createOscillator(),g3=AC.createGain();o2.type='triangle';
    o2.frequency.setValueAtTime(200,t);o2.frequency.exponentialRampToValueAtTime(110,t+0.05);
    g3.gain.setValueAtTime(0.3,t);g3.gain.exponentialRampToValueAtTime(0.0006,t+0.07);
    o2.connect(g3);g3.connect(master);trackSource(o2);o2.start(t);o2.stop(t+0.08);
    RHY_VOICE={gains:[g2,g3],sources:[s,o2]};
  } else if(kind==='H'){
    var s2=AC.createBufferSource(),f2=AC.createBiquadFilter(),g4=AC.createGain();
    s2.buffer=noiseBuf;f2.type='highpass';f2.frequency.value=7000;
    g4.gain.setValueAtTime(0.16,t);g4.gain.exponentialRampToValueAtTime(0.0006,t+0.035);
    s2.connect(f2);f2.connect(g4);g4.connect(master);trackSource(s2);s2.start(t);s2.stop(t+0.05);
    RHY_VOICE={gains:[g4],sources:[s2]};
  }
}

// ============================================================
//  作曲：STAGE THEME（Em、28小節：Aメロ8+Bメロ8+サビ8+WARNING4）
// ============================================================
var STAGE_CHORDS=[
  {r:64,t:[0,3,7]},{r:69,t:[0,3,7]},{r:72,t:[0,4,7]},{r:71,t:[0,4,7]}, // Aメロ: Em Am C B
  {r:64,t:[0,3,7]},{r:69,t:[0,3,7]},{r:74,t:[0,4,7]},{r:71,t:[0,4,7]}, // Em Am D B
  {r:69,t:[0,3,7]},{r:69,t:[0,3,7]},{r:72,t:[0,4,7]},{r:72,t:[0,4,7]}, // Bメロ: Am Am C C（2小節ずつ持ち上げる）
  {r:74,t:[0,4,7]},{r:74,t:[0,4,7]},{r:71,t:[0,4,7]},{r:71,t:[0,4,7]}, // D D B B
  {r:72,t:[0,4,7]},{r:67,t:[0,4,7]},{r:69,t:[0,3,7]},{r:64,t:[0,3,7]}, // サビ: C G Am Em（一瞬の解放）
  {r:72,t:[0,4,7]},{r:67,t:[0,4,7]},{r:74,t:[0,4,7]},{r:64,t:[0,3,7]}, // C G D Em（頂点→着地）
  {r:64,t:[0,3,7]},{r:65,t:[0,4,7]},{r:62,t:[0,4,7]},{r:71,t:[0,4,7]}  // WARNING: Em F D B（ボス曲を予告）
];
var STAGE_LEAD=[
  // bar1 (Em)
  [2,76,2],[4,79,2],[6,81,2],[8,83,4],[12,81,2],[14,79,2],
  // bar2 (Am) — 下降で答える
  [16,81,2],[18,79,2],[20,76,2],[22,72,2],[24,74,4],[28,72,2],[30,69,2],
  // bar3 (C) — 同じ形を3度上でシークエンス
  [34,79,2],[36,83,2],[38,84,2],[40,86,4],[44,84,2],[46,83,2],
  // bar4 (B) — 導音を含む緊張
  [50,71,2],[52,75,2],[54,78,2],[56,83,4],[60,81,2],[62,78,2],
  // bar5 (Em) — bar1再現
  [66,76,2],[68,79,2],[70,81,2],[72,83,4],[76,81,2],[78,79,2],
  // bar6 (Am) — bar2再現
  [80,81,2],[82,79,2],[84,76,2],[86,72,2],[88,74,4],[92,72,2],[94,69,2],
  // bar7 (D) — ブリッジ、伸ばす
  [96,74,4],[100,78,4],[104,81,4],[108,79,4],
  // bar8 (B) — ターンアラウンド、駆け上がってループ頭へ
  [112,79,2],[114,78,2],[116,76,2],[118,75,2],[120,78,2],[122,81,2],[124,83,2],[126,87,2],
  // ================= Bメロ（bar9〜16, steps128〜255）=================
  // 同じ2音を叩きつけてから跳ね上がる、というモチーフをAm→C→D→Bと2小節ずつ持ち上げていく。
  // 最後のB(bar15-16)で反復をやめて駆け上がり、サビの入り口(G5)へ落ちて着地する。
  // bar9-10 (Am)
  [128,76,2],[130,76,2],[132,81,2],[134,79,2],[136,76,2],[138,76,2],[140,81,2],[142,84,2],
  [144,76,2],[146,76,2],[148,81,2],[150,79,2],[152,76,2],[154,76,2],[156,81,2],[158,84,2],
  // bar11-12 (C) — 1段上へ
  [160,79,2],[162,79,2],[164,84,2],[166,83,2],[168,79,2],[170,79,2],[172,84,2],[174,88,2],
  [176,79,2],[178,79,2],[180,84,2],[182,83,2],[184,79,2],[186,79,2],[188,84,2],[190,88,2],
  // bar13-14 (D) — さらに1段
  [192,81,2],[194,81,2],[196,86,2],[198,85,2],[200,81,2],[202,81,2],[204,86,2],[206,90,2],
  [208,81,2],[210,81,2],[212,86,2],[214,85,2],[216,81,2],[218,81,2],[220,86,2],[222,90,2],
  // bar15-16 (B) — 反復をやめて駆け上がり、サビの入り口へ
  [224,75,2],[226,78,2],[228,81,2],[230,83,2],[232,87,2],[234,90,2],[236,83,2],[238,78,2],
  [240,71,2],[242,75,2],[244,78,2],[246,81,2],[248,83,2],[250,87,2],[252,90,2],[254,93,2],
  // ================= サビ（bar17〜24, steps256〜383）=================
  // ため息のように下降する形を繰り返し、bar20とbar24で一度立ち止まって呼吸する。
  // bar23(D)で全曲の頂点(E6)に到達してから、静かに戻ってくる。
  // 音色はAメロ・Bメロと同じ'lead'に統一（ブラス/古代祐三風の差し替えは撤回）。
  // bar17 (C)
  [258,79,6],[264,81,4],[268,79,4],
  // bar18 (G) — 下降するため息のライン
  [274,83,4],[278,81,2],[280,79,4],[284,74,4],
  // bar19 (Am) — 一段高く駆け上がってから大きく落ちる
  [290,84,4],[294,83,2],[296,81,4],[300,76,4],
  // bar20 (Em) — 長く伸ばして呼吸する
  [304,76,8],[316,71,4],
  // bar21 (C) — bar17再現
  [322,79,6],[328,81,4],[332,79,4],
  // bar22 (G) — bar18再現
  [338,83,4],[342,81,2],[344,79,4],[348,74,4],
  // bar23 (D) — 全曲の頂点
  [354,78,2],[356,81,2],[358,86,2],[360,88,6],[366,86,2],
  // bar24 (Em) — 音階を降りて着地、次のループへ余白を残す
  [368,83,2],[370,81,2],[372,79,2],[374,78,2],[376,76,4],
  // ================= WARNING（bar25〜28, steps384〜447）=================
  // E-Fの半音警報からDへ落下し、Bメジャーで止めてボス曲のEmへ解決させる。
  [384,76,4],[390,77,2],[392,76,4],[398,71,2],
  [400,77,4],[406,76,2],[408,77,4],[414,72,2],
  [416,74,2],[420,78,2],[424,81,4],[430,78,2],
  [432,71,2],[436,75,2],[440,78,2],[444,83,4]
];
var STAGE_LEN=448; // 28小節 = BPM150で44.8秒。ゲームのボス出現(約44.7秒)と同期
// Bメロ専用の順次進行ベース（ルート/オクターブ跳躍ではなく、次の和音への経過音でつなぐ）。ジェミ子さん提案。
var BMELO_BASS=[
  [128,69,4],[136,71,4],       // bar9 (Am): A4 → B4（経過音）
  [144,69,4],[152,72,4],       // bar10 (Am→Cへの経過): A4 → C5
  [160,72,4],[168,74,4],       // bar11 (C): C5 → D5（経過音）
  [176,72,4],[184,73,4],       // bar12 (C→Dへの経過): C5 → C#5（半音で滑らかに）
  [192,74,4],[200,76,4],       // bar13 (D): D5 → E5（経過音）
  [208,74,4],[216,73,4],       // bar14 (D→Bへの経過): D5 → C#5（半音で滑らかに）
  [224,71,4],[232,75,4],       // bar15 (B): B4 → D#5（長3度、盛り上げ）
  [240,71,4],[248,78,4]        // bar16 (Bキメへ向けて): B4 → F#5（一段高く、フィル/ブレイクへ）
];

// ============================================================
//  作曲：BOSS THEME（4小節、E→F→D→Emのリフ）
// ============================================================
var BOSS_CHORDS=[{r:64,t:[0,3,7]},{r:65,t:[0,4,7]},{r:62,t:[0,4,7]},{r:64,t:[0,3,7]}];
var BOSS_CORE_CHORDS=[{r:64,t:[0,3,7]},{r:72,t:[0,4,7]},{r:65,t:[0,4,7]},{r:71,t:[0,4,7]}];
var BOSS_LEN=64;
function bossRiffNote(step,root){
  var cell=[[0,12,2],[2,12,2],[4,15,2],[6,12,2],[8,19,4],[12,15,2],[14,12,2]];
  var i;for(i=0;i<cell.length;i++)if(cell[i][0]===step)return root+cell[i][1];
  return null;
}
function bossCoreRiffNote(step,root){
  var cell=[[0,12,2],[2,15,2],[4,19,2],[6,18,2],[8,24,2],[10,19,2],[12,18,2],[14,15,2]];
  var i;for(i=0;i<cell.length;i++)if(cell[i][0]===step)return root+cell[i][1];
  return null;
}

// ============================================================
//  作曲：OPENING THEME（D major、8小節、完全新規オリジナル）
//  「キャプテンネオ」そのものではなく、初期ZUNTATAのFMリードが持つ
//  能天気で前向きな推進力・行進曲的なノリ、というスタイルだけを狙って新しく書いた。
// ============================================================
var OPENING_CHORDS=[
  {r:62,t:[0,4,7]},{r:69,t:[0,4,7]},{r:71,t:[0,3,7]},{r:67,t:[0,4,7]}, // D A Bm G
  {r:62,t:[0,4,7]},{r:69,t:[0,4,7]},{r:67,t:[0,4,7]},{r:69,t:[0,4,7]}  // D A G A（ターンアラウンド）
];
var OPENING_LEAD=[
  [0,74,2],[2,78,2],[4,81,2],[6,86,4],[10,81,2],[12,78,2],[14,74,2],
  [16,69,2],[18,73,2],[20,76,2],[22,81,4],[26,76,2],[28,73,2],[30,69,2],
  [32,71,2],[34,74,2],[36,78,2],[38,83,4],[42,78,2],[44,74,2],[46,71,2],
  [48,67,2],[50,71,2],[52,74,2],[54,79,4],[58,74,2],[60,71,2],[62,67,2],
  [64,74,2],[66,78,2],[68,81,2],[70,86,4],[74,81,2],[76,78,2],[78,74,2],
  [80,69,2],[82,73,2],[84,76,2],[86,81,4],[90,76,2],[92,73,2],[94,69,2],
  [96,67,2],[98,71,2],[100,74,2],[102,79,2],[104,81,2],[106,79,2],[108,74,2],[110,71,2],
  [112,76,2],[114,78,2],[116,79,2],[118,81,2],[120,83,2],[122,85,2],[124,86,2],[126,88,2]
];
var OPENING_LEN=128;
var OPENING_BASS_T=['r','-','r','-','o','-','r','-','r','-','r','-','o','-','r','-'];
var OPENING_RHY   =['K','H','S','H','K','H','S','H','K','H','S','H','K','H','S','H'];

var ARP_CYC=[0,1,2,3,2,1]; // triad[0..2] + 3=oct
var STAGE_BASS_T=['r','-','o','-','r','-','o','r','-','o','-','r','o','-','r','o'];
var BOSS_BASS_T =['r','r','o','r','r','o','r','r','o','r','r','o','r','o','o','r'];
var STAGE_RHY=['K','-','H','-','S','-','H','-','K','-','H','K','S','-','H','H'];
var BOSS_RHY =['K','H','S','H','K','K','S','H','K','H','S','S','K','K','S','S'];
var THERMAL_RHY=['K','H','S','H','K','K','H','H','K','H','S','K','K','H','S','H'];
var CORE_RHY=['K','H','S','K','K','H','S','H','K','K','S','H','K','S','K','S'];

var step=0,nextTime=0,stepDur=0;
function setTempo(){stepDur=60/(mode==='opening'?168:(mode==='bossCore'?174:((mode==='boss')?166:150)))/4;} // 16分音符刻み

function schedule(stepIdx,t){
  var isCore=mode==='bossCore',isBoss=mode==='boss'||isCore,isOpen=mode==='opening',isThermal=mode==='thermal',isStage=mode==='stage'||isThermal;
  var len=isBoss?BOSS_LEN:(isOpen?OPENING_LEN:STAGE_LEN);
  var pos=((stepIdx%len)+len)%len;
  var bar=Math.floor(pos/16),within=pos%16;
  var chords=isCore?BOSS_CORE_CHORDS:(isBoss?BOSS_CHORDS:(isOpen?OPENING_CHORDS:STAGE_CHORDS)),ch=chords[bar%chords.length];
  var leadSrc=isOpen?OPENING_LEAD:STAGE_LEAD,leadLen=isOpen?OPENING_LEN:STAGE_LEN;
  var bassT=isBoss?BOSS_BASS_T:(isOpen?OPENING_BASS_T:STAGE_BASS_T);
  var rhyT=isCore?CORE_RHY:(isBoss?BOSS_RHY:(isOpen?OPENING_RHY:(isThermal?THERMAL_RHY:STAGE_RHY)));
  var inChorus=isStage&&bar>=16&&bar<24;
  var inBmelo=isStage&&bar>=8&&bar<16;
  var warningZone=isStage&&bar>=24;
  // サビ入りのキメ演出：bar16終盤4stepでスネア連打のフィルイン、
  // サビ頭2step(既存の休符と重なる)で伴奏を無音にするブレイク。
  var fillZone=isStage&&pos>=252&&pos<=255;
  var breakZone=isStage&&(pos===256||pos===257);

  // FM1: lead（STAGE=作曲済みメロディ、BOSS=リフをその場で移調、OPENING=古代祐三風の音色で通し）
  if(!mute.fm){
    if(isBoss){var bn=(isCore?bossCoreRiffNote:bossRiffNote)(within,ch.r);if(bn!==null)playFM('A1','lead',bn,t,isCore?0.12:0.16);}
    else{
      var i;
      for(i=0;i<leadSrc.length;i++){
        if(leadSrc[i][0]!==pos)continue;
        var noteLen=leadSrc[i][2]*stepDur;
        if(isOpen) playFM('A1','koshiro',leadSrc[i][1],t,Math.max(0.04,noteLen-0.03));
        else playFM('A1','lead',leadSrc[i][1],t,noteLen*(inChorus?0.75:(warningZone?0.52:0.42)),0,within===0?1.15:1);
      }
    }
  }
  // FM2: counter arp
  if(!mute.fm&&!breakZone&&!fillZone&&(!inChorus||within%4===0)){var ai=ARP_CYC[within%ARP_CYC.length],an=ai===3?ch.r+24:ch.r+12+ch.t[ai];playFM('A2','counter',an,t,stepDur*(inChorus?1.6:0.85));}
  // FM3: bass（Bメロだけは順次進行の専用ラインに差し替え）
  if(!mute.fm&&!breakZone){
    if(inBmelo){var bk;for(bk=0;bk<BMELO_BASS.length;bk++)if(BMELO_BASS[bk][0]===pos)playFM('A3','bass',BMELO_BASS[bk][1]-12,t,BMELO_BASS[bk][2]*stepDur*0.85);}
    else{var bt=bassT[within];if(bt!=='-')playFM('A3','bass',bt==='r'?ch.r-12:ch.r,t,stepDur*0.8);}
  }

  // ============ Chip B（2基目のYM2203）============
  var doubleLead=isOpen||isBoss||isThermal||inChorus||warningZone;
  if(!mute.fmB&&doubleLead){
    if(isBoss){var bn2=(isCore?bossCoreRiffNote:bossRiffNote)(within,ch.r);if(bn2!==null)playFM('B1','lead',bn2+12,t,isCore?0.10:0.14,9);}
    else{
      var i2;
      for(i2=0;i2<leadSrc.length;i2++){
        if(leadSrc[i2][0]!==pos)continue;
        var noteLen2=leadSrc[i2][2]*stepDur;
        if(isOpen) playFM('B1','koshiro',leadSrc[i2][1]+12,t,Math.max(0.04,noteLen2-0.03),9);
        else playFM('B1','lead',leadSrc[i2][1]+12,t,noteLen2*(inChorus?0.75:(warningZone?0.52:0.42)),9,within===0?1.15:1);
      }
    }
  }
  if(!mute.fmB&&within===0&&!breakZone)playFM('B2','pad',ch.r,t,stepDur*12);
  if(!mute.fmB&&!isBoss&&!fillZone&&!breakZone&&(isThermal||inChorus||warningZone)&&(within===6||within===14))playFM('B3','bass',ch.r-5,t,stepDur*0.7);

  if(!mute.ssg&&!isBoss&&!breakZone&&!fillZone){var j;for(j=0;j<leadSrc.length;j++)if((leadSrc[j][0]+2)%leadLen===pos)playSSG('A1',leadSrc[j][1],t,Math.min(leadSrc[j][2],3)*stepDur*0.7,0.045,-6);}
  if(!mute.ssg&&!breakZone&&!fillZone&&(within%4===2))playSSG('A2',ch.r+19,t,stepDur*0.5,0.05,+5);
  if(!mute.ssg&&!inChorus&&!breakZone&&!fillZone&&(within%2===1)){var si=ARP_CYC[(within>>1)%ARP_CYC.length],sn=si===3?ch.r+36:ch.r+24+ch.t[si];playSSG('A3',sn,t,stepDur*0.35,0.032,0);}
  if(!mute.ssgB&&!isBoss&&!inChorus&&!breakZone&&!fillZone&&(isOpen||isThermal)){var j2;for(j2=0;j2<leadSrc.length;j2++)if((leadSrc[j2][0]+4)%leadLen===pos)playSSG('B1',leadSrc[j2][1],t,Math.min(leadSrc[j2][2],2)*stepDur*0.6,0.03,-11);}
  if(!mute.ssgB&&!breakZone){
    if(inBmelo){var bk2;for(bk2=0;bk2<BMELO_BASS.length;bk2++)if(BMELO_BASS[bk2][0]===pos)playSSG('B2',BMELO_BASS[bk2][1]-12,t,BMELO_BASS[bk2][2]*stepDur*0.6,0.045,0);}
    else{var bt2=bassT[within];if(bt2!=='-')playSSG('B2',bt2==='r'?ch.r-12:ch.r,t,stepDur*0.6,0.05,0);}
  }
  if(!mute.ssgB&&!inChorus&&!breakZone&&!fillZone&&(isOpen||isThermal||isBoss)&&(within%3===0)){var si2=ARP_CYC[(within/3|0)%ARP_CYC.length],sn2=si2===3?ch.r+36:ch.r+24+ch.t[si2];playSSG('B3',sn2,t,stepDur*0.3,0.026,+3);}
  // ============ Chip B ここまで ============

  // RHYTHM（MSM5205相当・1ch）。サビ入りのキメ：フィル4step+ブレイク2step。
  if(!mute.rhy){
    if(breakZone){ /* 無音 */ }
    else if(fillZone){ drum('S',t); }
    else if(warningZone){var wd=CORE_RHY[within];if(wd!=='-')drum(wd,t);}
    else{ var d=rhyT[within];if(d!=='-')drum(d,t); }
  }
}
function tick(){if(!running||AC.state!=='running')return;if(nextTime<AC.currentTime-0.2)nextTime=AC.currentTime+0.02;while(nextTime<AC.currentTime+0.18){schedule(step,nextTime);step++;nextTime+=stepDur;}}

var BGM_OPN={
  init:function(context,destination){initAudio(context,destination);},
  start:function(){
    initAudio();if(!AC)return;if(AC.state==='suspended')AC.resume();
    if(running)return;running=true;setTempo();step=0;nextTime=AC.currentTime+0.05;
    timer=setInterval(tick,25);
  },
  stop:function(){running=false;clearInterval(timer);if(AC)allNotesOff(AC.currentTime);},
  setMode:function(m){
    if(['stage','thermal','opening','boss','bossCore'].indexOf(m)<0)return;
    mode=m;step=0;setTempo();if(AC){allNotesOff(AC.currentTime);nextTime=AC.currentTime+0.05;}
  },
  setMute:function(group,on){mute[group]=!!on;},
  setVolume:function(v){if(master)master.gain.setValueAtTime(Math.max(0,Math.min(1,v)),AC.currentTime);},
  getMode:function(){return mode;}
};
window.BGM_OPN=BGM_OPN;

})();

// ABYSS LINE / Project 87 v12 - integrated OPN music
(function(){
'use strict';
// ---------- basic setup ----------
var cv=document.getElementById('c'),cx=cv.getContext('2d');
// PROJECT 87: fictional dual-screen PC-88 conversion canvas
var W=640,H=200,scale=1,ox=0,oy=0,dpr=1,safeL=0,safeR=0,safeT=0,safeB=0;
var safeProbe=document.createElement('div');safeProbe.style.cssText='position:fixed;width:0;height:0;visibility:hidden;pointer-events:none;padding-left:env(safe-area-inset-left,0px);padding-right:env(safe-area-inset-right,0px);padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)';document.body.appendChild(safeProbe);
function safePx(name){var v=parseFloat(getComputedStyle(safeProbe)[name]);return isFinite(v)?v:0;}
function resize(){
  dpr=1;
  var vw=window.innerWidth,vh=window.innerHeight;
  scale=Math.min(vw/W,vh/H);
  safeL=safePx('paddingLeft')/scale;safeR=safePx('paddingRight')/scale;
  safeT=safePx('paddingTop')/scale;safeB=safePx('paddingBottom')/scale;
  ox=(vw-W*scale)/2;oy=(vh-H*scale)/2;
  cv.width=W;cv.height=H;
  cv.style.width=(W*scale)+'px';cv.style.height=(H*scale)+'px';
  cv.style.left=ox+'px';cv.style.top=oy+'px';
}
window.addEventListener('resize',resize);resize();

// ---------- audio ----------
var AC=null,master=null,musicOn=true;
function initAudio(){
  if(AC)return;
  var A=window.AudioContext||window.webkitAudioContext; if(!A)return;
  AC=new A();master=AC.createGain();master.gain.value=0.35;master.connect(AC.destination);
  window.BGM_OPN.init(AC);window.BGM_OPN.setVolume(0.24);
}
function resumeAudio(){ if(AC&&AC.state==='suspended')AC.resume(); }
function tone(f,type,dur,vol,slide,delay){
  if(!AC)return;
  var t=AC.currentTime+(delay||0),o=AC.createOscillator(),g=AC.createGain();
  o.type=type;o.frequency.setValueAtTime(f,t);
  if(slide)o.frequency.exponentialRampToValueAtTime(Math.max(20,f*slide),t+dur);
  g.gain.setValueAtTime(vol,t);g.gain.exponentialRampToValueAtTime(0.001,t+dur);
  o.connect(g);g.connect(master);o.start(t);o.stop(t+dur+0.02);
}
function noise(dur,vol,delay){
  if(!AC)return;
  var t=AC.currentTime+(delay||0),n=Math.floor(AC.sampleRate*dur),b=AC.createBuffer(1,n,AC.sampleRate),d=b.getChannelData(0),i;
  for(i=0;i<n;i++)d[i]=(Math.random()*2-1)*(1-i/n);
  var s=AC.createBufferSource(),g=AC.createGain(),f=AC.createBiquadFilter();
  f.type='lowpass';f.frequency.value=1800;
  s.buffer=b;g.gain.value=vol;s.connect(f);f.connect(g);g.connect(master);s.start(t);
}
var SFX={
  shot:function(){tone(1200,'square',0.05,0.05,0.5);},
  hit:function(){tone(300,'square',0.06,0.08,0.6);},
  boom:function(){noise(0.35,0.4);tone(120,'sawtooth',0.3,0.2,0.3);},
  bigboom:function(){noise(0.9,0.6);tone(80,'sawtooth',0.8,0.3,0.2);tone(60,'square',0.9,0.2,0.4,0.1);},
  power:function(){tone(440,'square',0.08,0.1);tone(660,'square',0.08,0.1,1,0.08);tone(880,'square',0.15,0.1,1,0.16);},
  slash:function(){tone(1600,'square',0.05,0.1,0.45);tone(720,'square',0.09,0.08,0.4,0.04);},
  dead:function(){noise(0.6,0.5);tone(400,'sawtooth',0.6,0.25,0.1);},
  warn:function(){tone(220,'sawtooth',0.25,0.24,1.5);tone(220,'sawtooth',0.25,0.24,1.5,0.35);}
};
var introT=0,musicMode=null;
function zoneEven(){return (stage%2)===0;}
function zoneName(){return zoneEven()?'ZONE '+stage+' THERMAL':'ZONE '+stage+' TRENCH';}
function pal(){return zoneEven()?{deep:'#f00',mid:'#f0f',hi:'#ff0',land:'#f00'}:{deep:'#00f',mid:'#0ff',hi:'#0ff',land:'#00f'};}
function bgmTick(){
  if(!AC)return;
  var desired=null;
  if(musicOn&&state==='play'){
    if(introT>0)desired='opening';
    else if(boss&&!boss.dead&&!boss.dying)desired=boss.arms.some(function(a){return !a.dead;})?'boss':'bossCore';
    else if(!boss||!boss.dying)desired=zoneEven()?'thermal':'stage';
  }
  if(desired===musicMode)return;
  window.BGM_OPN.stop();musicMode=desired;
  if(desired){window.BGM_OPN.setMode(desired);window.BGM_OPN.start();}
}
document.addEventListener('visibilitychange',function(){
  keys={};touch.active=false;touch.mx=touch.my=0;last=0;acc=0;
  if(!AC)return;
  if(document.hidden)AC.suspend();else resumeAudio();
});

// ---------- input ----------
var keys={},touch={active:false,id:-1,sx:0,sy:0,mx:0,my:0},fireHeld=false;
var TOUCH_GAIN=1.5,MOUSE_GAIN=1.4;
window.addEventListener('keydown',function(e){keys[e.keyCode]=true;if(state!=='play')startFromInput();if([32,37,38,39,40].indexOf(e.keyCode)>=0)e.preventDefault();});
window.addEventListener('keyup',function(e){keys[e.keyCode]=false;});
function tpos(t){return {x:(t.clientX-ox)/scale,y:(t.clientY-oy)/scale};}
cv.addEventListener('touchstart',function(e){
  e.preventDefault();initAudio();resumeAudio();
  var i,t;
  for(i=0;i<e.changedTouches.length;i++){t=e.changedTouches[i];
    if(state!=='play')startFromInput();
    if(state==='play'&&!touch.active){touch.active=true;touch.id=t.identifier;var p=tpos(t);touch.sx=p.x;touch.sy=p.y;touch.mx=0;touch.my=0;}
  }
},{passive:false});
cv.addEventListener('touchmove',function(e){
  e.preventDefault();var i,t;
  for(i=0;i<e.changedTouches.length;i++){t=e.changedTouches[i];
    if(t.identifier===touch.id){var p=tpos(t);touch.mx+=(p.x-touch.sx)*TOUCH_GAIN;touch.my+=(p.y-touch.sy)*TOUCH_GAIN;touch.sx=p.x;touch.sy=p.y;}
  }
},{passive:false});
function tend(e){e.preventDefault();var i;for(i=0;i<e.changedTouches.length;i++){if(e.changedTouches[i].identifier===touch.id){touch.active=false;touch.id=-1;touch.mx=0;touch.my=0;}}}
cv.addEventListener('touchend',tend,{passive:false});cv.addEventListener('touchcancel',tend,{passive:false});
function dragStart(p){touch.active=true;touch.id='mouse';touch.sx=p.x;touch.sy=p.y;touch.mx=0;touch.my=0;}
function dragMove(p){if(!touch.active||touch.id!=='mouse')return;touch.mx+=(p.x-touch.sx)*MOUSE_GAIN;touch.my+=(p.y-touch.sy)*MOUSE_GAIN;touch.sx=p.x;touch.sy=p.y;}
function rawpos(e){return {x:e.clientX,y:e.clientY};}
function dragEnd(){if(touch.id==='mouse'){touch.active=false;touch.id=-1;touch.mx=0;touch.my=0;}}
cv.addEventListener('mousedown',function(e){e.preventDefault();initAudio();resumeAudio();if(state!=='play')startFromInput();if(state==='play')dragStart(rawpos(e));});
window.addEventListener('mousemove',function(e){dragMove(rawpos(e));});
window.addEventListener('mouseup',dragEnd);
window.addEventListener('blur',function(){dragEnd();keys={};});

// ---------- game state ----------
var state='title',score=0,hiscore=0,lives=3,power=0,shield=0,stage=1,time=0,scroll=0;
function loadHI(){try{var n=parseInt(localStorage.getItem('abyss87_hi'),10);if(n>0)hiscore=n;}catch(err){}}
function saveHI(){try{if(score>hiscore)hiscore=score;localStorage.setItem('abyss87_hi',String(hiscore));}catch(err){}}
loadHI();
var player,bullets,ebullets,enemies,parts,pickups,boomerangs,boss,shake,flash,msg,msgT,invul,deadT,waveT,spawnQ,shieldFlash,slashes;
var LIMIT={enemies:24,pbullets:64,ebullets:96,parts:120};
var BOSS_HP_PER_POWER=0.6;
function rnd(a,b){return a+Math.random()*(b-a);}
var DPAT={};
function dpat(step,col){var k=step+col;if(DPAT[k])return DPAT[k];
  var c=document.createElement('canvas');c.width=c.height=step;var g=c.getContext('2d');g.fillStyle=col;g.fillRect(0,0,1,1);
  if(step===2){}else{g.fillRect(1,1,1,1);}
  DPAT[k]=cx.createPattern(c,'repeat');return DPAT[k];}
function dither(x,y,w,h,step,col){cx.fillStyle=dpat(step,col||'#000');cx.fillRect(x,y,w,h);}
function startFromInput(){
  initAudio();resumeAudio();
  if(state==='title'||(state==='over'&&deadT>60)){newGame();}
}
function newGame(){
  score=0;lives=3;power=0;shield=0;stage=1;time=0;scroll=0;
  resetField();state='play';introT=172;musicMode=null;bgmTick();
  say('LAUNCH');
}
function resetField(){
  player={x:120,y:H/2,r:5,vx:0,vy:0};
  bullets=[];ebullets=[];enemies=[];parts=[];pickups=[];boomerangs=[];boss=null;slashes=[];
  shake=0;flash=0;shieldFlash=0;invul=120;deadT=0;waveT=0;spawnQ=[];
}
function say(t){msg=t;msgT=120;}
resetField();msg='';msgT=0;

// ---------- entities ----------
function spawnEnemy(kind,x,y,o){
  if(enemies.length>=LIMIT.enemies)return null;
  var e={kind:kind,x:x,y:y,t:0,hp:1,r:12,score:100,dead:false};
  if(o){var k;for(k in o)e[k]=o[k];}
  if(kind==='drone'){e.hp=1;e.r=7;}
  if(kind==='ray'){e.hp=3;e.r=10;e.score=300;}
  if(kind==='mine'){e.hp=e.wall?5:2;e.r=8;e.score=e.wall?250:150;}
  if(kind==='turret'){e.hp=6;e.r=10;e.score=500;}
  if(kind==='crab'){e.hp=10;e.r=14;e.score=900;}
  enemies.push(e);return e;
}
function eshot(x,y,ang,sp,kind){if(ebullets.length<LIMIT.ebullets)ebullets.push({x:x,y:y,vx:Math.cos(ang)*sp,vy:Math.sin(ang)*sp,r:2.5,kind:kind||0});}
function aimAt(x,y){return Math.atan2(player.y-y,player.x-x);}
function burst(x,y,n,col,sp,life){var i;for(i=0;i<n&&parts.length<LIMIT.parts;i++){var a=rnd(0,6.283),s=rnd(0.3,1)*(sp||4);parts.push({x:x,y:y,vx:Math.cos(a)*s,vy:Math.sin(a)*s,life:life||30,max:life||30,col:col});}}

// ---------- waves ----------
function scheduleWaves(){
  var d=1+(stage-1)*0.25;spawnQ=[];
  function Q(t,f){spawnQ.push({t:t,f:f});}
  if(zoneEven())scheduleZone2(Q,d);else scheduleZone1(Q,d);
}
function scheduleZone1(Q,d){
  var i;
  for(i=0;i<6;i++)(function(i){Q(120+i*14,function(){spawnEnemy('drone',W+30,58,{path:'sine',ph:i*0.5,sp:3.2*d,by:58,amp:30});});})(i);
  for(i=0;i<6;i++)(function(i){Q(420+i*14,function(){spawnEnemy('drone',W+30,142,{path:'sine',ph:i*0.5,sp:3.2*d,by:142,amp:30});});})(i);
  Q(700,function(){spawnEnemy('turret',W+30,H-22,{path:'ground'});});
  Q(800,function(){spawnEnemy('turret',W+30,22,{path:'ceil'});});
  for(i=0;i<4;i++)(function(i){Q(760+i*40,function(){spawnEnemy('ray',W+30,rnd(34,H-34),{path:'dash',sp:2*d});});})(i);
  var wallGap=(Math.floor((stage-1)/2)%2)?4:1;
  for(i=0;i<7;i++)(function(i){if(i!==wallGap&&i!==wallGap+1)Q(1100+i*3,function(){spawnEnemy('mine',W+30,25+i*25,{path:'drift',sp:1.6*d,wall:true});});})(i);
  for(i=0;i<8;i++)(function(i){Q(1400+i*12,function(){spawnEnemy('drone',W+30,H/2,{path:'vee',ph:i,sp:3.6*d});});})(i);
  Q(1650,function(){spawnEnemy('crab',W+40,H/2,{path:'crab',sp:1.2*d});});
  Q(1800,function(){spawnEnemy('turret',W+30,H-22,{path:'ground'});});
  Q(1850,function(){spawnEnemy('turret',W+30,22,{path:'ceil'});});
  for(i=0;i<10;i++)(function(i){Q(1900+i*10,function(){var yy=i%2?150:50;spawnEnemy('drone',W+30,yy,{path:'sine',ph:i,sp:4*d,by:yy,amp:24});});})(i);
  for(i=0;i<4;i++)(function(i){Q(2250+i*30,function(){spawnEnemy('ray',W+30,rnd(34,H-34),{path:'dash',sp:2.4*d});});})(i);
  Q(2500,function(){say('WARNING');SFX.warn();});
  Q(2680,function(){spawnBoss();});
}
function scheduleZone2(Q,d){
  var i;
  // opening: center columns instead of top/bottom lanes
  for(i=0;i<5;i++)(function(i){
    Q(80+i*36,function(){
      spawnEnemy('drone',W+30,100,{path:'sine',ph:i,sp:3.4*d,by:100,amp:16});
      spawnEnemy('drone',W+30,52,{path:'sine',ph:i+1.2,sp:3.4*d,by:52,amp:12});
      spawnEnemy('drone',W+30,148,{path:'sine',ph:i+2.4,sp:3.4*d,by:148,amp:12});
    });
  })(i);
  // crossing pair: top sinks, bottom rises
  for(i=0;i<6;i++)(function(i){
    Q(340+i*22,function(){
      spawnEnemy('drone',W+24,18,{path:'cross',sp:2.8*d,by:18,dir:1,amp:150});
      spawnEnemy('drone',W+24,H-18,{path:'cross',sp:2.8*d,by:H-18,dir:-1,amp:150});
    });
  })(i);
  // pincer turrets at the same beat + free 4-way mines
  Q(520,function(){spawnEnemy('turret',W+30,H-22,{path:'ground'});spawnEnemy('turret',W+30,22,{path:'ceil'});});
  for(i=0;i<3;i++)(function(i){Q(560+i*50,function(){spawnEnemy('mine',W+30,rnd(50,H-50),{path:'drift',sp:1.8*d});});})(i);
  // first gate: CENTER gap (3-4), opposite of zone1's high gap
  for(i=0;i<7;i++)(function(i){if(i!==3&&i!==4)Q(780+i*3,function(){spawnEnemy('mine',W+30,25+i*25,{path:'drift',sp:1.7*d,wall:true});});})(i);
  // paired rays from high and low, not random mid
  for(i=0;i<4;i++)(function(i){
    Q(900+i*38,function(){
      spawnEnemy('ray',W+30,40,{path:'dash',sp:2.2*d});
      spawnEnemy('ray',W+30,H-40,{path:'dash',sp:2.2*d});
    });
  })(i);
  // second gate soon after, gap at the BOTTOM — forces a weave
  for(i=0;i<7;i++)(function(i){if(i!==5&&i!==6)Q(1120+i*3,function(){spawnEnemy('mine',W+30,25+i*25,{path:'drift',sp:1.8*d,wall:true});});})(i);
  // zigzag corridor instead of Vee
  for(i=0;i<10;i++)(function(i){Q(1280+i*14,function(){spawnEnemy('drone',W+30,H/2,{path:'zig',ph:i*0.7,sp:3.5*d,by:H/2,amp:42});});})(i);
  Q(1520,function(){spawnEnemy('crab',W+40,H/2,{path:'crab',sp:1.25*d});});
  // ceiling drop after crab (zone1's empty valley)
  for(i=0;i<8;i++)(function(i){Q(1680+i*16,function(){spawnEnemy('drone',W+20+i*6,8,{path:'sink',sp:3.2*d,ph:i});});})(i);
  Q(1860,function(){spawnEnemy('turret',W+30,H-22,{path:'ground'});});
  Q(1880,function(){spawnEnemy('turret',W+30,22,{path:'ceil'});});
  for(i=0;i<4;i++)(function(i){Q(1960+i*28,function(){spawnEnemy('mine',W+30,60+(i%2)*80,{path:'drift',sp:2*d});});})(i);
  for(i=0;i<3;i++)(function(i){
    Q(2200+i*36,function(){
      spawnEnemy('ray',W+30,34+i*8,{path:'dash',sp:2.6*d});
      spawnEnemy('ray',W+30,H-34-i*8,{path:'dash',sp:2.6*d});
    });
  })(i);
  Q(2500,function(){say('WARNING');SFX.warn();});
  Q(2680,function(){spawnBoss();});
}
function enemyUpdate(e){
  e.t++;var p=e.path,sp=e.sp||3;
  if(p==='sine'){e.x-=sp;e.y=e.by+Math.sin(e.t*0.06+e.ph)*(e.amp||30);if(e.t%70===35&&e.x<W-100&&e.x>150)eshot(e.x,e.y,aimAt(e.x,e.y),4);}
  else if(p==='vee'){e.x-=sp;e.y=H/2+(e.ph%2?1:-1)*Math.min(e.t*0.55,72)*(1+(e.ph>>1)*0.06);}
  else if(p==='dash'){if(e.t<60){e.x-=sp*0.5;}else if(e.t<90){e.x+=0.3;}else{e.x-=sp*4;}if(e.t===80)eshot(e.x,e.y,aimAt(e.x,e.y),5,1);}
  else if(p==='drift'){e.x-=sp;if(!e.wall)e.y+=Math.sin(e.t*0.03)*0.6;if(!e.wall&&e.t%90===60){var i;for(i=0;i<4;i++)eshot(e.x,e.y,i*1.5708+e.t*0.01,2.2);}}
  else if(p==='ground'||p==='ceil'){e.x-=1.5;if(e.t%50===0&&e.x<W-40){var a=aimAt(e.x,e.y);eshot(e.x,e.y,a-0.32,3.2);eshot(e.x,e.y,a,3.2);eshot(e.x,e.y,a+0.32,3.2);}}
  else if(p==='crab'){if(e.x>W-115)e.x-=sp;else{e.y=H/2+Math.sin(e.t*0.025)*48;e.x=W-115+Math.sin(e.t*0.05)*14;}
    if(e.t%40===0&&e.x<W-100){var j,a2=aimAt(e.x,e.y);for(j=-2;j<=2;j++)eshot(e.x-10,e.y,a2+j*0.18,3.5);}}
  else if(p==='zig'){var u=(e.t*0.09+e.ph)%4,tri=u<2?u-1:3-u;e.x-=sp;e.y=e.by+tri*(e.amp||36);if(e.t%80===40&&e.x<W-90&&e.x>140)eshot(e.x,e.y,aimAt(e.x,e.y),3.6);}
  else if(p==='cross'){e.x-=sp;e.y=e.by+(e.dir||1)*Math.min(e.t*0.65,e.amp||140);if(e.t===50&&e.x<W-60)eshot(e.x,e.y,aimAt(e.x,e.y),4);}
  else if(p==='sink'){if(e.t<36){e.y+=sp*0.55;e.x-=sp*0.25;}else{e.x-=sp;e.y+=Math.sin(e.t*0.06+(e.ph||0))*0.9;}if(e.y>H-12)e.y=H-12;if(e.t===44&&e.x<W-70)eshot(e.x,e.y,aimAt(e.x,e.y),4.2);}
  if(e.x<-60||e.y<-80||e.y>H+80)e.dead=true;
}
function enemyBodyDraw(e){
  cx.save();cx.translate(e.x,e.y);
  var k=e.kind,f=e.flash?'#fff':null;
  if(k==='drone'){cx.fillStyle=f||'#ff0';cx.beginPath();cx.moveTo(7,0);cx.lineTo(-5,-5);cx.lineTo(-2,0);cx.lineTo(-5,5);cx.closePath();cx.fill();cx.fillStyle='#000';cx.fillRect(1,-1,3,3);}
  else if(k==='ray'){cx.fillStyle=f||(zoneEven()?'#f0f':'#0ff');cx.beginPath();cx.moveTo(11,0);cx.lineTo(-4,-10);cx.lineTo(-8,0);cx.lineTo(-4,10);cx.closePath();cx.fill();cx.fillStyle=zoneEven()?'#f00':'#00f';cx.fillRect(-1,-2,6,4);}
  else if(k==='mine'){cx.rotate(e.t*0.04);cx.fillStyle=f||(e.wall?'#f00':'#f00');var i;for(i=0;i<6;i++){cx.rotate(1.047);cx.fillRect(5,-1,5,2);}cx.beginPath();cx.arc(0,0,5,0,6.283);cx.fill();cx.fillStyle=e.wall?'#fff':'#ff0';cx.fillRect(-1,-1,3,3);}
  else if(k==='turret'){var up=e.path==='ceil'?-1:1;cx.fillStyle='#00f';cx.fillRect(-11,up>0?2:-8,22,6);cx.fillStyle=f||'#0ff';cx.beginPath();cx.arc(0,0,7,0,6.283);cx.fill();var a=aimAt(e.x,e.y);cx.rotate(a);cx.fillStyle='#000';cx.fillRect(0,-2,12,4);}
  else if(k==='crab'){cx.fillStyle=f||'#f00';cx.beginPath();cx.ellipse?cx.ellipse(0,0,16,10,0,0,6.283):cx.arc(0,0,13,0,6.283);cx.fill();
    cx.strokeStyle=f||'#ff0';cx.lineWidth=3;var i2;for(i2=0;i2<3;i2++){var ly=-7+i2*7,w=Math.sin(e.t*0.15+i2)*3;cx.beginPath();cx.moveTo(-12,ly);cx.lineTo(-23,ly+w);cx.moveTo(12,ly);cx.lineTo(23,ly-w);cx.stroke();}
    cx.fillStyle='#fff';cx.fillRect(-8,-4,5,4);cx.fillRect(3,-4,5,4);}
  cx.restore();
}
function startCut(e){
  if(!e||e.cutT)return;
  e.cutT=e.cutMax=22;
  slashes.push({x:e.x,y:e.y,w:Math.max(28,e.r*5),life:14,max:14});
  var i;for(i=0;i<7&&parts.length<LIMIT.parts;i++)parts.push({x:e.x+rnd(-e.r,e.r),y:e.y,vx:rnd(-0.8,0.8),vy:rnd(-3,3),life:14,max:14,col:(i&1)?'#fff':'#0ff'});
  SFX.slash();
}
function enemyDraw(e){
  if(!e.cutT){enemyBodyDraw(e);return;}
  var done=e.cutMax-e.cutT,sep=Math.min(16,done*1.05),span=e.r*3.4,y=Math.round(e.y),x=Math.round(e.x);
  cx.save();cx.beginPath();cx.rect(e.x-span,e.y-span,span*2,span);cx.clip();cx.translate(0,-sep);enemyBodyDraw(e);cx.restore();
  cx.save();cx.beginPath();cx.rect(e.x-span,e.y,span*2,span);cx.clip();cx.translate(0,sep);enemyBodyDraw(e);cx.restore();
  if(done<5){cx.fillStyle='#fff';cx.fillRect(x-Math.round(e.r*3),y-1,Math.round(e.r*6),3);}
  cx.fillStyle=(e.cutT&1)?'#fff':'#0ff';cx.fillRect(x-Math.round(e.r*2.2),y,Math.round(e.r*4.4),1);
  cx.fillStyle=(e.cutT&2)?'#0ff':'#fff';cx.fillRect(x-Math.round(e.r*1.6),y-1,Math.round(e.r*3.2),1);
}

// ---------- boss: 深海要塞コア ----------
function spawnBoss(){
  var hp=Math.round((260+stage*80)*(1+power*BOSS_HP_PER_POWER));
  boss={x:W+100,y:H/2,t:0,hp:hp,max:hp,r:28,phase:0,arms:[],flash:0,dead:false,dying:0};
  var i;for(i=0;i<4;i++)boss.arms.push({a:i*1.5708,hp:30+stage*8,r:7,dead:false,len:36});
  bgmTick();
}
function bossUpdate(b){
  b.t++;
  if(b.dying){b.dying++;if(b.dying%6===0){burst(b.x+rnd(-70,70),b.y+rnd(-70,70),14,'#ff0',5,40);SFX.boom();shake=8;}
    if(b.dying>150){SFX.bigboom();flash=20;burst(b.x,b.y,120,'#fff',9,70);score+=5000*stage;b.dead=true;stageClear();}return;}
  if(b.x>W-105)b.x-=1.2;else{b.y=H/2+Math.sin(b.t*0.012)*25;b.x=W-105+Math.cos(b.t*0.02)*14;}
  var alive=0,i;for(i=0;i<4;i++)if(!b.arms[i].dead)alive++;
  var rot=0.012+(4-alive)*0.006;
  for(i=0;i<4;i++){var A=b.arms[i];A.a+=rot;A.px=b.x+Math.cos(A.a)*A.len;A.py=b.y+Math.sin(A.a)*A.len;A.x=A.px;A.y=A.py;A.isBossArm=true;
    if(!A.dead&&b.t%55===i*13&&b.x<W-100)eshot(A.px,A.py,aimAt(A.px,A.py),3.5,1);}
  if(b.x<W-120){
    if(alive===0){ if(b.t%18===0){var a=b.t*0.13,j;for(j=0;j<3;j++)eshot(b.x,b.y,a+j*2.094,3,2);} if(b.t%120===0){var k;for(k=-3;k<=3;k++)eshot(b.x,b.y,aimAt(b.x,b.y)+k*0.12,4.5);} }
    else if(b.t%90===0){var m;for(m=0;m<12;m++)eshot(b.x,b.y,m*0.5236+b.t*0.01,2.4,2);}
  }
}
function bossDraw(b){
  var i;
  for(i=0;i<4;i++){var A=b.arms[i];
    cx.strokeStyle=A.dead?'#00f':'#0ff';cx.lineWidth=A.dead?2:4;cx.beginPath();cx.moveTo(b.x,b.y);
    var midx=b.x+Math.cos(A.a)*A.len*0.5+Math.cos(A.a+1.5)*Math.sin(b.t*0.05+i)*10,midy=b.y+Math.sin(A.a)*A.len*0.5+Math.sin(A.a+1.5)*Math.sin(b.t*0.05+i)*10;
    cx.quadraticCurveTo(midx,midy,A.px,A.py);cx.stroke();
    if(!A.dead){cx.fillStyle=A.flash?'#fff':'#ff0';cx.beginPath();cx.arc(A.px,A.py,A.r,0,6.283);cx.fill();cx.fillStyle='#f00';cx.fillRect(A.px-2,A.py-2,4,4);}
    else{cx.fillStyle='#00f';cx.beginPath();cx.arc(A.px,A.py,5,0,6.283);cx.fill();}
  }
  cx.save();cx.translate(b.x,b.y);
  cx.rotate(b.t*0.01);cx.strokeStyle='#0ff';cx.lineWidth=5;cx.setLineDash([13,7]);cx.beginPath();cx.arc(0,0,38,0,6.283);cx.stroke();
  cx.rotate(-b.t*0.025);cx.strokeStyle='#00f';cx.lineWidth=3;cx.setLineDash([6,5]);cx.beginPath();cx.arc(0,0,32,0,6.283);cx.stroke();cx.setLineDash([]);
  var pulse=0.5+Math.sin(b.t*0.1)*0.5,exposed=true;for(i=0;i<4;i++)if(!b.arms[i].dead)exposed=false;
  cx.fillStyle=b.flash?'#fff':(exposed?'#f00':'#00f');cx.beginPath();cx.arc(0,0,b.r,0,6.283);cx.fill();
  cx.fillStyle=exposed?(pulse>0.5?'#ff0':'#f00'):(pulse>0.5?'#0ff':'#00f');cx.beginPath();cx.arc(0,0,13+pulse*3,0,6.283);cx.fill();
  cx.restore();
  cx.fillStyle='#000';cx.fillRect(W/2-100,7,200,5);cx.fillStyle=exposed?'#fff':'#0ff';cx.fillRect(W/2-100,7,200*b.hp/b.max,5);
}
function stageClear(){
  stage++;saveHI();say(zoneName());waveT=0;scheduleWaves();
}

// ---------- Boomerang Slugger option ----------
function addBoomerang(){
  if(boomerangs.length<2)boomerangs.push({x:player.x,y:player.y,state:'orbit',cool:16+boomerangs.length*14,vx:0,vy:0,target:null,life:0});
  else score+=800;
}
function nearestBoomTarget(x,y){
  var best=null,bd=1e9,i,e,dx,dy,d,A,armAlive=false;
  if(boss&&!boss.dead&&!boss.dying){
    for(i=0;i<boss.arms.length;i++){A=boss.arms[i];if(A.dead)continue;armAlive=true;if(typeof A.px!=='number')continue;dx=A.px-x;dy=A.py-y;d=dx*dx+dy*dy;if(d<bd){bd=d;best=A;}}
    if(armAlive)return best;
  }
  for(i=0;i<enemies.length;i++){e=enemies[i];if(e.dead||e.cutT||e.x<player.x-20)continue;dx=e.x-x;dy=e.y-y;d=dx*dx+dy*dy;if(d<bd){bd=d;best=e;}}
  if(!best&&boss&&!boss.dead&&!boss.dying)best=boss;
  return best;
}
function boomOrbitHit(b){
  var z,e,dx,dy,rr;
  for(z=0;z<enemies.length;z++){
    e=enemies[z];if(e.dead||e.cutT||(e.orbitHit&&e.orbitHit>time))continue;
    dx=b.x-e.x;dy=b.y-e.y;rr=e.r+4;if(dx*dx+dy*dy>rr*rr)continue;
    e.orbitHit=time+18;
    if(e.kind==='drone'||e.kind==='ray'||(e.kind==='mine'&&!e.wall)){startCut(e);score+=e.score*stage;}
    else{e.hp-=2;e.flash=4;SFX.hit();}
    return;
  }
}
function updateBoomerangs(){
  var i,b,a,dx,dy,d,sp=7;
  for(i=0;i<boomerangs.length;i++){
    b=boomerangs[i];
    if(b.state==='orbit'){
      a=time*0.045+i*3.1416;b.x=player.x+Math.cos(a)*19;b.y=player.y+Math.sin(a)*11;
      boomOrbitHit(b);
      if(b.cool>0)b.cool--;else{b.target=nearestBoomTarget(b.x,b.y);if(b.target){b.state='attack';b.life=0;}}
    }else if(b.state==='attack'){
      b.life++;if(!b.target||b.target.dead||b.target.cutT||b.life>100){b.state='return';b.target=null;}
      else{dx=b.target.x-b.x;dy=b.target.y-b.y;d=Math.sqrt(dx*dx+dy*dy)||1;b.vx=b.vx*0.55+dx/d*sp*0.45;b.vy=b.vy*0.55+dy/d*sp*0.45;b.x+=b.vx;b.y+=b.vy;}
      if(!b.tx){b.tx=[];b.ty=[];}b.tx.push(b.x);b.ty.push(b.y);if(b.tx.length>7){b.tx.shift();b.ty.shift();}
    }else{
      dx=player.x-b.x;dy=player.y-b.y;d=Math.sqrt(dx*dx+dy*dy)||1;b.x+=dx/d*8;b.y+=dy/d*8;
      if(d<10){b.state='orbit';b.cool=36+i*10;b.vx=b.vy=0;b.tx=[];b.ty=[];}
    }
  }
}
function drawBoomerangs(){
  var i,b,x,y,c,k;
  for(i=0;i<boomerangs.length;i++){
    b=boomerangs[i];
    if(b.tx){for(k=0;k<b.tx.length;k++){cx.fillStyle=k>4?'#fff':'#ff0';cx.fillRect(Math.round(b.tx[k])-1,Math.round(b.ty[k])-1,k>4?3:2,1);}}
    x=Math.round(b.x);y=Math.round(b.y);c=((time>>1)+i)&1;cx.fillStyle=c?'#fff':'#ff0';
    cx.fillRect(x-2,y-2,5,5);cx.fillRect(x-4,y-1,9,1);cx.fillRect(x-1,y-4,1,9);
    cx.fillStyle='#f00';cx.fillRect(x-5,y-5,2,1);cx.fillRect(x+4,y-5,2,1);
    if(b.state==='attack'){cx.fillStyle=(time&1)?'#fff':'#0ff';cx.fillRect(x-8,y,16,1);}
  }
}

// ---------- player ----------
var PLAYER_PAL=[null,'#fff','#0ff','#00f','#ff0','#f00'];
var PLAYER_PAT=[
'000000000000000000000000',
'001111111111111111000000',
'001111133333111111111000',
'001111111111111111111110',
'000000000011111100000000',
'000000000011221100000000',
'000000000011221100000000',
'000000000011111100000000',
'001111111111111111111110',
'001111133333111111111000',
'001111111111111111000000',
'000000000000000000000000'
].map(function(r){return r.split('').map(Number);});
var PLAYER_FLAME=[
  [[0,2,4],[1,2,4],[0,9,4],[1,9,4]],
  [[0,2,5],[1,1,4],[0,9,5],[1,10,4]]
];
var PLAYER_CV=(function(){
  var c=document.createElement('canvas');c.width=24;c.height=12;
  var g=c.getContext('2d'),j,i,v;
  for(j=0;j<12;j++)for(i=0;i<24;i++){v=PLAYER_PAT[j][i];if(!v)continue;g.fillStyle=PLAYER_PAL[v];g.fillRect(i,j,1,1);}
  return c;
})();

var fireT=0;
function playerUpdate(){
  var ax=0,ay=0;
  if(keys[37]||keys[65])ax-=1;if(keys[39]||keys[68])ax+=1;if(keys[38]||keys[87])ay-=1;if(keys[40]||keys[83])ay+=1;
  var sp=5.2;player.x+=ax*sp;player.y+=ay*sp;
  if(touch.active){var mx=Math.max(-14,Math.min(14,touch.mx)),my=Math.max(-14,Math.min(14,touch.my));player.x+=mx;player.y+=my;touch.mx-=mx;touch.my-=my;ay=ay||my/14;}
  player.x=Math.max(14+safeL,Math.min(W-18-safeR,player.x));player.y=Math.max(8+safeT,Math.min(H-8-safeB,player.y));
  player.tilt=ay;
  if(invul>0)invul--;
  fireT++;var rate=power>=3?6:8;
  if(fireT>=rate&&bullets.length<LIMIT.pbullets){fireT=0;
    bullets.push({x:player.x+12,y:player.y-3,vx:11,vy:0,dmg:1});
    bullets.push({x:player.x+12,y:player.y+3,vx:11,vy:0,dmg:1});
    if(power>=1){var spr=power>=4?2.0:1.2;bullets.push({x:player.x+10,y:player.y-3,vx:10,vy:-spr,dmg:1});bullets.push({x:player.x+10,y:player.y+3,vx:10,vy:spr,dmg:1});}
    if(power>=2){bullets.push({x:player.x+4,y:player.y-7,vx:9,vy:0,dmg:1});bullets.push({x:player.x+4,y:player.y+7,vx:9,vy:0,dmg:1});}
    if(power>=3){bullets.push({x:player.x+14,y:player.y,vx:12,vy:0,dmg:1});}
    if(power>=4){bullets.push({x:player.x-10,y:player.y-3,vx:-8,vy:-0.6,dmg:1});bullets.push({x:player.x-10,y:player.y+3,vx:-8,vy:0.6,dmg:1});}
    SFX.shot();
  }
  if(power>=5&&time%24===0&&bullets.length<LIMIT.pbullets)bullets.push({x:player.x+14,y:player.y,vx:12,vy:0,dmg:3,pierce:3,lance:true,lastHit:null});
}
function playerDraw(){
  if(invul>0&&(invul>>2)%2===0)return;
  var x=Math.round(player.x)-12,y=Math.round(player.y)-6,bank=0;
  if(player.tilt<-0.2)bank=-1;else if(player.tilt>0.2)bank=1;
  if(bank===0)cx.drawImage(PLAYER_CV,x,y);
  else{
    cx.drawImage(PLAYER_CV,0,0,12,12,x,y,12,12);
    cx.drawImage(PLAYER_CV,12,0,12,12,x+12,y+bank,12,12);
  }
  var fl=PLAYER_FLAME[(time>>2)%2],k;
  for(k=0;k<fl.length;k++){cx.fillStyle=PLAYER_PAL[fl[k][2]];cx.fillRect(x-2+fl[k][0],y+fl[k][1],1,1);}
  if(fireT===0){cx.fillStyle='#fff';cx.fillRect(x+22,y+3,2,1);cx.fillRect(x+22,y+8,2,1);}
  if(shield>0){var i,a,boost=shieldFlash?shieldFlash*0.35:0;
    cx.fillStyle=(time>>2)%2?'#0ff':'#fff';
    for(i=0;i<16;i++){a=i*0.3927+time*0.035;cx.fillRect(Math.round(player.x+Math.cos(a)*(17+boost)),Math.round(player.y+Math.sin(a)*(10+boost*0.5)),1,1);}
    cx.fillStyle=(time>>2)%2?'#fff':'#00f';
    for(i=0;i<12;i++){a=i*0.5236-time*0.05;cx.fillRect(Math.round(player.x+Math.cos(a)*(14+boost)),Math.round(player.y+Math.sin(a)*(8+boost*0.5)),1,1);}
    cx.fillStyle='#ff0';for(i=0;i<shield;i++){a=time*0.06+i*2.094;cx.fillRect(Math.round(player.x+Math.cos(a)*20)-1,Math.round(player.y+Math.sin(a)*12)-1,3,3);}
  }
}
function playerHit(){
  if(invul>0)return;
  if(shield>0){shield--;shieldFlash=12;invul=40;SFX.hit();burst(player.x,player.y,18,'#0ff',3,20);return;}
  SFX.dead();burst(player.x,player.y,50,'#ff0',6,50);shake=14;flash=10;
  lives--;power=Math.max(0,power-2);
  if(lives<0){state='over';deadT=0;saveHI();bgmTick();return;}
  invul=150;player.x=120;player.y=H/2;ebullets.length=0;
}

// ---------- pickups ----------
function dropPickup(x,y){
  var r=Math.random();
  if(r<0.18)pickups.push({x:x,y:y,kind:'P',t:0});
  else if(r<0.25)pickups.push({x:x,y:y,kind:'S',t:0});
  else if(r<0.32)pickups.push({x:x,y:y,kind:'B',t:0});
}

// ---------- update ----------
function update(){
  time++;
  if(state!=='play'){if(state==='over')deadT++;scroll+=0.7;parts.forEach(pUpd);return;}
  if(introT>0){introT--;playerUpdate();bullets.length=0;scroll+=2;if(msgT>0)msgT--;if(introT===0){invul=120;say(zoneName());}bgmTick();return;}
  scroll+=2;
  if(spawnQ.length===0&&!boss&&enemies.length===0)scheduleWaves();
  waveT++;
  var i;
  for(i=spawnQ.length-1;i>=0;i--){if(spawnQ[i].t<=waveT){spawnQ[i].f();spawnQ.splice(i,1);}}
  playerUpdate();
  updateBoomerangs();
  for(i=bullets.length-1;i>=0;i--){var b=bullets[i];b.x+=b.vx;b.y+=b.vy;if(b.x>W+20||b.x<-20)bullets.splice(i,1);}
  for(i=enemies.length-1;i>=0;i--){var e=enemies[i];
    if(e.cutT){e.cutT--;if(e.cutT<=0){e.dead=true;burst(e.x,e.y,18,'#fff',4,24);SFX.boom();dropPickup(e.x,e.y);}if(e.dead)enemies.splice(i,1);continue;}
    enemyUpdate(e);if(e.flash)e.flash--;
    var j;for(j=bullets.length-1;j>=0;j--){var bb=bullets[j];if(bb.lastHit!==e&&Math.abs(bb.x-e.x)<e.r+3&&Math.abs(bb.y-e.y)<e.r+1){e.hp-=bb.dmg;e.flash=3;SFX.hit();parts.push({x:bb.x,y:bb.y,vx:2,vy:rnd(-1,1),life:8,max:8,col:'#fff'});if(bb.pierce){bb.pierce--;bb.lastHit=e;if(bb.pierce<=0)bullets.splice(j,1);}else bullets.splice(j,1);}}
    var z,bm,bdx,bdy;for(z=0;z<boomerangs.length;z++){bm=boomerangs[z];if(bm.state!=='attack')continue;bdx=bm.x-e.x;bdy=bm.y-e.y;if(bdx*bdx+bdy*bdy<(e.r+5)*(e.r+5)){bm.state='return';bm.target=null;if(e.kind==='drone'||e.kind==='ray'||e.kind==='mine'){startCut(e);score+=e.score*stage;}else{e.hp-=5;e.flash=5;SFX.hit();}break;}}
    if(e.cutT)continue;
    if(e.hp<=0){e.dead=true;score+=e.score*stage;burst(e.x,e.y,e.kind==='crab'?40:14,e.kind==='mine'?'#f00':'#ff0',e.kind==='crab'?6:4,e.kind==='crab'?45:25);SFX.boom();dropPickup(e.x,e.y);}
    else if(!e.dead&&Math.abs(player.x-e.x)<e.r+player.r-4&&Math.abs(player.y-e.y)<e.r+player.r-4){playerHit();}
    if(e.dead)enemies.splice(i,1);
  }
  if(boss){bossUpdate(boss);if(boss.flash)boss.flash--;
    if(!boss.dying){var k;
      for(k=bullets.length-1;k>=0;k--){var pb=bullets[k],hit=false,m;
        for(m=0;m<4;m++){var A=boss.arms[m];if(!A.dead&&Math.abs(pb.x-A.px)<A.r+3&&Math.abs(pb.y-A.py)<A.r+2){A.hp--;A.flash=3;hit=true;if(A.hp<=0){A.dead=true;burst(A.px,A.py,30,'#ff0',6,40);SFX.boom();score+=1000*stage;}break;}}
        if(!hit&&Math.abs(pb.x-boss.x)<boss.r&&Math.abs(pb.y-boss.y)<boss.r){var exposed=true,q;for(q=0;q<4;q++)if(!boss.arms[q].dead)exposed=false;
          if(exposed){boss.hp-=1;boss.flash=2;}else{boss.hp-=0.1;}hit=true;}
        if(hit){bullets.splice(k,1);SFX.hit();}
      }
      for(m=0;m<4;m++)if(boss.arms[m].flash)boss.arms[m].flash--;
      for(k=0;k<boomerangs.length;k++){var bo=boomerangs[k];if(bo.state==='attack'){
        var armHit=false,aliveArms=0,ba,bdx,bdy;
        for(m=0;m<4;m++){ba=boss.arms[m];if(ba.dead)continue;aliveArms++;bdx=bo.x-ba.px;bdy=bo.y-ba.py;
          if(bdx*bdx+bdy*bdy<(ba.r+5)*(ba.r+5)){ba.hp-=10;ba.flash=5;armHit=true;bo.state='return';bo.target=null;SFX.hit();
            if(ba.hp<=0){ba.dead=true;burst(ba.px,ba.py,30,'#ff0',6,40);SFX.boom();score+=1000*stage;}break;}}
        if(!armHit&&aliveArms===0){var bx=bo.x-boss.x,by=bo.y-boss.y;if(bx*bx+by*by<(boss.r+5)*(boss.r+5)){boss.hp-=5;boss.flash=5;bo.state='return';bo.target=null;SFX.hit();}}
      }}
      if(boss.hp<=0){boss.hp=0;boss.dying=1;ebullets.length=0;}
      var dx=player.x-boss.x,dy=player.y-boss.y;if(dx*dx+dy*dy<(boss.r+player.r)*(boss.r+player.r))playerHit();
    }
    if(boss.dead)boss=null;
  }
  for(i=ebullets.length-1;i>=0;i--){var s=ebullets[i];s.x+=s.vx;s.y+=s.vy;
    if(s.x<-20||s.x>W+40||s.y<-20||s.y>H+20){ebullets.splice(i,1);continue;}
    var ddx=s.x-player.x,ddy=s.y-player.y;if(ddx*ddx+ddy*ddy<(s.r+player.r-3)*(s.r+player.r-3)){ebullets.splice(i,1);playerHit();break;}
  }
  for(i=pickups.length-1;i>=0;i--){var pk=pickups[i];pk.t++;pk.x-=1.5;pk.y+=Math.sin(pk.t*0.08)*0.8;
    if(Math.abs(pk.x-player.x)<13&&Math.abs(pk.y-player.y)<13){if(pk.kind==='P'){if(power<5)power++;else score+=500;}else if(pk.kind==='S'){shield=Math.min(3,shield+1);shieldFlash=8;}else addBoomerang();SFX.power();pickups.splice(i,1);continue;}
    if(pk.x<-30)pickups.splice(i,1);
  }
  parts.forEach(pUpd);for(i=parts.length-1;i>=0;i--)if(parts[i].life<=0)parts.splice(i,1);
  for(i=slashes.length-1;i>=0;i--){slashes[i].life--;if(slashes[i].life<=0)slashes.splice(i,1);}
  if(shake>0)shake--;if(flash>0)flash--;if(shieldFlash>0)shieldFlash--;if(msgT>0)msgT--;
  bgmTick();
}
function pUpd(p){p.x+=p.vx;p.y+=p.vy;p.vx*=0.96;p.vy*=0.96;p.life--;}

// ---------- background ----------
var bg=[],i0;for(i0=0;i0<40;i0++)bg.push({x:rnd(0,W),y:rnd(0,H),z:rnd(0.2,1)});
var seabed=[];for(i0=0;i0<60;i0++)seabed.push(rnd(20,70));
function drawBG(){
  var P=pal(),i;
  cx.fillStyle='#000';cx.fillRect(0,0,W,H);
  for(i=0;i<H;i+=8)dither(0,i,W,3,2,P.deep);
  for(i=0;i<4;i++){var sx=((i*190-scroll*0.15)%(W+220)+W+220)%(W+220)-100;for(var q=0;q<42;q+=8)dither(sx+q,0,3,H,2,P.mid);}
  for(i=0;i<bg.length;i++){var b=bg[i];var x=((b.x-scroll*b.z)%W+W)%W,y=(b.y-time*0.3*b.z+H)%H;cx.fillStyle=b.z>0.7?P.hi:P.deep;cx.fillRect(Math.round(x),Math.round(y),b.z>0.7?2:1,b.z>0.7?2:1);}
  cx.strokeStyle=P.deep;cx.lineWidth=2;
  if(zoneEven()){
    for(i=0;i<7;i++){var vx=((i*110-scroll*0.7)%(W+140)+W+140)%(W+140)-70;cx.beginPath();cx.moveTo(vx,H);cx.lineTo(vx+8,H-38-Math.sin((scroll+i)*0.03)*10);cx.lineTo(vx+16,H);cx.stroke();}
  }else{
    for(i=0;i<6;i++){var gx=((i*140-scroll*0.5)%(W+160)+W+160)%(W+160)-80;cx.beginPath();cx.moveTo(gx,H-26);cx.lineTo(gx+24,H-70);cx.lineTo(gx+48,H-26);cx.stroke();}
  }
  cx.fillStyle=P.land;cx.beginPath();cx.moveTo(0,H);
  for(i=0;i<=60;i++){var px=i*(W+40)/60-(scroll%((W+40)/60*2)),idx=(i+Math.floor(scroll/((W+40)/60)))%60;cx.lineTo(px,H-seabed[idx<0?idx+60:idx]*(zoneEven()?0.72:1));}
  cx.lineTo(W+40,H);cx.closePath();cx.fill();
  cx.fillStyle=P.land;cx.beginPath();cx.moveTo(0,0);
  for(i=0;i<=60;i++){var px2=i*(W+40)/60-(scroll*1.3%((W+40)/60*2)),idx2=(i*7+Math.floor(scroll*1.3/((W+40)/60)))%60;cx.lineTo(px2,seabed[idx2<0?idx2+60:idx2]*(zoneEven()?0.62:0.5));}
  cx.lineTo(W+40,0);cx.closePath();cx.fill();
  dither(0,H-72,W,72,2,'#000');dither(0,0,W,36,2,'#000');
}

// ---------- draw ----------
function draw(){
  cx.setTransform(1,0,0,1,0,0);
  cx.fillStyle='#000';cx.fillRect(0,0,cv.width,cv.height);
  cx.save();cx.beginPath();cx.rect(0,0,W,H);cx.clip();
  if(shake>0)cx.translate(rnd(-shake,shake),rnd(-shake,shake));
  drawBG();
  var i;
  for(i=0;i<pickups.length;i++){var pk=pickups[i];cx.fillStyle=pk.kind==='P'?'#ff0':(pk.kind==='S'?'#0ff':'#fff');cx.beginPath();cx.arc(pk.x,pk.y,7,0,6.283);cx.fill();cx.fillStyle=pk.kind==='B'?'#f00':'#000';cx.font='bold 8px monospace';cx.textAlign='center';cx.textBaseline='middle';cx.fillText(pk.kind,pk.x,pk.y+1);}
  for(i=0;i<enemies.length;i++)enemyDraw(enemies[i]);
  if(boss)bossDraw(boss);
  for(i=0;i<slashes.length;i++){var sl=slashes[i],lf=sl.life/sl.max,sw=Math.round(sl.w*(0.55+lf*0.7));cx.fillStyle=lf>0.6?'#fff':(lf>0.3?'#0ff':'#00f');cx.fillRect(Math.round(sl.x)-sw/2,Math.round(sl.y),sw,1);if(lf>0.45){cx.fillStyle='#fff';cx.fillRect(Math.round(sl.x)-sw/2,Math.round(sl.y)-1,sw,1);}}
  for(i=0;i<bullets.length;i++){var b=bullets[i],bx=Math.round(b.x),by=Math.round(b.y);
    if(b.lance){cx.fillStyle='#00f';cx.fillRect(bx-24,by-1,18,2);cx.fillStyle='#0ff';cx.fillRect(bx-16,by-2,34,4);cx.fillStyle='#fff';cx.fillRect(bx-6,by-1,28,2);if(time&1){cx.fillRect(bx+20,by-2,4,4);cx.fillStyle='#0ff';cx.fillRect(bx-28,by,10,1);}}
    else{cx.fillStyle='#0ff';cx.fillRect(bx-6,by-1,12,2);if(power>=3){cx.fillStyle='#fff';cx.fillRect(bx+5,by,3,1);}}
  }
  for(i=0;i<ebullets.length;i++){var s=ebullets[i];cx.fillStyle=s.kind===1?'#f00':(s.kind===2?'#fff':'#ff0');cx.fillRect(Math.round(s.x)-2,Math.round(s.y)-2,4,4);cx.fillStyle='#fff';cx.fillRect(Math.round(s.x),Math.round(s.y),1,1);}
  for(i=0;i<parts.length;i++){var p=parts[i];var lf=p.life/p.max;if(lf<0.35&&((time+i)&1))continue;cx.fillStyle=lf>0.6?p.col:(lf>0.35?'#f00':'#00f');cx.fillRect(Math.round(p.x)-1,Math.round(p.y)-1,2,2);}
  if(state==='play')drawBoomerangs();
  if(state==='play')playerDraw();
  if(flash>0){if(flash>14){cx.fillStyle='#fff';cx.fillRect(0,0,W,H);}else dither(0,0,W,H,flash>7?2:3,'#fff');}
  cx.fillStyle='#fff';cx.font='bold 10px "Courier New",monospace';cx.textAlign='left';cx.textBaseline='top';
  var hudL=8+safeL,hudR=W-8-safeR,hudTop=4+safeT,hudBottom=H-14-safeB;
  cx.fillText('1P '+pad(score),hudL,hudTop);
  cx.textAlign='right';cx.fillText('HI '+pad(Math.max(hiscore,score)),hudR,hudTop);
  cx.textAlign='left';cx.fillText(zoneEven()?'ZONE '+stage+' THM':'ZONE '+stage+' TRN',hudL,hudBottom);
  for(i=0;i<lives;i++){cx.fillStyle='#fff';cx.beginPath();cx.moveTo(hudL+78+i*13,hudBottom+5);cx.lineTo(hudL+70+i*13,hudBottom+2);cx.lineTo(hudL+70+i*13,hudBottom+8);cx.closePath();cx.fill();}
  cx.fillStyle='#ff0';cx.textAlign='right';cx.fillText('PWR '+repeat('|',power)+repeat('.',5-power),hudR,hudBottom);
  cx.fillStyle='#0ff';cx.fillText('SH '+repeat('o',shield),hudR-100,hudBottom);
  cx.fillStyle='#fff';cx.fillText('B '+repeat('*',boomerangs.length),hudR-144,hudBottom);
  if(msgT>0&&!(msgT<30&&(msgT>>2)&1)){cx.fillStyle=msg==='WARNING'?'#f00':'#fff';cx.font='bold 22px "Courier New",monospace';cx.textAlign='center';cx.textBaseline='middle';cx.fillText(msg,W/2,H/2-30);}
  if(state!=='play'){
    dither(0,H/2-58,W,120,2,'#000');cx.fillStyle='#000';cx.fillRect(W/2-210,H/2-52,420,104);
    cx.textAlign='center';cx.textBaseline='middle';
    if(state==='title'){cx.fillStyle='#0ff';cx.font='bold 34px "Courier New",monospace';cx.fillText('ABYSS LINE',W/2,H/2-34);
      cx.fillStyle='#fff';cx.font='10px "Courier New",monospace';cx.fillText('PROJECT 87 / PANORAMA CONVERSION  V12',W/2,H/2-6);cx.fillText('DRAG OR CURSOR KEYS / AUTO FIRE',W/2,H/2+16);
      cx.fillStyle='#0ff';if((time>>4)%2===0)cx.fillText('TOUCH TO START',W/2,H/2+40);}
    else{cx.fillStyle='#f00';cx.font='bold 28px "Courier New",monospace';cx.fillText('GAME OVER',W/2,H/2-24);
      cx.fillStyle='#fff';cx.font='10px "Courier New",monospace';cx.fillText('SCORE '+pad(score)+'   ZONE '+stage,W/2,H/2+8);
      if(deadT>30&&(time>>4)%2===0)cx.fillText('TOUCH TO RETRY',W/2,H/2+34);}
  }
  cx.restore();
}
function pad(n){var s=''+n;while(s.length<7)s='0'+s;return s;}
function repeat(c,n){var s='',i;for(i=0;i<n;i++)s+=c;return s;}

// ---------- loop (PROJECT 87: 30fps draw, 60Hz logic) ----------
var LOGIC_PER_FRAME=2;
var last=0,acc=0;
function loop(ts){
  if(document.hidden){last=0;acc=0;requestAnimationFrame(loop);return;}
  if(!last)last=ts;var dt=ts-last;last=ts;if(dt>100)dt=100;acc+=dt;
  while(acc>=33.333){var n;for(n=0;n<LOGIC_PER_FRAME;n++)update();acc-=33.333;}
  draw();requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
})();

