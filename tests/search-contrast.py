"""Loaded-extension contrast regression, using the native filter structure."""
import json
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT.parent / 'bilibili-margin-search-lite-preview-20261109/.python-deps'))
from playwright.sync_api import sync_playwright

OUT = ROOT / os.environ.get('CONTRAST_OUT', 'delivery/search-contrast')
OUT.mkdir(parents=True, exist_ok=True)
EXT = str(Path(os.environ.get('SMOKE_EXT', ROOT / 'dist')).resolve())
FIXTURE = '''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><style>
body{margin:0}.search-tabs,.search-conditions,.search-page-video{max-width:1280px;margin:24px auto}
.search-tabs{display:flex;gap:24px;padding:12px}.search-condition-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:12px 0}
.vui_button{height:32px}.date-trigger{background:#222225;color:#606065;padding:6px 32px;border-radius:6px}
.search-date-picker__trigger{display:flex;align-items:center;gap:8px}.search-channel-item{color:#616166}
</style></head><body><div id="app"><div class="search-tabs"><span class="vui_tabs--nav-item">综合</span><span class="vui_tabs--nav-item vui_tabs--nav-item-active">视频</span></div>
<div class="search-conditions"><div class="conditions-order"><div class="search-condition-row"><button class="vui_button vui_button--active">综合排序</button><button class="vui_button ordinary">最多播放</button><button class="vui_button">最新发布</button></div></div>
<div class="more-conditions"><div class="search-condition-row"><button class="vui_button vui_button--active">全部日期</button><button class="vui_button">最近一天</button><button class="vui_button">最近一周</button><div class="search-date-picker__trigger"><div class="date-trigger start">开始日期</div><span class="separator">至</span><div class="date-trigger end">结束日期</div></div></div>
<div class="search-condition-row"><button class="vui_button vui_button--active">全部时长</button><button class="vui_button">10分钟以下</button><button class="vui_button">10–30分钟</button><div class="search-channel-item" style="color:#616166">分区筛选功能升级中，敬请期待</div></div></div></div>
<div class="search-content"><div class="search-page-video"><div class="video-list"><div class="video-list-item"><div class="bili-video-card"><a href="https://www.bilibili.com/video/BV1kuxM6bE2A/"><h3 class="bili-video-card__info--tit">普通视频标题</h3></a></div></div></div></div></div></div></body></html>'''

# Composite actual computed background colors from root to text; no assumed tint.
MEASURE = '''selector => {
 const el=document.querySelector(selector), canvas=document.createElement('canvas');
 canvas.width=canvas.height=1; const ctx=canvas.getContext('2d',{willReadFrequently:true});
 const rgba=color=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data].map((v,i)=>i===3?v/255:v/255)};
 let bg=[1,1,1]; const ancestors=[]; for(let n=el;n;n=n.parentElement) ancestors.push(n);
 for(const n of ancestors.reverse()){const c=rgba(getComputedStyle(n).backgroundColor);bg=bg.map((v,i)=>c[i]*c[3]+v*(1-c[3]));}
 const s=getComputedStyle(el),c=rgba(s.color); const fg=bg.map((v,i)=>c[i]*c[3]+v*(1-c[3]));
 const luminance=rgb=>rgb.map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
 const a=luminance(fg),b=luminance(bg);
 return {selector,text:el.textContent.trim(),color:s.color,background:s.backgroundColor,fontSize:s.fontSize,contrast:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
}'''

results = []
with sync_playwright() as p:
    context = p.chromium.launch_persistent_context(tempfile.mkdtemp(prefix='margin-search-contrast-'),
        executable_path=r'C:\Users\asus\AppData\Local\ms-playwright\chromium-1248\chrome-win64\chrome.exe',
        headless=True, args=[f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'],
        viewport={'width':1440,'height':900}, locale='zh-CN')
    try:
        def route_request(route):
            if route.request.resource_type == 'document':
                route.fulfill(content_type='text/html; charset=utf-8', body=FIXTURE)
            elif 'api.bilibili.com' in route.request.url:
                route.fulfill(content_type='application/json', body='{"code":0,"data":{}}')
            else:
                route.fulfill(status=204, body='')
        context.route('https://**/*', route_request)
        worker = context.service_workers[0] if context.service_workers else context.wait_for_event('serviceworker')
        worker.evaluate("() => chrome.storage.local.set({'margin:settings':{intro:false,theme:'light',bg:{mode:'off'}}})")
        page = context.new_page()
        page.goto('https://search.bilibili.com/video?keyword=测试', wait_until='domcontentloaded')
        page.locator('#margin-search-exact').wait_for()
        page.locator('#margin-search-exact input').check()
        for theme in ['light','dark']:
            worker.evaluate("theme => chrome.storage.local.set({'margin:settings':{intro:false,theme,bg:{mode:'off'}}})", theme)
            page.wait_for_function('theme => document.documentElement.dataset.marginTheme === theme', arg=theme)
            for wallpaper in ['#fafafa','#090909']:
                page.evaluate("color => {document.documentElement.classList.add('margin-has-bg');document.body.style.setProperty('background',color,'important');document.documentElement.style.setProperty('background',color,'important')}", wallpaper)
                rows = [page.evaluate(MEASURE, selector) for selector in [
                    '#margin-search-exact label', '#margin-search-exact-status', '.search-conditions .ordinary',
                    '.date-trigger.start', '.search-channel-item', '.search-tabs .vui_tabs--nav-item']]
                results.append({'theme':theme,'wallpaper':wallpaper,'measurements':rows})
                page.screenshot(path=str(OUT/f'{theme}-{wallpaper[1:]}.png'))
        page.set_viewport_size({'width':390,'height':844})
        overflow = page.evaluate('document.documentElement.scrollWidth > innerWidth')
        report = {'cases':results,'narrowHorizontalOverflow':overflow,
            'scope':'Loaded extension with native-shaped filter fixture and computed alpha compositing over bright/dark backgrounds. Not the user profile.'}
        (OUT/'report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    finally:
        context.close()
failed=[{'theme':r['theme'],'wallpaper':r['wallpaper'],'selector':m['selector'],'contrast':round(m['contrast'],2)} for r in results for m in r['measurements'] if m['contrast']<4.5]
print(json.dumps({'measurements':sum(len(r['measurements']) for r in results),'failed':failed,'narrowHorizontalOverflow':overflow},ensure_ascii=False))
assert not failed, 'Search controls must retain at least 4.5:1 text contrast'
assert not overflow, 'Search controls must not cause horizontal overflow'
