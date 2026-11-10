import { draftValue, selectDraftText } from './message-draft.mjs';
// All traffic is mocked; no files or messages are sent to real Bilibili accounts.
import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { installMocks } from './mocks.mjs';

const ext=resolve(process.env.SMOKE_EXT||'dist'),out=resolve(process.env.SMOKE_OUT||'tests/artifacts/message-media');mkdirSync(out,{recursive:true});
const ctx=await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(),'margin-media-')),{...(process.env.CHROMIUM_PATH?{executablePath:process.env.CHROMIUM_PATH}:{channel:'chromium'}),headless:true,args:['--headless=new','--no-sandbox',`--disable-extensions-except=${ext}`,`--load-extension=${ext}`],viewport:{width:1440,height:1000},locale:'zh-CN'});
const results=[],sent=[],attempts=[];let uploads=0,emojiLoads=0,failUpload=false,failImage=false,failText=false,releaseUpload,holdHistory=false,releaseHistory;
let failImageAt = 0, holdSend = false, releaseSend;
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jC1cAAAAASUVORK5CYII=','base64');
const file={name:'test.png',mimeType:'image/png',buffer:png};
const emotes=[{text:'[tv_doge]',uri:'https://i0.hdslb.com/bfs/emote/doge.png',gif_url:'https://i0.hdslb.com/bfs/emote/doge.gif'}];
const page=ctx.pages()[0];const errors=[];page.on('pageerror',e=>errors.push(e.message));
async function json(route,body){await route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':route.request().headers().origin||'https://message.bilibili.com','access-control-allow-credentials':'true'},body:JSON.stringify(body)});}
async function check(name,fn){await fn();results.push(name);console.log('PASS '+name);}
try{
  await installMocks(ctx);
  await ctx.route('**/x/emote/user/panel/web?*',async route=>{emojiLoads++;await json(route,{code:0,data:{packages:[{id:1,text:'小电视',emote:emotes.map(e=>({text:e.text,url:e.gif_url,flags:{unlocked:true}}))},{id:2,text:'颜文字',emote:[{text:'[开心]',url:'https://i0.hdslb.com/happy.png'}]}]}});});
  await ctx.route('**/fetch_session_msgs?*',async route=>{
    const talker=Number(new URL(route.request().url()).searchParams.get('talker_id'));
    const body={code:0,data:{e_infos:emotes,messages:sent.filter(m=>m.to===talker).map((m,i)=>({sender_uid:m.from,msg_type:m.type,content:JSON.stringify(m.content),timestamp:Math.floor(Date.now()/1000),msg_key:String(i+1),msg_seqno:i+1})).reverse()}};
    if(holdHistory){holdHistory=false;await new Promise(r=>{releaseHistory=r;});}
    return json(route,body);
  });
  await ctx.route('**/x/dynamic/feed/draw/upload_bfs',async route=>{
    uploads++;const raw=route.request().postDataBuffer().toString();assert(raw.includes('name="file_up"')&&raw.includes('name="biz"')&&raw.includes('\r\nim\r\n'),'upload form mismatch');
    if(releaseUpload!==undefined)await new Promise(r=>{releaseUpload=r;});
    const filename = raw.match(/filename="([^"]+)"/)?.[1] || 'test.png';
    await json(route,failUpload?{code:-1,message:'模拟上传失败'}:{code:0,data:{image_url:'https://message.biliimg.com/bfs/im_new/' + encodeURIComponent(filename),image_width:1,image_height:1,img_size:1}}).catch(()=>{});
  });
  await ctx.route('**/web_im/v1/web_im/send_msg',async route=>{
    const b=new URLSearchParams(route.request().postData());const m={to:Number(b.get('msg[receiver_id]')),from:Number(b.get('msg[sender_uid]')),type:Number(b.get('msg[msg_type]')),face:b.get('msg[new_face_version]'),content:JSON.parse(b.get('msg[content]'))};attempts.push(m);
    if(m.type===1&&failText||m.type===2&&(failImage||attempts.filter(x=>x.type===2).length===failImageAt))return json(route,{code:-1,message:'模拟发送失败'});
    sent.push(m);
    if (holdSend) { holdSend = false; await new Promise(resolve => { releaseSend = resolve; }); }
    await json(route,{code:0,data:{msg_key:String(sent.length)}});
  });
  const sw=ctx.serviceWorkers()[0]||await ctx.waitForEvent('serviceworker');await sw.evaluate(()=>chrome.storage.local.set({'margin:settings':{theme:'dark',intro:false}}));
  await ctx.addInitScript(()=>sessionStorage.setItem('margin:intro-played','1'));
  await page.goto('https://message.bilibili.com/#/whisper',{waitUntil:'domcontentloaded'});
  const sessions=page.locator('#margin-root .wh-s');await sessions.first().click();
  const root='#margin-root',input=page.locator(`${root} .wh-input`),send=page.locator(`${root} .wh-send`),pick=page.locator(`${root} input[type=file]`),panel=page.locator(`${root} .wh-emoji-panel`),attachment=page.locator(`${root} .wh-attachment`);
  await input.waitFor();
  await check('lazy Bilibili emoji picker, insertion at selection and keyboard dismissal',async()=>{
    assert.equal(emojiLoads,0);assert(await send.isDisabled());
    await input.fill('abc');await selectDraftText(input,1,2);
    await page.locator(`${root} [aria-label="选择表情"]`).click();await panel.getByRole('button',{name:'[tv_doge]',exact:true}).click();
    assert.equal(await draftValue(input),'a[tv_doge]c');assert.equal(await input.locator('img[alt="[tv_doge]"]').count(),1);assert.equal(emojiLoads,1);
    await page.locator(`${root} [aria-label="选择表情"]`).click();await panel.getByRole('searchbox').fill('不存在');assert(await panel.getByText('没有找到表情').isVisible());
    await page.keyboard.press('Escape');assert(await panel.isHidden());assert(await page.locator(`${root} [aria-label="选择表情"]`).evaluate(e=>e.getRootNode().activeElement===e));
    await page.locator(`${root} [aria-label="选择表情"]`).click();await panel.getByRole('tab',{name:'颜文字'}).click();assert(await panel.getByRole('button',{name:'[开心]',exact:true}).isVisible());await page.keyboard.press('Escape');assert.equal(emojiLoads,1);
  });
  await check('failed text keeps draft; successful native emoji renders original GIF',async()=>{
    failText=true;await send.click();await page.waitForTimeout(200);assert.equal(await draftValue(input),'a[tv_doge]c');assert.equal(sent.length,0);
    failText=false;await send.click();await page.waitForFunction(()=>document.getElementById('margin-root').shadowRoot.querySelector('.wh-input').textContent==='');
    await page.locator(`${root} .wh-inline-emote`).waitFor();assert((await page.locator(`${root} .wh-inline-emote`).getAttribute('src')).endsWith('.gif'));assert.equal(sent[0].face,'1');
  });
  await check('attachment preview/remove never uploads before send',async()=>{
    await pick.setInputFiles(file);assert(await attachment.isVisible());assert.equal(uploads,0);await page.locator(`${root} [aria-label="移除图片"]`).click();assert(await attachment.isHidden());assert.equal(uploads,0);
    await pick.setInputFiles({name:'bad.html',mimeType:'text/html',buffer:Buffer.from('bad')});assert(await attachment.isHidden());
    await pick.setInputFiles(file);await page.screenshot({path:join(out,'message-attachment-dark.png')});
  });
  await check('upload failure and image-send failure preserve attachment; retry reuses upload',async()=>{
    failUpload=true;await send.click();await page.waitForTimeout(200);assert(await attachment.isVisible());assert.equal(sent.length,1);
    failUpload=false;failImage=true;await send.click();await page.waitForTimeout(200);assert(await attachment.isVisible());const uploaded=uploads;
    failImage=false;await send.click();await page.waitForFunction(()=>document.getElementById('margin-root').shadowRoot.querySelector('.wh-attachment').hidden);assert.equal(uploads,uploaded);assert.equal(sent.at(-1).type,2);assert.equal(sent.at(-1).content.width,1);assert.equal(sent.at(-1).content.original,1);
    await page.locator(`${root} .wh-mimg`).last().click();await page.locator(`${root} .lb-img`).waitFor();await page.waitForFunction(()=>document.getElementById('margin-root').shadowRoot.querySelector('.lb-img')?.naturalWidth>0);await page.keyboard.press('Escape');await page.locator(`${root} .lb`).waitFor({state:'detached'});
  });
  await check('partial image/text success keeps only unsent text for retry',async()=>{
    await pick.setInputFiles(file);await input.fill('图片说明');failText=true;const n=sent.length;
    await send.click();await page.waitForFunction(()=>document.getElementById('margin-root').shadowRoot.querySelector('.wh-attachment').hidden);await page.waitForTimeout(100);
    assert.equal(sent.length,n+1);assert.equal(await draftValue(input),'图片说明');assert(await attachment.isHidden());const uploaded=uploads;
    failText=false;await send.click();await page.waitForFunction(()=>document.getElementById('margin-root').shadowRoot.querySelector('.wh-input').textContent==='');assert.equal(sent.length,n+2);assert.equal(uploads,uploaded);
  });
  await check('multiple images keep order and retry only the failed remainder', async () => {
    const files = ['a.png', 'b.png', 'c.png'].map(name => ({ ...file, name }));
    await pick.setInputFiles(files);
    assert.equal(await attachment.locator('.wh-attachment-item').count(), 3);
    await input.fill('三张图的说明');
    const before = sent.length;
    failImageAt = attempts.filter(x => x.type === 2).length + 2;
    await send.click();
    await page.waitForFunction(() => !document.getElementById('margin-root').shadowRoot.querySelector('.wh-send').disabled);
    assert.equal(sent.length, before + 1);
    assert(sent.at(-1).content.url.endsWith('/a.png'));
    assert.equal(await attachment.locator('.wh-attachment-item').count(), 2);
    assert.equal(await draftValue(input), '三张图的说明');
    const uploaded = uploads;
    failImageAt = 0;
    await send.click();
    await page.waitForFunction(() => document.getElementById('margin-root').shadowRoot.querySelector('.wh-attachment').hidden);
    await page.waitForFunction(() => document.getElementById('margin-root').shadowRoot.querySelector('.wh-input').textContent === '');
    assert.equal(uploads, uploaded + 1);
    assert.deepEqual(sent.slice(before).map(x => x.type === 2 ? x.content.url.split('/').pop() : x.content.content), ['a.png', 'b.png', 'c.png', '三张图的说明']);
  });
  await check('paste and drop append multiple images and allow individual removal', async () => {
    for (const event of ['paste', 'drop']) {
      await input.evaluate((input, { event, bytes }) => {
        const transfer = new DataTransfer();
        for (const name of ['first.png', 'second.png']) transfer.items.add(new File([new Uint8Array(bytes)], name, { type: 'image/png' }));
        input.dispatchEvent(event === 'paste' ? new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }) : new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true }));
      }, { event, bytes: [...png] });
    }
    assert.equal(await attachment.locator('.wh-attachment-item').count(), 4);
    await attachment.getByRole('button', { name: '移除图片', exact: true }).nth(1).click();
    assert.equal(await attachment.locator('.wh-attachment-item').count(), 3);
    await page.screenshot({ path: join(out, 'message-multiple-images.png') });
    while (await attachment.locator('.wh-attachment-item').count()) await attachment.getByRole('button', { name: '移除图片', exact: true }).first().click();
  });
  await check('switching conversations after an in-flight send cancels remaining images', async () => {
    await pick.setInputFiles(['first.png', 'second.png'].map(name => ({ ...file, name })));
    const before = sent.length, uploaded = uploads;
    holdSend = true;
    await send.click();
    const deadline = Date.now() + 5000;
    while (!releaseSend && Date.now() < deadline) await page.waitForTimeout(20);
    assert(releaseSend, 'held send did not start');
    await sessions.nth(1).click();
    releaseSend(); releaseSend = undefined;
    await page.waitForTimeout(250);
    assert.equal(sent.length, before + 1);
    assert.equal(uploads, uploaded + 1);
    await sessions.first().click();
    await input.waitFor();
  });
  await check('switching conversations cancels pending upload before any message is sent',async()=>{
    await pick.setInputFiles(file);releaseUpload=null;const n=sent.length;await send.click();await page.waitForTimeout(100);
    await sessions.nth(1).click();await input.waitFor();releaseUpload?.();releaseUpload=undefined;await page.waitForTimeout(200);assert.equal(sent.length,n);assert(await attachment.isHidden());
  });
  await check('slow initial history cannot overwrite a newly sent message',async()=>{
    holdHistory=true;await sessions.first().click();await input.waitFor();await input.fill('历史加载期间的新消息');await send.click();
    await page.locator(`${root} .wh-log`).getByText('历史加载期间的新消息',{exact:true}).waitFor();releaseHistory();await page.waitForTimeout(200);
    assert(await page.locator(`${root} .wh-log`).getByText('历史加载期间的新消息',{exact:true}).isVisible());
  });
  await check('light theme and emoji panel fit the viewport',async()=>{
    await page.setViewportSize({width:1280,height:800});await page.locator(`${root} [aria-label^="切换到"]`).click();
    await page.locator(`${root} [aria-label="选择表情"]`).click();await panel.getByRole('button',{name:'[tv_doge]',exact:true}).waitFor();
    const r=await panel.boundingBox();assert(r.x>=0&&r.y>=0&&r.x+r.width<=1281&&r.y+r.height<=801);await page.screenshot({path:join(out,'message-emojis-light.png')});
  });
  await check('rapid picker toggles cancel entrance; reduced motion opens immediately',async()=>{
    await page.keyboard.press('Escape');
    const emoji=page.locator(`${root} [aria-label="选择表情"]`);
    await emoji.evaluate(e=>{for(let i=0;i<7;i++)e.click();});
    assert(await panel.isVisible());assert.equal(await emoji.getAttribute('aria-expanded'),'true');
    await page.keyboard.press('Escape');assert(await panel.isHidden());
    assert.equal(await panel.evaluate(e=>e.getAnimations().length),0);
    await page.emulateMedia({reducedMotion:'reduce'});
    await emoji.click();assert(await panel.isVisible());assert.equal(await panel.evaluate(e=>e.getAnimations().length),0);
    await pick.setInputFiles(file);assert.equal(await attachment.evaluate(e=>e.getAnimations().length),0);
    await page.keyboard.press('Escape');await page.emulateMedia({reducedMotion:'no-preference'});
  });
  await check('message tools use local IconMCP outlines with accessible names',async()=>{
    for(const label of ['添加图片','选择表情','移除图片']){
      const svg=page.locator(`${root} [aria-label="${label}"] svg`);
      assert.equal(await svg.getAttribute('data-icon-source'),'IconMCP');
      assert.equal(await svg.getAttribute('viewBox'),'0 0 24 24');
      assert.equal(await svg.getAttribute('aria-hidden'),'true');
      assert.equal(await svg.getAttribute('focusable'),'false');
    }
  });
  assert.deepEqual(errors,[]);
}finally{writeFileSync(join(out,'results.json'),JSON.stringify({results,sent,attempts,uploads,errors,scope:'offline mocked requests only'},null,2));await ctx.close();}
