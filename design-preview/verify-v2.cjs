const {chromium}=require('/data/.npm/_npx/420ff84f11983ee5/node_modules/playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 const p=await browser.newPage(); const errors=[];p.on('pageerror',e=>errors.push(e.message));
 const base='file://'+__dirname+'/'+(process.env.STANDALONE?'private-family-preview.html':'index.html');
 const visibleAboveFold=async selector=>p.locator(selector).first().evaluate(el=>{const r=el.getBoundingClientRect();const nav=document.querySelector('.mobile-nav');const n=getComputedStyle(nav).display==='none'?innerHeight:nav.getBoundingClientRect().top;return r.top>=0&&r.bottom<=n});
 for(const [width,height] of [[1440,900],[1280,720],[834,1112],[390,844],[375,667],[320,568]]){
  await p.setViewportSize({width,height});await p.goto(base);
  assert.equal(await p.locator('.hero').count(),0);
  assert(await visibleAboveFold('.quick-grid'),'main areas above fold '+width);
  assert(await visibleAboveFold('.ai-home'),'AI panel above fold '+width);
  if(width>=375)assert(await visibleAboveFold('.recent-panel .compact-row:first-child'),'recent item above fold '+width);
  assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'home overflow '+width);
  await p.screenshot({path:__dirname+`/v2-home-${width}.png`});
  const nav=width<=720?'.mobile-nav':'.nav';
  for(const label of ['Family AI','Memories','Family','My Vault','Home']){
   await p.locator(nav).getByRole('button',{name:label,exact:true}).click();
   assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'overflow '+label+' '+width);
   if(label==='Family AI'){
    assert(await visibleAboveFold('.agent-composer'),'AI composer above fold '+width);
    await p.screenshot({path:__dirname+`/v2-ai-${width}.png`});
   }
  }
  console.log('PASS '+width+'x'+height+' main areas + AI above fold, navigation, overflow, AI composer'+(width>=375?', recent memory above fold':''));
 }
 await p.setViewportSize({width:390,height:844});await p.goto(base);
 await p.locator('#home-ai-question').fill('Find a beach memory');
 await p.getByRole('button',{name:'Open question in Family AI'}).click();
 assert.equal(await p.locator('#agent-question').inputValue(),'Find a beach memory');
 await p.getByRole('button',{name:'Preview question',exact:true}).click();
 assert(await p.getByText('Question previewed, not sent.').isVisible());
 await p.getByRole('button',{name:'Access',exact:true}).click();
 assert.equal(await p.getByRole('checkbox',{name:/My Vault/}).isChecked(),false);
 await p.getByRole('checkbox',{name:/My Vault/}).check();
 await p.getByRole('button',{name:'Apply to preview'}).click();
 assert((await p.locator('.scope-summary').innerText()).includes('My Vault'));
 await p.locator('[data-agent="Family storyteller"]').click();
 assert((await p.locator('.agent-topline').innerText()).includes('Family storyteller'));
 await p.locator('.mobile-nav').getByRole('button',{name:'Home',exact:true}).click();
 await p.locator('[data-item="1"]').click();await p.keyboard.press('Escape');
 assert(!await p.locator('dialog').isVisible());
 await p.locator('.mobile-nav').getByRole('button',{name:'My Vault',exact:true}).click();
 await p.locator('[data-add]').click();assert.equal(await p.locator('#draft-scope').inputValue(),'Private');
 await p.locator('#draft-title').fill('Prototype test note');await p.locator('#draft-note').fill('A note saved only in this preview.');
 await p.getByRole('button',{name:'Review memory'}).click();await p.getByRole('button',{name:'Back',exact:true}).click();
 assert.equal(await p.locator('#draft-title').inputValue(),'Prototype test note');
 await p.getByRole('button',{name:'Review memory'}).click();await p.getByRole('button',{name:'Add to preview',exact:true}).click();
 await p.getByRole('button',{name:'View collection',exact:true}).click();
 assert(await p.getByRole('heading',{name:'Prototype test note'}).isVisible());
 await p.locator('.mobile-nav').getByRole('button',{name:'Memories',exact:true}).click();
 assert.equal(await p.getByRole('heading',{name:'Prototype test note'}).count(),0);
 await p.locator('#search').fill('zzzz');assert(await p.getByRole('heading',{name:'No memories found'}).isVisible());
 await p.getByRole('button',{name:'Clear filters'}).click();await p.getByRole('button',{name:'Timeline',exact:true}).click();assert(await p.locator('.timeline').isVisible());
 await p.reload();assert.deepEqual(errors,[]);
 console.log('PASS home-to-AI question, truthful preview reply, vault opt-in, agent selection, detail/Escape, capture/private default/review/back/save, collection separation, search recovery, timeline; zero JS errors');
 await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
