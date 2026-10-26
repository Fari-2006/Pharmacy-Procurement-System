module.exports = (req,res,next) => {
 const json=res.json.bind(res);
 res.json = body => {
  if (req.user?.role === 'cashier' || req.user?.role === 'supplier') {
   const clean = value => {
    if(Array.isArray(value))return value.map(clean);
    if(value && typeof value === 'object')return Object.fromEntries(Object.entries(value).filter(([k])=>!['path',...(req.user.role==='cashier'?['costPrice','purchasePrice','bankDetails']:['sellingPrice'])].includes(k)).map(([k,v])=>[k,clean(v)]));
    return value;
   };
   body=clean(JSON.parse(JSON.stringify(body)));
  }
  return json(body);
 };
 next();
};
