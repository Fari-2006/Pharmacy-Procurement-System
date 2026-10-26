const {chromium}=require('@playwright/test');
const fs=require('node:fs'),assert=require('node:assert/strict');
(async()=>{
 const session=JSON.parse(fs.readFileSync(process.env.TEST_SESSION||'/tmp/pharmacy-test-session.json','utf8'));
 const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 try{
 const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 // Public pages: real navigation, validation, registration, approval and login.
 await page.goto(session.base);
 assert.equal(await page.locator('h1').count(),1);
 assert((await page.locator('h1').innerText()).includes('Every step connected.'));
 assert.equal(await page.locator('.app-container').count(),0);
 await page.getByRole('navigation').getByRole('link',{name:'Register',exact:true}).click();
 await page.locator('#name').fill('New Cashier');await page.locator('#email').fill('new.cashier@test.com');
 await page.locator('#role').selectOption('cashier');await page.locator('#password').fill('NewPass@123');await page.locator('#confirmPassword').fill('Different@123');
 await page.getByRole('button',{name:'Submit registration'}).click();assert((await page.locator('#accessMessage').innerText()).includes('Passwords do not match'));
 await page.locator('#confirmPassword').fill('NewPass@123');await page.getByRole('button',{name:'Submit registration'}).click();await page.locator('#pageRegisterForm').waitFor({state:'hidden'});
 assert((await page.locator('#accessMessage').innerText()).includes('administrator will review'));
 await page.getByRole('navigation').getByRole('link',{name:'Login',exact:true}).click();
 await page.locator('#email').fill('new.cashier@test.com');await page.locator('#password').fill('NewPass@123');await page.locator('#pageLoginForm [type=submit]').click();
 await page.waitForFunction(()=>document.getElementById('accessMessage').textContent.includes('pending'));
 const users=await page.request.get(session.base+'/api/users',{headers:{Authorization:'Bearer '+session.tokens.admin}});const newUser=(await users.json()).users.find(u=>u.email==='new.cashier@test.com');
 assert(newUser&&!newUser.isActive);
 const activated=await page.request.put(session.base+'/api/users/'+newUser._id,{headers:{Authorization:'Bearer '+session.tokens.admin},data:{isActive:true}});assert.equal(activated.status(),200);
 await page.locator('#pageLoginForm [type=submit]').click();await page.waitForURL('**/app');await page.locator('#view-pos.active').waitFor();
 await page.locator('#logoutBtn').click();await page.waitForURL('**/login?loggedOut=1');assert.equal(await page.evaluate(()=>localStorage.getItem('pharma_token')),null);
 await page.goto(session.base+'/app');await page.waitForURL('**/login');assert.equal(await page.locator('.app-container').count(),0);
 await page.goto(session.base+'/register');await page.locator('#role').selectOption('supplier');assert(await page.locator('#companyField').isVisible());assert(await page.locator('#companyName').getAttribute('required')!==null);
 await page.goto(session.base);await page.screenshot({path:'/tmp/pharmacy-home.png',fullPage:true});
 await page.goto(session.base+'/login');await page.screenshot({path:'/tmp/pharmacy-login.png',fullPage:true});
 await page.goto(session.base+'/register');await page.screenshot({path:'/tmp/pharmacy-register.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});
 for(const path of ['/','/login','/register']){await page.goto(session.base+path);await page.screenshot({path:'/tmp/pharmacy-mobile-'+(path==='/'?'home':path.slice(1))+'.png',fullPage:true});const overflow=await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(n=>n.getBoundingClientRect().right>innerWidth+1).slice(0,8).map(n=>({tag:n.tagName,cls:n.className,width:n.getBoundingClientRect().width,right:n.getBoundingClientRect().right})));assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),path+' mobile overflow '+JSON.stringify(overflow));}
 await page.screenshot({path:'/tmp/pharmacy-register-mobile.png',fullPage:true});
 await page.setViewportSize({width:1440,height:1000});
 assert.equal(errors.length,0,errors.join('\n'));console.log('PASS public home, registration, approval, login/logout, protected redirect and mobile layouts');
 for(const role of ['supplier','pharmacist','admin','cashier']){
  await page.goto(session.base+'/login');await page.evaluate(({token,role})=>{localStorage.setItem('pharma_token',token);localStorage.setItem('pharma_user',JSON.stringify({id:'test',role,name:role+' Test'}))},{token:session.tokens[role],role});await page.goto(session.base+'/app');
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
