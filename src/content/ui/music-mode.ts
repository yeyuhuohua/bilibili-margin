import { h, icon, ICONS, guardTyping } from './dom';
import { parseLrc, lyricIndex, type LyricLine } from '../music-lyrics';
import css from './music-mode.css?inline';
import { getJSON } from '../api/http';
import { createVisualizer } from './music-visualizer';

type Capturable=HTMLVideoElement&{captureStream?:()=>MediaStream;mozCaptureStream?:()=>MediaStream};
const findPlayer=()=>document.querySelector<HTMLElement>('.bpx-player-container')||document.querySelector<HTMLElement>('#bilibili-player, .bilibili-player');
const videoSelector='.bpx-player-video-wrap video, .bilibili-player-video video, video';
type StyleState={value:string;priority:string;applied:string};

/** Listening surface: lift the existing player in place, never reparent, clone or replace its video/danmaku. */
export function createMusicMode(onOpenChange?: (active: boolean) => void, onThemeToggle?: () => void){
  const host=h('div',{id:'margin-music',hidden:''}),root=host.attachShadow({mode:'open'});
  const app=h('div',{class:'fv-app',role:'dialog','aria-modal':'true','aria-label':'聆听模式',tabindex:'-1','data-view':'listen'});
  const button=(label:string,className='fv-button')=>h('button',{type:'button',class:className,'aria-label':label,title:label});
  const back=button('返回普通播放');back.append(icon(ICONS.back),'返回普通播放');
  const theme=button('切换明暗主题');theme.append(icon(ICONS.sun));
  const videoView=button('视频视图'),listenView=button('聆听视图');
  for(const tab of [videoView,listenView]){tab.textContent=tab===videoView?'视频':'聆听';tab.setAttribute('role','tab');tab.setAttribute('aria-selected',String(tab===listenView));}
  const tabs=h('div',{class:'lv-tabs fv-glass',role:'tablist','aria-label':'播放视图'},videoView,listenView);
  const stage=h('div',{class:'fv-stage','aria-label':'原生视频和弹幕区域'});
  const cover=h('img',{class:'lv-cover',alt:'当前视频封面',hidden:''}),coverNote=h('span',{class:'lv-cover-note'},'正在读取视频封面');
  const retryCover=button('重试封面');retryCover.textContent='重试封面';retryCover.hidden=true;stage.append(cover,coverNote);
  const sourceSelect=h('select',{'aria-label':'歌词来源'},h('option',{value:'captions'},'视频字幕'),h('option',{value:'import'},'导入歌词'),h('option',{value:'original'},'原画歌词')) as HTMLSelectElement;
  const read=button('读取视频字幕','lv-text');read.textContent='读取字幕';
  const importButton=button('导入歌词','lv-text');importButton.textContent='导入歌词';
  const file=h('input',{type:'file',accept:'.lrc,.txt,text/plain','aria-label':'本地歌词文件',hidden:''}) as HTMLInputElement;
  const lines=h('div',{class:'lv-lines'}),lyricWindow=h('div',{class:'lv-lyric-window',tabindex:'0','aria-label':'歌词内容',hidden:''},lines);
  const emptyLyrics=h('div',{class:'lv-empty'},h('p',{},'让声音留一点空白'),h('span',{},'暂无可用歌词'));
  const original=h('div',{class:'lv-original','aria-label':'原画歌词窗口',hidden:''});
  const originalButton=button('显示原画歌词','lv-text');originalButton.textContent='显示原画歌词';emptyLyrics.append(originalButton);
  const adjust=button('调整原画歌词范围','lv-text');adjust.textContent='调整范围';adjust.hidden=true;
  const resetCrop=button('恢复完整画面','lv-text');resetCrop.textContent='完整画面';resetCrop.hidden=true;
  const follow=button('回到当前句','fv-button');follow.textContent='回到当前句';follow.hidden=true;
  const offset=h('input',{type:'number',min:'-30',max:'30',step:'.1',value:'0','aria-label':'歌词延后秒数'}) as HTMLInputElement;
  const offsetLabel=h('label',{class:'lv-offset'},'歌词延后',offset,'秒');offsetLabel.hidden=true;
  const sourceNote=h('p',{class:'lv-source-note',role:'status'},'优先使用播放器已加载的字幕，也可导入本地歌词。');
  const lyricsPanel=h('section',{class:'lv-lyrics','aria-label':'歌词区域'},h('div',{class:'lv-lyric-head'},sourceSelect,h('div',{},read,importButton),file),sourceNote,lyricWindow,emptyLyrics,original,h('div',{class:'lv-lyric-foot'},offsetLabel,adjust,resetCrop,follow));
  const title=h('h1',{class:'fv-title'}),author=h('p',{class:'fv-author'});
  const canvas=h('canvas',{'aria-label':'实时音频频谱'}), spectrumButton=button('关闭频谱','fv-button fv-spectrum-toggle');spectrumButton.textContent='关闭频谱';spectrumButton.setAttribute('aria-pressed','true');

  const shapeBars=button('频谱样式','lv-wave-tab'),shapeLine=button('声波样式','lv-wave-tab');
  shapeBars.textContent='频谱';shapeLine.textContent='声波';shapeBars.setAttribute('role','tab');shapeLine.setAttribute('role','tab');
  shapeBars.setAttribute('aria-selected','true');shapeLine.setAttribute('aria-selected','false');
  const signal=h('span',{class:'lv-signal'},'待播放');
  const shapeTabs=h('div',{class:'lv-wave-tabs',role:'tablist','aria-label':'音频可视化样式'},shapeBars,shapeLine);
  const spectrumPanel=h('div',{class:'fv-visual fv-spectrum-card fv-glass'},h('div',{class:'lv-signal-head'},shapeTabs,signal),canvas,h('div',{class:'lv-signal-foot'},spectrumButton));
  const visual=createVisualizer(canvas);
  let spectrumShape:'bars'|'line'='bars';
  const chooseShape=(next:'bars'|'line')=>{spectrumShape=next;visual.setMode(next);shapeBars.setAttribute('aria-selected',String(next==='bars'));shapeLine.setAttribute('aria-selected',String(next==='line'));};
  shapeBars.addEventListener('click',()=>chooseShape('bars'));shapeLine.addEventListener('click',()=>chooseShape('line'));
  shapeTabs.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const next=event.key==='Home'?'bars':event.key==='End'?'line':spectrumShape==='bars'?'line':'bars';chooseShape(next);(next==='bars'?shapeBars:shapeLine).focus();});
  const play=button('播放','fv-play');play.append(icon(ICONS.play));
  const rewind=button('后退 10 秒','fv-icon');rewind.textContent='−10';
  const forward=button('前进 10 秒','fv-icon');forward.textContent='+10';
  const repeat=button('单曲循环','fv-icon');repeat.append(icon(ICONS.refresh));repeat.setAttribute('aria-pressed','false');
  const mute=button('静音','fv-icon');mute.append(icon('<path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>'));
  const volume=h('input',{type:'range',min:'0',max:'1',step:'.01',value:'.6','aria-label':'音量'}) as HTMLInputElement;
  const progress=h('input',{type:'range',min:'0',max:'1',step:'.1',value:'0','aria-label':'播放进度'}) as HTMLInputElement;
  const elapsed=h('span',{},'00:00'),duration=h('span',{},'00:00');
  const status=h('div',{class:'fv-status',role:'status'},'原生视频与弹幕 · 播放时自动启用频谱');
  const dmComposer=button('展开弹幕输入','fv-button');dmComposer.textContent='弹幕';dmComposer.setAttribute('aria-expanded','false');
  app.append(h('header',{class:'fv-head'},h('div',{class:'fv-brand'},'映间',h('small',{},'聆听')),tabs,h('div',{class:'fv-tools'},theme,back)),
    h('main',{class:'fv-main'},h('div',{class:'fv-scene'},h('section',{class:'fv-left','aria-label':'当前作品'},stage,h('div',{class:'fv-meta'},h('div',{class:'fv-info'},title,author,retryCover),spectrumPanel)),lyricsPanel),
      h('section',{class:'fv-dock fv-glass','aria-label':'音乐播放控制'},h('div',{class:'fv-top'},h('div',{class:'fv-time'},elapsed,' / ',duration),h('div',{class:'fv-transport'},rewind,play,forward,repeat),h('div',{class:'fv-volume'},dmComposer,mute,volume)),h('div',{class:'fv-progress'},progress)),status));
  root.append(h('style',{},css),app);document.documentElement.append(host);guardTyping(host);
  // Native controls can mount after entry. Scoped CSS handles them without a
  // subtree observer on the continuously changing danmaku layer.
  document.documentElement.append(h('style',{},`
    html.margin-listening-bg #margin-bg{display:block!important;z-index:2147482999!important}
    html.margin-listening-mode .bpx-player-container :is(.bpx-player-control-wrap,.bpx-player-control-bottom){display:none!important}
    html.margin-listening-mode:not(.margin-listening-input) .bpx-player-sending-area{display:none!important}
  `));

  let opened=false,frame:HTMLElement|null=null,video:Capturable|null=null,returnFocus:HTMLElement|null=null;
  const styles=new Map<HTMLElement,Map<string,StyleState>>();let layoutFrame=0,poll=0,mediaEvents:AbortController|null=null;
  const viewStyles=new Map<HTMLElement,Map<string,StyleState>>();
  let view:'video'|'listen'='listen',sourceKind='captions',lyrics:LyricLine[]=[],activeLine=-1,following=true,metadataKey='',mediaRevision=0,composeDm=false;
  let imported:LyricLine[]=[],importedStatic:string[]=[],importedName='',importRevision=0,coverProbe:HTMLImageElement|null=null,coverTimer=0,coverReady=false;
  const coverTried=new Set<string>();
  let metadataAbort:AbortController|null=null,metadataCover='',metadataAuthor='';
  let crop={x:0,y:0,w:1,h:1},picking=false,cropDraft={...crop},selectionFocus:HTMLElement|null=null;
  const reduced=()=>matchMedia('(prefers-reduced-motion: reduce)').matches||document.documentElement.classList.contains('margin-reduce');
  const contentKey=()=>`${location.pathname}:${new URLSearchParams(location.search).get('p')||'1'}:${document.querySelector('.video-title')?.textContent?.trim()||'当前视频'}`;
  let context:AudioContext|null=null,stream:MediaStream|null=null,source:MediaStreamAudioSourceNode|null=null,analyser:AnalyserNode|null=null,bins:Uint8Array<ArrayBuffer>|null=null;
  let spectrumFrame=0,lastPaint=0,starting=false,spectrumWanted=true;
  function setStyle(el:HTMLElement,key:string,value:string,records=styles){
    let saved=records.get(el);if(!saved){saved=new Map();records.set(el,saved);}
    const current=el.style.getPropertyValue(key),priority=el.style.getPropertyPriority(key),old=saved.get(key);
    if(!old)saved.set(key,{value:current,priority,applied:value});
    else {if(current!==old.applied||priority!=='important'){old.value=current;old.priority=priority;}old.applied=value;}
    if(current!==value||priority!=='important')el.style.setProperty(key,value,'important');
    saved.get(key)!.applied=el.style.getPropertyValue(key);
  }
  function restoreStyles(records=styles){for(const [el,saved]of records)for(const [key,state]of saved){if(el.style.getPropertyValue(key)!==state.applied||el.style.getPropertyPriority(key)!=='important')continue;state.value?el.style.setProperty(key,state.value,state.priority):el.style.removeProperty(key);}records.clear();}
  function lift(){
    if(!frame)return;
    for(let el=frame.parentElement;el&&el!==document.documentElement;el=el.parentElement){
      // Bilibili can enable sticky positioning after entry; keep ancestors
      // outside stacking contexts until the native layout is restored on exit.
      setStyle(el,'position','relative');
      for(const [key,value]of Object.entries({transform:'none',filter:'none','backdrop-filter':'none',perspective:'none',contain:'none',isolation:'auto','will-change':'auto','clip-path':'none',overflow:'visible','z-index':'auto',opacity:'1','mix-blend-mode':'normal',zoom:'1',transition:'none'}))setStyle(el,key,value);
    }
    setStyle(document.documentElement,'overflow','hidden');
    setStyle(frame,'position','fixed');setStyle(frame,'z-index','2147483100');setStyle(frame,'margin','0');setStyle(frame,'max-width','none');setStyle(frame,'min-width','0');setStyle(frame,'max-height','none');setStyle(frame,'min-height','0');setStyle(frame,'transform','none');setStyle(frame,'box-sizing','border-box');setStyle(frame,'border-radius','18px');setStyle(frame,'overflow','hidden');setStyle(frame,'clip-path','inset(0 round 18px)');
  }
  function layout(){layoutFrame=0;if(!opened||!frame||document.fullscreenElement)return;const target=picking?selectionStage:view==='listen'&&sourceKind==='original'?original:stage;const box=target.getBoundingClientRect();setStyle(frame,'left',`${box.left}px`);setStyle(frame,'top',`${box.top}px`);setStyle(frame,'width',`${box.width}px`);setStyle(frame,'height',`${box.height}px`);const dock=app.querySelector('.fv-dock')!.getBoundingClientRect();setStyle(frame,'clip-path',picking?'inset(0 round 18px)':`inset(${Math.max(0,76-box.top)}px 0 ${Math.max(0,box.bottom-dock.top+12)}px 0 round 18px)`);}
  function scheduleLayout(){if(!layoutFrame&&opened)layoutFrame=requestAnimationFrame(layout);}
  function onFullscreen(){
    if(!opened||!frame)return;
    const full=document.fullscreenElement;
    if(full&&full.contains(frame)){for(const [key,value]of Object.entries({left:'0px',top:'0px',width:'100%',height:'100%','border-radius':'0px','clip-path':'none'}))setStyle(frame,key,value);}
    else if(!full){setStyle(frame,'border-radius','18px');setStyle(frame,'clip-path','inset(0 round 18px)');scheduleLayout();}
  }
  const ro=new ResizeObserver(scheduleLayout);
  const format=(time:number)=>`${String(Math.floor(time/60)).padStart(2,'0')}:${String(Math.floor(time%60)).padStart(2,'0')}`;
  const rangeFill=(input:HTMLInputElement)=>input.style.setProperty('--fill',`${Number(input.value)/Number(input.max)*100}%`);
  function sync(){
    if(!video)return;
    app.classList.toggle('lv-reduce',reduced());
    const label=video.paused?'播放':'暂停';if(play.getAttribute('aria-label')!==label){play.setAttribute('aria-label',label);play.replaceChildren(video.paused?icon(ICONS.play):document.createTextNode('Ⅱ'));}
    elapsed.textContent=format(video.currentTime);duration.textContent=Number.isFinite(video.duration)?format(video.duration):'--:--';progress.max=String(Number.isFinite(video.duration)?video.duration:1);progress.value=String(video.currentTime);progress.disabled=!Number.isFinite(video.duration);rangeFill(progress);
    progress.setAttribute('aria-valuetext',`${format(video.currentTime)}，共 ${duration.textContent}`);volume.setAttribute('aria-valuetext',`${Math.round(video.volume*100)}%`);
    volume.value=String(video.volume);rangeFill(volume);mute.setAttribute('aria-label',video.muted?'取消静音':'静音');mute.style.opacity=video.muted?'.45':'1';repeat.setAttribute('aria-pressed',String(video.loop));
    syncLyrics();
    if(video.paused||reduced()){cancelAnimationFrame(spectrumFrame);spectrumFrame=0;drawSpectrum();}else if(analyser&&!spectrumFrame&&!document.hidden)spectrumFrame=requestAnimationFrame(tick);
  }
  function drawSpectrum(){
    const active=!!(analyser&&bins&&video&&!video.paused&&!reduced());
    if(active)analyser!.getByteFrequencyData(bins!);
    visual.draw(bins,active);
    const label=active?'实时':video?.paused?'已暂停':analyser?'静止':'待播放';
    if(signal.textContent!==label)signal.textContent=label;
    if(signal.dataset.live!==String(active))signal.dataset.live=String(active);
  }
  function tick(now:number){spectrumFrame=0;if(!opened||!video||video.paused||document.hidden||!analyser||reduced())return;if(now-lastPaint>=33){lastPaint=now;drawSpectrum();}spectrumFrame=requestAnimationFrame(tick);}
  function spectrumLabel(){const label=spectrumWanted?'关闭频谱':'启用频谱';spectrumButton.textContent=label;spectrumButton.setAttribute('aria-label',label);spectrumButton.setAttribute('title',label);spectrumButton.setAttribute('aria-pressed',String(spectrumWanted));}
  function stopSpectrum(){starting=false;cancelAnimationFrame(spectrumFrame);spectrumFrame=0;source?.disconnect();source=null;analyser=null;bins=null;stream?.getTracks().forEach(track=>track.stop());stream=null;const old=context;context=null;if(old&&old.state!=='closed')void old.close().catch(()=>{});spectrumLabel();drawSpectrum();}
  async function startSpectrum(){
    if(!opened||!spectrumWanted||!video||video.paused||video.readyState<2||context||starting)return;
    const capture=video.captureStream||video.mozCaptureStream;if(!capture){status.textContent='当前浏览器不支持音轨分析，视频与弹幕继续播放。';return;}
    starting=true;const ownVideo=video;let ac:AudioContext|null=null;
    try{ac=new AudioContext();context=ac;await ac.resume();if(context!==ac||!opened||!spectrumWanted||video!==ownVideo)return;stream=capture.call(ownVideo);stream.getVideoTracks().forEach(track=>track.stop());if(!stream.getAudioTracks().some(track=>track.readyState==='live'&&!track.muted))throw new Error();source=ac.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));analyser=ac.createAnalyser();analyser.fftSize=1024;analyser.smoothingTimeConstant=.85;source.connect(analyser);bins=new Uint8Array(analyser.frequencyBinCount);status.textContent='原生视频与弹幕 · 实时音频频谱';sync();}
    catch{if(context===ac){stopSpectrum();status.textContent='音轨暂不可分析，视频与弹幕继续播放。';}}finally{if(context===ac)starting=false;}
  }
  function centerLine(){
    const line=lines.children[activeLine] as HTMLElement|undefined;
    if(line&&view==='listen'&&!lyricWindow.hidden)lyricWindow.scrollTo({top:Math.max(0,line.offsetTop-lyricWindow.clientHeight*.36),behavior:reduced()?'instant':'smooth'});
  }
  function syncLyrics(){
    if(!video||!lyrics.length)return;
    const next=lyricIndex(lyrics,video.currentTime-Number(offset.value||0));if(next===activeLine)return;
    lines.children[activeLine]?.removeAttribute('aria-current');activeLine=next;
    lines.children[activeLine]?.setAttribute('aria-current','true');if(following)centerLine();
  }
  function setLyrics(next:LyricLine[],label:string,plain:string[]=[]){
    lyrics=next;activeLine=-1;following=true;follow.hidden=true;offset.value='0';sourceNote.textContent=label;
    const entries=next.length?next.map(line=>line.text):plain;
    lines.replaceChildren(...entries.map((text,i)=>{
      const line=h(next.length?'button':'p',{class:'lv-line',...(next.length?{type:'button','aria-label':`${text}，跳转到 ${format(next[i].at)}`}:{})},text);
      if(next.length)line.addEventListener('click',()=>{following=true;follow.hidden=true;seek(next[i].at+Number(offset.value||0));});return line;
    }));
    lyricWindow.hidden=!entries.length;emptyLyrics.hidden=!!entries.length;offsetLabel.hidden=!next.length;
    app.classList.toggle('lv-has-lyrics',!!entries.length);syncLyrics();applyPresentation();
  }
  function readCaptions(){
    sourceKind='captions';sourceSelect.value=sourceKind;const found:LyricLine[]=[];let label='';
    try{if(video)for(const track of video.textTracks){if(!['subtitles','captions'].includes(track.kind))continue;for(const cue of Array.from(track.cues||[]).slice(0,10000))if('text'in cue&&typeof cue.text==='string'&&cue.text.trim())found.push({at:cue.startTime,text:cue.text.replace(/<[^>]*>/g,'').slice(0,500)});if(found.length){label=track.label;break;}}}catch{/* Unreadable tracks leave import and original picture available. */}
    setLyrics(found.sort((a,b)=>a.at-b.at),found.length?`视频字幕${label?` · ${label}`:''}`:'未找到已加载的字幕，可导入歌词或显示原画歌词。');
  }
  function cancelCover(){clearTimeout(coverTimer);if(coverProbe){coverProbe.onload=coverProbe.onerror=null;coverProbe.removeAttribute('src');coverProbe=null;}}
  async function requestMetadata(){
    metadataAbort?.abort();const own=new AbortController();metadataAbort=own;const ownKey=metadataKey;
    const bvid=location.pathname.match(/\/video\/(BV[0-9A-Za-z]{10})/)?.[1];if(!bvid)return;
    const timer=window.setTimeout(()=>own.abort(),8000);
    try{
      const data=await getJSON<{pic?:string;owner?:{name?:string}}>('/x/web-interface/view',{bvid},own.signal);
      if(!opened||metadataKey!==ownKey||metadataAbort!==own)return;
      metadataCover=data.pic||'';metadataAuthor=data.owner?.name||'';if(!document.querySelector('.up-name, .up-info-container .name')?.textContent?.trim()&&metadataAuthor)author.textContent=metadataAuthor;loadCover();
    }catch{/* Native metadata and explicit retry remain available. */}finally{clearTimeout(timer);}
  }
  function loadCover(){
    if(!opened||coverReady||coverProbe)return;
    const candidates=[video?.poster||'',...Array.from(document.querySelectorAll<HTMLMetaElement>('meta[property="og:image"],meta[name="og:image"],meta[itemprop="image"]'),el=>el.content),metadataCover];
    for(const value of [...candidates]){try{const url=new URL(value,location.href);if(url.hostname.endsWith('.hdslb.com')&&/\.(?:jpe?g|png|webp|avif)@/i.test(url.pathname)){url.pathname=url.pathname.replace(/(\.(?:jpe?g|png|webp|avif))@.*$/i,'$1');candidates.push(url.href);}}catch{/* Skip malformed metadata. */}}
    let candidate='';for(const value of candidates){try{const url=new URL(value,location.href);if(!value)continue;if(url.protocol==='http:'&&url.hostname.endsWith('.hdslb.com'))url.protocol='https:';if(url.username||url.password||url.protocol!=='https:'&&url.origin!==location.origin)continue;if(!coverTried.has(url.href)){candidate=url.href;break;}}catch{/* Try remaining metadata candidates. */}}
    if(!candidate){coverNote.textContent='封面暂不可用';retryCover.hidden=false;return;}
    coverTried.add(candidate);const ownKey=metadataKey,probe=new Image();coverProbe=probe;probe.referrerPolicy='no-referrer';
    retryCover.hidden=true;
    probe.onload=()=>{if(!opened||coverProbe!==probe||metadataKey!==ownKey)return;if(!probe.naturalWidth){failed();return;}cover.src=candidate;cover.hidden=false;coverNote.hidden=true;retryCover.hidden=true;stage.style.setProperty('--cover-ratio',`${probe.naturalWidth}/${probe.naturalHeight}`);coverReady=true;cancelCover();scheduleLayout();};
    const failed=()=>{if(coverProbe!==probe)return;cancelCover();loadCover();};probe.onerror=failed;coverTimer=window.setTimeout(failed,4000);probe.src=candidate;
  }
  function applyPresentation(){
    restoreStyles(viewStyles);
    document.documentElement.classList.toggle('margin-listening-mode',opened&&(view==='listen'||picking));
    document.documentElement.classList.toggle('margin-listening-input',opened&&view==='listen'&&composeDm&&!picking);
    app.dataset.view=view;videoView.setAttribute('aria-selected',String(view==='video'));listenView.setAttribute('aria-selected',String(view==='listen'));videoView.tabIndex=view==='video'?0:-1;listenView.tabIndex=view==='listen'?0:-1;
    original.hidden=sourceKind!=='original';adjust.hidden=resetCrop.hidden=sourceKind!=='original';
    if(sourceKind==='original'){lyricWindow.hidden=emptyLyrics.hidden=offsetLabel.hidden=true;app.classList.add('lv-has-lyrics');}
    if(!frame||!video){scheduleLayout();return;}
    if(view==='listen'||picking){
      for(const el of frame.querySelectorAll<HTMLElement>('.bpx-player-control-wrap,.bpx-player-control-bottom,.native-caption'))setStyle(el,'display','none',viewStyles);
      if(!composeDm||picking)for(const el of frame.querySelectorAll<HTMLElement>('.bpx-player-sending-area'))setStyle(el,'display','none',viewStyles);
      for(const el of [frame,...frame.querySelectorAll<HTMLElement>('.bpx-player-primary-area,.bpx-player-video-area,.bpx-player-video-perch,.bpx-player-video-wrap')]){setStyle(el,'background','transparent',viewStyles);if(el!==frame)setStyle(el,'height','100%',viewStyles);}
      if(view==='listen'&&sourceKind!=='original'&&!picking)setStyle(video,'opacity','0',viewStyles);
      else if(!picking){
        const ratio=(video.videoWidth||16)/(video.videoHeight||9)*crop.w/crop.h;original.style.setProperty('--original-ratio',String(ratio));
        for(const [key,value]of Object.entries({position:'absolute',width:`${100/crop.w}%`,height:`${100/crop.h}%`,left:`${-crop.x/crop.w*100}%`,top:`${-crop.y/crop.h*100}%`,'max-width':'none','max-height':'none','object-fit':'fill',transform:'none'}))setStyle(video,key,value,viewStyles);
      }
    }
    scheduleLayout();if(following)centerLine();
  }
  function switchView(next:'video'|'listen'){if(picking)finishCrop(false);view=next;applyPresentation();drawSpectrum();}
  const selectionHost=h('div',{id:'margin-listen-crop',role:'dialog','aria-modal':'true','aria-label':'调整原画歌词',hidden:''}),selectionRoot=selectionHost.attachShadow({mode:'open'});
  const selectionStage=h('div',{class:'lv-crop-stage','aria-label':'原画歌词选区编辑区域'});
  const cropArea=h('div',{class:'lv-crop-area',role:'group',tabindex:'0','aria-label':'移动歌词选区'});
  for(const corner of ['nw','ne','sw','se'] as const)cropArea.append(h('button',{type:'button',class:`lv-crop-handle ${corner}`,'data-corner':corner,'aria-label':`调整${{nw:'左上',ne:'右上',sw:'左下',se:'右下'}[corner]}角` }));
  selectionStage.append(cropArea);
  const cancelCrop=button('取消选区'),saveCrop=button('使用这个范围');cancelCrop.textContent='取消';saveCrop.textContent='使用这个范围';
  const cropReadout=h('span',{class:'lv-crop-readout'});
  selectionRoot.append(h('style',{},css),h('div',{class:'lv-crop-title'},'框选原画中的歌词',h('span',{},'拖动选区或四角调整，播放进度保持不变')),selectionStage,h('div',{class:'lv-crop-actions fv-glass'},cropReadout,cancelCrop,saveCrop));document.documentElement.append(selectionHost);
  function paintCrop(){cropArea.style.left=`${cropDraft.x*100}%`;cropArea.style.top=`${cropDraft.y*100}%`;cropArea.style.width=`${cropDraft.w*100}%`;cropArea.style.height=`${cropDraft.h*100}%`;cropReadout.textContent=`${Math.round(cropDraft.w*100)}% × ${Math.round(cropDraft.h*100)}%`;}
  function openCrop(){selectionFocus=root.activeElement as HTMLElement;picking=true;cropDraft={...crop};selectionHost.hidden=false;app.setAttribute('aria-hidden','true');paintCrop();applyPresentation();layout();saveCrop.focus();}
  function finishCrop(commit:boolean){if(!picking)return;if(commit)crop={...cropDraft};picking=false;selectionHost.hidden=true;app.removeAttribute('aria-hidden');applyPresentation();selectionFocus?.focus({preventScroll:true});}
  let drag:null|{x:number;y:number;box:typeof crop;mode:string}=null;
  const clamp=(n:number,a:number,b:number)=>Math.min(b,Math.max(a,n));
  selectionStage.addEventListener('pointerdown',event=>{if(event.button!==0)return;event.preventDefault();const rect=selectionStage.getBoundingClientRect(),el=event.target as HTMLElement;const x=clamp((event.clientX-rect.x)/rect.width,0,1),y=clamp((event.clientY-rect.y)/rect.height,0,1);drag={x,y,box:{...cropDraft},mode:el.dataset.corner||((el===cropArea||cropArea.contains(el))?'move':'new')};selectionStage.setPointerCapture(event.pointerId);});
  selectionStage.addEventListener('pointermove',event=>{if(!drag)return;const rect=selectionStage.getBoundingClientRect(),x=clamp((event.clientX-rect.x)/rect.width,0,1),y=clamp((event.clientY-rect.y)/rect.height,0,1),dx=x-drag.x,dy=y-drag.y,b=drag.box;let left=b.x,top=b.y,right=b.x+b.w,bottom=b.y+b.h;
    if(drag.mode==='move'){left=clamp(b.x+dx,0,1-b.w);top=clamp(b.y+dy,0,1-b.h);right=left+b.w;bottom=top+b.h;}
    else if(drag.mode==='new'){left=Math.min(drag.x,x);top=Math.min(drag.y,y);right=Math.max(drag.x+.04,x);bottom=Math.max(drag.y+.04,y);}
    else{if(drag.mode.includes('w'))left=clamp(b.x+dx,0,right-.04);if(drag.mode.includes('e'))right=clamp(b.x+b.w+dx,left+.04,1);if(drag.mode.includes('n'))top=clamp(b.y+dy,0,bottom-.04);if(drag.mode.includes('s'))bottom=clamp(b.y+b.h+dy,top+.04,1);}
    cropDraft={x:clamp(left,0,.96),y:clamp(top,0,.96),w:clamp(right-left,.04,1-left),h:clamp(bottom-top,.04,1-top)};paintCrop();});
  selectionStage.addEventListener('pointerup',()=>{drag=null;});selectionStage.addEventListener('pointercancel',()=>{drag=null;});
  selectionStage.addEventListener('keydown',event=>{if(!event.key.startsWith('Arrow'))return;event.preventDefault();const step=event.shiftKey ? .05 : .01,dx=event.key==='ArrowRight'?step:event.key==='ArrowLeft'?-step:0,dy=event.key==='ArrowDown'?step:event.key==='ArrowUp'?-step:0,corner=(event.target as HTMLElement).dataset.corner;
    if(!corner){cropDraft.x=clamp(cropDraft.x+dx,0,1-cropDraft.w);cropDraft.y=clamp(cropDraft.y+dy,0,1-cropDraft.h);}else{const right=cropDraft.x+cropDraft.w,bottom=cropDraft.y+cropDraft.h;if(corner.includes('w')){cropDraft.x=clamp(cropDraft.x+dx,0,right-.04);cropDraft.w=right-cropDraft.x;}else cropDraft.w=clamp(cropDraft.w+dx,.04,1-cropDraft.x);if(corner.includes('n')){cropDraft.y=clamp(cropDraft.y+dy,0,bottom-.04);cropDraft.h=bottom-cropDraft.y;}else cropDraft.h=clamp(cropDraft.h+dy,.04,1-cropDraft.y);}paintCrop();});
  cancelCrop.addEventListener('click',()=>finishCrop(false));saveCrop.addEventListener('click',()=>finishCrop(true));
  read.addEventListener('click',()=>{importRevision++;readCaptions();});importButton.addEventListener('click',()=>file.click());
  originalButton.addEventListener('click',()=>{importRevision++;sourceKind='original';sourceSelect.value='original';sourceNote.textContent='原视频画面，与当前播放同步';applyPresentation();});
  adjust.addEventListener('click',openCrop);resetCrop.addEventListener('click',()=>{crop={x:0,y:0,w:1,h:1};applyPresentation();});
  sourceSelect.addEventListener('change',()=>{importRevision++;if(sourceSelect.value==='captions')readCaptions();else if(sourceSelect.value==='original')originalButton.click();else{sourceKind='import';setLyrics(imported,importedName?`本地文件 · ${importedName}${imported.length?'':' · 静态文本，无时间轴'}`:'选择本地 LRC 或文本文件',importedStatic);sourceSelect.value='import';if(!imported.length&&!importedStatic.length)file.click();}});
  file.addEventListener('change',async()=>{const chosen=file.files?.[0],revision=mediaRevision,key=metadataKey,ownImport=++importRevision;if(!chosen)return;try{if(chosen.size>1_000_000)throw new Error('歌词文件需小于 1 MB');const text=await chosen.text();if(!opened||revision!==mediaRevision||ownImport!==importRevision||key!==metadataKey||key!==contentKey())return;const parsed=parseLrc(text),plain=parsed.length?[]:text.split(/\r?\n/).map(s=>s.trim().slice(0,500)).filter(Boolean).slice(0,1000);if(!parsed.length&&!plain.length)throw new Error('文件没有可显示的文字');imported=parsed;importedStatic=plain;importedName=chosen.name;sourceKind='import';sourceSelect.value='import';setLyrics(parsed,`本地文件 · ${chosen.name}${parsed.length?'':' · 静态文本，无时间轴'}`,plain);}catch(error){if(opened&&ownImport===importRevision)sourceNote.textContent=`导入失败：${(error as Error).message}`;}finally{if(ownImport===importRevision)file.value='';}});
  offset.addEventListener('input',syncLyrics);follow.addEventListener('click',()=>{following=true;follow.hidden=true;centerLine();});
  lyricWindow.addEventListener('wheel',()=>{following=false;follow.hidden=false;},{passive:true});lyricWindow.addEventListener('keydown',event=>{if(['ArrowUp','ArrowDown','PageUp','PageDown','Home','End'].includes(event.key)){following=false;follow.hidden=false;}});
  videoView.addEventListener('click',()=>switchView('video'));listenView.addEventListener('click',()=>switchView('listen'));
  tabs.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const next=event.key==='Home'?'video':event.key==='End'?'listen':view==='video'?'listen':'video';switchView(next);(next==='video'?videoView:listenView).focus();});
  function bind(){
    const nextFrame=findPlayer();
    const frameChanged=nextFrame!==frame;
    if(frameChanged){restoreStyles(viewStyles);restoreStyles();frame=nextFrame;lift();scheduleLayout();}
    const nextVideo=frame?.querySelector<Capturable>(videoSelector)||null;
    const videoChanged=nextVideo!==video;
    if(videoChanged){restoreStyles(viewStyles);mediaRevision++;mediaEvents?.abort();stopSpectrum();video=nextVideo;mediaEvents=new AbortController();if(video){for(const event of ['timeupdate','play','playing','canplay','pause','volumechange','ratechange','durationchange','loadedmetadata','seeking','emptied'])video.addEventListener(event,()=>{if(event==='emptied')stopSpectrum();sync();if(['play','playing','canplay'].includes(event))void startSpectrum();if(['canplay','loadedmetadata'].includes(event)&&sourceKind==='captions'&&!lyrics.length)readCaptions();},{signal:mediaEvents.signal});video.textTracks.addEventListener('change',()=>{if(sourceKind==='captions'&&!lyrics.length)readCaptions();},{signal:mediaEvents.signal});for(const track of video.querySelectorAll('track'))track.addEventListener('load',()=>{if(sourceKind==='captions')readCaptions();},{signal:mediaEvents.signal});}void startSpectrum();}
    const nextTitle=document.querySelector('.video-title')?.textContent?.trim()||'当前视频',nextAuthor=document.querySelector('.up-name, .up-info-container .name')?.textContent?.trim()||metadataAuthor||'B 站原生播放器';if(title.textContent!==nextTitle){title.textContent=nextTitle;title.title=nextTitle;}if(author.textContent!==nextAuthor)author.textContent=nextAuthor;play.disabled=!video;
    const key=contentKey();
    if(key!==metadataKey){metadataKey=key;mediaRevision++;if(picking)finishCrop(false);cancelCover();coverTried.clear();metadataCover=metadataAuthor='';author.textContent=document.querySelector('.up-name, .up-info-container .name')?.textContent?.trim()||'B 站原生播放器';coverReady=false;cover.hidden=true;coverNote.hidden=false;retryCover.hidden=true;coverNote.textContent='正在读取视频封面';imported=[];importedStatic=[];importedName='';crop={x:0,y:0,w:1,h:1};readCaptions();void requestMetadata();}
    else if(frameChanged||videoChanged)applyPresentation();
    loadCover();
    if(!frame)status.textContent='等待原生播放器加载…';sync();
  }
  function close(){if(!opened)return;if(picking)finishCrop(false);opened=false;document.documentElement.classList.remove('margin-listening-bg');onOpenChange?.(false);mediaRevision++;metadataAbort?.abort();cancelCover();themeObserver.disconnect();clearInterval(poll);cancelAnimationFrame(layoutFrame);layoutFrame=0;ro.disconnect();mediaEvents?.abort();stopSpectrum();restoreStyles(viewStyles);restoreStyles();document.documentElement.classList.remove('margin-listening-mode','margin-listening-input');frame=null;video=null;host.hidden=true;document.removeEventListener('keydown',onKey,true);returnFocus?.isConnected&&returnFocus.focus({preventScroll:true});}
  retryCover.addEventListener('click',()=>{cancelCover();coverTried.clear();loadCover();void requestMetadata();});
  function onKey(event:KeyboardEvent){
    if(!opened||document.fullscreenElement)return;
    if(spectrumWanted&&context?.state==='suspended')void context.resume().catch(()=>{});
    const origin=event.composedPath()[0];
    if(picking){if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();finishCrop(false);}else if(event.key==='Tab'){const nodes=[cropArea,...selectionRoot.querySelectorAll<HTMLElement>('button')],current=selectionRoot.activeElement;if(event.shiftKey&&current===nodes[0]){event.preventDefault();nodes.at(-1)?.focus();}else if(!event.shiftKey&&current===nodes.at(-1)){event.preventDefault();nodes[0].focus();}}return;}
    if(event.key==='Escape'&&origin instanceof HTMLSelectElement)return;
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close();}
    if(event.code==='Space'&&(origin===app||origin===host)){event.preventDefault();play.click();}
    if(event.key==='Tab'){
      const nodes=[...(frame?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),video[controls],[tabindex="0"]')||[]),...root.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select,[tabindex="0"]')].filter(el=>el.getClientRects().length&&getComputedStyle(el).visibility!=='hidden'&&getComputedStyle(el).opacity!=='0');
      const current=(document.activeElement?.shadowRoot?.activeElement||document.activeElement),first=nodes[0],last=nodes.at(-1);
      if(event.shiftKey&&current===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&current===last){event.preventDefault();first?.focus();}
    }
  }
  play.addEventListener('click',()=>{if(video)video.paused?void video.play().catch(()=>{status.textContent='播放暂不可用，请使用原生控制栏重试。';}):video.pause();});
  const seek=(time:number)=>{if(video&&Number.isFinite(video.duration))video.currentTime=Math.max(0,Math.min(video.duration,time));};
  rewind.addEventListener('click',()=>seek((video?.currentTime||0)-10));forward.addEventListener('click',()=>seek((video?.currentTime||0)+10));progress.addEventListener('input',()=>seek(Number(progress.value)));
  repeat.addEventListener('click',()=>{if(video){video.loop=!video.loop;sync();}});mute.addEventListener('click',()=>{if(video){video.muted=!video.muted;sync();}});volume.addEventListener('input',()=>{if(video){video.volume=Number(volume.value);video.muted=false;sync();}});
  theme.addEventListener('click',()=>{if(onThemeToggle)onThemeToggle();else{app.classList.toggle('fv-light');visual.refresh();drawSpectrum();}});spectrumButton.addEventListener('click',()=>{spectrumWanted=!spectrumWanted;spectrumLabel();if(spectrumWanted){status.textContent='原生视频与弹幕 · 播放时自动启用频谱';void startSpectrum();}else{stopSpectrum();status.textContent='原生视频与弹幕 · 频谱已关闭';}});back.addEventListener('click',close);
  dmComposer.addEventListener('click',()=>{if(view==='video'){frame?.querySelector<HTMLElement>('.bpx-player-sending-area input:not([type=checkbox]),.bpx-player-sending-area textarea')?.focus();return;}composeDm=!composeDm;dmComposer.setAttribute('aria-expanded',String(composeDm));dmComposer.setAttribute('aria-label',composeDm?'收起弹幕输入':'展开弹幕输入');applyPresentation();});
  const syncTheme=()=>{app.classList.toggle('fv-light',document.documentElement.dataset.marginTheme==='light');const accent=getComputedStyle(document.documentElement).getPropertyValue('--brand').trim();if(accent&&CSS.supports('color',accent))app.style.setProperty('--accent',accent);else app.style.removeProperty('--accent');visual.refresh();drawSpectrum();};
  const themeObserver=new MutationObserver(syncTheme);
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change',()=>{if(opened)sync();});document.addEventListener('margin:motion',()=>{if(opened)sync();});
  document.addEventListener('pointerdown',()=>{if(opened&&spectrumWanted&&context?.state==='suspended')void context.resume().catch(()=>{});},true);
  for(const el of [host,selectionHost])for(const event of ['keydown','keyup','keypress'])el.addEventListener(event,e=>e.stopPropagation());
  app.addEventListener('scroll',scheduleLayout,{passive:true});addEventListener('resize',()=>{scheduleLayout();drawSpectrum();},{passive:true});document.addEventListener('fullscreenchange',onFullscreen);document.addEventListener('visibilitychange',()=>{cancelAnimationFrame(spectrumFrame);spectrumFrame=0;if(opened&&!document.hidden)sync();});addEventListener('pagehide',close);
  return {open(){if(opened)return;if(document.fullscreenElement)return;returnFocus=(document.activeElement?.shadowRoot?.activeElement||document.activeElement) as HTMLElement;spectrumWanted=true;spectrumLabel();status.textContent='原生视频与弹幕 · 播放时自动启用频谱';opened=true;host.hidden=false;document.documentElement.classList.add('margin-listening-bg');onOpenChange?.(true);app.scrollTop=0;syncTheme();themeObserver.observe(document.documentElement,{attributes:true,attributeFilter:['data-margin-theme','style']});bind();for(const target of [stage,original,selectionStage])ro.observe(target);layout();drawSpectrum();back.focus();poll=window.setInterval(bind,1000);document.addEventListener('keydown',onKey,true);},close,state:()=>({opened,video,frame,spectrum:!!analyser,view,source:sourceKind,lines:lyrics.length,crop:{...crop},picking,visualizer:spectrumShape})};
}
