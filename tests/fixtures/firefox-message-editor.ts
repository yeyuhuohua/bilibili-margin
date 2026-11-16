import { messageDraftText } from '../../src/content/ui/message-editor';
import { createMessageComposer } from '../../src/content/ui/message-composer';

const host = document.createElement('section');
host.id = 'editor-extension-test';
document.body.append(host);
const root = host.attachShadow({mode:'open'});
const style = document.createElement('style');
style.textContent = '.wh-input{display:block;min-height:100px;padding:12px;border:1px solid #777;white-space:pre-wrap} .wh-draft-emote{width:20px;height:20px}';
const errors: string[] = [], events: unknown[] = [];
const result = document.createElement('pre'); result.id = 'editor-extension-report';
const composer = createMessageComposer({me:1,to:2,name:'测试联系人',csrf:()=>'',say:text=>errors.push(text),onSent:async()=>{}});
const input=composer.el.querySelector<HTMLElement>('.wh-input')!;
const editor={el:input,value:()=>messageDraftText(input)};
root.append(style, composer.el);document.body.append(result);
const paint = () => { result.textContent = JSON.stringify({text:editor.value(),events,errors}); };
addEventListener('error', e=>{errors.push(String(e.message));paint();});
for (const type of ['beforeinput','input','keydown','keyup']) editor.el.addEventListener(type,event=>{
  const e=event as InputEvent & KeyboardEvent;
  events.push({type, key:e.key, inputType:e.inputType,defaultPrevented:e.defaultPrevented});
  if(events.length>30)events.shift();queueMicrotask(paint);
});
paint();
