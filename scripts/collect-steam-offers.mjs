import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectSteamDiscovery, operationPaths } from './daily-operations.mjs';
import { loadPlaywright, sha256 } from './collect-steam-discovery.mjs';

const API_URL='https://api.steampowered.com/IStoreBrowseService/GetItems/v1/';
const CONTEXT=Object.freeze({language:'schinese',country_code:'CN',steam_realm:1});
function ids(values){
  if(!Array.isArray(values)||!values.length||values.some(id=>!/^\d{3,}$/.test(String(id))||!Number.isSafeInteger(Number(id))||Number(id)>4294967295))throw Error('APP_IDS_INVALID');
  const result=values.map(String);
  if(new Set(result).size!==result.length)throw Error('APP_IDS_DUPLICATE');
  return result;
}
export function storeOffersUrl(appIds){
  const input={ids:ids(appIds).map(id=>({appid:Number(id)})),context:CONTEXT,data_request:{include_all_purchase_options:true,include_assets:true}};
  return API_URL+'?input_json='+encodeURIComponent(JSON.stringify(input));
}
export function assertStoreOffersSource(url,appIds,method='GET'){
  if(method!=='GET'||url!==storeOffersUrl(appIds))throw Error('OFFERS_SOURCE_REJECTED');
}
function price(value,minor){
  if(typeof value!=='string'||!/^¥\s*\d+(?:,\d{3})*(?:\.\d{1,2})?$/.test(value)||!/^\d+$/.test(String(minor)))throw Error('CNY_PRICE_INVALID');
  if(Math.round(Number(value.replace(/[¥,\s]/g,''))*100)!==Number(minor))throw Error('PRICE_MINOR_MISMATCH');
  return '¥'+(Number(minor)/100).toFixed(2);
}
export function parseStoreOffers(raw,appIds){
  const expected=ids(appIds),data=JSON.parse(raw),items=data?.response?.store_items;
  if(!Array.isArray(items))throw Error('STORE_ITEMS_MISSING');
  const actual=items.map(item=>String(item.appid));
  if(actual.length!==expected.length||new Set(actual).size!==actual.length||actual.some(id=>!expected.includes(id)))throw Error('RESPONSE_APP_IDS_MISMATCH');
  return expected.map(appId=>{
    const item=items.find(value=>String(value.appid)===appId);
    try{
      if(item.success!==1||item.visible!==true||item.item_type!==0||item.id!==Number(appId)||!item.name)throw Error('ITEM_UNAVAILABLE');
      if(item.type===4)return{appId,status:'verified-ineligible',reason:'DLC_NOT_STANDALONE_GAME',name:item.name,appType:item.type,url:`https://store.steampowered.com/app/${appId}/?cc=cn&l=schinese`};
      if(item.type!==0)throw Error('APP_TYPE_UNRESOLVED');
      const option=item.best_purchase_option;
      if(!option||!Number.isSafeInteger(option.packageid)||option.packageid<=0||option.bundleid||option.price_cannot_be_displayed_as_discount||option.hide_discount_pct_for_compliance)throw Error('PURCHASE_OPTION_UNRESOLVED');
      const matching=(item.purchase_options||[]).find(value=>value.packageid===option.packageid);
      const offerFields=['packageid','purchase_option_name','final_price_in_cents','original_price_in_cents','formatted_final_price','formatted_original_price','discount_pct','active_discounts','hide_discount_pct_for_compliance','price_cannot_be_displayed_as_discount'];
      if(!matching||offerFields.some(field=>JSON.stringify(matching[field])!==JSON.stringify(option[field])))throw Error('PURCHASE_OPTION_MISMATCH');
      const current=price(option.formatted_final_price,option.final_price_in_cents);
      if(!option.discount_pct&&!(option.active_discounts||[]).length&&(item.purchase_options||[]).filter(value=>value.packageid).every(value=>!(value.active_discounts||[]).length))return{appId,status:'verified-ineligible',reason:'NO_ACTIVE_DISCOUNT',name:item.name,country:'CN',currency:'CNY',packageId:String(option.packageid),current,url:`https://store.steampowered.com/app/${appId}/?cc=cn&l=schinese`};
      const original=price(option.formatted_original_price,option.original_price_in_cents);
      if(!Number.isInteger(option.discount_pct)||option.discount_pct<1||option.discount_pct>100||Number(option.final_price_in_cents)<=0||Number(option.final_price_in_cents)>=Number(option.original_price_in_cents))throw Error('DISCOUNT_UNRESOLVED');
      const discounts=option.active_discounts;
      if(!Array.isArray(discounts)||!discounts.length||discounts.some(value=>!Number.isSafeInteger(value.discount_end_date)||value.discount_end_date<=0))throw Error('SALE_END_MISSING');
      const ends=[...new Set(discounts.map(value=>value.discount_end_date))];
      if(ends.length!==1)throw Error('SALE_END_AMBIGUOUS');
      if(discounts.some(value=>!/^\d+$/.test(String(value.discount_amount)))||discounts.reduce((sum,value)=>sum+Number(value.discount_amount),0)!==Number(option.original_price_in_cents)-Number(option.final_price_in_cents))throw Error('DISCOUNT_AMOUNT_MISMATCH');
      return{appId,status:'verified-offer',name:item.name,country:'CN',currency:'CNY',packageId:String(option.packageid),purchaseOptionName:option.purchase_option_name,original,current,discountPercent:option.discount_pct,saleEndUnix:ends[0],saleEndStatus:'explicit-official-unix',url:`https://store.steampowered.com/app/${appId}/?cc=cn&l=schinese`,assets:item.assets||null,historicalPriceVerified:false};
    }catch(error){return{appId,status:'unresolved',reason:error.message};}
  });
}
async function freezeIdentity(root,date){
  const snapshot=await inspectSteamDiscovery(root,date);
  return{appIds:[...new Set([...snapshot.appIds,...(snapshot.extraAppIds||[])])],sha256:sha256(await fs.readFile(operationPaths(root,date).steamDiscovery)),frozenAt:snapshot.frozenAt};
}
export async function collectSteamOffers({root=process.cwd(),date,out}){
  const freeze=await freezeIdentity(root,date),url=storeOffersUrl(freeze.appIds);
  const target=path.resolve(root,out||''),relative=path.relative(path.resolve(root,'output'),target);
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||!target.endsWith('.json'))throw Error('OUTPUT_REJECTED');
  const {chromium}=await loadPlaywright();
  const proxyUrl=process.env.HTTPS_PROXY||process.env.HTTP_PROXY;
  let proxy;
  if(proxyUrl){const u=new URL(proxyUrl);if(!['http:','https:','socks5:'].includes(u.protocol)||u.username||u.password)throw Error('PROXY_UNSUPPORTED');proxy={server:u.origin};}
  const browser=await chromium.launch({channel:'msedge',headless:true,...(proxy?{proxy}:{})});
  try{
    const context=await browser.newContext({javaScriptEnabled:false,serviceWorkers:'block'});
    const response=await context.request.get(url,{maxRedirects:0,timeout:60000,headers:{Cookie:'',Authorization:''}});
    assertStoreOffersSource(response.url(),freeze.appIds);
    if(response.status()!==200)throw Error('HTTP_ERROR: '+response.status());
    const raw=await response.body(),observedAt=new Date().toISOString();
    const offers=parseStoreOffers(raw.toString('utf8'),freeze.appIds);
    const currentFreeze=await freezeIdentity(root,date);
    if(currentFreeze.sha256!==freeze.sha256)throw Error('FREEZE_CHANGED_DURING_COLLECTION');
    const rawFile=target.replace(/\.json$/,'.response.json');
    const evidence={schemaVersion:1,date,observedAt,method:'GET',authenticated:false,sourceUrl:url,responseUrl:response.url(),httpStatus:200,context:CONTEXT,freeze,rawResponseFile:path.basename(rawFile),rawResponseSha256:sha256(raw),offers};
    await fs.mkdir(path.dirname(target),{recursive:true});
    await fs.writeFile(rawFile,raw,{flag:'wx'});
    await fs.writeFile(target,JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});
    return{output:target,observedAt,appIdCount:offers.length,verifiedCount:offers.filter(value=>value.status==='verified-offer').length,unresolved:offers.filter(value=>value.status==='unresolved')};
  }finally{await browser.close();}
}
export async function replaySteamOffers(file,{root=process.cwd()}={}){
  const evidence=JSON.parse(await fs.readFile(file,'utf8'));
  const freeze=await freezeIdentity(root,evidence.date);
  if(JSON.stringify(freeze)!==JSON.stringify(evidence.freeze)||evidence.authenticated!==false||evidence.httpStatus!==200||evidence.method!=='GET'||JSON.stringify(evidence.context)!==JSON.stringify(CONTEXT)||!Number.isFinite(Date.parse(evidence.observedAt)))throw Error('OFFER_EVIDENCE_INVALID');
  assertStoreOffersSource(evidence.sourceUrl,freeze.appIds);
  assertStoreOffersSource(evidence.responseUrl,freeze.appIds);
  const raw=await fs.readFile(path.resolve(path.dirname(file),evidence.rawResponseFile));
  if(sha256(raw)!==evidence.rawResponseSha256)throw Error('RAW_HASH_MISMATCH');
  const offers=parseStoreOffers(raw.toString('utf8'),freeze.appIds);
  if(JSON.stringify(offers)!==JSON.stringify(evidence.offers))throw Error('PARSED_EVIDENCE_MISMATCH');
  return{valid:true,appIdCount:offers.length,verifiedCount:offers.filter(value=>value.status==='verified-offer').length,unresolved:offers.filter(value=>value.status==='unresolved')};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{
    const args=Object.fromEntries(process.argv.slice(2).map(arg=>{const i=arg.indexOf('=');return[arg.slice(2,i),arg.slice(i+1)];}));
    const result=args.replay?await replaySteamOffers(args.replay):await collectSteamOffers({date:args.date,out:args.out});
    console.log(JSON.stringify(result,null,2));
  }catch(error){console.error(error.message);process.exitCode=1;}
}
