const assert=require('node:assert/strict');
const {MongoMemoryReplSet}=require('mongodb-memory-server');
const mongoose=require('mongoose');
const {spawn}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const sessionFile=path.join(os.tmpdir(),'pharmacy-test-session.json');
process.env.JWT_SECRET='integration-test-secret-with-at-least-32-characters';
let server,mongo,base,fixtureRoot;const tokens={};let checks=0;
const ok=(label,value)=>{assert.ok(value,label);checks++;console.log('PASS',label)};
async function call(role,path,method='GET',body,status=200){const r=await fetch(base+'/api'+path,{method,headers:{'Content-Type':'application/json',...(tokens[role]?{Authorization:'Bearer '+tokens[role]}:{})},body:body===undefined?undefined:JSON.stringify(body)});const d=await r.json();if(Array.isArray(status))assert.ok(status.includes(r.status),`${method} ${path}: ${JSON.stringify(d)}`);else assert.equal(r.status,status,`${method} ${path}: ${JSON.stringify(d)}`);return d;}
(async()=>{
 mongo=await MongoMemoryReplSet.create({binary:{version:'8.0.4'},replSet:{count:1,args:['--nounixsocket']}});
 const uri=mongo.getUri('pharmacy_test');await mongoose.connect(uri);
 const User=require('../src/models/User'),Supplier=require('../src/models/Supplier'),Medicine=require('../src/models/Medicine'),PO=require('../src/models/PurchaseOrder'),GR=require('../src/models/GoodsReceipt'),Return=require('../src/models/SupplierReturn'),Invoice=require('../src/models/SupplierInvoice'),Notification=require('../src/models/Notification');
 const sa=await Supplier.create({name:'Supplier A',returnPolicy:{acceptsNearExpiryReturns:true,minimumDaysBeforeExpiry:10,acceptsDamagedReturns:true}}),sb=await Supplier.create({name:'Supplier B'});
 for(const [role,company]of [['admin'],['pharmacist'],['cashier'],['supplier',sa],['supplierB',sb],['pharmacist2']]){const u=await User.create({name:role,email:role+'@test.com',password:'Test@123',role:role.startsWith('supplier')?'supplier':role==='pharmacist2'?'pharmacist':role,supplierCompany:company?._id});tokens[role]=u.generateAuthToken();}
 const med=await Medicine.create({name:'Test Medicine',genericName:'Generic',category:'Other',reorderLevel:10,batches:[]});
 for(const M of [User,Supplier,Medicine,PO,GR,Return,Invoice,Notification])await M.init();
 // Run the real application under a hidden ancestor, like the user's .gemini directory.
 fixtureRoot=fs.mkdtempSync(path.join(os.tmpdir(),'.pharmacy-integration-'));
 const sourceRoot=path.resolve(__dirname,'..');
 for(const file of ['server.js','package.json','src','public'])fs.cpSync(path.join(sourceRoot,file),path.join(fixtureRoot,file),{recursive:true});
 fs.symlinkSync(path.join(sourceRoot,'node_modules'),path.join(fixtureRoot,'node_modules'),process.platform==='win32'?'junction':'dir');
 fs.writeFileSync(path.join(fixtureRoot,'public','.private-config'),'private-test-value');
 server=spawn(process.execPath,['server.js'],{cwd:fixtureRoot,env:{...process.env,MONGODB_URI:uri,PORT:'5127',NODE_ENV:'test'},stdio:['ignore','pipe','pipe']});let logs='';server.stderr.on('data',b=>logs+=b);server.stdout.on('data',b=>logs+=b);base='http://127.0.0.1:5127';
 for(let i=0;i<100;i++){try{await fetch(base+'/api/health');break}catch{await new Promise(r=>setTimeout(r,100))}}
 for(const route of ['/','/home','/login','/register','/registration','/app','/css/access.css','/js/access.js']){
  const page=await fetch(base+route);assert.equal(page.status,200,'Hidden-directory application route '+route);
 }
 const privateResponse=await fetch(base+'/.private-config');assert(!(await privateResponse.text()).includes('private-test-value'));
 ok('pages load from hidden workspace without exposing hidden static files',true);
 const signup={name:'Applicant',email:'applicant@test.com',password:'Applicant@123',role:'pharmacist',isActive:true,supplierCompany:sa.id};
 const registered=await call('','/auth/register','POST',signup,201);ok('registration does not issue a token',!registered.token);
 const applicant=await User.findOne({email:signup.email});ok('registration cannot self-activate or link a company',!applicant.isActive&&applicant.supplierCompany===null&&applicant.registrationStatus==='pending');
 await call('','/auth/register','POST',signup,409);
 await call('','/auth/register','POST',{...signup,email:'admin.request@test.com',role:'admin'},400);
 await call('','/auth/register','POST',{...signup,email:'short@test.com',password:'short'},400);
 await call('','/auth/login','POST',{email:signup.email,password:signup.password},403);
 await call('cashier','/users/'+applicant.id,'PUT',{isActive:true},403);
 await call('admin','/users/'+applicant.id,'PUT',{isActive:true});
 ok('admin approves registration',(await User.findById(applicant.id)).registrationStatus==='approved');
 await call('','/auth/login','POST',{email:signup.email,password:signup.password});
 await call('','/auth/register','POST',{...signup,email:'supplier.request@test.com',role:'supplier'},400);
 await call('','/auth/register','POST',{...signup,email:'supplier.request@test.com',role:'supplier',companyName:'Requested Company'},201);
 const supplierRequest=await User.findOne({email:'supplier.request@test.com'});
 await call('admin','/users/'+supplierRequest.id,'PUT',{isActive:true,supplierCompany:sa.id});
 const approvedSupplier=await User.findById(supplierRequest.id).populate('supplierCompany');
 ok('approval automatically creates and links the registered company',approvedSupplier.supplierCompany.name==='Requested Company'&&String(approvedSupplier.supplierCompany._id)!==sa.id);
 await call('admin','/users/'+supplierRequest.id,'PUT',{isActive:true});
 ok('repeated approval does not duplicate company',await Supplier.countDocuments({companyKey:'requested company'})===1);
 ok('supplier can log in with their registered company',(await call('','/auth/login','POST',{email:'supplier.request@test.com',password:signup.password})).user.role==='supplier');
 for(const role of ['admin','pharmacist','cashier','supplier']){const d=await call('', '/auth/login','POST',{email:role+'@test.com',password:'Test@123'});ok(role+' login',d.token);}
 for(const path of ['/purchase-orders','/goods-receipts','/returns','/supplier-invoices','/suppliers'])await call('cashier',path,'GET',undefined,403);
 for(const path of ['/sales','/dashboard/stats','/medicines'])await call('supplier',path,'GET',undefined,403);
 ok('cashier and supplier API restrictions',true);
 await call('admin','/settings','PUT',{approvalRequired:true,approvalThreshold:null},400);
 await call('admin','/settings','PUT',{approvalRequired:true,approvalThreshold:100});
 const payload={supplierId:sa.id,items:[{medicineId:med.id,quantity:10,unitPrice:5}],isDraft:true};
 let o=(await call('pharmacist','/purchase-orders','POST',payload,201)).order;
 await call('supplier','/purchase-orders/'+o._id,'GET',undefined,404);
 const filtered=await call('supplier','/purchase-orders?status=Draft');ok('supplier cannot filter into drafts',filtered.orders.length===0);
 await call('pharmacist',`/purchase-orders/${o._id}/draft`,'PUT',{items:[{medicineId:med.id,quantity:10,unitPrice:5}]});
 o=(await call('pharmacist',`/purchase-orders/${o._id}/submit`,'POST',{})).order;ok('draft submits below threshold',o.status==='Submitted');
 const notices=await call('supplier','/notifications'),other=await call('supplierB','/notifications');ok('notification supplier isolation',notices.notifications.length>0&&other.notifications.length===0);
 await call('supplierB','/notifications/'+notices.notifications[0]._id+'/read','PUT',{},404);
 await call('supplierB','/purchase-orders/'+o._id,'GET',undefined,404);
 await call('supplierB',`/purchase-orders/${o._id}/supplier-response`,'PUT',{decision:'accept'},404);
 await call('supplier',`/purchase-orders/${o._id}/propose-changes`,'PUT',{reason:'Price updated',proposedItems:[{medicineId:med.id,quantity:10,unitPrice:15}]});
 await call('supplier',`/purchase-orders/${o._id}/shipping`,'PUT',{stage:'packed'},400);
 o=(await call('pharmacist',`/purchase-orders/${o._id}/review-proposed-changes`,'PUT',{decision:'confirm'})).order;ok('price increase triggers approval',o.status==='Pending Admin Approval');
 await call('admin',`/purchase-orders/${o._id}/admin-approval`,'PUT',{decision:'approve'});
 await call('supplier',`/purchase-orders/${o._id}/supplier-response`,'PUT',{decision:'accept'});
 await call('supplier',`/purchase-orders/${o._id}/shipping`,'PUT',{stage:'packed'});
 await call('supplier',`/purchase-orders/${o._id}/shipping`,'PUT',{stage:'dispatched',carrier:'Test Carrier',trackingReference:'T123'});
 await call('supplier',`/purchase-orders/${o._id}/shipping`,'PUT',{stage:'delivered'});
 ok('delivered does not increase stock',(await Medicine.findById(med.id)).totalStock===0);
 const exp=new Date(Date.now()+200*86400000).toISOString();
 const batch=q=>({batchNumber:'B001',expiryDate:exp,quantity:q,costPrice:15,sellingPrice:20,rackLocation:'Shelf A'});
 const receipt={receiptSubmissionKey:'receipt-1',purchaseOrderId:o._id,items:[{medicineId:med.id,deliveredQuantity:7,acceptedQuantity:6,rejectedQuantity:1,rejectionReason:'Damaged',batches:[batch(3),{...batch(3),batchNumber:'B002'}]}]};
 const r=(await call('pharmacist','/goods-receipts','POST',receipt,201));ok('partial multibatch receipt',r.orderStatus==='Partially Received'&&(await Medicine.findById(med.id)).totalStock===6);
 const dup=await call('pharmacist','/goods-receipts','POST',receipt);ok('duplicate is idempotent',dup.isDuplicate&&(await Medicine.findById(med.id)).totalStock===6);
 await call('pharmacist','/goods-receipts','POST',{...receipt,notes:'different'},409);
 await call('pharmacist','/goods-receipts','POST',{...receipt,receiptSubmissionKey:'over',items:[{medicineId:med.id,deliveredQuantity:5,acceptedQuantity:5,rejectedQuantity:0,batches:[batch(5)]}]},400);
 const bad={...receipt,receiptSubmissionKey:'expired',items:[{medicineId:med.id,deliveredQuantity:1,acceptedQuantity:1,rejectedQuantity:0,batches:[{...batch(1),expiryDate:'2000-01-01'}]}]};await call('pharmacist','/goods-receipts','POST',bad,400);ok('invalid receipts leave stock unchanged',(await Medicine.findById(med.id)).totalStock===6);
 const final={...receipt,receiptSubmissionKey:'receipt-2',items:[{medicineId:med.id,deliveredQuantity:4,acceptedQuantity:4,rejectedQuantity:0,batches:[{...batch(4),batchNumber:'B003'}]}]};
 const finals=await Promise.all([call('pharmacist','/goods-receipts','POST',final,[200,201]),call('pharmacist','/goods-receipts','POST',final,[200,201])]);
 // Both concurrent responses succeed; one is a replay. Database invariants must hold.
 ok('concurrent receipt does not duplicate stock',(await Medicine.findById(med.id)).totalStock===10&&await GR.countDocuments({receiptSubmissionKey:'receipt-2'})===1);
 ok('order fully received',(await PO.findById(o._id)).status==='Received');
 let updated=await Medicine.findById(med.id),source=updated.batches.find(b=>b.batchNumber==='B001');
 let ret=(await call('pharmacist','/returns','POST',{medicineId:med.id,batchId:String(source._id),quantity:2,reason:'Damaged / Defective'},201)).supplierReturn;
 updated=await Medicine.findById(med.id);ok('partial return quarantines only requested units',updated.totalStock===8&&updated.batches.id(source._id).quantity===1&&updated.batches.id(ret.quarantineBatchId).quantity===2);
 await call('supplierB',`/returns/${ret._id}/status`,'PUT',{status:'Approved'},404);
 await call('pharmacist',`/returns/${ret._id}/status`,'PUT',{status:'Approved'},403);
 await call('supplier',`/returns/${ret._id}/status`,'PUT',{status:'Supplier Received'},400);
 await call('supplier',`/returns/${ret._id}/status`,'PUT',{status:'Approved'});
 await call('pharmacist',`/returns/${ret._id}/status`,'PUT',{status:'Sent Back'});
 await call('supplier',`/returns/${ret._id}/status`,'PUT',{status:'Supplier Received'});
 await call('supplier',`/returns/${ret._id}/resolve`,'PUT',{resolution:'Credit Note',creditNoteReference:'CN-1'});
 ok('return does not deduct sellable stock twice',(await Medicine.findById(med.id)).totalStock===8);
 const inv=(await call('pharmacist','/supplier-invoices','POST',{supplierId:sa.id,invoiceNumber:'SUP-1',purchaseOrderIds:[o._id],goodsReceiptIds:[r.receipt._id],itemsTotal:150,dueDate:'2030-01-01'},201)).invoice;
 await call('supplierB','/supplier-invoices/'+inv._id,'GET',undefined,403);
 await call('pharmacist','/supplier-invoices/'+inv._id+'/apply-credit','POST',{creditNoteReference:'CN-1',creditAmount:30});
 await call('pharmacist','/supplier-invoices/'+inv._id+'/apply-credit','POST',{creditNoteReference:'CN-1',creditAmount:30},400);
 const paid=await call('pharmacist','/supplier-invoices/'+inv._id+'/payments','POST',{amount:120,paymentMethod:'upi'});ok('invoice credit and payment reconciled',paid.invoice.balanceDue===0&&paid.invoice.status==='Paid');
 const stock=await call('cashier','/medicines');ok('cashier cannot retrieve cost prices',!JSON.stringify(stock).includes('costPrice'));
 const sale=await call('cashier','/sales','POST',{items:[{medicineId:med.id,batchNumber:'B001',quantity:1}],paymentMethod:'cash',paidAmount:20},201);ok('POS still bills and deducts stock',sale.sale.grandTotal===20&&(await Medicine.findById(med.id)).totalStock===7);
 const quarantined=(await Medicine.findById(med.id)).batches.find(b=>b.returnReference);
 await call('cashier','/sales','POST',{items:[{medicineId:med.id,batchNumber:quarantined.batchNumber,quantity:50}],paymentMethod:'cash',paidAmount:1000},400);
 const notice=await Notification.create({recipientRole:'pharmacist',title:'Staff alert',message:'Per-user read state'});await call('pharmacist',`/notifications/${notice.id}/read`,'PUT',{});ok('notification read state is per user',(await call('pharmacist2','/notifications')).notifications.some(n=>n._id===notice.id&&!n.isRead));
 // Attachment ownership, content verification and public-path denial.
 const form=new FormData();form.append('attachment',new Blob(['%PDF-1.4\n%%EOF'],{type:'application/pdf'}),'invoice.pdf');let response=await fetch(base+`/api/attachments/orders/${o._id}`,{method:'POST',headers:{Authorization:'Bearer '+tokens.pharmacist},body:form});assert.equal(response.status,201);const attachment=(await response.json()).attachment;
 response=await fetch(base+'/uploads/attachments/'+attachment.filename);assert.equal(response.status,404);
 response=await fetch(base+'/api/attachments/'+attachment.filename,{headers:{Authorization:'Bearer '+tokens.supplierB}});assert.equal(response.status,404);
 response=await fetch(base+'/api/attachments/'+attachment.filename,{headers:{Authorization:'Bearer '+tokens.supplier}});assert.equal(response.status,200);ok('attachments protected by ownership',true);
 const perf=await call('pharmacist','/suppliers/performance');ok('supplier performance uses actual records',perf.performance.some(p=>p.supplierName==='Supplier A'&&p.totalOrders===1));
 await call('supplier','/suppliers/my-company','PUT',{contactPerson:'New Contact',phone:'1234567890'});ok('supplier company profile editable',true);
 await call('admin','/procurement-audit');ok('admin audit endpoint available',true);
 console.log(`\n${checks} grouped checks passed.`);
 if(process.env.RUN_UI==='1'){fs.writeFileSync(sessionFile,JSON.stringify({base,tokens,uri}));await new Promise((resolve,reject)=>{const ui=spawn(process.execPath,['tests/ui.cjs'],{stdio:'inherit',env:process.env});ui.on('exit',code=>code?reject(new Error('UI checks failed')):resolve());});}
 if(process.env.KEEP_TEST_SERVER==='1'){fs.writeFileSync(sessionFile,JSON.stringify({base,tokens,uri}));await new Promise(r=>setTimeout(r,600000));}
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{if(server&&server.exitCode===null){server.kill();await new Promise(r=>server.once('exit',r));}await mongoose.disconnect();if(mongo)await mongo.stop();if(fixtureRoot)fs.rmSync(fixtureRoot,{recursive:true,force:true})});
