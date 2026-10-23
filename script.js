
// ABYSS LINE / Project 87 combined v4 — combined_v3_proto ＋ BGM v4（全5曲）
// BGM v4：YM2203×2（FM6+SSG6）+ MSM5205（リズム1ch）相当、各チャンネル同時1音。作曲：Claude。
//   stage(TRENCH)=HADAL ZONE / thermal=BLACK SMOKER / boss=IRON LEVIATHAN / bossCore=ABYSSAL HEART / opening=LAUNCH
//   鳴るのは SONGS の5曲と scheduleSong() だけ。旧STAGE曲・旧エンジンは削除済み（v3_proto 参照）。
(function(){
'use strict';
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
  // 出力段ローパス8500Hz：実機のアナログ出力段の代わり。金属感の上の帯域は残す
  outFilter=AC.createBiquadFilter();outFilter.type='lowpass';outFilter.frequency.value=8500;outFilter.Q.value=0.7;
  master.connect(comp);comp.connect(outFilter);outFilter.connect(destination||AC.destination);
  var n=AC.sampleRate*0.6,b=AC.createBuffer(1,n,AC.sampleRate),d=b.getChannelData(0),i;
  for(i=0;i<n;i++)d[i]=Math.random()*2-1;
  noiseBuf=b;
}
function hz(note){return 13.75*Math.pow(2,(note-9)/12);}

// ============================================================
//  FM音色：オペレータ自己フィードバック（実機OPNのFBレジスタ相当）
//  実機と同じ式 y[n]=sin(φ+β·(y[n-1]+y[n-2])/2) を1周期ぶん計算して
//  PeriodicWave化し、モジュレータの波形そのものにする。β↑でサイン→ノコギリ寄りになり、
//  キャリアに乗る倍音が増える＝金属的なエッジ。β≦2の範囲は周期が安定することを確認済み。
// ============================================================
var FB_CACHE={};
function fbWave(beta){
  var key=beta.toFixed(2);if(FB_CACHE[key])return FB_CACHE[key];
  var N=256,H=48,buf=new Float32Array(N),o1=0,o2=0,c,n,h,k,y;
  for(c=0;c<12;c++)for(n=0;n<N;n++){y=Math.sin(2*Math.PI*n/N+beta*(o1+o2)/2);o2=o1;o1=y;buf[n]=y;}
  var re=new Float32Array(H+1),im=new Float32Array(H+1);
  for(h=1;h<=H;h++){var a=0,b=0;for(k=0;k<N;k++){a+=buf[k]*Math.cos(2*Math.PI*h*k/N);b+=buf[k]*Math.sin(2*Math.PI*h*k/N);}re[h]=2*a/N;im[h]=2*b/N;}
  var w;try{w=AC.createPeriodicWave(re,im,{disableNormalization:true});}catch(e){w=AC.createPeriodicWave(re,im);}
  FB_CACHE[key]=w;return w;
}
var FM_PATCH={
  // Lead（IRON LEVIATHAN）：金属的なベル系。FB1.5でモジュレータがほぼノコギリ波
  lead:  {ratio:3.5, idx0:1.3,  idx1:0.45, att:0.004, dec:0.16, vol:0.22, fb:1.5},
  // Counter：アルペジオ用。FB0.6でリードとぶつからない程度の「ざらつき」
  counter:{ratio:2.0, idx0:1.2, idx1:0.22, att:0.004, dec:0.20, vol:0.13, fb:0.6},
  // Bass：減衰を短くしてピッキング感を立てる
  bass:  {ratio:1.0, idx0:3.0,  idx1:0.7,  att:0.003, dec:0.14, vol:0.30, fb:1.0},
  // ---- v4 の曲用 ----
  // 歌うリード：整数比(ratio1)で音程感を出し、FB1.4で金属的な芯。長い音だけ0.18秒遅れてビブラートがかかる
  hlead: {ratio:1.0, idx0:2.4, idx1:1.2, att:0.005, dec:0.10, sus:0.78, rel:0.06, vol:0.20,
          fb:1.4, vib:true, vibRate:5.8, vibDepth:0.012, vibDelay:0.18},
  harm:  {ratio:1.0, idx0:1.6, idx1:0.8, att:0.006, dec:0.10, sus:0.70, rel:0.06, vol:0.11,
          fb:1.0, vib:true, vibRate:5.8, vibDepth:0.010, vibDelay:0.2},
  brass: {ratio:1.0, idx0:3.2, idx1:1.0, att:0.012, dec:0.10, sus:0.45, rel:0.08, vol:0.13, fb:1.2},
  // ディストーション・ギター風：FB最大近く＋高い変調度、減衰を極端に短くしてブリッジミュートの刻みに
  gtr:   {ratio:1.0, idx0:4.0, idx1:1.6, att:0.002, dec:0.05, vol:0.10, fb:1.9},
  // THERMAL/CORE 用リード：モジュレータ2倍で鼻にかかった明るい音、FBも強め。HADALより「熱い」
  tlead: {ratio:2.0, idx0:2.0, idx1:1.0, att:0.004, dec:0.10, sus:0.75, rel:0.06, vol:0.19,
          fb:1.6, vib:true, vibRate:6.2, vibDepth:0.012, vibDelay:0.16}
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
  car.type='sine';
  if(p.fb)mod.setPeriodicWave(fbWave(p.fb));else mod.type='sine';
  car.frequency.setValueAtTime(f,t);
  if(detuneCents)car.detune.value=detuneCents;
  mod.frequency.setValueAtTime(f*p.ratio,t);
  mod.connect(mg);mg.connect(car.frequency);car.connect(cg);cg.connect(master);
  var extraNodes=[],voiceSources=[mod,car];
  if(p.vib){
    var lfo=AC.createOscillator(),lfoGain=AC.createGain();
    lfo.frequency.setValueAtTime(p.vibRate,t);
    if(p.vibDelay){ // ディレイド・ビブラート：発音直後は真っ直ぐ、少し後から揺れ始める
      lfoGain.gain.setValueAtTime(0,t);lfoGain.gain.setValueAtTime(0,t+p.vibDelay);
      lfoGain.gain.linearRampToValueAtTime(f*p.vibDepth,t+p.vibDelay+0.2);
    } else lfoGain.gain.setValueAtTime(f*p.vibDepth,t);
    lfo.connect(lfoGain);lfoGain.connect(car.frequency);
    extraNodes.push(lfo,lfoGain);voiceSources.push(lfo);
  }
  var stopAt;
  if(p.sus!==undefined){
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

// ============================================================
//  リズム音源（MSM5205相当・1ch）
//  K=キック S=スネア s=ゴーストスネア H=クローズHH h=ゴーストHH O=オープンHH T=ハイタム t=ロータム
//  1chなので次の打撃が前の音を必ず切る（実機ADPCMと同じ）。タムもサンプル再生の範囲内。
// ============================================================
function noiseHit(t,type,freq,q,vol,len){
  var s=AC.createBufferSource(),f=AC.createBiquadFilter(),g=AC.createGain();
  s.buffer=noiseBuf;f.type=type;f.frequency.value=freq;if(q)f.Q.value=q;
  g.gain.setValueAtTime(vol,t);g.gain.exponentialRampToValueAtTime(0.0006,t+len);
  s.connect(f);f.connect(g);g.connect(master);trackSource(s);s.start(t);s.stop(t+len+0.02);
  return {g:g,s:s};
}
function toneHit(t,wave,f0,f1,vol,len){
  var o=AC.createOscillator(),g=AC.createGain();o.type=wave;
  o.frequency.setValueAtTime(f0,t);o.frequency.exponentialRampToValueAtTime(f1,t+len*0.8);
  g.gain.setValueAtTime(vol,t);g.gain.exponentialRampToValueAtTime(0.0008,t+len);
  o.connect(g);g.connect(master);trackSource(o);o.start(t);o.stop(t+len+0.02);
  return {g:g,o:o};
}
function drum(kind,t){
  if(kind==='-')return;
  keyOffVoice(RHY_VOICE,t);
  var a,b;
  if(kind==='K'){a=toneHit(t,'sine',160,32,0.58,0.14);RHY_VOICE={gains:[a.g],sources:[a.o]};}
  else if(kind==='S'||kind==='s'){
    var v=kind==='S'?1:0.38;
    a=noiseHit(t,'bandpass',1900,0.9,0.42*v,kind==='S'?0.12:0.05);
    b=toneHit(t,'triangle',210,110,0.3*v,0.07);
    RHY_VOICE={gains:[a.g,b.g],sources:[a.s,b.o]};
  }
  else if(kind==='H'){a=noiseHit(t,'highpass',7000,0,0.15,0.035);RHY_VOICE={gains:[a.g],sources:[a.s]};}
  else if(kind==='h'){a=noiseHit(t,'highpass',8000,0,0.07,0.022);RHY_VOICE={gains:[a.g],sources:[a.s]};}
  else if(kind==='O'){a=noiseHit(t,'highpass',6000,0,0.13,0.13);RHY_VOICE={gains:[a.g],sources:[a.s]};}
  else if(kind==='T'){a=toneHit(t,'sine',260,120,0.42,0.12);RHY_VOICE={gains:[a.g],sources:[a.o]};}
  else if(kind==='t'){a=toneHit(t,'sine',170,75,0.46,0.15);RHY_VOICE={gains:[a.g],sources:[a.o]};}
  // C=キック＋クラッシュを1つのサンプルとして鳴らす（ADPCM 1chでも頭の一撃に厚みが出る）
  else if(kind==='C'){a=toneHit(t,'sine',160,32,0.55,0.14);b=noiseHit(t,'highpass',5000,0,0.16,0.55);RHY_VOICE={gains:[a.g,b.g],sources:[a.o,b.s]};}
}

// ============================================================
//  ベースライン：16ステップの記号パターン
//  r=ベース音 o=+1oct 5=+5度 O=+1oct+5度 T=+2oct
//  >=次の小節のベース音を16分早く食って伸ばす（次小節の頭は打たない）
//  p=次の小節のベース音への半音アプローチ（上行なら下から、下行なら上から）
//  p はジェミ子さんの「Bメロの経過音」のアイデアを全セクションに広げたもの
// ============================================================
var BASS_A =['r','-','o','-','r','o','-','r','-','o','r','-','o','r','5','o'];
var BASS_B =['r','r','o','r','r','o','r','r','o','r','r','o','r','o','5','p'];
var PUSH_B =['r','r','o','r','r','o','r','r','o','r','r','o','r','o','>','-'];
var RUN_UP =['r','-','o','-','r','o','-','r','r','5','o','5','o','O','T','O'];
var BASS_W =['r','r','o','r','r','o','r','r','o','r','r','o','r','o','T','o'];
var RUN_W  =['r','r','o','r','r','o','r','r','o','5','o','O','T','O','T','p'];
var BOSS_BASS=['r','r','o','r','r','o','r','r','o','r','r','o','r','o','T','o'];
var BOSS_PUSH=['r','r','o','r','r','o','r','r','o','r','r','o','5','o','>','-'];
var CORE_BASS=['r','-','r','o','r','-','o','r','-','r','o','r','5','o','T','p'];

// ボス／コア用のリズム型
var BOSS_RHY=['K','h','S','h','K','K','S','h','K','h','S','K','h','K','S','O'];
var BOSS_RHY_F=['K','h','S','h','K','K','S','h','K','h','S','s','S','T','t','t'];
var CORE_RHY=['K','h','S','K','K','h','S','h','K','K','S','h','K','S','K','S'];

function bassBase(ch){return ch.b!==undefined?ch.b:ch.r-12;}
function bassNoteOf(tok,ch,nx){
  var b=bassBase(ch),nb=bassBase(nx);
  if(tok==='r')return b;if(tok==='o')return b+12;if(tok==='5')return b+7;
  if(tok==='O')return b+19;if(tok==='T')return b+24;if(tok==='>')return nb;
  if(tok==='p')return nb>=b?nb-1:nb+1;
  return null;
}
function chordTone(ch,i){return i<ch.t.length?ch.t[i]:12;} // 4音和音なら4番目は7th/9th、3音ならオクターブ
var ARP_CYC=[0,1,2,3,2,1];

// ============================================================
//  SONG ENGINE — 全曲共通の編曲エンジン
//  1曲 = 和音列＋リード譜＋小節ごとの役割（roles）＋ベース/ギター/リズムの小節パターン
//  roles の文字：I=イントロ（リードの1oct下ユニゾン＋ブラス刻み）
//                A=歌（8分アルペジオ、ブラスは小節頭の白玉）
//                B=上昇（16分アルペジオ＋SSG高音ペダル）
//                C=サビ（3度下ハモり＋SSGきらめき＋ブラスの裏打ち）
//                K=溜め/WARNING（リード休み、ブラスとギターのキメだけ）
//                R=リフ回帰（ユニゾン、エコー無し）
//  チャンネル割り（YM2203×2 + MSM5205、各ch同時1音。SSG-B1〜3は使わない）
//    FM-A1 リード  FM-A2 ユニゾン/アルペジオ/ハモり  FM-A3 ベース
//    FM-B1 リードの付点8分遅れエコー  FM-B2 ブラス  FM-B3 ギター風の刻み
//    SSG-A1 きらめき  SSG-A2 ベースの矩形波ダブリング  SSG-A3 高音ペダル
// ============================================================
function hc(r,t,b){return {r:r,t:t,b:b};}
var NOTE_PC={C:0,D:2,E:4,F:5,G:7,A:9,B:11};
function parseLead(src){
  var ev=[],bar,toks,i,m,pos,len;
  for(bar=0;bar<src.length;bar++){
    pos=bar*16;toks=src[bar].split(/\s+/);
    for(i=0;i<toks.length;i++){
      m=/^([A-Gr])(#|b)?(\d)?:(\d+)$/.exec(toks[i]);if(!m)continue;
      len=parseInt(m[4],10);
      if(m[1]!=='r')ev.push([pos,12*(parseInt(m[3],10)+1)+NOTE_PC[m[1]]+(m[2]==='#'?1:(m[2]==='b'?-1:0)),len]);
      pos+=len;
    }
  }
  return ev;
}
function bars(list){var out=[],i,k;for(i=0;i<list.length;i+=2)for(k=0;k<list[i];k++)out.push(list[i+1]);return out;}
function makeSong(o){
  o.len=o.chords.length*16;o.lead=parseLead(o.leadSrc);o.leadAt={};o.echoAt={};
  var i,e;for(i=0;i<o.lead.length;i++){e=o.lead[i];o.leadAt[e[0]]=e;o.echoAt[(e[0]+3)%o.len]=e;}
  return o;
}
// サビのハモり：リードの3〜9半音下にある、いちばん高い和音構成音（常に協和する）
function harmonyBelow(note,ch){
  var h,k,pc;
  for(h=note-3;h>=note-9;h--){pc=((h%12)+12)%12;for(k=0;k<ch.t.length;k++)if((ch.r+ch.t[k])%12===pc)return h;}
  return null;
}

// ---- 共通パターン（16分×16）----
var HB_MG  =['o','r','r','o','r','r','o','r','r','o','r','r','o','r','o','r']; // 3-3-3-3-2-2
var HB_MGP =['o','r','r','o','r','r','o','r','r','o','r','r','o','r','>','-'];
var HB_HALF=['r','-','-','-','-','-','r','-','-','-','r','-','-','-','-','-'];
var HB_END =['o','r','r','o','r','r','o','r','r','o','r','r','O','-','-','-'];
var HG_I=['X','x','x','X','x','x','X','x','x','X','x','x','X','x','X','x'];
var HG_A=['X','-','x','-','x','-','X','-','x','-','x','-','X','-','x','x'];
var HG_B=['X','x','x','x','X','x','x','x','X','x','x','x','X','x','x','x'];
var HG_H=['X','-','-','-','-','-','X','-','-','-','X','-','-','-','-','-'];
var HG_END=['X','x','x','X','x','x','X','x','x','X','x','x','X','-','-','-'];
var HR_I  =['K','h','H','K','S','h','K','h','K','h','H','K','S','h','S','s'];
var HR_IF =['K','h','S','h','K','h','S','s','S','S','T','T','t','t','S','S'];
var HR_A  =['K','h','H','h','S','h','H','K','h','h','K','h','S','h','s','O'];
var HR_AF =['K','h','H','h','S','h','H','K','h','h','K','h','S','T','S','t'];
var HR_B  =['K','h','K','h','S','h','H','K','h','K','H','h','S','h','K','s'];
var HR_BF =['K','h','K','h','S','h','H','K','h','K','S','s','S','T','T','t'];
var HR_ROLL=['S','s','S','s','S','s','S','s','S','S','S','S','S','S','S','S'];
var HR_C  =['K','h','H','K','S','h','K','h','K','h','K','K','S','h','O','h'];
var HR_CF =['K','h','H','K','S','h','K','h','S','s','S','S','T','T','t','t'];
var HR_HALF=['K','-','-','-','-','-','K','-','S','-','-','-','-','-','K','-'];
var HR_TOM=['T','T','T','T','t','t','t','t','S','S','S','S','S','S','S','S'];
var TR_I  =['K','h','S','h','K','K','h','H','K','h','S','K','h','K','S','O'];
var TR_C  =['K','h','S','K','K','h','S','h','K','K','S','h','K','h','S','O'];
var OR_1  =['K','h','S','h','K','h','S','h','K','h','S','h','K','S','S','S'];
var OR_END=['K','h','S','h','K','h','S','h','S','S','S','S','C','-','-','-'];

// ============================================================
//  1. HADAL ZONE — TRENCH（奇数ゾーン）  C minor / BPM152 / 32小節・50.5秒
//     INTRO4 → A8 → B8 → サビ8 → WARNING4（溜め2＋リフ回帰2）
// ============================================================
var H_Cm=hc(60,[0,3,7,10],48),H_Ab=hc(68,[0,4,7,14],44),H_Abm7=hc(68,[0,4,7,11],44),H_Bb=hc(70,[0,4,7,14],46),
    H_Fm=hc(65,[0,3,7,10],41),H_G=hc(67,[0,4,7,10],43),H_Gb9=hc(67,[0,4,7,13],43),
    H_Gm=hc(67,[0,3,7,10],43),H_Eb=hc(63,[0,4,7,14],51);
var SONG_HADAL=makeSong({
  name:'HADAL ZONE',bpm:152,leadPatch:'hlead',echo:true,
  roles:'IIIIAAAAAAAABBBBBBBBCCCCCCCCKKRR',
  chords:[H_Cm,H_Cm,H_Ab,H_Bb, H_Cm,H_Ab,H_Fm,H_G, H_Cm,H_Ab,H_Bb,H_Gb9,
          H_Fm,H_Gm,H_Abm7,H_Bb, H_Fm,H_Gm,H_Ab,H_G, H_Ab,H_Bb,H_Gm,H_Cm, H_Fm,H_Bb,H_Eb,H_G,
          H_Ab,H_Bb,H_Cm,H_G],
  leadSrc:[
    'G4:2 C5:2 Eb5:2 G5:4 F5:2 Eb5:2 D5:2','Eb5:2 C5:2 G4:4 Bb4:2 C5:6',
    'Ab4:2 C5:2 Eb5:2 Ab5:4 G5:2 F5:2 Eb5:2','Bb4:2 D5:2 F5:2 Bb5:2 Ab5:2 G5:2 F5:2 D5:2',
    'G5:6 F5:2 Eb5:4 D5:2 Eb5:2','C5:6 Eb5:2 Ab5:6 G5:2','F5:8 Eb5:2 F5:2 G5:2 Ab5:2','G5:8 F5:2 D5:2 B4:2 D5:2',
    'G5:6 F5:2 Eb5:4 D5:2 Eb5:2','C5:6 Eb5:2 Ab5:4 C6:4','Bb5:6 Ab5:2 G5:4 F5:2 D5:2','D5:4 F5:4 Ab5:4 G5:2 F5:2',
    'C5:3 Ab4:3 C5:2 Eb5:3 C5:3 F5:2','D5:3 Bb4:3 D5:2 F5:3 D5:3 G5:2','Eb5:3 C5:3 Eb5:2 G5:3 Eb5:3 Ab5:2','F5:3 D5:3 F5:2 Bb5:4 Ab5:2 G5:2',
    'Ab5:3 F5:3 Ab5:2 C6:3 Ab5:3 F5:2','Bb5:3 G5:3 Bb5:2 D6:3 Bb5:3 G5:2','C6:4 Bb5:4 Ab5:4 G5:4','G5:8 B4:1 C5:1 D5:1 Eb5:1 F5:1 G5:1 Ab5:1 B5:1',
    'C6:6 Bb5:2 C6:4 Eb6:4','D6:8 C6:2 Bb5:2 F5:4','G5:6 Bb5:2 D6:4 C6:2 Bb5:2','C6:12 Bb5:2 C6:2',
    'Ab5:6 G5:2 Ab5:4 C6:4','Bb5:6 Ab5:2 Bb5:4 D6:4','Eb6:8 D6:2 C6:2 Bb5:2 G5:2','B5:12 r:4',
    'r:16','r:16','G4:2 C5:2 Eb5:2 G5:2 Bb5:2 G5:2 Eb5:2 C5:2','B4:2 D5:2 F5:2 Ab5:2 G5:8'],
  bass:bars([3,HB_MG,1,HB_MGP, 7,BASS_A,1,RUN_UP, 3,BASS_B,1,PUSH_B,3,BASS_B,1,RUN_UP,
             1,HB_MG,1,HB_MGP,1,HB_MG,1,HB_MGP,1,HB_MG,1,HB_MGP,1,HB_MG,1,RUN_UP, 2,HB_HALF,1,HB_MG,1,RUN_W]),
  gtr:bars([4,HG_I, 8,HG_A, 8,HG_B, 8,HG_I, 2,HG_H,1,HG_I,1,HG_B]),
  rhy:bars([3,HR_I,1,HR_IF, 7,HR_A,1,HR_AF, 3,HR_B,1,HR_BF,3,HR_B,1,HR_ROLL, 7,HR_C,1,HR_CF, 2,HR_HALF,1,HR_I,1,HR_TOM]),
  crash:{0:1,4:1,12:1,20:1,22:1,24:1,26:1,30:1}
});

// ============================================================
//  2. BLACK SMOKER — THERMAL（偶数ゾーン）  E minor（フリギアのF♮＋和声的短音階のD♯）/ BPM152 / 32小節
//     HADALと同じ長さ・同じ構成にして、ボス出現の同期をゾーンに関係なく揃える。
//     熱水噴出孔の「熱さ」は、主音Eのすぐ上のF（半音）と、16分音符で回り込むリフで出す。
// ============================================================
var T_Em=hc(64,[0,3,7],52),T_F=hc(65,[0,4,7,14],53),T_FE=hc(65,[0,4,7,11],52),T_G=hc(67,[0,4,7,14],43),
    T_Am=hc(69,[0,3,7,10],45),T_B7=hc(71,[0,4,7,10],47),T_C=hc(72,[0,4,7,14],48),
    T_D=hc(74,[0,4,7,14],50),T_Bm=hc(71,[0,3,7,10],47);
var SONG_THERMAL=makeSong({
  name:'BLACK SMOKER',bpm:152,leadPatch:'tlead',echo:true,
  roles:'IIIIAAAAAAAABBBBBBBBCCCCCCCCKKRR',
  chords:[T_Em,T_F,T_G,T_F, T_Em,T_F,T_Em,T_F,T_Am,T_G,T_F,T_B7,
          T_C,T_D,T_Em,T_Em,T_C,T_D,T_B7,T_B7, T_C,T_D,T_Bm,T_Em,T_Am,T_D,T_G,T_B7,
          T_Em,T_FE,T_Em,T_B7],
  leadSrc:[
    // INTRO：主音Eの周りを半音で回り込む16分のリフ
    'E5:1 F5:1 E5:1 D#5:1 E5:2 B4:2 G4:1 A4:1 B4:2 E5:2 G5:2','F5:2 E5:1 F5:1 A5:2 C6:2 B5:1 A5:1 G5:2 F5:2 E5:2',
    'G5:2 F#5:1 G5:1 B5:2 D6:2 C6:1 B5:1 A5:2 G5:2 F#5:2','A5:4 G5:2 F5:2 E5:2 F5:2 D#5:2 B4:2',
    // A：Em→F（半音上）の揺れの上で歌う
    'B5:6 A5:2 G5:4 F#5:2 G5:2','A5:8 G5:2 F5:2 E5:2 F5:2','G5:6 F#5:2 E5:4 B4:4','C5:6 B4:2 A4:4 C5:2 E5:2',
    'E5:6 D5:2 C5:4 E5:2 A5:2','B5:6 A5:2 G5:4 D5:4','C6:6 B5:2 A5:4 F5:4','D#5:4 F#5:4 A5:4 B5:4',
    // B：付点8分で C→D→Em と押し上げる
    'E5:3 G5:3 C6:2 B5:3 G5:3 E5:2','F#5:3 A5:3 D6:2 E6:3 D6:3 A5:2','G5:3 B5:3 E6:2 D6:3 B5:3 G5:2','E6:4 D6:2 B5:2 G5:2 A5:2 B5:4',
    'E5:3 G5:3 C6:2 B5:3 G5:3 E5:2','F#5:3 A5:3 D6:2 E6:3 D6:3 A5:2','D#6:4 B5:4 A5:4 F#5:4','B5:6 F#5:2 G5:1 A5:1 B5:1 C6:1 D6:1 D#6:1 r:2',
    // サビ：D#からEへ飛び込む。頂点はbar27のG6
    'E6:6 D6:2 C6:4 B5:2 C6:2','D6:8 A5:4 F#5:4','B5:6 A5:2 B5:4 D6:4','E6:12 D6:2 B5:2',
    'C6:6 B5:2 A5:4 E6:4','D6:6 C6:2 A5:4 F#5:4','B5:4 D6:4 G6:8','F#6:4 D#6:4 B5:4 A5:4',
    // WARNING：E音ペダル上で Em→F/E の軋み、リフ回帰でボスへ
    'r:16','r:16','E5:1 F5:1 E5:1 D#5:1 E5:2 B4:2 G4:1 A4:1 B4:2 E5:2 G5:2','F#5:2 A5:2 B5:2 D#6:2 B5:8'],
  bass:bars([4,BASS_W, 7,BASS_A,1,RUN_UP, 8,HB_MG,
             1,BASS_B,1,PUSH_B,1,BASS_B,1,PUSH_B,1,BASS_B,1,PUSH_B,1,BASS_B,1,RUN_UP, 2,HB_HALF,1,BASS_W,1,RUN_W]),
  gtr:bars([4,HG_B, 8,HG_A, 8,HG_I, 8,HG_B, 2,HG_H,1,HG_I,1,HG_B]),
  rhy:bars([3,TR_I,1,HR_IF, 7,HR_B,1,HR_BF, 7,HR_I,1,HR_ROLL, 7,TR_C,1,HR_CF, 2,HR_HALF,1,TR_I,1,HR_TOM]),
  crash:{0:1,4:1,12:1,20:1,22:1,24:1,26:1,30:1}
});

// ============================================================
//  3. IRON LEVIATHAN — BOSS（ARMOR）  F minor / BPM166 / 16小節・約23秒
//     前半8小節：同じ音を叩きつける機械的なスタッカート。ナポリの和音(Gb)で一瞬よろめかせる。
//     後半8小節：Bbm→C→Db→Eb と1段ずつ上がり、最後は C7(♭9) の半音上行で頭へ戻る。
//     リードは金属的なベル系（lead）。「装甲」の硬さ。
// ============================================================
var B_Fm=hc(65,[0,3,7,10],41),B_Db=hc(61,[0,4,7,14],49),B_C7=hc(60,[0,4,7,10],48),B_Gb=hc(66,[0,4,7,14],42),
    B_Bbm=hc(70,[0,3,7,10],46),B_Eb7=hc(63,[0,4,7,10],51),B_C7b9=hc(60,[0,4,7,13],48);
var SONG_BOSS=makeSong({
  name:'IRON LEVIATHAN',bpm:166,leadPatch:'lead',echo:true,
  roles:'BBBBBBBBCCCCCCCC',
  chords:[B_Fm,B_Fm,B_Db,B_C7,B_Fm,B_Fm,B_Gb,B_C7, B_Bbm,B_C7,B_Db,B_Eb7,B_Bbm,B_C7,B_Db,B_C7b9],
  leadSrc:[
    'F5:2 r:2 F5:1 F5:1 Ab5:2 G5:2 F5:2 C5:2 Eb5:2','F5:2 r:2 F5:1 F5:1 Ab5:2 Bb5:2 C6:2 Bb5:2 Ab5:2',
    'Ab5:6 F5:2 Db5:4 F5:4','E5:6 G5:2 C6:4 Bb5:4',
    'F5:2 r:2 F5:1 F5:1 Ab5:2 G5:2 F5:2 C5:2 Eb5:2','F5:2 r:2 F5:1 F5:1 Ab5:2 Bb5:2 C6:2 Bb5:2 Ab5:2',
    'Gb5:6 Bb5:2 Db6:4 C6:2 Bb5:2','C6:4 Bb5:4 G5:4 E5:4',
    'Db6:6 C6:2 Bb5:4 F5:4','E5:6 F5:2 G5:4 C6:4','F5:6 Ab5:2 Db6:4 C6:2 Db6:2','Eb6:8 Db6:4 Bb5:4',
    'Bb5:3 Db6:3 F6:2 Eb6:3 Db6:3 Bb5:2','C6:3 E6:3 G6:2 F6:3 E6:3 C6:2','F6:8 Eb6:4 Db6:4','C6:4 Db6:4 E6:4 G6:4'],
  bass:bars([3,BOSS_BASS,1,BOSS_PUSH, 3,BOSS_BASS,1,BOSS_PUSH, 3,BOSS_BASS,1,BOSS_PUSH, 3,BOSS_BASS,1,RUN_W]),
  gtr:bars([16,HG_B]),
  rhy:bars([7,BOSS_RHY,1,BOSS_RHY_F, 7,BOSS_RHY,1,BOSS_RHY_F]),
  crash:{0:1,8:1}
});

// ============================================================
//  4. ABYSSAL HEART — CORE（最終形態）  F# minor / BPM174 / 8小節・約11秒
//     BOSSのF短調から半音上へ。テンポも上げ、16分の駆け上がりで追い込む。
// ============================================================
var C_Fm=hc(66,[0,3,7,10],42),C_D=hc(62,[0,4,7,14],50),C_E7=hc(64,[0,4,7,10],52),C_Bm=hc(71,[0,3,7,10],47),
    C_C7=hc(61,[0,4,7,10],49),C_C7b9=hc(61,[0,4,7,13],49);
var SONG_CORE=makeSong({
  name:'ABYSSAL HEART',bpm:174,leadPatch:'tlead',echo:true,
  roles:'BBBBCCCC',
  chords:[C_Fm,C_Fm,C_D,C_E7,C_Bm,C_C7,C_D,C_C7b9],
  leadSrc:[
    'F#5:1 G#5:1 A5:1 C#6:1 F#6:4 E6:2 C#6:2 A5:2 C#6:2','F#6:2 E6:2 C#6:2 A5:2 G#5:2 A5:2 C#6:4',
    'D5:1 E5:1 F#5:1 A5:1 D6:4 C#6:2 A5:2 F#5:2 A5:2','E6:6 D6:2 B5:4 G#5:4',
    'B5:1 C#6:1 D6:1 F#6:1 B5:4 D6:2 F#6:2 E6:2 D6:2','C#6:2 B5:2 G#5:2 F5:2 G#5:2 B5:2 C#6:4',
    'F#6:6 E6:2 D6:4 A5:4','G#5:2 B5:2 D6:2 F6:2 E6:2 D6:2 C#6:4'],
  bass:bars([7,CORE_BASS,1,RUN_W]),
  gtr:bars([8,HG_B]),
  rhy:bars([7,CORE_RHY,1,HR_CF]),
  crash:{0:1,4:1}
});

// ============================================================
//  5. LAUNCH — OPENING（発進）  BPM168 / 4小節・約5.71秒
//     前半2小節：半分の速さのキメ（ブラスとギターの一撃）の上で、リードが4分音符でゆっくり上がる「溜め」。
//     後半2小節：全パートが入ってファンファーレ。Ab→G で止めて、TRENCH の HADAL ZONE（C短調）へ解決させる。
//     ゲーム側の発進演出 introT もこの長さ（343フレーム≒5.72秒）に合わせてある。
// ============================================================
var LR_BUILD=['K','-','-','-','-','-','K','-','S','-','-','-','S','s','S','S'];
var SONG_OPENING=makeSong({
  name:'LAUNCH',bpm:168,leadPatch:'hlead',echo:false,
  roles:'KKII',
  chords:[H_Cm,H_Bb,H_Ab,H_G],
  leadSrc:['G4:4 C5:4 Eb5:4 G5:4','F5:6 G5:2 Ab5:4 Bb5:4',
           'C5:2 C5:1 C5:1 Eb5:2 G5:2 Ab5:4 G5:2 F5:2','G5:2 Ab5:1 Bb5:1 B5:4 D6:8'],
  bass:[HB_HALF,HB_HALF,HB_MG,HB_END],
  gtr:[HG_H,HG_H,HG_I,HG_END],
  rhy:[HR_HALF,LR_BUILD,OR_1,OR_END],
  crash:{0:1,2:1}
});

var SONGS={stage:SONG_HADAL,thermal:SONG_THERMAL,boss:SONG_BOSS,bossCore:SONG_CORE,opening:SONG_OPENING};

function scheduleSong(S,stepIdx,t){
  var L=S.len,pos=((stepIdx%L)+L)%L,bar=pos>>4,w=pos&15,nb=S.chords.length;
  var ch=S.chords[bar],nx=S.chords[(bar+1)%nb],prev=(bar+nb-1)%nb,role=S.roles.charAt(bar);
  var e=S.leadAt[pos],len,gate;

  // FM-A1 リード
  if(!mute.fm&&e){len=e[2]*stepDur;gate=e[2]>=4?0.95:(e[2]>=2?0.82:0.7);
    playFM('A1',S.leadPatch,e[1],t,len*gate,0,w===0?1.1:1);}
  // FM-A2 ユニゾン／アルペジオ／ハモり
  if(!mute.fm){
    if(role==='I'||role==='R'){if(e)playFM('A2','harm',e[1]-12,t,e[2]*stepDur*0.8);}
    else if(role==='C'){if(e&&e[2]>=2){var hn=harmonyBelow(e[1],ch);if(hn!==null)playFM('A2','harm',hn,t,e[2]*stepDur*0.9);}}
    else if((role==='A'&&(w&1)===0)||role==='B'){var ai=ARP_CYC[(role==='B'?w:(w>>1))%ARP_CYC.length];playFM('A2','counter',ch.r+chordTone(ch,ai),t,stepDur*(role==='B'?0.8:1.4));}
  }
  // FM-A3 ベース（＋SSG-A2で矩形波ダブリング）
  var bt=S.bass[bar][w];
  if(w===0&&S.bass[prev][14]==='>')bt='-';
  if(bt!=='-'){var bn=bassNoteOf(bt,ch,nx),bd=bt==='>'?stepDur*2.6:(bt==='O'&&S.bass[bar][w+1]==='-'?stepDur*3:stepDur*0.78);
    if(!mute.fm)playFM('A3','bass',bn,t,bd);
    if(!mute.ssg)playSSG('A2',bn,t,Math.min(bd,stepDur*0.6),0.042,0);}

  // FM-B1 付点8分遅れのエコー
  var ee=S.echoAt[pos];
  if(!mute.fmB&&S.echo&&ee&&role!=='K'&&role!=='R')playFM('B1',S.leadPatch,ee[1],t,Math.min(ee[2],6)*stepDur*0.8,8,0.38);
  // FM-B2 ブラス
  if(!mute.fmB){
    var hit=false,bl=stepDur*1.2;
    if((role==='I'||role==='K')&&(w===0||w===6||w===10||(role==='I'&&w===12)))hit=true;
    else if(role==='C'&&(w===0||w===10))hit=true;
    else if(role==='A'&&w===0){hit=true;bl=stepDur*10;}
    if(hit)playFM('B2','brass',ch.r+ch.t[1],t,bl);
  }
  // FM-B3 ギター風の刻み（x=ルート、X=5度上のパワーコード頭）
  var gt=S.gtr[bar][w];
  if(!mute.fmB&&gt!=='-'){var gb=bassBase(ch);playFM('B3','gtr',gt==='X'?gb+19:gb+12,t,gt==='X'?stepDur*0.9:stepDur*0.45);}

  // SSG-A1 サビのきらめき／SSG-A3 上昇部の高音ペダル
  if(!mute.ssg&&role==='C'&&(w&1)===1){var si=ARP_CYC[(w>>1)%ARP_CYC.length];playSSG('A1',ch.r+24+chordTone(ch,si),t,stepDur*0.4,0.026,+4);}
  if(!mute.ssg&&role==='B'&&(w&3)===2)playSSG('A3',ch.r+24+7,t,stepDur*0.6,0.03,-4);

  // RHYTHM（クラッシュ小節は頭をC、直後2つを空けて余韻を残す）
  if(!mute.rhy){
    var dk=S.rhy[bar][w];
    if(S.crash[bar]){if(w===0)dk='C';else if(w<3)dk='-';}
    drum(dk,t);
  }
}

var step=0,nextTime=0,stepDur=0;
function setTempo(){stepDur=60/SONGS[mode].bpm/4;} // 16分音符1つの長さ
function schedule(stepIdx,t){scheduleSong(SONGS[mode],stepIdx,t);}
function tick(){if(!running||AC.state!=='running')return;if(nextTime<AC.currentTime-0.2)nextTime=AC.currentTime+0.02;while(nextTime<AC.currentTime+0.18){schedule(step,nextTime);step++;nextTime+=stepDur;}}

var BGM_OPN={
  version:'v4',
  init:function(context,destination){initAudio(context,destination);},
  start:function(){
    initAudio();if(!AC)return;if(AC.state==='suspended')AC.resume();
    if(running)return;running=true;setTempo();step=0;nextTime=AC.currentTime+0.05;
    timer=setInterval(tick,25);
  },
  stop:function(){running=false;clearInterval(timer);if(AC)allNotesOff(AC.currentTime);},
  setMode:function(m){
    if(!SONGS.hasOwnProperty(m))return;
    mode=m;step=0;setTempo();if(AC){allNotesOff(AC.currentTime);nextTime=AC.currentTime+0.05;}
  },
  setMute:function(group,on){mute[group]=!!on;},
  setVolume:function(v){if(master)master.gain.setValueAtTime(Math.max(0,Math.min(1,v)),AC.currentTime);},
  getMode:function(){return mode;},
  songInfo:function(m){var S=SONGS[m];return S?{name:S.name,bpm:S.bpm,bars:S.chords.length,roles:S.roles,seconds:S.len*60/S.bpm/4}:null;}
};
window.BGM_OPN=BGM_OPN;
})();

// ABYSS LINE / Project 87 combined v4 — game
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
  ox=(vw-W*scale)/2;oy=(vh-H*scale)/2;
  // セーフエリア（ノッチ・角丸・ホームバー）は、ゲーム画面に実際にかぶっている分だけを避ける。
  // 以前は画面がレターボックスで中央にあってもインセットを丸ごと引いていたため、縦持ちなどで
  // 上下の移動範囲が大きく削られていた（約100ドット）。
  safeL=Math.max(0,safePx('paddingLeft')-ox)/scale;safeR=Math.max(0,safePx('paddingRight')-(vw-ox-W*scale))/scale;
  safeT=Math.max(0,safePx('paddingTop')-oy)/scale;safeB=Math.max(0,safePx('paddingBottom')-(vh-oy-H*scale))/scale;
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
// パレットは2つだけ：TRENCH=青、THERMAL=赤。HUDの「TRN/THM」と色が必ず一致する
function pal(){
  return zoneEven()?{deep:'#f00',mid:'#f0f',hi:'#ff0',land:'#f00'}:{deep:'#00f',mid:'#0ff',hi:'#0ff',land:'#00f'};
}
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
var state='title',score=0,hiscore=0,lives=3,power=0,shield=0,stage=1,time=0,scroll=0,powerUpCalloutsLeft=3;
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
  score=0;lives=3;power=0;shield=0;stage=1;time=0;scroll=0;powerUpCalloutsLeft=3;
  resetField();state='play';introT=343;musicMode=null;bgmTick(); // LAUNCH 4小節(BPM168)=5.71秒＝343tick。曲と一体なので動かさない
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
  // TRENCH "avoid" beat: let the lanes clear (silence), then ground+ceil turret spawn on the
  // SAME tick so their 3-way volleys land together — a top/bottom pincer, not more bullets.
  Q(800,function(){spawnEnemy('turret',W+30,H-22,{path:'ground'});spawnEnemy('turret',W+30,22,{path:'ceil'});});
  for(i=0;i<4;i++)(function(i){Q(960+i*40,function(){spawnEnemy('ray',W+30,rnd(34,H-34),{path:'dash',sp:2*d});});})(i);
  var wallGap=(Math.floor((stage-1)/2)%2)?4:1;
  for(i=0;i<7;i++)(function(i){if(i!==wallGap&&i!==wallGap+1)Q(1100+i*3,function(){spawnEnemy('mine',W+30,25+i*25,{path:'drift',sp:1.6*d,wall:true});});})(i);
  for(i=0;i<8;i++)(function(i){Q(1400+i*12,function(){spawnEnemy('drone',W+30,H/2,{path:'vee',ph:i,sp:3.6*d});});})(i);
  Q(1650,function(){spawnEnemy('crab',W+40,H/2,{path:'crab',sp:1.2*d});});
  Q(1800,function(){spawnEnemy('turret',W+30,H-22,{path:'ground'});});
  Q(1850,function(){spawnEnemy('turret',W+30,22,{path:'ceil'});});
  for(i=0;i<10;i++)(function(i){Q(1900+i*10,function(){var yy=i%2?150:50;spawnEnemy('drone',W+30,yy,{path:'sine',ph:i,sp:4*d,by:yy,amp:24});});})(i);
  for(i=0;i<4;i++)(function(i){Q(2250+i*30,function(){spawnEnemy('ray',W+30,rnd(34,H-34),{path:'dash',sp:2.4*d});});})(i);
  // ゾーン曲32小節(BPM152)=50.53秒。2653=44.22秒＝最後の4小節(KKRR)の頭、3032=ループの拍。動かさない
  Q(2653,function(){say('WARNING');SFX.warn();});
  Q(3032,function(){spawnBoss();});
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
  // THERMAL "avoid" beat: 3 of the 6 crossing pairs keep their original early ticks (tell),
  // then a silence, then the other 3 converge on ONE tick — top+bottom, diagonal, all firing
  // together — instead of trickling in one at a time. Same 6 pairs as before, just regrouped,
  // and timed to resolve before the pincer turrets below so the two beats don't stack.
  for(i=0;i<3;i++)(function(i){
    Q(340+i*22,function(){
      spawnEnemy('drone',W+24,18,{path:'cross',sp:2.8*d,by:18,dir:1,amp:150});
      spawnEnemy('drone',W+24,H-18,{path:'cross',sp:2.8*d,by:H-18,dir:-1,amp:150});
    });
  })(i);
  Q(500,function(){
    var xo;
    for(xo=0;xo<3;xo++){
      spawnEnemy('drone',W+24+xo*16,18,{path:'cross',sp:2.8*d,by:18,dir:1,amp:150});
      spawnEnemy('drone',W+24+xo*16,H-18,{path:'cross',sp:2.8*d,by:H-18,dir:-1,amp:150});
    }
  });
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
  // ゾーン曲32小節(BPM152)=50.53秒。2653=44.22秒＝最後の4小節(KKRR)の頭、3032=ループの拍。動かさない
  Q(2653,function(){say('WARNING');SFX.warn();});
  Q(3032,function(){spawnBoss();});
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
  boss={x:W+100,y:H/2,t:0,hp:hp,max:hp,r:28,phase:'approach',phaseT:0,cycle:0,roamT:140,telegraph:0,chargeTx:0,chargeTy:0,flankNewY:H/2,arms:[],flash:0,dead:false,dying:0};
  var i;for(i=0;i<4;i++)boss.arms.push({a:i*1.5708,hp:30+stage*8,r:7,dead:false,len:0,lunge:0});
  bgmTick();
}
// BOSS PHASE VARIETY PROTOTYPE: shared arm-position writer, reused by every angle-based phase
// below so A.px/A.py/A.x/A.y/A.isBossArm (read elsewhere for boomerang targeting + bullet
// collision) stay correct. split/merge below set A.px/A.py directly instead (see comments).
function armPos(b,A){A.px=b.x+Math.cos(A.a)*A.len;A.py=b.y+Math.sin(A.a)*A.len;A.x=A.px;A.y=A.py;A.isBossArm=true;}
function bossUpdate(b){
  b.t++;
  if(b.dying){b.dying++;if(b.dying%6===0){burst(b.x+rnd(-70,70),b.y+rnd(-70,70),14,'#ff0',5,40);SFX.boom();shake=8;}
    if(b.dying>150){SFX.bigboom();flash=20;burst(b.x,b.y,120,'#fff',9,70);score+=5000*stage;b.dead=true;stageClear();}return;}
  var alive=0,i;for(i=0;i<4;i++)if(!b.arms[i].dead)alive++;
  // once every arm is down, force a one-time transition into the dedicated 'core' finale phase
  // (reuses the old alive===0 firing pattern below, just makes the moment read as a phase change)
  if(alive===0&&b.phase!=='core'&&b.phase!=='approach'&&b.phase!=='deploy'){
    b.phase='core';b.phaseT=0;shake=Math.max(shake,10);flash=Math.max(flash,8);burst(b.x,b.y,40,'#f00',6,40);SFX.boom();
  }
  b.phaseT++;
  if(b.phase==='approach'){
    if(b.x>W-105){b.x-=1.2;}else{b.x=W-105;b.phase='deploy';b.phaseT=0;}
    b.y=H/2;
    for(i=0;i<4;i++)armPos(b,b.arms[i]);
    return;
  }
  if(b.phase==='deploy'){
    var dp=Math.min(1,b.phaseT/40);
    for(i=0;i<4;i++){var Ad=b.arms[i];Ad.a+=0.05;Ad.len=36*dp;armPos(b,Ad);}
    if(b.phaseT>=40){for(i=0;i<4;i++)b.arms[i].len=36;SFX.hit();burst(b.x,b.y,20,'#0ff',5,30);b.phase='rotate';b.phaseT=0;b.roamT=rnd(110,170);}
    return;
  }
  if(b.phase==='rotate'){
    b.y=H/2+Math.sin(b.t*0.012)*25;b.x=W-105+Math.cos(b.t*0.02)*14;
    var rot=0.012+(4-alive)*0.006;
    for(i=0;i<4;i++){var A=b.arms[i];A.a+=rot;
      if(A.lunge>0)A.lunge--;
      A.len=36+(A.lunge>0?Math.sin(A.lunge/8*3.14159)*10:0);
      armPos(b,A);
      if(!A.dead&&b.t%55===i*13&&b.x<W-100){eshot(A.px,A.py,aimAt(A.px,A.py),3.5,1);A.lunge=8;A.flash=4;}
    }
    if(b.phaseT>=b.roamT){
      b.cycle=(b.cycle||0)+1;
      // BOSS SPLIT/MERGE PROTOTYPE: 1-in-4 cycles detaches the arms instead of charge/flank
      var pick=b.cycle%4;
      b.phase=pick===0?'flank':(pick===2?'split':'charge');b.phaseT=0;
      if(b.phase==='charge'){b.chargeTx=Math.max(player.x+70,160);b.chargeTy=player.y;b.telegraph=20;}
      else if(b.phase==='flank'){b.flankNewY=player.y<H/2?H-50:50;}
    }
    return;
  }
  if(b.phase==='charge'){
    for(i=0;i<4;i++){var A2=b.arms[i];A2.a+=0.03;armPos(b,A2);}
    if(b.telegraph>0){b.telegraph--;return;}
    if(b.phaseT<36){
      var dx=b.chargeTx-b.x,dy=b.chargeTy-b.y,d=Math.sqrt(dx*dx+dy*dy)||1;
      b.x+=dx/d*Math.min(9,d);b.y+=dy/d*Math.min(9,d);
      if(b.phaseT===18&&b.x<W-60){var a0=aimAt(b.x,b.y),j;for(j=-2;j<=2;j++)eshot(b.x,b.y,a0+j*0.15,5);}
    }else{
      var hx=W-105,hy=H/2,dx2=hx-b.x,dy2=hy-b.y,d2=Math.sqrt(dx2*dx2+dy2*dy2)||1;
      if(d2>4){b.x+=dx2/d2*6;b.y+=dy2/d2*6;}
      else{b.phase='rotate';b.phaseT=0;b.roamT=rnd(110,170);}
    }
    return;
  }
  if(b.phase==='flank'){
    for(i=0;i<4;i++){var A3=b.arms[i];A3.a+=0.02;armPos(b,A3);}
    if(b.phaseT<18){
      b.x+=5;
      if(b.phaseT===17){burst(b.x,b.y,30,'#0ff',5,30);SFX.boom();}
    }else if(b.phaseT===19){
      b.x=W+60;b.y=b.flankNewY;
    }else if(b.phaseT<45){
      b.x-=5.5;
    }else{
      b.x=W-105;b.phase='rotate';b.phaseT=0;b.roamT=rnd(100,150);burst(b.x,b.y,20,'#fff',5,30);SFX.hit();
    }
    return;
  }
  if(b.phase==='split'){
    // BOSS SPLIT/MERGE PROTOTYPE: arms stop orbiting and spread into a loose diamond around
    // the core, each firing independently, then re-converge in the 'merge' phase below. The
    // core itself (b.x/b.y) holds still as the anchor the tether lines are drawn to, so
    // bossDraw()'s existing core<->arm line needs no changes at all.
    if(b.phaseT===1){
      var R=90,offs=[[0,-R],[R,0],[0,R],[-R,0]];
      for(i=0;i<4;i++){var As=b.arms[i];As.splitTx=b.x+offs[i][0];As.splitTy=Math.max(20,Math.min(H-20,b.y+offs[i][1]));As.sx=As.px;As.sy=As.py;}
    }
    var moveT=Math.min(1,b.phaseT/30);
    for(i=0;i<4;i++){
      var As2=b.arms[i];if(As2.dead)continue;
      if(b.phaseT<=30){As2.px=As2.sx+(As2.splitTx-As2.sx)*moveT;As2.py=As2.sy+(As2.splitTy-As2.sy)*moveT;}
      else{
        As2.px=As2.splitTx+Math.sin(b.t*0.05+i)*6;As2.py=As2.splitTy+Math.cos(b.t*0.04+i)*6;
        if(b.t%45===i*11)eshot(As2.px,As2.py,aimAt(As2.px,As2.py),4,1);
      }
      As2.x=As2.px;As2.y=As2.py;As2.isBossArm=true;
    }
    if(b.phaseT>=100){b.phase='merge';b.phaseT=0;for(i=0;i<4;i++){var Am=b.arms[i];Am.mx=Am.px;Am.my=Am.py;}}
    return;
  }
  if(b.phase==='merge'){
    var mt=Math.min(1,b.phaseT/26);
    for(i=0;i<4;i++){
      var Am2=b.arms[i];if(Am2.dead)continue;
      Am2.px=Am2.mx+(b.x-Am2.mx)*mt+Math.cos(Am2.a)*Am2.len*mt;
      Am2.py=Am2.my+(b.y-Am2.my)*mt+Math.sin(Am2.a)*Am2.len*mt;
      Am2.x=Am2.px;Am2.y=Am2.py;Am2.isBossArm=true;
    }
    if(b.phaseT>=26){
      for(i=0;i<4;i++)armPos(b,b.arms[i]);
      SFX.hit();burst(b.x,b.y,24,'#0ff',5,30);shake=Math.max(shake,5);
      b.phase='rotate';b.phaseT=0;b.roamT=rnd(110,170);
    }
    return;
  }
  if(b.phase==='core'){
    b.x+=(W-105-b.x)*0.05;b.y+=(H/2-b.y)*0.05;
    for(i=0;i<4;i++){var A4=b.arms[i];if(!A4.dead)continue;A4.a+=0.01;armPos(b,A4);}
    var esc=1-b.hp/b.max;
    if(b.t%Math.max(8,Math.round(18-esc*8))===0){var a=b.t*0.13,jj;for(jj=0;jj<3;jj++)eshot(b.x,b.y,a+jj*2.094,3,2);}
    if(b.t%Math.max(50,Math.round(120-esc*50))===0){var k=-3;for(k=-3;k<=3;k++)eshot(b.x,b.y,aimAt(b.x,b.y)+k*0.12,4.5);}
    return;
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
  // BOSS PHASE VARIETY PROTOTYPE: telegraph ring before a charge, so the lunge is readable/avoidable
  if(b.phase==='charge'&&b.telegraph>0&&b.telegraph%4<2){cx.strokeStyle='#fff';cx.lineWidth=2;cx.beginPath();cx.arc(b.x,b.y,b.r+8,0,6.283);cx.stroke();}
  cx.save();cx.translate(b.x,b.y);
  cx.rotate(b.t*0.01);cx.strokeStyle='#0ff';cx.lineWidth=5;cx.setLineDash([13,7]);cx.beginPath();cx.arc(0,0,38,0,6.283);cx.stroke();
  cx.rotate(-b.t*0.025);cx.strokeStyle='#00f';cx.lineWidth=3;cx.setLineDash([6,5]);cx.beginPath();cx.arc(0,0,32,0,6.283);cx.stroke();cx.setLineDash([]);
  var pulse=0.5+Math.sin(b.t*0.1)*0.5,exposed=true;for(i=0;i<4;i++)if(!b.arms[i].dead)exposed=false;
  cx.fillStyle=b.flash?'#fff':(exposed?'#f00':'#00f');cx.beginPath();cx.arc(0,0,b.r,0,6.283);cx.fill();
  cx.fillStyle=exposed?(pulse>0.5?'#ff0':'#f00'):(pulse>0.5?'#0ff':'#00f');cx.beginPath();cx.arc(0,0,13+pulse*3,0,6.283);cx.fill();
  cx.restore();
  cx.fillStyle='#000';cx.fillRect(W/2-100,7,200,5);cx.fillStyle=exposed?'#fff':'#0ff';cx.fillRect(W/2-100,7,200*b.hp/b.max,5);
}
window.BOSS_PHASE_DEBUG_SPAWN=function(){enemies.length=0;spawnBoss();}; // console/test hook only
window.BOSS_PHASE_DEBUG_STATE=function(){return {phase:boss&&boss.phase,phaseT:boss&&boss.phaseT,bx:boss&&Math.round(boss.x),by:boss&&Math.round(boss.y),hp:boss&&boss.hp,armsAlive:boss?boss.arms.filter(function(a){return !a.dead;}).length:0,armLens:boss?boss.arms.map(function(a){return Math.round(a.len);}):null,armPos:boss?boss.arms.map(function(a){return {x:Math.round(a.px),y:Math.round(a.py)};}):null,cycle:boss&&boss.cycle,dying:boss&&!!boss.dying};}; // console/test hook only
window.BOSS_PHASE_DEBUG_KILL_ARMS=function(){if(boss)boss.arms.forEach(function(a){a.dead=true;});}; // console/test hook only
window.BOSS_PHASE_DEBUG_ZERO_HP=function(){if(boss)boss.hp=0;}; // console/test hook only
window.BOSS_PHASE_DEBUG_FORCE_SPLIT=function(){if(boss){boss.phase='rotate';boss.phaseT=9999;boss.roamT=0;boss.cycle=1;}}; // console/test hook only: forces the NEXT rotate->transition to resolve as 'split' (cycle%4===2 path requires cycle=2, so this nudges cycle to 1 then lets the normal increment land on 2)
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
var PLAYER_PAL=[null,'#fff','#0ff','#00f','#ff0','#f00','#f0f','#000'];
// 30x19 hybrid-nozzle ship, drawn from the hand sketches: tilted egg cockpit split by a diagonal (glass above, body below), sitting above the body axis on purpose
var PLAYER_PAT=[
'000007000000000007777700000000',
'000007700000000771112177700000',
'000007577000007551222222270000',
'000007155700071115522222227700',
'000007111570071111152222222270',
'000007111157071111115522222227',
'000007111115772111111155222227',
'077771111331532211111111522227',
'736361113253113221111111155227',
'736361553553553322121212122570',
'736362223523225777222222277700',
'077772222332557000777777700000',
'000007222225770000000000000000',
'000007222257000000000000000000',
'000007222570000000000000000000',
'000007255700000000000000000000',
'000007577000000000000000000000',
'000007700000000000000000000000',
'000007000000000000000000000000'
].map(function(r){return r.split('').map(Number);});
var PLAYER_FLAME=[
  [[1,8,4],[0,9,4],[1,9,5],[1,10,4]],
  [[1,8,5],[0,9,5],[-1,9,4],[1,9,4],[1,10,5]]
];
var PLAYER_CV=(function(){
  var c=document.createElement('canvas');c.width=30;c.height=19;
  var g=c.getContext('2d'),j,i,v;
  for(j=0;j<19;j++)for(i=0;i<30;i++){v=PLAYER_PAT[j][i];if(!v)continue;g.fillStyle=PLAYER_PAL[v];g.fillRect(i,j,1,1);}
  return c;
})();

var fireT=0;
function playerUpdate(){
  var ax=0,ay=0;
  if(keys[37]||keys[65])ax-=1;if(keys[39]||keys[68])ax+=1;if(keys[38]||keys[87])ay-=1;if(keys[40]||keys[83])ay+=1;
  var sp=5.2;player.x+=ax*sp;player.y+=ay*sp;
  if(touch.active){var mx=Math.max(-14,Math.min(14,touch.mx)),my=Math.max(-14,Math.min(14,touch.my));player.x+=mx;player.y+=my;touch.mx-=mx;touch.my-=my;ay=ay||my/14;}
  player.x=Math.max(15+safeL,Math.min(W-18-safeR,player.x));player.y=Math.max(10+safeT,Math.min(H-10-safeB,player.y));
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
  var x=Math.round(player.x)-15,y=Math.round(player.y)-9,bank=0;
  if(player.tilt<-0.2)bank=-1;else if(player.tilt>0.2)bank=1;
  if(bank===0)cx.drawImage(PLAYER_CV,x,y);
  else{
    cx.drawImage(PLAYER_CV,0,0,15,19,x,y,15,19);
    cx.drawImage(PLAYER_CV,15,0,15,19,x+15,y+bank,15,19);
  }
  var fl=PLAYER_FLAME[(time>>2)%2],k;
  for(k=0;k<fl.length;k++){cx.fillStyle=PLAYER_PAL[fl[k][2]];cx.fillRect(x-2+fl[k][0],y+fl[k][1],1,1);}
  if(fireT===0){cx.fillStyle='#fff';cx.fillRect(x+27,y+6,2,1);cx.fillRect(x+27,y+12,2,1);}
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
// B-1: on stage 1, before the player has ever picked up a Boomerang Slugger, widen B's
// share of the drop table (0.25-0.32 -> 0.25-0.40) so a first-time player is very likely to
// see one during the opening wave alone, without touching P/S odds or guaranteeing a drop.
// Reverts to the normal table the moment boomerangs.length>=1 — no extra counter/state.
function dropPickup(x,y){
  var r=Math.random(),bMax=(stage===1&&boomerangs.length===0)?0.40:0.32;
  if(r<0.18)pickups.push({x:x,y:y,kind:'P',t:0});
  else if(r<0.25)pickups.push({x:x,y:y,kind:'S',t:0});
  else if(r<bMax)pickups.push({x:x,y:y,kind:'B',t:0});
}

// ---------- update ----------
function update(){
  time++;
  if(state!=='play'){if(state==='over')deadT++;scroll+=0.7;parts.forEach(pUpd);if(shake>0)shake--;if(flash>0)flash--;if(shieldFlash>0)shieldFlash--;if(msgT>0)msgT--;return;}
  if(introT>0){introT--;playerUpdate();bullets.length=0;scroll+=2;if(msgT>0)msgT--;if(introT===0){invul=120;say(zoneName());}bgmTick();return;}
  scroll+=2;
  bgPhaseUpdate();
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
    if(Math.abs(pk.x-player.x)<13&&Math.abs(pk.y-player.y)<13){if(pk.kind==='P'){if(power<5){power++;if(powerUpCalloutsLeft>0){powerUpCalloutsLeft--;say('POWER UP');}}else score+=500;}else if(pk.kind==='S'){shield=Math.min(3,shield+1);shieldFlash=8;}else addBoomerang();SFX.power();pickups.splice(i,1);continue;}
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
// 背景：通常面は常に静か（天気の循環はしない）。ボスのコア露出中だけ、最大400tick（約6.7秒）
// 上下の縁に単色の濁りが1秒周期でゆっくり呼吸する。白の点滅は使わない。
var bgPhase='calm',starDrift=0,bgCoreForceT=0,bgStormT=0;
function bgPhaseUpdate(){
  if(boss&&boss.phase==='core'){bgCoreForceT++;}else{bgCoreForceT=0;}
  var storm=bgCoreForceT>0&&bgCoreForceT<=400;
  if(storm){if(bgPhase!=='storm'){bgPhase='storm';bgStormT=0;}bgStormT++;}else bgPhase='calm';
  starDrift+=storm?0.75:1.5;
}
function bgPhaseOverlay(P){
  if(bgPhase!=='storm')return;
  var cyc=bgStormT%60,breathe=cyc<30?cyc/30:(60-cyc)/30,step=6-Math.round(breathe*3);
  dither(0,0,W,36,step,P.deep);dither(0,H-36,W,36,step,P.deep);
}
function drawBG(){
  var P=pal(),i;
  cx.fillStyle='#000';cx.fillRect(0,0,W,H);
  for(i=0;i<H;i+=8)dither(0,i,W,3,2,P.deep);
  for(i=0;i<4;i++){var sx=((i*190-scroll*0.15)%(W+220)+W+220)%(W+220)-100;for(var q=0;q<42;q+=8)dither(sx+q,0,3,H,2,P.mid);}
  for(i=0;i<bg.length;i++){var b=bg[i];var x=((b.x-scroll*b.z)%W+W)%W,y=(b.y-starDrift*b.z+H)%H;cx.fillStyle=b.z>0.7?P.hi:P.deep;cx.fillRect(Math.round(x),Math.round(y),b.z>0.7?2:1,b.z>0.7?2:1);}
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
  bgPhaseOverlay(P);
}
window.BG_PHASE_DEBUG_STATE=function(){return {bgPhase:bgPhase,starDrift:Math.round(starDrift),bossPhase:boss&&boss.phase,bgCoreForceT:bgCoreForceT};}; // console/test hook only

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
  for(i=0;i<ebullets.length;i++){var s=ebullets[i],sx=Math.round(s.x),sy=Math.round(s.y);cx.fillStyle='#000';cx.fillRect(sx-3,sy-3,6,6);cx.fillStyle=s.kind===1?'#f00':(s.kind===2?'#fff':'#ff0');cx.fillRect(sx-2,sy-2,4,4);cx.fillStyle='#fff';cx.fillRect(sx,sy,1,1);}
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
      cx.fillStyle='#fff';cx.font='10px "Courier New",monospace';cx.fillText('PROJECT 87 / PANORAMA CONVERSION  V4',W/2,H/2-6);cx.fillText('DRAG OR CURSOR KEYS / AUTO FIRE',W/2,H/2+16);
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

