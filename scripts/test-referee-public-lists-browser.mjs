import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { createRequire } from 'node:module';
const { chromium, webkit } = createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');

async function main() {
 const { base } = JSON.parse(await fs.readFile(process.env.REFEREE_LIST_PREVIEW_FILE || '/tmp/nuaafa-referee-list-preview.json','utf8'));
 assert.equal(new URL(base).hostname,'127.0.0.1','Only an isolated local preview may be tested.');
 const out=process.env.REFEREE_LIST_EVIDENCE_DIR || '/tmp/nuaafa-referee-continuous-evidence'; await fs.mkdir(out,{recursive:true});
 const results=[]; const transportNotes=[];
 // Representative usable browser areas, not hardware resolutions or claimed macOS defaults.
 // Include compact and roomy windows for 13-, 15- and 16-inch MacBooks.
 const macbookSizes=[[1280,700],[1440,800],[1470,820],[1536,860],[1710,980],[1728,980],[1920,1000]];
 const sizes=[[360,640],[390,844],[430,932],[768,1024],[1024,768],[1280,700],[1366,768],[1440,800],[1440,900],[1470,820],[1536,860],[1710,980],[1728,980],[1728,1117],[1920,1000],[1920,1080],[2560,1440]];
 const engines=(process.env.REFEREE_LIST_BROWSER_ENGINES || 'chrome,webkit').split(',');
 assert(engines.length && engines.every(engine=>['chrome','webkit'].includes(engine)));
 for (const engine of engines) {
  const browser=await (engine==='chrome'?chromium.launch({channel:process.env.REFEREE_LIST_BROWSER_CHANNEL || 'chrome',headless:true}):webkit.launch({headless:true}));
  try {
   const context=await browser.newContext(); const page=await context.newPage();
   const errors=[], prefetchMessages=[], failedPrefetch=[];
   page.on('pageerror',error=>{
    if(engine==='webkit' && /^\/127\.0\.0\.1:\d+\/(?:association|participation|competitions\/arbitration|news|media|teams)\?_rsc=[^\s]+ due to access control checks\.$/.test(error.message)) prefetchMessages.push(error.message);
    else errors.push(error.message);
   });
   page.on('requestfailed',request=>{ if(request.url().includes('_rsc=')) failedPrefetch.push({url:request.url(),failure:request.failure()?.errorText}); });
   const settle=async()=>{
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    await page.waitForLoadState('networkidle');
   };
   const ids=()=>page.locator('article[data-match-id]').evaluateAll(nodes=>nodes.map(node=>node.dataset.matchId));
   const measure=()=>page.evaluate(()=>{
    const rows=[...document.querySelectorAll('article[data-match-id]')].map(element=>element.getBoundingClientRect());
    const header=document.querySelector('.site-header'); const box=header?.getBoundingClientRect();
    const sticky=header && ['fixed','sticky'].includes(getComputedStyle(header).position) && box.top<=0 ? box.bottom : 0;
    return {
     fullyVisible:rows.filter(row=>row.top>=sticky-1&&row.bottom<=innerHeight+1).length,
     partlyVisible:rows.filter(row=>row.bottom>sticky&&row.top<innerHeight).length,
     rowHeight:Math.round(rows[0]?.height||0), overflow:document.documentElement.scrollWidth>innerWidth,
    };
   });
   const drain=async(expected)=>{
    await page.getByRole('button',{name:'继续浏览',exact:true}).click();
    await page.waitForFunction(total=>document.querySelectorAll('article[data-match-id]').length===total,expected);
    assert.equal(await page.locator('article').count(),expected);
    assert.equal(new Set(await ids()).size,expected);
    await page.getByRole('status').filter({hasText:'已显示全部比赛'}).waitFor();
    assert.equal(await page.getByRole('button',{name:'继续浏览',exact:true}).count(),0);
    await settle();
   };
   for(const [width,height] of sizes) for(const kind of ['assignments','open-matches','history']) {
    await page.setViewportSize({width,height});
    await page.goto(`${base}/referees/${kind}`,{waitUntil:'networkidle'});
    const firstScreen=await measure(); assert.equal(firstScreen.overflow,false);
    const first=await ids(); assert.equal(first.length,3);
    // Measure a full screen devoted to the list separately from the first screen's header and filters.
    await page.locator('article').first().evaluate(element=>element.scrollIntoView({block:'start',behavior:'instant'}));
    await page.waitForLoadState('networkidle');
    const listScreen=await measure(); assert.equal(listScreen.overflow,false);
    const capture=[390,1440,2560].includes(width)||macbookSizes.some(([w,h])=>w===width&&h===height);
    if(capture) await page.screenshot({path:`${out}/${engine}-${kind}-${width}x${height}-list.png`});
    await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'}));
    if(capture) await page.screenshot({path:`${out}/${engine}-${kind}-${width}x${height}-entry.png`});
    assert.equal((await ids()).length,3,'Scrolling or resizing must not expand the initial three matches.');
    assert(await page.getByRole('button',{name:'继续浏览',exact:true}).isVisible());
    results.push({engine,kind,width,height,firstScreen,listScreen,loaded: (await ids()).length});
   }
   await fs.writeFile(`${out}/viewport-capacity.json`,JSON.stringify(results,null,2));
   console.log(`PASS ${engine}: ${sizes.length} viewport sizes × three routes measured, exactly three initial matches on every size, no scroll-triggered expansion or horizontal overflow.`);
   await page.setViewportSize({width:1440,height:900});
   for(const [kind,total] of [['assignments',53],['open-matches',51],['history',52]]) {
    await page.goto(`${base}/referees/${kind}`,{waitUntil:'networkidle'});
    const first=(await ids()).slice(0,3);
    await drain(total);
    assert.deepEqual((await ids()).slice(0,3),first);
   }
   // Recover a failed prefetch without losing the already rendered rows.
   await page.route('**/api/referees/public-list?**',route=>route.fulfill({status:503,json:{error:'Synthetic failure'}}));
   await page.goto(`${base}/referees/open-matches`,{waitUntil:'networkidle'});
   await page.getByRole('button',{name:'继续浏览',exact:true}).click();
   await page.getByRole('alert').filter({hasText:'加载失败'}).waitFor();
   assert.equal(await page.locator('article').count(),3);
   await page.unroute('**/api/referees/public-list?**');
   await page.getByRole('button',{name:'重试加载',exact:true}).click();
   await page.waitForFunction(()=>document.querySelectorAll('article').length>3);
   // Applied filters also carry through every subsequent automatic request.
   await page.getByLabel('赛事',{exact:true}).selectOption('women');
   await page.locator('form summary').click();
   await page.getByLabel('赛制',{exact:true}).selectOption('FUTSAL');
   await page.getByLabel('球队关键词',{exact:true}).fill('模拟女子');
   await Promise.all([page.waitForURL(url=>url.searchParams.get('competition')==='women'),page.getByRole('button',{name:'筛选',exact:true}).click()]);
   await page.waitForLoadState('networkidle');
   await drain(17);
   assert((await ids()).every(id=>id.startsWith('open-2-')));
   await page.getByRole('link',{name:'清除筛选',exact:true}).click();
   await page.waitForURL(`${base}/referees/open-matches`);
   await page.waitForFunction(()=>document.querySelector('select[name=competition]')?.value==='');
   assert((await ids()).includes('open-0-00'));
   await page.goto(`${base}/referees/assignments`,{waitUntil:'networkidle'});
   await page.locator('article details summary').first().press('Enter');
   await page.waitForFunction(()=>document.querySelector('article details')?.open);
   await page.locator('article a').first().click(); await page.waitForURL('**/print');
   assert(await page.getByRole('heading',{name:'裁判员选派单',exact:true}).isVisible());
   await page.goBack(); await page.waitForLoadState('networkidle');
   await page.goto(`${base}/referees/history?q=does-not-exist`,{waitUntil:'networkidle'});
   assert.equal(await page.locator('article').count(),0);
   await page.goto(`${base}/referees/history?from=2026-02-30`,{waitUntil:'networkidle'});
   assert(await page.getByRole('form',{name:'筛选比赛'}).getByRole('alert').isVisible());
   await context.addCookies([{name:'nuaa_referee_member',value:'synthetic-list-session-token',url:base}]);
   await page.setViewportSize({width:390,height:844});
   await page.goto(`${base}/referees/open-matches?competition=five`,{waitUntil:'networkidle'});
   assert(await page.getByRole('heading',{name:'可报名场次 / 执裁意向',exact:true}).isVisible());
   const memberRows=page.locator('article[data-current-match-id]');
   assert.equal(await memberRows.count(),17,'Signed-in referees see all current matches immediately.');
   const memberIds=await memberRows.evaluateAll(nodes=>nodes.map(node=>node.dataset.currentMatchId));
   assert.equal(new Set(memberIds).size,17);
   assert(memberIds.every(id=>id.startsWith('open-0-')));
   assert.equal(await page.getByRole('button',{name:'继续浏览',exact:true}).count(),0);
   assert(await page.getByText('已显示当前筛选下的全部比赛 · 开放报名优先，按开赛时间排列',{exact:true}).isVisible());
   assert.equal((await measure()).overflow,false);
   await page.waitForLoadState('networkidle'); assert.deepEqual(errors,[]);
   if(prefetchMessages.length) {
    const directChecks=[];
    for(const route of ['/association','/participation','/competitions/arbitration','/news','/media','/teams']) {
     const response=await context.request.get(base+route); assert.equal(response.status(),200); directChecks.push({route,status:response.status()});
    }
    transportNotes.push({engine,messages:prefetchMessages,failedPrefetch,directChecks});
    await fs.writeFile(`${out}/transport-notes.json`,JSON.stringify(transportNotes,null,2));
    console.log(`NOTE ${engine}: ${prefetchMessages.length} existing navigation RSC-prefetch transport diagnostics recorded separately; the corresponding routes return HTTP 200. Application exceptions remain checked strictly.`);
   }
   await context.close();
   const fallback=await browser.newContext(); await fallback.addInitScript(()=>{window.IntersectionObserver=undefined;});
   const simple=await fallback.newPage();
   await simple.goto(`${base}/referees/open-matches`,{waitUntil:'networkidle'});
   assert.equal(await simple.locator('article').count(),3);
   await simple.getByRole('button',{name:'继续浏览',exact:true}).click();
   await simple.waitForFunction(()=>document.querySelectorAll('article').length===51);
   await fallback.close();
   const noScript=await browser.newContext({javaScriptEnabled:false}); const plain=await noScript.newPage();
   await plain.goto(`${base}/referees/open-matches`); assert.equal(await plain.locator('article').count(),3);
   const before=await plain.locator('article').first().getAttribute('data-match-id');
   await plain.getByRole('link',{name:'继续查看比赛 →',exact:true}).click();
   assert.equal(await plain.locator('article').count(),12);
   assert.notEqual(await plain.locator('article').first().getAttribute('data-match-id'),before);
   await noScript.close();
   console.log(`PASS ${engine}: all 53/51/52 records expanded by one click without further interaction; no duplicates; filters through to the end; retry; details/print/back; member mobile; no-observer and no-JavaScript fallbacks.`);
  } finally {await browser.close();}
 }
 await fs.writeFile(`${out}/viewport-capacity.json`,JSON.stringify(results,null,2));
 console.log('EVIDENCE '+out);
}
main().catch(error=>{console.error(error);process.exitCode=1;});
