import test from 'node:test';
import assert from 'node:assert/strict';
import {assertStoreOffersSource,storeOffersUrl,parseStoreOffers} from './collect-steam-offers.mjs';
const appIds=['1771300','292030'];
const option=()=>({packageid:635513,purchase_option_name:'Base game',final_price_in_cents:'9120',original_price_in_cents:'22800',formatted_final_price:'¥91.20',formatted_original_price:'¥228.00',discount_pct:60,active_discounts:[{discount_amount:'13680',discount_end_date:1790874000}]});
function fixture(){return{response:{store_items:appIds.map(appid=>{const purchase=option();return{item_type:0,type:0,id:Number(appid),appid:Number(appid),success:1,visible:true,name:'Game '+appid,best_purchase_option:purchase,purchase_options:[structuredClone(purchase)]};})}};}
function parse(data=fixture()){return parseStoreOffers(JSON.stringify(data),appIds);}
function modify(change){const data=fixture();change(data.response.store_items[0]);return parse(data)[0];}
test('anonymous official request binds exact frozen IDs and CN context',()=>{
 const url=storeOffersUrl(appIds);assert.doesNotThrow(()=>assertStoreOffersSource(url,appIds));
 for(const bad of [url.replace('api.steampowered.com','example.org'),url+'&key=test',url.replace('CN','US'),url.replace('1771300','1888930')])assert.throws(()=>assertStoreOffersSource(bad,appIds));
 assert.throws(()=>assertStoreOffersSource(url,appIds,'POST'));assert.throws(()=>storeOffersUrl([...appIds,appIds[0]]));
});
test('exact app set and each package offer are checked before accepting prices',()=>{
 const result=parse();assert.equal(result.length,2);assert.equal(result[0].current,'¥91.20');assert.equal(result[0].saleEndUnix,1790874000);assert.equal(result[0].historicalPriceVerified,false);
 const missing=fixture();missing.response.store_items.pop();assert.throws(()=>parse(missing),/APP_IDS_MISMATCH/);
 const duplicate=fixture();duplicate.response.store_items[1]=structuredClone(duplicate.response.store_items[0]);assert.throws(()=>parse(duplicate),/APP_IDS_MISMATCH/);
 assert.equal(modify(item=>item.purchase_options[0].packageid=123).reason,'PURCHASE_OPTION_MISMATCH');
 assert.equal(modify(item=>item.purchase_options[0].final_price_in_cents='1').reason,'PURCHASE_OPTION_MISMATCH');
 assert.equal(modify(item=>item.purchase_options[0].is_edition=true).status,'verified-offer','edition UI metadata does not change the same package price or expiry');
});
test('foreign currency, missing or conflicting dates and unverified prices remain unresolved',()=>{
 for(const [change,reason] of [
  [o=>o.formatted_final_price='$91.20','CNY_PRICE_INVALID'],
  [o=>o.final_price_in_cents='9100','PRICE_MINOR_MISMATCH'],
  [o=>delete o.active_discounts[0].discount_end_date,'SALE_END_MISSING'],
  [o=>o.active_discounts.push({discount_amount:'0',discount_end_date:1790884000}),'SALE_END_AMBIGUOUS'],
  [o=>o.active_discounts[0].discount_amount='1','DISCOUNT_AMOUNT_MISMATCH'],
 ]){const result=modify(item=>{change(item.best_purchase_option);item.purchase_options=[structuredClone(item.best_purchase_option)];});assert.equal(result.status,'unresolved');assert.equal(result.reason,reason);}
 assert.equal(modify(item=>item.visible=false).status,'unresolved');
 assert.equal(modify(item=>delete item.type).status,'unresolved');
});
test('official DLC metadata and matching full-price packages give explicit eligibility decisions',()=>{
 assert.equal(modify(item=>item.type=4).reason,'DLC_NOT_STANDALONE_GAME');
 const noSale=modify(item=>{delete item.best_purchase_option.discount_pct;delete item.best_purchase_option.active_discounts;delete item.best_purchase_option.original_price_in_cents;delete item.best_purchase_option.formatted_original_price;item.purchase_options=[structuredClone(item.best_purchase_option)];});
 assert.equal(noSale.status,'verified-ineligible');assert.equal(noSale.reason,'NO_ACTIVE_DISCOUNT');assert.equal(noSale.current,'¥91.20');
 assert.equal(modify(item=>{delete item.best_purchase_option.active_discounts;item.purchase_options=[structuredClone(item.best_purchase_option)];}).status,'unresolved','a discount claim without an official expiry is not a verified rejection');
});
