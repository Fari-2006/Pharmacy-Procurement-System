const {chromium}=require('@playwright/test');
const fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const session=JSON.parse(fs.readFileSync(process.env.TEST_SESSION||'/tmp/pharmacy-test-session.json','utf8'));
 const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 for(const role of ['supplier','pharmacist','admin','cashier']){
  await page.goto(session.base);await page.evaluate(({token,role})=>{localStorage.setItem('pharma_token',token);localStorage.setItem('pharma_user',JSON.stringify({id:'test',role,name:role+' Test'}))},{token:session.tokens[role],role});await page.reload();
  await page.waitForTimeout(700);
  const start=role==='supplier'?'portal':role==='cashier'?'pos':'dashboard';assert(await page.locator('#view-'+start).evaluate(n=>n.classList.contains('active')),role+' default view');
  const views=role==='supplier'?['orders','tracking','returns','invoices','notifications','company','help']:role==='pharmacist'?['orders','reorder','receiving','returns','invoices','performance']:role==='admin'?['settings','audit','users']:['inventory','sales','pos'];
  for(const v of views){await page.locator(`.nav-item[data-view=${v}]`).click();await page.waitForTimeout(400);assert(await page.locator('#view-'+v).evaluate(n=>n.classList.contains('active')),v+' navigation');assert(!(await page.locator('#view-'+v).innerText()).includes('Loading…'),v+' loaded');}
  if(role==='pharmacist'){
   await page.locator('.nav-item[data-view=orders]').click();await page.getByRole('button',{name:'Create Purchase Order',exact:true}).click();await page.waitForTimeout(400);assert(await page.locator('#poForm').isVisible());
   await page.locator('#poForm [name=expectedDeliveryDate]').fill('2030-01-01');
   await page.locator('#poForm [name=quantity]').fill('2');await page.locator('#poForm [name=unitPrice]').fill('10');
   await page.locator('#poForm [type=submit]').click();await page.locator('#discussionForm').waitFor({state:'visible'});
   assert((await page.locator('dialog').innerText()).includes('Submitted'));await page.locator('dialog').getByRole('button',{name:'Close',exact:true}).click();
  }
  if(role==='supplier'){
   await page.locator('.nav-item[data-view=orders]').click();await page.locator('#view-orders [data-order]').first().click();await page.waitForTimeout(500);assert(await page.locator('#discussionForm').isVisible());await page.locator('dialog').getByRole('button',{name:'Close',exact:true}).click();
   await page.locator('.nav-item[data-view=portal]').click();await page.waitForTimeout(300);await page.screenshot({path:'/tmp/pharmacy-supplier-dashboard.png',fullPage:true});
  }
  assert.equal(errors.length,0,errors.join('\n'));console.log('PASS browser navigation and forms:',role);
 }
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
