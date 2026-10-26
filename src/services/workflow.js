const mongoose = require('mongoose');
const crypto = require('crypto');
const fail = (message,status=400) => {const e=new Error(message);e.statusCode=status;throw e;};
const number = (v,label,{integer=false,positive=false}={}) => {const n=Number(v);if(v===null||v===''||v===undefined||!Number.isFinite(n)||(positive?n<=0:n<0)||(integer&&!Number.isSafeInteger(n)))fail('Invalid '+label);return n;};
const money = n => Math.round((n+Number.EPSILON)*100)/100;
const serial = prefix => prefix+'-'+new Date().toISOString().slice(0,10).replaceAll('-','')+'-'+crypto.randomUUID().slice(0,12).toUpperCase();
// Fail closed before writing on standalone MongoDB. Never perform partial stock writes.
const atomic = async fn => {
 const hello=await mongoose.connection.db.admin().command({hello:1});
 if(!hello.setName && hello.msg!=='isdbgrid')fail('This stock operation requires MongoDB replica-set transactions. See README setup instructions.',503);
 const session=await mongoose.startSession();
 try {let value;await session.withTransaction(async()=>{value=await fn(session)});return value;} finally{await session.endSession();}
};
const audit=async(req,action,details,session,extra={})=>{await require('../models/AuditLog').create([{user:req.user._id,userName:req.user.name,userRole:req.user.role,action,details,...extra}],session?{session}:{});};
module.exports={fail,number,money,serial,atomic,audit};
